/**
 * Pull-before-push, user-edit gate, and compare-and-swap.
 * Idle time does not write. A stale rack cannot shrink the account.
 */
import {
  accountPool,
  mergeAccount,
  type CloudGarment,
  type CloudLook,
  type CloudMeta,
} from "./merge.ts";
import { shrinkGuard } from "./guard.ts";
import { embedTasteAvoid, peelTasteAvoid } from "../taste.ts";

export type SyncMemory = {
  pulled: boolean;
  dirty: boolean;
  rev: number | null;
  updatedAt: string | null;
  baseGarmentIds: string[];
  baseLookIds: string[];
  base: CloudMeta | null;
};

export type FetchCloud =
  | { ok: true; cloud: CloudMeta | null }
  | { ok: false };

export type WriteResult =
  | { ok: true; rev: number; updatedAt: string }
  | { ok: false; conflict: boolean };

/**
 * Only a missing closet_meta_push may use the table compare-and-swap.
 * Permission denied and every other RPC error abort. They do not write.
 */
export function rpcFailurePlan(error: {
  code?: string;
  message?: string;
  status?: number;
}): "fallback" | "abort" {
  if (error.code === "42501") return "abort";
  if (error.status === 401 || error.status === 403) return "abort";
  const message = error.message ?? "";
  if (/permission denied|insufficient privilege/i.test(message)) return "abort";
  if (error.code === "PGRST202" || error.code === "42883") return "fallback";
  if (/could not find the function/i.test(message)) return "fallback";
  if (/schema cache/i.test(message) && /function/i.test(message) && /not find|does not exist/i.test(message)) {
    return "fallback";
  }
  if (/function .+ does not exist/i.test(message)) return "fallback";
  return "abort";
}

export function freshMemory(): SyncMemory {
  return {
    pulled: false,
    dirty: false,
    rev: null,
    updatedAt: null,
    baseGarmentIds: [],
    baseLookIds: [],
    base: null,
  };
}

export function markDirty(mem: SyncMemory): SyncMemory {
  return { ...mem, dirty: true };
}

/** A push is allowed only after a successful pull, and only for a user edit. */
export function shouldSchedulePush(mem: SyncMemory): boolean {
  return mem.pulled && mem.dirty;
}

function cloneMeta(meta: CloudMeta): CloudMeta {
  return JSON.parse(JSON.stringify(meta)) as CloudMeta;
}

export function liveGarmentIds(meta: CloudMeta): string[] {
  return accountPool(meta.garments)
    .filter((g) => g.tombstone !== true)
    .map((g) => g.id);
}

export function liveLookIds(meta: CloudMeta): string[] {
  return meta.looks.filter((l) => l.tombstone !== true).map((l) => l.id);
}

/**
 * Base is the last server snapshot, never the merged rack.
 * An unsent local edit lives in the store; the next push diffs it against this row.
 * A null server row means there is no base.
 */
export function rememberPull(mem: SyncMemory, cloud: CloudMeta | null, merged: CloudMeta): SyncMemory {
  void merged;
  if (!cloud) {
    return {
      pulled: true,
      dirty: mem.dirty,
      rev: null,
      updatedAt: null,
      baseGarmentIds: [],
      baseLookIds: [],
      base: null,
    };
  }
  const snap = cloneMeta(cloud);
  return {
    pulled: true,
    dirty: mem.dirty,
    rev: typeof cloud.rev === "number" ? cloud.rev : null,
    updatedAt: cloud.updatedAt ?? null,
    baseGarmentIds: liveGarmentIds(snap),
    baseLookIds: liveLookIds(snap),
    base: snap,
  };
}

/** Postgres 40001 from closet_meta_require_rev_bump. Retry the compare-and-swap; do not abort. */
export function isRevConflict(error: { code?: string; message?: string }): boolean {
  if (error.code === "40001") return true;
  return /stale write refused/i.test(error.message ?? "");
}

function uniq(ids: string[]): string[] {
  return [...new Set(ids)];
}

/** Read a closet_meta row, including tombstone stubs embedded in the jsonb. */
export function rowToCloud(data: {
  garments?: unknown;
  looks?: unknown;
  journal?: unknown;
  avoid?: unknown;
  drop?: unknown;
  ref_photo?: unknown;
  v?: unknown;
  rev?: unknown;
  updated_at?: unknown;
  deleted_garments?: unknown;
  deleted_looks?: unknown;
} | null): CloudMeta | null {
  if (!data) return null;
  const garmentsIn = Array.isArray(data.garments) ? (data.garments as CloudGarment[]) : [];
  const looksIn = Array.isArray(data.looks) ? (data.looks as CloudLook[]) : [];
  const deletedGarments = new Set<string>(
    Array.isArray(data.deleted_garments)
      ? data.deleted_garments.filter((id): id is string => typeof id === "string")
      : [],
  );
  const deletedLooks = new Set<string>(
    Array.isArray(data.deleted_looks)
      ? data.deleted_looks.filter((id): id is string => typeof id === "string")
      : [],
  );
  const garments: CloudGarment[] = [];
  for (const g of garmentsIn) {
    if (!g || typeof g.id !== "string") continue;
    if (g.tombstone) {
      deletedGarments.add(g.id);
      continue;
    }
    garments.push(g);
  }
  const looks: CloudLook[] = [];
  for (const l of looksIn) {
    if (!l || typeof l.id !== "string") continue;
    if (l.tombstone) {
      deletedLooks.add(l.id);
      continue;
    }
    looks.push(l);
  }
  const peeled = peelTasteAvoid(data.avoid);
  return {
    garments,
    looks,
    journal: Array.isArray(data.journal) ? (data.journal as CloudMeta["journal"]) : [],
    avoid: peeled.avoid,
    ...(peeled.taste ? { taste: peeled.taste } : {}),
    drop: (data.drop as CloudMeta["drop"]) ?? null,
    refPhoto: Boolean(data.ref_photo),
    v: typeof data.v === "number" ? data.v : 6,
    rev: typeof data.rev === "number" ? data.rev : undefined,
    updatedAt: typeof data.updated_at === "string" ? data.updated_at : undefined,
    deletedGarments: [...deletedGarments],
    deletedLooks: [...deletedLooks],
  };
}

/** Live rows plus tombstone stubs so a pre-migration jsonb row still carries deletes. */
export function packCloud(meta: CloudMeta): CloudMeta {
  const deletedGarments = meta.deletedGarments ?? [];
  const deletedLooks = meta.deletedLooks ?? [];
  const liveG = meta.garments.filter((g) => g.tombstone !== true);
  const liveL = meta.looks.filter((l) => l.tombstone !== true);
  const haveG = new Set(liveG.map((g) => g.id));
  const haveL = new Set(liveL.map((l) => l.id));
  return {
    ...meta,
    v: 6,
    garments: [
      ...liveG,
      ...deletedGarments
        .filter((id) => !haveG.has(id))
        .map((id) => ({ id, archived: true, tombstone: true })),
    ],
    looks: [
      ...liveL,
      ...deletedLooks
        .filter((id) => !haveL.has(id))
        .map((id) => ({ id, garmentIds: [], tombstone: true })),
    ],
    deletedGarments,
    deletedLooks,
  };
}

export function mergeForSync(opts: {
  local: CloudMeta;
  cloud: CloudMeta | null;
  tombstones: { garments: string[]; looks: string[] };
  base: CloudMeta | null;
}): CloudMeta {
  return mergeAccount({
    local: opts.local,
    cloud: opts.cloud,
    lastCloudIds: opts.base ? liveGarmentIds(opts.base) : null,
    tombstones: uniq([...opts.tombstones.garments, ...(opts.cloud?.deletedGarments ?? [])]),
    deletedLooks: uniq([...opts.tombstones.looks, ...(opts.cloud?.deletedLooks ?? [])]),
    base: opts.base,
  }).next;
}

export async function pushIfDirty(opts: {
  mem: SyncMemory;
  local: CloudMeta;
  tombstones: { garments: string[]; looks: string[] };
  fetchCloud: () => Promise<FetchCloud>;
  write: (
    expected: { rev: number | null; updatedAt: string | null },
    payload: CloudMeta,
  ) => Promise<WriteResult>;
  prepare?: (merged: CloudMeta) => Promise<CloudMeta>;
  log?: (message: string, detail?: Record<string, unknown>) => void;
}): Promise<{
  mem: SyncMemory;
  wrote: boolean;
  refused: boolean;
  /** Network failure or three conflicts. Keep the edit and retry. */
  retry: boolean;
  merged: CloudMeta | null;
}> {
  if (!shouldSchedulePush(opts.mem)) {
    return { mem: opts.mem, wrote: false, refused: false, retry: false, merged: null };
  }

  const base = opts.mem.base;

  for (let attempt = 0; attempt < 3; attempt++) {
    const fetched = await opts.fetchCloud();
    if (!fetched.ok) return { mem: opts.mem, wrote: false, refused: false, retry: true, merged: null };
    const cloud = fetched.cloud;
    const merged = mergeForSync({
      local: opts.local,
      cloud,
      tombstones: opts.tombstones,
      base,
    });
    const guard = shrinkGuard({
      baseGarmentIds: uniq([
        ...(base ? liveGarmentIds(base) : []),
        ...(cloud ? liveGarmentIds(cloud) : []),
      ]),
      baseLookIds: uniq([
        ...(base ? liveLookIds(base) : []),
        ...(cloud ? liveLookIds(cloud) : []),
      ]),
      baseLooks: [...(base?.looks ?? []), ...(cloud?.looks ?? [])],
      nextGarmentIds: liveGarmentIds(merged),
      nextLookIds: liveLookIds(merged),
      deletedGarments: merged.deletedGarments ?? [],
      deletedLooks: merged.deletedLooks ?? [],
    });
    if (!guard.ok) {
      opts.log?.("[closet] refused push", {
        reason: guard.reason,
        garments: guard.garments,
        looks: guard.looks,
      });
      return {
        mem: { ...opts.mem, dirty: false },
        wrote: false,
        refused: true,
        retry: false,
        merged: null,
      };
    }
    const prepared = opts.prepare ? await opts.prepare(merged) : merged;
    const payload = packCloud({
      ...prepared,
      deletedGarments: merged.deletedGarments,
      deletedLooks: merged.deletedLooks,
      v: 6,
    });
    const result = await opts.write(
      {
        rev: cloud && typeof cloud.rev === "number" ? cloud.rev : null,
        updatedAt: cloud?.updatedAt ?? null,
      },
      payload,
    );
    if (result.ok) {
      const stored = rowToCloud({
        garments: payload.garments,
        looks: payload.looks,
        journal: payload.journal,
        avoid: embedTasteAvoid(payload.avoid, payload.taste),
        drop: payload.drop,
        ref_photo: payload.refPhoto,
        v: 6,
        rev: result.rev,
        updated_at: result.updatedAt,
        deleted_garments: payload.deletedGarments,
        deleted_looks: payload.deletedLooks,
      });
      const nextMem = rememberPull(
        { ...opts.mem, dirty: false },
        stored,
        stored ?? payload,
      );
      return { mem: nextMem, wrote: true, refused: false, retry: false, merged: stored };
    }
    if (!result.conflict) {
      return { mem: opts.mem, wrote: false, refused: false, retry: false, merged: null };
    }
    // Next attempt re-fetches and merges against the same base, so an edit
    // on this phone still diffs from the last pull.
    void base;
  }

  return { mem: opts.mem, wrote: false, refused: false, retry: true, merged: null };
}

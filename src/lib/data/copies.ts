import { applyV2Write, type V2VersionRow } from "./v2-guard.ts";

/** Already gone from the app. Still in_closet in garments_v2 until a signed-in session. */
export const DELETED_LEGACY_IDS = [
  "g_37e5eqjwgd3d",
  "g_c6qdv5c3gkor",
  "g_x0ro1mg2gu0a",
  "g_oh9f64t8kvor",
] as const;

export const STRAY_LOOK_NAME = "Olive field jacket · weekday";

export function parityLine(
  metaGarments: number,
  metaLooks: number,
  v2Garments: number,
  v2Looks: number,
): string | null {
  if (metaGarments === v2Garments && metaLooks === v2Looks) return null;
  return `Closet copies differ · meta ${metaGarments}/${metaLooks} · v2 ${v2Garments}/${v2Looks}`;
}

function idKey(ids: readonly string[]): string {
  return [...ids].sort().join("|");
}

/**
 * The one stray look, and only when its ids are not today's drop.
 * Returns the first match. Does not select any other name.
 */
export function strayLookId(
  looks: readonly { id: string; name: string; garmentIds: readonly string[] }[],
  drop: { date: string; garmentIds: readonly string[] } | null,
  today: string,
): string | null {
  const dropKey = drop && drop.date === today ? idKey(drop.garmentIds) : null;
  for (const look of looks) {
    if (look.name !== STRAY_LOOK_NAME) continue;
    if (dropKey != null && idKey(look.garmentIds) === dropKey) continue;
    return look.id;
  }
  return null;
}

/**
 * Set deleted_at on an existing row. A missing legacy_id is not inserted.
 * Already-deleted rows are left alone.
 */
export function memMarkDeleted(
  rows: readonly V2VersionRow[],
  legacyId: string,
  now: string,
): V2VersionRow[] {
  const index = rows.findIndex((row) => row.legacy_id === legacyId);
  if (index < 0) return [...rows];
  const row = rows[index]!;
  if (row.deleted_at) return [...rows];
  const applied = applyV2Write(row, {
    expectedVersion: row.version,
    version: row.version + 1,
    deleted_at: now,
  });
  if (!applied.applied) return [...rows];
  const next = [...rows];
  next[index] = applied.row;
  return next;
}

export function backfillDeletedIds(
  rows: readonly V2VersionRow[],
  ids: readonly string[],
  now: string,
): V2VersionRow[] {
  let next = [...rows];
  for (const id of ids) next = memMarkDeleted(next, id, now);
  return next;
}

export type CopyIo = {
  backfill: (ids: readonly string[]) => Promise<void>;
  counts: () => Promise<{ garments: number; looks: number } | null>;
  looks: () => readonly { id: string; name: string; garmentIds: readonly string[] }[];
  drop: () => { date: string; garmentIds: readonly string[] } | null;
  today: string;
  removeLook: (id: string) => void;
  metaGarments: () => number;
  metaLooks: () => number;
};

export type CopyReconcileResult = {
  metaG: number;
  metaL: number;
  v2G: number | null;
  v2L: number | null;
  removed: string | null;
};

let copyParity: string | null = null;
const parityListeners = new Set<() => void>();
const reconciled = new Map<string, CopyReconcileResult>();
const inflight = new Map<string, Promise<CopyReconcileResult>>();

export function getCopyParity(): string | null {
  return copyParity;
}

export function subscribeCopyParity(fn: () => void): () => void {
  parityListeners.add(fn);
  return () => {
    parityListeners.delete(fn);
  };
}

export function setCopyParity(next: string | null): void {
  if (next === copyParity) return;
  copyParity = next;
  for (const fn of parityListeners) fn();
}

export function resetCopyReconcileForTests(): void {
  reconciled.clear();
  inflight.clear();
  setCopyParity(null);
}

/** Once per signed-in user. A failed pass is not marked done, so a later call can retry. */
export function runCopyReconcile(userId: string, io: CopyIo): Promise<CopyReconcileResult> {
  const done = reconciled.get(userId);
  if (done) return Promise.resolve(done);
  const pending = inflight.get(userId);
  if (pending) return pending;
  const job = (async () => {
    await io.backfill(DELETED_LEGACY_IDS);
    const removed = strayLookId(io.looks(), io.drop(), io.today);
    if (removed) {
      try {
        io.removeLook(removed);
      } catch {
        /* closet_meta delete already happened inside removeLook, or it threw first */
      }
    }
    const metaG = io.metaGarments();
    const metaL = io.metaLooks();
    let v2: { garments: number; looks: number } | null = null;
    try {
      v2 = await io.counts();
    } catch {
      v2 = null;
    }
    if (v2) setCopyParity(parityLine(metaG, metaL, v2.garments, v2.looks));
    else setCopyParity(null);
    const result: CopyReconcileResult = {
      metaG,
      metaL,
      v2G: v2?.garments ?? null,
      v2L: v2?.looks ?? null,
      removed,
    };
    reconciled.set(userId, result);
    return result;
  })();
  inflight.set(userId, job);
  return job.finally(() => {
    inflight.delete(userId);
  });
}

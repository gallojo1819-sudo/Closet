import { isCloudSrc } from "./src.ts";
import { mergeTaste, type TasteMemory } from "../taste.ts";

/**
 * Account merge. closet.v6 + IDB stay a cache.
 * Never replace a non-empty local rack with an empty cloud.
 * Tests use a fake user and must not touch closet.v6.
 */

export type CloudGarment = {
  id: string;
  archived?: boolean;
  demo?: boolean;
  imageSrc?: string;
  cutoutSrc?: string;
  /** Durable delete. Not a live piece. */
  tombstone?: boolean;
  name?: string;
};

export type CloudLook = {
  id: string;
  garmentIds: string[];
  tombstone?: boolean;
  /** Fewer than two pieces still in the closet. Kept, not deleted. */
  broken?: boolean;
  name?: string;
};

export type CloudJournal = { date: string; garmentIds: string[] };

export type CloudDrop = { date: string; garmentIds: string[] } | null;

export type CloudMeta = {
  garments: CloudGarment[];
  looks: CloudLook[];
  journal: CloudJournal[];
  avoid: Record<string, number>;
  drop: CloudDrop;
  refPhoto: boolean;
  /** Schema generation. Stays 6. Conflict checks use `rev`, not this. */
  v: number;
  /** Monotonic row revision. Absent until the closet_meta_push migration. */
  rev?: number;
  updatedAt?: string;
  /** Ids removed on purpose. Absence from the live array is not a delete. */
  deletedGarments?: string[];
  deletedLooks?: string[];
  /** Stylist memory. Rides in the avoid jsonb. Empty on a new account. */
  taste?: TasteMemory;
};

export type LinkAction = "push" | "pull" | "union" | "keep";

/** Real pieces that belong on the account. Demo never ships. */
/** Demo never ships. Archived pieces stay in the synced array until a tombstone. */
export function accountPool<T extends CloudGarment>(garments: T[]): T[] {
  return garments.filter((g) => g.demo !== true);
}

export function decideLink(localCount: number, cloudCount: number): LinkAction {
  if (cloudCount === 0 && localCount > 0) return "push";
  if (cloudCount > 0 && localCount === 0) return "pull";
  if (cloudCount > 0 && localCount > 0) return "union";
  return "keep";
}

/** Empty cloud never overwrites a rack that already has pieces. */
export function shouldApplyCloud(localCount: number, cloudCount: number): boolean {
  if (cloudCount === 0) return false;
  return true;
}

export function unionById<T extends { id: string }>(local: T[], cloud: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of cloud) map.set(item.id, item);
  for (const item of local) map.set(item.id, item);
  return [...map.values()];
}

/** closet_meta sb: srcs win over local idb: on the same id. Other local fields stay. */
export function preferAccountSrcs<T extends CloudGarment>(local: T, cloud: T | undefined): T {
  if (!cloud) return local;
  const imageSrc = isCloudSrc(cloud.imageSrc)
    ? cloud.imageSrc
    : (local.imageSrc ?? cloud.imageSrc);
  const cutoutSrc = isCloudSrc(cloud.cutoutSrc)
    ? cloud.cutoutSrc
    : (local.cutoutSrc ?? cloud.cutoutSrc);
  return { ...cloud, ...local, imageSrc, cutoutSrc };
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Three-way field merge. A side that still matches `base` did not edit that
 * field, so the other side's edit wins. Image srcs still prefer closet_meta sb:.
 * A new local plate stays when the cloud cutout still equals the last pull.
 * If the cloud cutout actually changed, the cloud one wins.
 */
export function mergeGarmentFields<T extends CloudGarment>(base: T | undefined, local: T, cloud: T): T {
  const srcs = preferAccountSrcs(local, cloud);
  const cutoutSrc =
    base && cloud.cutoutSrc === base.cutoutSrc && local.cutoutSrc && local.cutoutSrc !== base.cutoutSrc
      ? local.cutoutSrc
      : srcs.cutoutSrc;
  if (!base) return srcs;
  const out: Record<string, unknown> = { ...cloud };
  const keys = new Set([
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(cloud),
  ]);
  for (const key of keys) {
    if (key === "imageSrc" || key === "cutoutSrc") continue;
    const b = (base as Record<string, unknown>)[key];
    const l = (local as Record<string, unknown>)[key];
    const c = (cloud as Record<string, unknown>)[key];
    if (!sameJson(l, b) && sameJson(c, b)) out[key] = l;
    else out[key] = c;
  }
  out.imageSrc = srcs.imageSrc;
  out.cutoutSrc = cutoutSrc;
  return out as T;
}

/**
 * Union by id. A missing id is not a delete — only tombstones remove a piece.
 * `lastCloudIds` used to treat "was synced, now absent" as a remote delete.
 * That let a shrunk upsert erase sneakers on every other phone. It is ignored.
 */
export function mergeGarments<T extends CloudGarment>(opts: {
  local: T[];
  cloud: T[];
  lastCloudIds: string[] | null;
  /** Deleted on purpose. Cloud must not bring them back, even on first link. */
  tombstones?: string[];
  /** Last pulled records, for concurrent edits to different pieces. */
  base?: T[] | null;
}): T[] {
  void opts.lastCloudIds;
  const dead = new Set(opts.tombstones ?? []);
  const live = (rows: T[]) =>
    rows.filter((g) => g.demo !== true && g.tombstone !== true && !dead.has(g.id));
  const localReal = live(opts.local);
  const cloudReal = live(opts.cloud);
  const baseReal = live(opts.base ?? []);
  if (cloudReal.length === 0 && localReal.length === 0 && baseReal.length === 0) return [];
  const localMap = new Map(localReal.map((g) => [g.id, g]));
  const cloudMap = new Map(cloudReal.map((g) => [g.id, g]));
  const baseMap = new Map(baseReal.map((g) => [g.id, g]));
  const ids = new Set<string>([...localMap.keys(), ...cloudMap.keys(), ...baseMap.keys()]);
  const next: T[] = [];
  for (const id of ids) {
    if (dead.has(id)) continue;
    const local = localMap.get(id);
    const cloud = cloudMap.get(id);
    const base = baseMap.get(id);
    if (local && cloud) next.push(mergeGarmentFields(base, local, cloud));
    else if (local) next.push(local);
    else if (cloud) next.push(cloud);
    else if (base) next.push(base);
  }
  return next;
}

export function mergeLooks<T extends CloudLook>(
  local: T[],
  cloud: T[],
  allowed: Set<string>,
  deleted?: Set<string>,
  base?: T[] | null,
): T[] {
  const dead = deleted ?? new Set<string>();
  const keep = (rows: T[]) => rows.filter((l) => l.tombstone !== true && !dead.has(l.id));
  const localMap = new Map(keep(local).map((l) => [l.id, l]));
  const cloudMap = new Map(keep(cloud).map((l) => [l.id, l]));
  const baseMap = new Map(keep(base ?? []).map((l) => [l.id, l]));
  const ids = new Set<string>([...cloudMap.keys(), ...localMap.keys(), ...baseMap.keys()]);
  const out: T[] = [];
  for (const id of ids) {
    const localLook = localMap.get(id);
    const cloudLook = cloudMap.get(id);
    const baseLook = baseMap.get(id);
    let pick: T | undefined;
    if (localLook && cloudLook) {
      if (baseLook && sameJson(localLook, baseLook)) pick = cloudLook;
      else if (baseLook && sameJson(cloudLook, baseLook)) pick = localLook;
      else pick = { ...cloudLook, ...localLook, id };
    } else {
      pick = localLook ?? cloudLook ?? baseLook;
    }
    if (!pick) continue;
    const garmentIds = pick.garmentIds.filter((gid) => allowed.has(gid));
    const broken = garmentIds.length < 2;
    out.push(
      garmentIds.length === pick.garmentIds.length && !broken
        ? pick
        : { ...pick, garmentIds, broken },
    );
  }
  return out;
}

export function mergeJournal<T extends CloudJournal>(local: T[], cloud: T[], allowed: Set<string>): T[] {
  const map = new Map<string, T>();
  for (const row of cloud) map.set(row.date, row);
  for (const row of local) map.set(row.date, row);
  return [...map.values()]
    .map((row) => ({
      ...row,
      garmentIds: row.garmentIds.filter((id) => allowed.has(id)),
    }))
    .filter((row) => row.garmentIds.length > 0);
}

export function mergeAvoid(
  local: Record<string, number>,
  cloud: Record<string, number>,
  allowed: Set<string>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, n] of Object.entries(cloud)) {
    if (allowed.has(id)) out[id] = n;
  }
  for (const [id, n] of Object.entries(local)) {
    if (!allowed.has(id)) continue;
    out[id] = Math.max(out[id] ?? 0, n);
  }
  return out;
}

export function mergeDrop<T extends CloudDrop>(local: T, cloud: T, allowed: Set<string>): T {
  const pick = local ?? cloud;
  if (!pick) return null as T;
  const ids = pick.garmentIds.filter((id) => allowed.has(id));
  if (ids.length < 2) return null as T;
  return { ...pick, garmentIds: ids } as T;
}

export type MergeResult<T extends CloudMeta> = {
  action: LinkAction;
  next: T;
  appliedCloud: boolean;
};

function uniqIds(ids: Array<string | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

export function mergeAccount<T extends CloudMeta>(opts: {
  local: T;
  cloud: T | null;
  lastCloudIds: string[] | null;
  tombstones?: string[];
  deletedLooks?: string[];
  /** Last pulled snapshot. Concurrent edits to different pieces both survive. */
  base?: T | null;
}): MergeResult<T> {
  const localCount = accountPool(opts.local.garments).length;
  const cloudCount = opts.cloud ? accountPool(opts.cloud.garments).length : 0;
  const action = decideLink(localCount, cloudCount);
  const deletedGarments = uniqIds([
    ...(opts.tombstones ?? []),
    ...(opts.local.deletedGarments ?? []),
    ...(opts.cloud?.deletedGarments ?? []),
    ...opts.local.garments.filter((g) => g.tombstone).map((g) => g.id),
    ...(opts.cloud?.garments ?? []).filter((g) => g.tombstone).map((g) => g.id),
  ]);
  const deletedLooks = uniqIds([
    ...(opts.deletedLooks ?? []),
    ...(opts.local.deletedLooks ?? []),
    ...(opts.cloud?.deletedLooks ?? []),
    ...opts.local.looks.filter((l) => l.tombstone).map((l) => l.id),
    ...(opts.cloud?.looks ?? []).filter((l) => l.tombstone).map((l) => l.id),
  ]);
  const stamped = {
    ...opts.local,
    deletedGarments,
    deletedLooks,
  };

  // No row, or an empty row with no tombstones, must not wipe the phone.
  // A tombstone is the only way an empty live rack deletes a piece.
  if (!opts.cloud || (!shouldApplyCloud(localCount, cloudCount) && deletedGarments.length === 0 && deletedLooks.length === 0)) {
    return { action, next: stamped, appliedCloud: false };
  }

  const garments = mergeGarments({
    local: opts.local.garments,
    cloud: opts.cloud.garments,
    lastCloudIds: opts.lastCloudIds,
    tombstones: deletedGarments,
    base: opts.base?.garments ?? null,
  });
  const allowed = new Set(garments.filter((g) => !g.archived).map((g) => g.id));
  const looks = mergeLooks(
    opts.local.looks,
    opts.cloud.looks,
    allowed,
    new Set(deletedLooks),
    opts.base?.looks ?? null,
  );
  const journal = mergeJournal(opts.local.journal, opts.cloud.journal, allowed);
  const avoid = mergeAvoid(opts.local.avoid, opts.cloud.avoid, allowed);
  const drop = mergeDrop(opts.local.drop, opts.cloud.drop, allowed);
  const refPhoto = opts.local.refPhoto || opts.cloud.refPhoto;
  const taste = mergeTaste(opts.local.taste, opts.cloud.taste);
  const next: T = {
    ...stamped,
    garments,
    looks,
    journal,
    avoid,
    drop,
    refPhoto,
    v: opts.cloud.v || opts.local.v || 6,
    rev: typeof opts.cloud.rev === "number" ? opts.cloud.rev : opts.local.rev,
    updatedAt: opts.cloud.updatedAt ?? opts.local.updatedAt,
  };
  if (taste) next.taste = taste;
  else delete next.taste;

  return {
    action,
    appliedCloud: true,
    next,
  };
}

/**
 * Account merge. closet.v6 + IDB stay a cache.
 * Never replace a non-empty local rack with an empty cloud.
 * Tests use a fake user and must not touch closet.v6.
 */

export type CloudGarment = { id: string; archived?: boolean; demo?: boolean };

export type CloudLook = { id: string; garmentIds: string[] };

export type CloudJournal = { date: string; garmentIds: string[] };

export type CloudDrop = { date: string; garmentIds: string[] } | null;

export type CloudMeta = {
  garments: CloudGarment[];
  looks: CloudLook[];
  journal: CloudJournal[];
  avoid: Record<string, number>;
  drop: CloudDrop;
  refPhoto: boolean;
  v: number;
};

export type LinkAction = "push" | "pull" | "union" | "keep";

/** Real pieces that belong on the account. Demo never ships. */
export function accountPool<T extends CloudGarment>(garments: T[]): T[] {
  return garments.filter((g) => !g.archived && g.demo !== true);
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

/**
 * First link (lastCloudIds === null): union by id.
 * Later: cloud is the account; local-only ids that were in lastCloudIds were
 * removed on another device; local-only ids that were not are unpushed adds.
 */
export function mergeGarments<T extends CloudGarment>(opts: {
  local: T[];
  cloud: T[];
  lastCloudIds: string[] | null;
}): T[] {
  const localReal = accountPool(opts.local);
  const cloudReal = accountPool(opts.cloud);
  if (cloudReal.length === 0) return localReal;
  if (opts.lastCloudIds === null) return unionById(localReal, cloudReal);

  const last = new Set(opts.lastCloudIds);
  const cloudIds = new Set(cloudReal.map((g) => g.id));
  const next = new Map<string, T>();
  for (const g of cloudReal) next.set(g.id, g);
  for (const g of localReal) {
    if (cloudIds.has(g.id)) {
      next.set(g.id, g);
      continue;
    }
    if (!last.has(g.id)) next.set(g.id, g);
  }
  return [...next.values()];
}

export function mergeLooks<T extends CloudLook>(local: T[], cloud: T[], allowed: Set<string>): T[] {
  const merged = unionById(local, cloud);
  const out: T[] = [];
  for (const look of merged) {
    const ids = look.garmentIds.filter((id) => allowed.has(id));
    if (ids.length < 2) continue;
    out.push(ids.length === look.garmentIds.length ? look : { ...look, garmentIds: ids });
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

export function mergeAccount<T extends CloudMeta>(opts: {
  local: T;
  cloud: T | null;
  lastCloudIds: string[] | null;
}): MergeResult<T> {
  const localCount = accountPool(opts.local.garments).length;
  const cloudCount = opts.cloud ? accountPool(opts.cloud.garments).length : 0;
  const action = decideLink(localCount, cloudCount);

  if (!shouldApplyCloud(localCount, cloudCount) || !opts.cloud) {
    return { action, next: opts.local, appliedCloud: false };
  }

  const garments = mergeGarments({
    local: opts.local.garments,
    cloud: opts.cloud.garments,
    lastCloudIds: opts.lastCloudIds,
  });
  const allowed = new Set(garments.filter((g) => !g.archived).map((g) => g.id));
  const looks = mergeLooks(opts.local.looks, opts.cloud.looks, allowed);
  const journal = mergeJournal(opts.local.journal, opts.cloud.journal, allowed);
  const avoid = mergeAvoid(opts.local.avoid, opts.cloud.avoid, allowed);
  const drop = mergeDrop(opts.local.drop, opts.cloud.drop, allowed);
  const refPhoto = opts.local.refPhoto || opts.cloud.refPhoto;

  return {
    action,
    appliedCloud: true,
    next: {
      ...opts.local,
      garments,
      looks,
      journal,
      avoid,
      drop,
      refPhoto,
      v: opts.cloud.v || opts.local.v || 6,
    },
  };
}

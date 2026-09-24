/** Ids the user deleted on this phone. Survives refresh. Not closet.v6. */
const KEY = "closet.deleted.v1";

export function readTombstones(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

export function addTombstone(id: string): void {
  if (!id || typeof localStorage === "undefined") return;
  const next = [...new Set([...readTombstones(), id])];
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode — merge still gets the in-memory caller's list */
  }
}

/** Drop tombstones that the account no longer has, after a successful upsert. */
export function clearTombstones(ids: string[]): void {
  if (!ids.length || typeof localStorage === "undefined") return;
  const drop = new Set(ids);
  const next = readTombstones().filter((id) => !drop.has(id));
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* */
  }
}

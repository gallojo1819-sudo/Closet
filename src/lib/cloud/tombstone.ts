/** Ids the user deleted on this phone. Survives refresh. Not closet.v6. */
const KEY = "closet.deleted.v1";
const LOOK_KEY = "closet.deleted.looks.v1";

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

function readKey(key: string): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

function writeKey(key: string, ids: string[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* private mode */
  }
}

export function readLookTombstones(): string[] {
  return readKey(LOOK_KEY);
}

export function addLookTombstone(id: string): void {
  if (!id) return;
  writeKey(LOOK_KEY, [...new Set([...readLookTombstones(), id])]);
}

export function clearLookTombstones(ids: string[]): void {
  if (!ids.length) return;
  const drop = new Set(ids);
  writeKey(
    LOOK_KEY,
    readLookTombstones().filter((id) => !drop.has(id)),
  );
}

/** Drop tombstones that the account row now stores, after a successful push. */
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

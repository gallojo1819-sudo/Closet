/**
 * Browser copy of engine results (house matrix, week) so a fresh app open skips the rebuild.
 * Its own IndexedDB database, keys "engine-cache:…": nothing here touches closet-images,
 * closet.v6, closet_meta or the cloud. A miss, a failure or no IndexedDB just means a fresh build.
 */
import { liveRows, setEngineStore } from "./engine-store.ts";

const DB_NAME = "closet-engine-cache";
const STORE = "entries";
/** Newest first. Today and the Lookbook chips need a handful; old weeks and closets fall off. */
const KEEP = 16;

type Row = { key: string; at: number; value: unknown };

let ready: Promise<void> | null = null;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
  });
}

function readAll(db: IDBDatabase): Promise<Row[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as Row[]) ?? []);
    req.onerror = () => reject(req.error ?? new Error("Could not read engine cache"));
  });
}

function write(db: IDBDatabase, put: Row[], drop: string[]): void {
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const row of put) store.put(row);
    for (const key of drop) store.delete(key);
  } catch {
    /* Quota or a closed database: the next open rebuilds. */
  }
}

/**
 * Load once per app open, then the engine reads and writes through memory. The memory store is
 * attached at once, so a build that runs before the disk read finishes is still saved.
 */
export function loadEngineCache(): Promise<void> {
  if (ready) return ready;
  if (typeof indexedDB === "undefined") return (ready = Promise.resolve());
  /* Insertion order is age order, oldest first, so the first key is the one to drop. */
  const mem = new Map<string, unknown>();
  let db: IDBDatabase | null = null;
  let pending: Row[] = [];
  let dropped: string[] = [];
  const trim = () => {
    while (mem.size > KEEP) {
      const first = mem.keys().next().value as string;
      mem.delete(first);
      dropped.push(first);
    }
  };
  setEngineStore({
    get: (key) => mem.get(key),
    put: (key, value) => {
      mem.delete(key);
      mem.set(key, value);
      trim();
      pending.push({ key, at: Date.now(), value });
      if (db) {
        write(db, pending, dropped);
        pending = [];
        dropped = [];
      }
    },
  });
  ready = (async () => {
    const opened = await open();
    const rows = await readAll(opened);
    const keep = liveRows(rows, KEEP);
    const kept = new Set(keep.map((row) => row.key));
    const stale = rows.filter((row) => !kept.has(row.key)).map((row) => row.key);
    /* Saved rows go in behind anything built this session (oldest first, newest kept). */
    const fresh = [...mem.entries()];
    mem.clear();
    for (const row of keep.reverse()) mem.set(row.key, row.value);
    for (const [key, value] of fresh) {
      mem.delete(key);
      mem.set(key, value);
    }
    trim();
    db = opened;
    write(opened, pending, [...stale.filter((key) => !mem.has(key)), ...dropped]);
    pending = [];
    dropped = [];
  })().catch(() => {});
  return ready;
}

/** Resolves when the saved results are in memory, or after `ms` so a slow disk never holds a page. */
export function engineCacheReady(ms = 400): Promise<void> {
  return Promise.race([loadEngineCache(), new Promise<void>((resolve) => setTimeout(resolve, ms))]);
}

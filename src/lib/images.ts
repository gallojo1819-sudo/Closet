/**
 * Image blobs live in IndexedDB; closet.v6 keeps only metadata + "idb:" keys.
 * Full data URLs never go back into persist once migrated.
 */

const DB_NAME = "closet-images";
const STORE = "images";
const KEY_PREFIX = "idb:";

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
  });
  return dbPromise;
}

export function imageKey(id: string, kind: "o" | "c" | "t"): string {
  return `${KEY_PREFIX}${id}:${kind}`;
}

export function isIdbKey(src: string | undefined | null): src is string {
  return typeof src === "string" && src.startsWith(KEY_PREFIX);
}

export const CLOSET_META_KEY = `${KEY_PREFIX}closet:meta`;

export async function putClosetMeta(meta: {
  garments: unknown[];
  looks?: unknown;
  journal?: unknown;
  avoid?: unknown;
  drop?: unknown;
  refPhoto?: unknown;
  refPhotoBackup?: unknown;
  messages?: unknown;
}): Promise<void> {
  const blob = new Blob([JSON.stringify({ v: 6, ...meta })], {
    type: "application/json",
  });
  await putImage(CLOSET_META_KEY, blob);
}

export async function getClosetMeta(): Promise<{
  v?: number;
  garments: unknown[];
  looks?: unknown;
  journal?: unknown;
  avoid?: unknown;
  drop?: unknown;
  refPhoto?: unknown;
  refPhotoBackup?: unknown;
  messages?: unknown;
} | null> {
  const blob = await getImage(CLOSET_META_KEY);
  if (!blob) return null;
  try {
    const data = JSON.parse(await blob.text()) as {
      garments?: unknown;
      looks?: unknown;
      journal?: unknown;
      avoid?: unknown;
      drop?: unknown;
      refPhoto?: unknown;
      refPhotoBackup?: unknown;
      messages?: unknown;
      v?: number;
    };
    if (!Array.isArray(data.garments) || data.garments.length === 0) return null;
    return { ...data, garments: data.garments };
  } catch {
    return null;
  }
}

export async function clearClosetMeta(): Promise<void> {
  await deleteImage(CLOSET_META_KEY);
}

export async function putImage(key: string, blob: Blob): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not store image"));
  });
  urlCache.delete(key);
  notifyImage(key);
}

export async function getImage(key: string): Promise<Blob | null> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("Could not read image"));
  });
}

export async function deleteImage(key: string): Promise<void> {
  if (!isIdbKey(key)) return;
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not delete image"));
  });
  const cached = urlCache.get(key);
  if (cached) {
    URL.revokeObjectURL(cached);
    urlCache.delete(key);
  }
}

const urlCache = new Map<string, string>();
const imageWatchers = new Map<string, Set<() => void>>();

export function watchImage(key: string, fn: () => void): () => void {
  let set = imageWatchers.get(key);
  if (!set) {
    set = new Set();
    imageWatchers.set(key, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) imageWatchers.delete(key);
  };
}

function notifyImage(key: string) {
  imageWatchers.get(key)?.forEach((fn) => fn());
}

/** name + size + lastModified + first 64KB. Same File → same hash. */
export async function fileFingerprint(file: File): Promise<string> {
  const head = await file.slice(0, 64 * 1024).arrayBuffer();
  const meta = new TextEncoder().encode(
    `${file.name}\0${file.size}\0${file.lastModified}`,
  );
  const bytes = new Uint8Array(meta.byteLength + head.byteLength);
  bytes.set(meta, 0);
  bytes.set(new Uint8Array(head), meta.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Resolve any stored src (idb key, data URL, or path) to a displayable URL. */
export async function resolveImage(src: string): Promise<string> {
  if (!isIdbKey(src)) return src;
  const cached = urlCache.get(src);
  if (cached) return cached;
  const blob = await getImage(src);
  if (!blob) return "";
  const url = URL.createObjectURL(blob);
  urlCache.set(src, url);
  return url;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(head ?? "")?.[1] ?? "image/jpeg";
  const bin = atob(body ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.readAsDataURL(blob);
  });
}

const REF_KEY = "idb:me:ref";

export function refImageKey(): string {
  return REF_KEY;
}

export function lookOnMeKey(lookId: string, extra?: string): string {
  return extra ? `${KEY_PREFIX}lb:v2:${lookId}:${extra}` : `${KEY_PREFIX}lb:v2:${lookId}`;
}

/** JPEG data URL, long edge capped. Used to shrink On-me payloads. */
export async function jpegDataUrl(src: Blob | string, maxEdge: number, quality = 0.8): Promise<string> {
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  const revoke = typeof src !== "string";
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("jpeg"));
      el.src = url;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight, 1));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality);
  } finally {
    if (revoke) URL.revokeObjectURL(url);
  }
}

/** JPEG data URL, long edge ≤900, payload ≤400KB — persist backup for Joe's body photo. */
export async function compressRefBackup(blob: Blob): Promise<string> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("backup"));
      el.src = url;
    });
    const scale = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const maxChars = Math.floor((400 * 1024 * 4) / 3);
    let q = 0.82;
    let data = c.toDataURL("image/jpeg", q);
    while (data.length > maxChars && q > 0.35) {
      q -= 0.1;
      data = c.toDataURL("image/jpeg", q);
    }
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Grid thumbnail: JPEG long edge 480, q 0.7. Does not block ingest. */
export async function putThumb(id: string, src: Blob | string): Promise<void> {
  const data = await jpegDataUrl(src, 480, 0.7);
  await putImage(imageKey(id, "t"), dataUrlToBlob(data));
}

export async function ensureThumb(id: string, cutoutSrc: string): Promise<void> {
  try {
    const hit = await getImage(imageKey(id, "t"));
    if (hit) return;
    if (isIdbKey(cutoutSrc)) {
      const blob = await getImage(cutoutSrc);
      if (blob) await putThumb(id, blob);
      return;
    }
    if (cutoutSrc) await putThumb(id, cutoutSrc);
  } catch {
    /* thumb is optional */
  }
}

/** Store a data URL under a key. No-op for non-data URLs; returns the src to keep. */
export async function stashDataUrl(key: string, src: string): Promise<string> {
  if (!src.startsWith("data:")) return src;
  await putImage(key, dataUrlToBlob(src));
  return key;
}

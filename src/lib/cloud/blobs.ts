import {
  cloudImageKey,
  getImage,
  imageKey,
  isIdbKey,
  putImage,
} from "../images.ts";
import type { Garment } from "../types.ts";
import { getAccount, setAccountProgress, setLocalOnly } from "./account.ts";
import { cloudErrorCopy, LOCAL_ONLY_CAPTION } from "./copy.ts";
import {
  closetImagesBucket,
  garmentObjectPath,
  getSupabase,
} from "./client.ts";
import { decideBlobPut, isAlreadyStored } from "./guard.ts";
import { parseCloudSrc } from "./src.ts";
import {
  OPEN_THUMB_CONCURRENCY,
  openDownloadPlan,
  type BlobKind,
} from "./open-plan.ts";

const inflight = new Map<string, Promise<boolean>>();
const uploaded = new Set<string>();
const folderCache = new Map<string, Set<string>>();
const signedCache = new Map<string, { url: string; exp: number }>();
const reportedCloud = new Set<string>();

function reportCloudError(error: unknown) {
  const line = cloudErrorCopy(error);
  if (reportedCloud.has(line)) return;
  reportedCloud.add(line);
  setAccountProgress(line);
}

/** 60-minute signed URL. Never return sb:. */
export async function signedCloudUrl(path: string): Promise<string> {
  if (!path) return "";
  const now = Date.now();
  const hit = signedCache.get(path);
  if (hit && hit.exp > now + 60_000) return hit.url;
  const sb = getSupabase();
  if (!sb) return "";
  const { data, error } = await sb.storage
    .from(closetImagesBucket())
    .createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) {
    if (error && (isForbidden(error) || isBadRequest(error))) reportCloudError(error);
    return "";
  }
  const url = data.signedUrl;
  if (!url.startsWith("http://") && !url.startsWith("https://")) return "";
  signedCache.set(path, { url, exp: now + 60 * 60 * 1000 });
  return url;
}

export function markUploaded(id: string, kind: BlobKind) {
  uploaded.add(`${id}:${kind}`);
}

export function forgetUploaded(id: string) {
  for (const kind of ["t", "c", "o"] as const) uploaded.delete(`${id}:${kind}`);
}

export function clearUploaded() {
  uploaded.clear();
}

export function wasUploaded(id: string, kind: BlobKind): boolean {
  return uploaded.has(`${id}:${kind}`);
}

export async function mapPool<T>(
  items: T[],
  n: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      const item = items[i++];
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}

export async function hasLocalBlob(id: string, kind: BlobKind): Promise<boolean> {
  try {
    return Boolean(await getImage(imageKey(id, kind)));
  } catch {
    return false;
  }
}

export async function fetchCloudBlob(
  id: string,
  kind: BlobKind,
  userId?: string,
  srcHint?: string,
): Promise<boolean> {
  const hinted = parseCloudSrc(srcHint);
  const hintPath = hinted && hinted.kind === kind ? hinted.path : "";
  const mark = hintPath ? `${id}:${kind}:${hintPath}` : `${id}:${kind}`;
  const pending = inflight.get(mark);
  if (pending) return pending;
  const work = (async () => {
    if (hintPath) {
      try {
        if (await getImage(cloudImageKey(hintPath))) return true;
      } catch {
        /* IDB miss falls through to storage */
      }
    } else if (await hasLocalBlob(id, kind)) {
      return true;
    }
    const uid = userId ?? getAccount().user?.id;
    const sb = getSupabase();
    if (!sb) return false;
    const paths: string[] = [];
    if (hintPath) paths.push(hintPath);
    if (uid) paths.push(garmentObjectPath(uid, id, kind));
    if (kind === "t" && uid) {
      paths.push(garmentObjectPath(uid, id, "c"));
    }
    const unique = [...new Set(paths)];
    for (const path of unique) {
      const { data, error } = await sb.storage.from(closetImagesBucket()).download(path);
      if (error) {
        if (isForbidden(error) || isBadRequest(error)) reportCloudError(error);
        continue;
      }
      if (!data || data.size === 0) continue;
      await putImage(cloudImageKey(path), data);
      await putImage(imageKey(id, kind), data);
      return true;
    }
    return false;
  })();
  inflight.set(mark, work);
  try {
    return await work;
  } finally {
    inflight.delete(mark);
  }
}

export function requestThumb(id: string): void {
  void fetchCloudBlob(id, "t");
}

export function requestCutout(id: string, hint?: string): void {
  void (async () => {
    if (await fetchCloudBlob(id, "c", undefined, hint)) return;
    await fetchCloudBlob(id, "o");
  })();
}

export async function prefetchEagerThumbs(
  ids: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const plan = openDownloadPlan(ids);
  let done = 0;
  const total = ids.length;
  await mapPool(plan.eager, plan.concurrency || OPEN_THUMB_CONCURRENCY, async (id) => {
    await fetchCloudBlob(id, "t");
    done += 1;
    onProgress?.(done, total);
  });
}

/** imageKey(id, kind), then cutoutSrc, then imageSrc, then the other kinds (a cover can fill :t). */
export function uploadBlobKeys(
  g: { id: string; imageSrc?: string; cutoutSrc?: string },
  kind: BlobKind,
): string[] {
  const keys = [imageKey(g.id, kind)];
  if (isIdbKey(g.cutoutSrc)) keys.push(g.cutoutSrc);
  if (isIdbKey(g.imageSrc)) keys.push(g.imageSrc);
  for (const k of ["t", "c", "o"] as const) {
    if (k !== kind) keys.push(imageKey(g.id, k));
  }
  return [...new Set(keys)];
}

export function needsJpegConvert(type: string | undefined | null): boolean {
  const t = (type ?? "").toLowerCase();
  return t !== "image/jpeg" && t !== "image/jpg";
}

export async function blobAsJpeg(blob: Blob): Promise<Blob> {
  if (!needsJpegConvert(blob.type)) return blob;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return blob;
  }
  const bitmap = await createImageBitmap(blob);
  try {
    const c = document.createElement("canvas");
    c.width = Math.max(1, bitmap.width);
    c.height = Math.max(1, bitmap.height);
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.drawImage(bitmap, 0, 0);
    const out = await new Promise<Blob | null>((resolve) =>
      c.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (!out) throw new Error("jpeg");
    return out;
  } finally {
    bitmap.close();
  }
}

async function blobFor(g: Garment, kind: BlobKind): Promise<Blob | null> {
  for (const key of uploadBlobKeys(g, kind)) {
    try {
      const hit = await getImage(key);
      if (hit) return hit;
    } catch {
      /* */
    }
  }
  return null;
}

export function countTjpgFromLists(
  level1: { name: string }[],
  nested: Record<string, { name: string }[]>,
): number {
  let n = 0;
  for (const row of level1) {
    if (!row.name || row.name === "me") continue;
    if (row.name === "t.jpg") {
      n += 1;
      continue;
    }
    if (/\.[a-z0-9]+$/i.test(row.name) && row.name !== "t.jpg") continue;
    const files = nested[row.name] ?? [];
    if (files.some((f) => /^(t|c|o)\.jpg$/i.test(f.name))) n += 1;
  }
  return n;
}

export async function countListedThumbs(userId: string): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 0;
  const { data: level1, error } = await sb.storage
    .from(closetImagesBucket())
    .list(userId, { limit: 1000 });
  if (error) throw error;
  if (!level1) return 0;
  const nested: Record<string, { name: string }[]> = {};
  const folders = level1.filter(
    (row) => row.name && row.name !== "me" && !/\.jpg$/i.test(row.name),
  );
  await mapPool(folders, 6, async (row) => {
    const { data, error: nestedErr } = await sb.storage
      .from(closetImagesBucket())
      .list(`${userId}/${row.name}`, { limit: 20 });
    if (nestedErr) throw nestedErr;
    nested[row.name] = data ?? [];
  });
  return countTjpgFromLists(level1, nested);
}

async function remoteFolder(userId: string, garmentId: string): Promise<Set<string> | null> {
  const folder = `${userId}/${garmentId}`;
  const cached = folderCache.get(folder);
  if (cached) return cached;
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.storage.from(closetImagesBucket()).list(folder, { limit: 20 });
  if (error) return null;
  const names = new Set((data ?? []).map((row) => row.name).filter(Boolean));
  folderCache.set(folder, names);
  return names;
}

const coverSha = new Map<string, string>();

export function peekCoverSha(id: string): string | undefined {
  return coverSha.get(id);
}

/** The next cover upload must hash the current bytes, not the previous sha. */
export function forgetCoverSha(id: string): void {
  coverSha.delete(id);
  uploaded.delete(`${id}:c`);
}

export async function sha8(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 8);
}

export function coverFileName(sha: string): string {
  return `c-${sha}.jpg`;
}

export function refFileName(sha: string): string {
  return `ref-${sha}.jpg`;
}

function rememberRemote(userId: string, garmentId: string, name: string) {
  const folder = `${userId}/${garmentId}`;
  const names = folderCache.get(folder) ?? new Set<string>();
  names.add(name);
  folderCache.set(folder, names);
}

export async function uploadKind(userId: string, g: Garment, kind: BlobKind): Promise<boolean> {
  const mark = `${g.id}:${kind}`;
  if (kind !== "c" && uploaded.has(mark)) return true;
  const sb = getSupabase();
  if (!sb) return false;
  if (kind === "c") return uploadVersionedCover(userId, g);
  const fileName = `${kind}.jpg`;
  const listed = await remoteFolder(userId, g.id);
  const remoteExists = listed?.has(fileName) ?? false;
  if (remoteExists) {
    uploaded.add(mark);
    return true;
  }
  const raw = await blobFor(g, kind);
  if (
    decideBlobPut({
      alreadyUploaded: false,
      remoteExists,
      hasLocalBlob: Boolean(raw),
    }) === "skip"
  ) {
    return kind !== "t";
  }
  let blob: Blob;
  try {
    blob = await blobAsJpeg(raw!);
  } catch (err) {
    setLocalOnly(true);
    throw err;
  }
  const path = garmentObjectPath(userId, g.id, kind);
  const { error } = await sb.storage.from(closetImagesBucket()).upload(path, blob, {
    upsert: false,
    contentType: "image/jpeg",
  });
  if (error) {
    if (isAlreadyStored(error)) {
      rememberRemote(userId, g.id, fileName);
      uploaded.add(mark);
      return true;
    }
    setLocalOnly(true);
    throw error;
  }
  rememberRemote(userId, g.id, fileName);
  const { data: landed, error: dlErr } = await sb.storage
    .from(closetImagesBucket())
    .download(path);
  if (dlErr || !landed || landed.size === 0) {
    setLocalOnly(true);
    throw dlErr ?? new Error(`download miss ${path}`);
  }
  uploaded.add(mark);
  const canonical = imageKey(g.id, kind);
  if (kind === "t") {
    try {
      const existing = await getImage(canonical);
      if (!existing) await putImage(canonical, blob);
    } catch {
      /* IDB cache is best-effort */
    }
  }
  return true;
}

async function uploadVersionedCover(userId: string, g: Garment): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const raw = await blobFor(g, "c");
  if (!raw) return false;
  let blob: Blob;
  try {
    blob = await blobAsJpeg(raw);
  } catch (err) {
    setLocalOnly(true);
    throw err;
  }
  const sha = await sha8(await blob.arrayBuffer());
  const fileName = coverFileName(sha);
  const listed = await remoteFolder(userId, g.id);
  if (listed?.has(fileName)) {
    coverSha.set(g.id, sha);
    uploaded.add(`${g.id}:c`);
    return true;
  }
  const path = `${userId}/${g.id}/${fileName}`;
  const { error } = await sb.storage.from(closetImagesBucket()).upload(path, blob, {
    upsert: false,
    contentType: "image/jpeg",
  });
  if (error) {
    if (isAlreadyStored(error)) {
      rememberRemote(userId, g.id, fileName);
      coverSha.set(g.id, sha);
      uploaded.add(`${g.id}:c`);
      return true;
    }
    setLocalOnly(true);
    throw error;
  }
  rememberRemote(userId, g.id, fileName);
  coverSha.set(g.id, sha);
  uploaded.add(`${g.id}:c`);
  return true;
}

export function isForbidden(error: { statusCode?: string; status?: number; message?: string }): boolean {
  if (error.status === 403 || error.statusCode === "403") return true;
  return /403|not allowed|row-level|unauthorized/i.test(error.message ?? "");
}

export function isBadRequest(error: { statusCode?: string; status?: number; message?: string }): boolean {
  if (error.status === 400 || error.statusCode === "400") return true;
  return /\b400\b/.test(error.message ?? "");
}

export function localOnlyCaption(): string {
  return LOCAL_ONLY_CAPTION;
}

/** :t first so the other phone sees a picture, then :c, then :o. */
export async function uploadGarmentBlobs(userId: string, g: Garment): Promise<void> {
  await uploadKind(userId, g, "t");
  await uploadKind(userId, g, "c");
  await uploadKind(userId, g, "o");
}

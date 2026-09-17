import {
  getImage,
  imageKey,
  isIdbKey,
  putImage,
} from "../images.ts";
import type { Garment } from "../types.ts";
import { getAccount, setLocalOnly } from "./account.ts";
import { LOCAL_ONLY_CAPTION } from "./copy.ts";
import { isRetryableCloudError } from "./online.ts";
import {
  closetImagesBucket,
  garmentObjectPath,
  getSupabase,
} from "./client.ts";
import {
  OPEN_THUMB_CONCURRENCY,
  openDownloadPlan,
  type BlobKind,
} from "./open-plan.ts";

const inflight = new Map<string, Promise<boolean>>();
const uploaded = new Set<string>();

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
): Promise<boolean> {
  const mark = `${id}:${kind}`;
  const pending = inflight.get(mark);
  if (pending) return pending;
  const work = (async () => {
    if (await hasLocalBlob(id, kind)) {
      return true;
    }
    const uid = userId ?? getAccount().user?.id;
    if (!uid) return false;
    const sb = getSupabase();
    if (!sb) return false;
    const { data, error } = await sb.storage
      .from(closetImagesBucket())
      .download(garmentObjectPath(uid, id, kind));
    if (error || !data) {
      if (error && isForbidden(error)) return false;
      return false;
    }
    await putImage(imageKey(id, kind), data);
    return true;
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

export function requestCutout(id: string): void {
  void (async () => {
    if (await fetchCloudBlob(id, "c")) return;
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

/** :t from imageKey id t, else cutoutSrc, else imageSrc. */
export function uploadBlobKeys(
  g: { id: string; imageSrc?: string; cutoutSrc?: string },
  kind: BlobKind,
): string[] {
  const keys = [imageKey(g.id, kind)];
  if (kind === "t") {
    if (isIdbKey(g.cutoutSrc)) keys.push(g.cutoutSrc);
    if (isIdbKey(g.imageSrc)) keys.push(g.imageSrc);
  } else if (kind === "c" && isIdbKey(g.cutoutSrc)) {
    keys.push(g.cutoutSrc);
  } else if (kind === "o" && isIdbKey(g.imageSrc)) {
    keys.push(g.imageSrc);
  }
  return [...new Set(keys)];
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

export async function uploadKind(userId: string, g: Garment, kind: BlobKind): Promise<boolean> {
  const mark = `${g.id}:${kind}`;
  if (uploaded.has(mark)) return true;
  const sb = getSupabase();
  if (!sb) return false;
  const blob = await blobFor(g, kind);
  if (!blob) return kind !== "t";
  const { error } = await sb.storage.from(closetImagesBucket()).upload(
    garmentObjectPath(userId, g.id, kind),
    blob,
    { upsert: true, contentType: blob.type || "image/jpeg" },
  );
  if (error) {
    if (isForbidden(error)) {
      setLocalOnly(true);
      throw error;
    }
    if (isRetryableCloudError(error)) setLocalOnly(true);
    return false;
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

export function isForbidden(error: { statusCode?: string; status?: number; message?: string }): boolean {
  if (error.status === 403 || error.statusCode === "403") return true;
  return /403|not allowed|row-level|unauthorized/i.test(error.message ?? "");
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

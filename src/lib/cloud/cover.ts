/**
 * Cover bytes for On you. IDB first, then closet-images (download / signed URL).
 * Never treat an sb: miss in IDB as a missing plate when storage has c/t/o.
 */
import { getImage, imageKey, putImage } from "../images.ts";
import type { Garment } from "../types.ts";
import { getAccount } from "./account.ts";
import { fetchCloudBlob, signedCloudUrl } from "./blobs.ts";
import {
  closetImagesBucket,
  garmentObjectPath,
  getSupabase,
} from "./client.ts";
import { parseCloudSrc } from "./src.ts";
import type { BlobKind } from "./open-plan.ts";

const KINDS: BlobKind[] = ["c", "t", "o"];

export function coverLoadError(name: string): string {
  return `Couldn't load ${name} — open Closet and wait for the photo.`;
}

export type CoverLoader = {
  getIdb: (key: string) => Promise<Blob | null>;
  download: (path: string) => Promise<Blob | null>;
  signedFetch: (path: string) => Promise<Blob | null>;
  /** Live: fetchCloudBlob(id, kind) then IDB. Tests omit this and stub download. */
  fetchKind?: (id: string, kind: BlobKind, srcHint?: string) => Promise<Blob | null>;
  putIdb?: (key: string, blob: Blob) => Promise<void>;
  userId?: string;
};

export function coverPathsForGarment(
  g: { id: string; cutoutSrc?: string; imageSrc?: string },
  userId?: string,
): { idbKeys: string[]; paths: string[] } {
  const idbKeys = KINDS.map((k) => imageKey(g.id, k));
  const paths: string[] = [];
  for (const src of [g.cutoutSrc, g.imageSrc]) {
    const parsed = parseCloudSrc(src);
    if (parsed) paths.push(parsed.path);
  }
  const uid =
    userId ??
    parseCloudSrc(g.cutoutSrc)?.userId ??
    parseCloudSrc(g.imageSrc)?.userId;
  if (uid) {
    for (const k of KINDS) paths.push(garmentObjectPath(uid, g.id, k));
  }
  return { idbKeys, paths: [...new Set(paths)] };
}

function srcHintFor(
  g: { cutoutSrc?: string; imageSrc?: string },
  kind: BlobKind,
): string | undefined {
  for (const src of [g.cutoutSrc, g.imageSrc]) {
    const parsed = parseCloudSrc(src);
    if (parsed?.kind === kind) return src;
  }
  return g.cutoutSrc ?? g.imageSrc;
}

async function cacheCover(loader: CoverLoader, path: string, blob: Blob): Promise<void> {
  if (!loader.putIdb) return;
  const parsed = parseCloudSrc(`sb:${path}`);
  if (!parsed) return;
  try {
    await loader.putIdb(imageKey(parsed.id, parsed.kind), blob);
  } catch {
    /* */
  }
}

export async function loadCoverBlob(
  g: { id: string; name?: string; cutoutSrc?: string; imageSrc?: string },
  loader: CoverLoader,
): Promise<Blob | null> {
  const { idbKeys, paths } = coverPathsForGarment(g, loader.userId);
  for (const key of idbKeys) {
    try {
      const hit = await loader.getIdb(key);
      if (hit && hit.size > 0) return hit;
    } catch {
      /* */
    }
  }
  if (loader.fetchKind) {
    for (const kind of KINDS) {
      try {
        const hit = await loader.fetchKind(g.id, kind, srcHintFor(g, kind));
        if (hit && hit.size > 0) return hit;
      } catch {
        /* */
      }
    }
  }
  for (const path of paths) {
    try {
      const hit = await loader.download(path);
      if (hit && hit.size > 0) {
        await cacheCover(loader, path, hit);
        return hit;
      }
    } catch {
      /* */
    }
  }
  for (const path of paths) {
    try {
      const hit = await loader.signedFetch(path);
      if (hit && hit.size > 0) {
        await cacheCover(loader, path, hit);
        return hit;
      }
    } catch {
      /* */
    }
  }
  return null;
}

export type LookCovers =
  | { ok: true; blobs: Blob[] }
  | { ok: false; name: string };

export async function loadLookCovers(
  pieces: { id: string; name: string; cutoutSrc?: string; imageSrc?: string }[],
  loader: CoverLoader,
): Promise<LookCovers> {
  const blobs: Blob[] = [];
  for (const g of pieces) {
    const blob = await loadCoverBlob(g, loader);
    if (!blob) return { ok: false, name: g.name };
    blobs.push(blob);
  }
  return { ok: true, blobs };
}

async function defaultDownload(path: string): Promise<Blob | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.storage.from(closetImagesBucket()).download(path);
  if (error || !data || data.size === 0) return null;
  return data;
}

async function defaultSignedFetch(path: string): Promise<Blob | null> {
  const url = await signedCloudUrl(path);
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  const blob = await res.blob();
  return blob.size > 0 ? blob : null;
}

async function liveFetchKind(
  id: string,
  kind: BlobKind,
  srcHint?: string,
): Promise<Blob | null> {
  const uid = getAccount().user?.id;
  const ok = await fetchCloudBlob(id, kind, uid, srcHint);
  if (!ok) return null;
  const blob = await getImage(imageKey(id, kind));
  return blob && blob.size > 0 ? blob : null;
}

export function liveCoverLoader(): CoverLoader {
  return {
    getIdb: getImage,
    fetchKind: liveFetchKind,
    download: defaultDownload,
    signedFetch: defaultSignedFetch,
    putIdb: putImage,
    userId: getAccount().user?.id ?? undefined,
  };
}

export async function coverBlobForGarment(g: Garment): Promise<Blob | null> {
  return loadCoverBlob(g, liveCoverLoader());
}

import { garmentObjectPath } from "./client.ts";
import type { BlobKind } from "./open-plan.ts";

export const CLOUD_PREFIX = "sb:";

export function cloudSrc(userId: string, id: string, kind: BlobKind): string {
  return `${CLOUD_PREFIX}${garmentObjectPath(userId, id, kind)}`;
}

export function isCloudSrc(s: string | undefined | null): s is string {
  return typeof s === "string" && s.startsWith(CLOUD_PREFIX);
}

export function parseCloudSrc(
  s: string | undefined | null,
): { userId: string; id: string; kind: BlobKind; path: string } | null {
  if (!isCloudSrc(s)) return null;
  const path = s.slice(CLOUD_PREFIX.length);
  const m = /^([^/]+)\/([^/]+)\/([oct])\.jpg$/.exec(path);
  if (!m) return null;
  return { userId: m[1]!, id: m[2]!, kind: m[3] as BlobKind, path };
}

/** Never paint sb: or idb: as <img src>. Signed URLs must be http(s). */
export function paintSrc(idbOrBlob: string, signedUrl: string): string {
  if (idbOrBlob.startsWith("sb:") || idbOrBlob.startsWith("idb:")) {
    /* fall through */
  } else if (idbOrBlob.startsWith("blob:") || idbOrBlob.startsWith("data:")) {
    return idbOrBlob;
  } else if (idbOrBlob.startsWith("http://") || idbOrBlob.startsWith("https://")) {
    return idbOrBlob;
  }
  if (signedUrl.startsWith("http://") || signedUrl.startsWith("https://")) return signedUrl;
  if (signedUrl.startsWith("blob:") || signedUrl.startsWith("data:")) return signedUrl;
  return "";
}

export function parseIdbImageKey(
  s: string | undefined | null,
): { id: string; kind: BlobKind } | null {
  if (typeof s !== "string" || !s.startsWith("idb:")) return null;
  const rest = s.slice(4);
  const i = rest.lastIndexOf(":");
  if (i <= 0) return null;
  const kind = rest.slice(i + 1);
  if (kind !== "o" && kind !== "c" && kind !== "t") return null;
  return { id: rest.slice(0, i), kind };
}

export function idbCount(garments: { imageSrc?: string; cutoutSrc?: string }[]): number {
  return garments.filter(
    (g) =>
      (typeof g.imageSrc === "string" && g.imageSrc.startsWith("idb:")) ||
      (typeof g.cutoutSrc === "string" && g.cutoutSrc.startsWith("idb:")),
  ).length;
}

type SrcGarment = { id: string; imageSrc: string; cutoutSrc: string };

/** After a successful :t/:c/:o upload, meta must not stay 145/145 idb:. */
export function rewriteCloudSrcs<T extends SrcGarment>(
  garments: T[],
  userId: string,
  uploadedKinds: Set<string>,
): T[] {
  return garments.map((g) => {
    const o = uploadedKinds.has(`${g.id}:o`);
    const c = uploadedKinds.has(`${g.id}:c`);
    const t = uploadedKinds.has(`${g.id}:t`);
    if (!o && !c && !t) return g;
    const cutoutSrc = c
      ? cloudSrc(userId, g.id, "c")
      : t
        ? cloudSrc(userId, g.id, "t")
        : g.cutoutSrc;
    const imageSrc = o ? cloudSrc(userId, g.id, "o") : cutoutSrc;
    return { ...g, imageSrc, cutoutSrc };
  });
}

/** set() rewritten garments, then read them back — never upsert the pre-rewrite array. */
export function applyBackupToStore<T extends SrcGarment>(
  getGarments: () => T[],
  setGarments: (next: T[]) => void,
  userId: string,
  uploadedKinds: Set<string>,
): T[] {
  const rewritten = rewriteCloudSrcs(getGarments(), userId, uploadedKinds);
  setGarments(rewritten);
  return getGarments();
}

/**
 * Sticky Backup only when leftover idb: AND storage is missing objects.
 * sb: srcs (remaining 0) or listed objects ≥ N → hide. Don't lie.
 */
export function shouldShowBackupBanner(input: {
  signedIn: boolean;
  liveCount: number;
  remaining: number;
  localOnly?: boolean;
  listedThumbs?: number | null;
}): boolean {
  if (!input.signedIn || input.liveCount <= 0) return false;
  if (input.remaining <= 0) return false;
  if (typeof input.listedThumbs !== "number") return false;
  return input.listedThumbs < input.liveCount;
}

export function backupRemaining(input: {
  idbRemaining: number;
  listedThumbs: number;
  liveCount: number;
}): number {
  if (input.idbRemaining <= 0) return 0;
  if (input.listedThumbs >= input.liveCount) return 0;
  return input.idbRemaining;
}

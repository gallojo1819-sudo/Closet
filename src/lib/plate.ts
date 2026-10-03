import type { ImageSource } from "./types.ts";
import { PLATE_FAIL_MESSAGE } from "./scan.ts";

export const REPRINT_CAPTION = PLATE_FAIL_MESSAGE;

type CoverFields = {
  imageSrc?: string;
  cutoutSrc?: string;
  imageSource?: ImageSource | string;
  reprint?: boolean;
  category?: string;
  archived?: boolean;
  id?: string;
  notes?: string;
};

const PLATE_SOURCES = new Set(["official", "cutout", "segmented"]);

/** Short hash of a cover or original. A different file name is not a plate. */
const blobHashes = new Map<string, string>();
const unreadableBlobs = new Set<string>();
let blobRev = 0;
const blobListeners = new Set<() => void>();

function bumpBlobRev(): void {
  blobRev += 1;
  for (const fn of blobListeners) fn();
}

export function subscribeCoverBytes(fn: () => void): () => void {
  blobListeners.add(fn);
  return () => {
    blobListeners.delete(fn);
  };
}

export function coverByteRev(): number {
  return blobRev;
}

export function resetBlobHashes(): void {
  blobHashes.clear();
  unreadableBlobs.clear();
  bumpBlobRev();
}

/** SHA-1, first 8 hex chars. Same width as `c-<sha>.jpg`. */
export async function shortBlobHash(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 8);
}

export function noteBlobHash(src: string, hash: string): void {
  const key = src.trim();
  if (!key || !hash || blobHashes.get(key) === hash) return;
  blobHashes.set(key, hash);
  unreadableBlobs.delete(key);
  bumpBlobRev();
}

export async function noteBlob(src: string, blob: Blob): Promise<string> {
  const hash = await shortBlobHash(await blob.arrayBuffer());
  noteBlobHash(src, hash);
  return hash;
}

export function markBlobUnreadable(src: string): void {
  const key = src.trim();
  if (!key || unreadableBlobs.has(key)) return;
  unreadableBlobs.add(key);
  bumpBlobRev();
}

/** True when both files were hashed and the bytes match. A different name is not enough. */
export function coverBytesMatch(g: CoverFields): boolean {
  const image = g.imageSrc?.trim() ?? "";
  const cutout = g.cutoutSrc?.trim() ?? "";
  if (!image || !cutout || image === cutout) return false;
  const a = blobHashes.get(cutout);
  const b = blobHashes.get(image);
  return Boolean(a && b && a === b);
}

/** False only while a distinct cover and original still need a hash. */
export function coverBytesKnown(g: CoverFields): boolean {
  const image = g.imageSrc?.trim() ?? "";
  const cutout = g.cutoutSrc?.trim() ?? "";
  if (!image || !cutout || image === cutout) return true;
  if (unreadableBlobs.has(image) || unreadableBlobs.has(cutout)) return true;
  return blobHashes.has(image) && blobHashes.has(cutout);
}

/**
 * The cover is still the phone photo.
 * Equal srcs, or a photo that never became a plate (camera matte writes :o and :c).
 */
export function coverIsOriginal(g: CoverFields): boolean {
  const image = g.imageSrc?.trim() ?? "";
  const cutout = g.cutoutSrc?.trim() ?? "";
  if (!image || !cutout) return false;
  if (image === cutout) return true;
  if (PLATE_SOURCES.has(g.imageSource ?? "")) return false;
  return g.imageSource === "photo";
}

/** Automatic pass. reprint false is the explicit "use my photo" choice. */
export function coverStillPhoto(g: CoverFields): boolean {
  if (g.reprint === false) return false;
  return coverIsOriginal(g);
}

export function notesSayHeld(notes?: string): boolean {
  return /\bheld\b/i.test(notes ?? "");
}

/**
 * A plate the grid, Lookbook, and On you may paint.
 * Official and segmented catalog rows may store the same URL for image and cutout.
 * A phone photo, an empty cover, a refused plate, a held shot still pointing at
 * itself, or a `c-<sha>.jpg` whose bytes match the original is not.
 */
export function hasCleanCover(g: CoverFields): boolean {
  const cutout = g.cutoutSrc?.trim() ?? "";
  const image = g.imageSrc?.trim() ?? "";
  if (!cutout) return false;
  if (g.reprint === true) return false;
  const source = g.imageSource ?? "";
  if (source === "photo") return false;
  if (!PLATE_SOURCES.has(source)) return false;
  if (image && cutout === image) {
    if (notesSayHeld(g.notes)) return false;
    return source === "official" || source === "segmented";
  }
  if (coverBytesMatch(g)) return false;
  return true;
}

/** The stored plate key when one already exists. Never the phone photo. */
export function keptPlateKey(g: CoverFields): string {
  if (coverBytesMatch(g)) return "";
  if (hasCleanCover(g)) return g.cutoutSrc?.trim() ?? "";
  const cutout = g.cutoutSrc?.trim() ?? "";
  const image = g.imageSrc?.trim() ?? "";
  if (!cutout || cutout === image || g.imageSource === "photo") return "";
  if (!PLATE_SOURCES.has(g.imageSource ?? "")) return "";
  return cutout;
}

/** Grid paper tile. A refused plate, or outerwear that still has no clean cover. */
export function needsReprintTile(g: CoverFields): boolean {
  if (hasCleanCover(g)) return false;
  if (g.reprint === true) return true;
  return g.category === "outerwear";
}

/**
 * One signed-in pass. Outerwear with no clean plate, when the cover is missing,
 * the notes say held, imageSource is photo, the cutout URL is the original,
 * or the cover file is the same bytes as the original.
 */
export function jacketsNeedingPlate<T extends CoverFields>(garments: T[]): T[] {
  return garments.filter((g) => {
    if (g.archived || g.category !== "outerwear") return false;
    if (hasCleanCover(g)) return false;
    const cutout = g.cutoutSrc?.trim() ?? "";
    const image = g.imageSrc?.trim() ?? "";
    const missing = !cutout;
    const held = notesSayHeld(g.notes);
    const photo = g.imageSource === "photo";
    const same = Boolean(image) && cutout === image;
    return missing || held || photo || same || coverBytesMatch(g);
  });
}

/** One pass. Outerwear only. A plate (official, cutout, segmented) is not included. */
export function rawOuterwearCovers<T extends CoverFields>(garments: T[]): T[] {
  return garments.filter(
    (g) => !g.archived && g.category === "outerwear" && coverStillPhoto(g),
  );
}

export type PlatePatch = {
  cutoutSrc: string;
  imageSource: ImageSource;
  matteQuality: "clean" | "busy";
  reprint: boolean;
};

function sameFileBytes(a: string, b: string): boolean {
  const left = a.trim();
  const right = b.trim();
  if (!left || !right) return false;
  if (left === right) return true;
  const ha = blobHashes.get(left);
  const hb = blobHashes.get(right);
  return Boolean(ha && hb && ha === hb);
}

/**
 * imageSrc is not in the patch. A clean plate is stored at plateKey.
 * A refusal does not point cutoutSrc at the phone photo.
 * A previous c- file that matches the original is not kept.
 * A previous plate whose bytes differ is left in place.
 */
export function plateResultPatch(
  garmentImageSrc: string,
  written: { reprint: boolean; cutoutSrc: string },
  plateKey: string,
  previousCutout = "",
): PlatePatch {
  const refused = {
    cutoutSrc: "",
    imageSource: "cutout" as const,
    matteQuality: "busy" as const,
    reprint: true,
  };
  if (!written.reprint && written.cutoutSrc.startsWith("data:")) {
    return {
      cutoutSrc: plateKey,
      imageSource: "cutout",
      matteQuality: "clean",
      reprint: false,
    };
  }
  const prev = previousCutout.trim();
  const prevIsPhoto =
    !prev || prev === garmentImageSrc || prev.startsWith("data:") || sameFileBytes(prev, garmentImageSrc);
  if (!prevIsPhoto) {
    return {
      cutoutSrc: prev,
      imageSource: "cutout",
      matteQuality: "clean",
      reprint: false,
    };
  }
  const fromWritten = written.cutoutSrc.trim();
  if (
    !written.reprint &&
    fromWritten &&
    fromWritten !== garmentImageSrc &&
    !fromWritten.startsWith("data:") &&
    !sameFileBytes(fromWritten, garmentImageSrc)
  ) {
    return {
      cutoutSrc: fromWritten,
      imageSource: "cutout",
      matteQuality: "clean",
      reprint: false,
    };
  }
  return refused;
}

/** At most `concurrency` workers. Does not start until the caller awaits it. */
export async function runPlatePass<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  concurrency = 2,
): Promise<void> {
  if (!items.length) return;
  let cursor = 0;
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        await worker(items[i]!);
      }
    }),
  );
}


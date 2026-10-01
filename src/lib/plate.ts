import type { ImageSource } from "./types.ts";
import { HAND_COVER_MESSAGE } from "./scan.ts";

export const REPRINT_CAPTION = HAND_COVER_MESSAGE;

type CoverFields = {
  imageSrc?: string;
  cutoutSrc?: string;
  imageSource?: ImageSource | string;
  reprint?: boolean;
  category?: string;
  archived?: boolean;
  id?: string;
};

const PLATE_SOURCES = new Set(["official", "cutout", "segmented"]);

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

/** Grid paper tile. A refused plate, or outerwear whose cover is still the photo. */
export function needsReprintTile(g: CoverFields): boolean {
  if (g.reprint === true) return true;
  if (g.reprint === false) return false;
  return g.category === "outerwear" && coverStillPhoto(g);
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

/**
 * imageSrc is not in the patch. A clean plate is stored at plateKey.
 * A refusal keeps cutoutSrc on the original photo key, never a data URL.
 */
export function plateResultPatch(
  garmentImageSrc: string,
  written: { reprint: boolean; cutoutSrc: string },
  plateKey: string,
): PlatePatch {
  if (!written.reprint && written.cutoutSrc.startsWith("data:")) {
    return {
      cutoutSrc: plateKey,
      imageSource: "cutout",
      matteQuality: "clean",
      reprint: false,
    };
  }
  return {
    cutoutSrc: garmentImageSrc,
    imageSource: "photo",
    matteQuality: "busy",
    reprint: true,
  };
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


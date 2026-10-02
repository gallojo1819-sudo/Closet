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
 * A phone photo, an empty cover, a refused plate, or a held shot still pointing at itself is not.
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
  return true;
}

/** The stored plate key when one already exists. Never the phone photo. */
export function keptPlateKey(g: CoverFields): string {
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
 * the notes say held, imageSource is photo, or the cutout is still the original.
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
    return missing || held || photo || same;
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

/**
 * imageSrc is not in the patch. A clean plate is stored at plateKey.
 * A refusal does not point cutoutSrc at the phone photo.
 * A previous clean plate is left in place.
 */
export function plateResultPatch(
  garmentImageSrc: string,
  written: { reprint: boolean; cutoutSrc: string },
  plateKey: string,
  previousCutout = "",
): PlatePatch {
  if (!written.reprint && written.cutoutSrc.startsWith("data:")) {
    return {
      cutoutSrc: plateKey,
      imageSource: "cutout",
      matteQuality: "clean",
      reprint: false,
    };
  }
  const prev = previousCutout.trim();
  const keepPrev = Boolean(prev) && prev !== garmentImageSrc && !prev.startsWith("data:");
  if (keepPrev) {
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
    !fromWritten.startsWith("data:")
  ) {
    return {
      cutoutSrc: fromWritten,
      imageSource: "cutout",
      matteQuality: "clean",
      reprint: false,
    };
  }
  return {
    cutoutSrc: "",
    imageSource: "cutout",
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


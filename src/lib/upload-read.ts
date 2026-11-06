/**
 * Paste and scan failures. Each reason has its own line.
 * The old banner collapsed every miss into "Could not read N: image.png".
 */

import { HEIC_ERROR } from "./camera.ts";

export const UPLOAD_MISS_COPY = {
  page: "This looks like a page screenshot — crop to one piece or paste the product link.",
  format: "Couldn't open this image format. Save it as JPEG or PNG and paste again.",
  empty: "No garment found in that photo. Crop to one piece and try again.",
  timeout: "Naming timed out. Paste the photo again, or set the name on the tile.",
  read: "Could not read that file.",
} as const;

export type UploadMissReason = keyof typeof UPLOAD_MISS_COPY;

export type UploadMiss = {
  name: string;
  reason: UploadMissReason;
};

export const NEEDS_NAME_PROMPT = "Needs a name — tap to set";

const GENERIC_PASTE =
  /^(image|img|clipboard|unknown|pasted)(\s*\(\d+\))?(\.(png|jpe?g|webp|gif|avif|bmp))?$/i;

/** Clipboard files arrive as image.png. Number them so three misses are not one name. */
export function pastedFileLabel(index: number, name: string): string {
  const base = name.trim();
  if (!base || GENERIC_PASTE.test(base)) return `pasted ${index + 1}`;
  return base;
}

export function uploadMissLine(miss: UploadMiss): string {
  return `${miss.name} — ${missCopy(miss.reason)}`;
}

function missCopy(reason: UploadMissReason): string {
  switch (reason) {
    case "page":
    case "format":
    case "empty":
    case "timeout":
    case "read":
      return UPLOAD_MISS_COPY[reason];
    default: {
      const neverReason: never = reason;
      return neverReason;
    }
  }
}

export function tileCaption(piece: {
  name: string;
  category: string;
  needsName?: boolean;
}): { title: string; meta: string } {
  if (piece.needsName) return { title: NEEDS_NAME_PROMPT, meta: "" };
  return { title: piece.name, meta: piece.category };
}

export class PageRejected extends Error {
  readonly reason = "page" as const;
  constructor() {
    super(UPLOAD_MISS_COPY.page);
    this.name = "PageRejected";
  }
}

export class AlreadyInCloset extends Error {
  constructor() {
    super("Already in the closet.");
    this.name = "AlreadyInCloset";
  }
}

export class NotClothes extends Error {
  constructor() {
    super("Not clothes.");
    this.name = "NotClothes";
  }
}

export class ScanEmpty extends Error {
  readonly reason = "empty" as const;
  constructor() {
    super(UPLOAD_MISS_COPY.empty);
    this.name = "ScanEmpty";
  }
}

export class ImageFormatError extends Error {
  readonly reason = "format" as const;
  constructor() {
    super(UPLOAD_MISS_COPY.format);
    this.name = "ImageFormatError";
  }
}

export type ScanCatch =
  | { type: "dupe"; name: string }
  | { type: "skip" }
  | { type: "heic" }
  | { type: "miss"; miss: UploadMiss };

/** Map a thrown scan error to one banner line. HEIC keeps its own sentence. */
export function classifyScanError(e: unknown, name: string, heic: boolean): ScanCatch {
  if (e instanceof AlreadyInCloset) return { type: "dupe", name };
  if (e instanceof NotClothes) return { type: "skip" };
  if (e instanceof PageRejected) return { type: "miss", miss: { name, reason: "page" } };
  if (e instanceof ScanEmpty) return { type: "miss", miss: { name, reason: "empty" } };
  if (e instanceof ImageFormatError) return { type: "miss", miss: { name, reason: "format" } };
  if (e instanceof Error && e.message === HEIC_ERROR) {
    if (heic) return { type: "heic" };
    return { type: "miss", miss: { name, reason: "format" } };
  }
  if (e instanceof Error && /timed out|timeout/i.test(e.message)) {
    return { type: "miss", miss: { name, reason: "timeout" } };
  }
  return { type: "miss", miss: { name, reason: "read" } };
}

const IMAGE_EXT = /\.(jpe?g|png|webp|avif|gif|bmp|svg)(\?|$)/i;

/**
 * A product-page URL from a copied image. Plain text wins, then a page href,
 * then an img src. Used to fill "Use listing".
 */
export function listingUrlFromClipboard(text: string, html: string): string | null {
  const trimmed = text.trim();
  if (/^https?:\/\/\S+$/i.test(trimmed)) return trimmed;
  const hrefs = [...html.matchAll(/href\s*=\s*["'](https?:\/\/[^"']+)["']/gi)].map(
    (m) => m[1] ?? "",
  );
  const page = hrefs.find((h) => h && !IMAGE_EXT.test(h));
  if (page) return page;
  const src = html.match(/<img[^>]+src\s*=\s*["'](https?:\/\/[^"']+)["']/i)?.[1];
  return src ?? null;
}

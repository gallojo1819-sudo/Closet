import "server-only";
import sharp, { type Sharp } from "sharp";
import type { Bbox } from "./types";

/** Minimal shape needed to score a duplicate candidate. */
export interface DedupCandidate {
  id: string;
  colors: string[] | null;
  subtype: string | null;
  created_at: string;
}

export interface DedupSubject {
  colors: string[];
  subtype: string | null;
}

/** Two subtypes are "compatible" when they match, or either is unknown. */
function subtypeCompatible(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Conservative duplicate flagging. A candidate qualifies when it shares the
 * category (caller pre-filters), at least one color, and a compatible subtype.
 * Returns the strongest match's id (most shared colors, newest as tiebreak),
 * or null. This ONLY produces a flag — never a merge or delete.
 */
export function pickDuplicate(
  subject: DedupSubject,
  candidates: DedupCandidate[],
): string | null {
  const subjectColors = new Set(subject.colors.map((c) => c.toLowerCase()));
  if (subjectColors.size === 0) return null;

  let best: { id: string; shared: number; createdAt: string } | null = null;
  for (const c of candidates) {
    if (!subtypeCompatible(subject.subtype, c.subtype)) continue;
    const shared = (c.colors ?? []).filter((col) =>
      subjectColors.has(col.toLowerCase()),
    ).length;
    if (shared < 1) continue;
    if (
      !best ||
      shared > best.shared ||
      (shared === best.shared && c.created_at > best.createdAt)
    ) {
      best = { id: c.id, shared, createdAt: c.created_at };
    }
  }
  return best?.id ?? null;
}

export interface CropResult {
  buffer: Buffer;
  /** True when the bbox crop was too small and we fell back to the full photo. */
  tooSmall: boolean;
}

/**
 * Produce a 480px-long-side JPEG thumbnail for a garment.
 *
 * Crops the item's bbox (with 12% padding each side, clamped to bounds). If the
 * shorter side of the *unpadded* crop is under 64px AND the item is not an
 * accessory, the crop is rejected: we return the full photo as the thumb and
 * signal `tooSmall` so the caller can set status 'hold'.
 */
export async function makeThumbnail(
  uprightJpeg: Buffer,
  width: number,
  height: number,
  bbox: Bbox | null,
  isAccessory: boolean,
): Promise<CropResult> {
  const resizeToThumb = (b: Sharp) =>
    b
      .resize(480, 480, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

  if (!bbox) {
    return { buffer: await resizeToThumb(sharp(uprightJpeg)), tooSmall: false };
  }

  const [l, t, r, b] = bbox;
  const left = l * width;
  const top = t * height;
  const cropW = (r - l) * width;
  const cropH = (b - t) * height;

  const tooSmall = Math.min(cropW, cropH) < 64 && !isAccessory;
  if (tooSmall) {
    return { buffer: await resizeToThumb(sharp(uprightJpeg)), tooSmall: true };
  }

  const padX = cropW * 0.12;
  const padY = cropH * 0.12;
  const x0 = Math.max(0, Math.round(left - padX));
  const y0 = Math.max(0, Math.round(top - padY));
  const x1 = Math.min(width, Math.round(left + cropW + padX));
  const y1 = Math.min(height, Math.round(top + cropH + padY));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);

  const buffer = await resizeToThumb(
    sharp(uprightJpeg).extract({ left: x0, top: y0, width: w, height: h }),
  );
  return { buffer, tooSmall: false };
}

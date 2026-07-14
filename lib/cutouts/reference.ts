import "server-only";
import sharp from "sharp";
import type { Bbox } from "@/lib/garments/types";

// Build the reference image sent to Gemini: crop the item's bbox (+12% padding,
// clamped) and center it on a neutral light-gray ~1200px square canvas,
// preserving aspect.

const CANVAS = 1200;
const INNER = 1040; // crop is fit within this, leaving even margins
const GRAY = { r: 220, g: 220, b: 220 };

/**
 * Crop the garment's bbox straight from the original photo (no gray canvas),
 * with generous padding so a plain background leaves a transparent margin after
 * segmentation. Used by the segmentation route — these are the real pixels.
 */
export async function cropOriginalBbox(
  original: Buffer,
  bbox: Bbox | null,
  padFrac = 0.22,
): Promise<Buffer> {
  const meta = await sharp(original).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!bbox || !w || !h) return original;
  const [l, t, r, b] = bbox;
  const cw = (r - l) * w;
  const chh = (b - t) * h;
  const x0 = Math.max(0, Math.round(l * w - cw * padFrac));
  const y0 = Math.max(0, Math.round(t * h - chh * padFrac));
  const x1 = Math.min(w, Math.round(r * w + cw * padFrac));
  const y1 = Math.min(h, Math.round(b * h + chh * padFrac));
  return sharp(original)
    .extract({
      left: x0,
      top: y0,
      width: Math.max(1, x1 - x0),
      height: Math.max(1, y1 - y0),
    })
    .toBuffer();
}

export async function buildReferenceCrop(
  original: Buffer,
  bbox: Bbox | null,
): Promise<Buffer> {
  const meta = await sharp(original).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;

  let cropped: Buffer;
  if (bbox && w && h) {
    const [l, t, r, b] = bbox;
    const left = l * w;
    const top = t * h;
    const cw = (r - l) * w;
    const chh = (b - t) * h;
    const padX = cw * 0.12;
    const padY = chh * 0.12;
    const x0 = Math.max(0, Math.round(left - padX));
    const y0 = Math.max(0, Math.round(top - padY));
    const x1 = Math.min(w, Math.round(left + cw + padX));
    const y1 = Math.min(h, Math.round(top + chh + padY));
    cropped = await sharp(original)
      .extract({
        left: x0,
        top: y0,
        width: Math.max(1, x1 - x0),
        height: Math.max(1, y1 - y0),
      })
      .toBuffer();
  } else {
    cropped = original;
  }

  const fitted = await sharp(cropped)
    .resize(INNER, INNER, { fit: "inside", withoutEnlargement: false })
    .toBuffer();

  return sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 3,
      background: GRAY,
    },
  })
    .composite([{ input: fitted, gravity: "center" }])
    .png()
    .toBuffer();
}

import "server-only";
import sharp from "sharp";

// Ladder step A — TRUE SEGMENTATION.
//
// Strip a uniform plain background by sampling the border, keeping the
// garment's ACTUAL pixels. No invention is possible: alpha is computed from the
// real image, RGB is left untouched (no despill — this is not a saturated
// chroma key). This is the pixel-preserving default for garments shot flat on a
// plain surface.
//
// A learned matting model (@imgly/background-removal-node) is the eventual
// upgrade for shadowed / textured backgrounds — see the round Diff Review for
// why it is sequenced separately. This border-sampling stripper is honest for
// the "clean shot on a plain surface" case the shooting guidance targets; when
// the background is not uniform enough it fails cleanly and the ladder falls
// through to the generation route.

const BORDER_BAND = 6;
const LOW = 12; // distance from bg <= this -> fully transparent
const HIGH = 100; // distance from bg >= this -> fully opaque (keep the garment)
const BORDER_OUTLIER_TOL = 36;
const BORDER_MAX_OUTLIER_FRAC = 0.1;

export interface SegmentOk {
  ok: true;
  png: Buffer;
  raw: Buffer;
  width: number;
  height: number;
}
export interface SegmentFail {
  ok: false;
  reason: string;
}
export type SegmentResult = SegmentOk | SegmentFail;

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function inBand(x: number, y: number, w: number, h: number): boolean {
  return (
    x < BORDER_BAND ||
    y < BORDER_BAND ||
    x >= w - BORDER_BAND ||
    y >= h - BORDER_BAND
  );
}

export async function segmentBackground(crop: Buffer): Promise<SegmentResult> {
  const { data, info } = await sharp(crop)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  if (info.channels !== 4) return { ok: false, reason: "not RGBA after decode" };

  // Sample the border band -> background color (median RGB).
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inBand(x, y, w, h)) continue;
      const i = (y * w + x) * 4;
      rs.push(data[i]);
      gs.push(data[i + 1]);
      bs.push(data[i + 2]);
    }
  }
  if (rs.length === 0) return { ok: false, reason: "no border to sample" };
  const bg: [number, number, number] = [median(rs), median(gs), median(bs)];

  // Uniformity gate: if the border isn't a consistent plain field, this isn't a
  // clean background — fall through to the generation route.
  let outliers = 0;
  for (let i = 0; i < rs.length; i++) {
    const dist = Math.max(
      Math.abs(rs[i] - bg[0]),
      Math.abs(gs[i] - bg[1]),
      Math.abs(bs[i] - bg[2]),
    );
    if (dist > BORDER_OUTLIER_TOL) outliers++;
  }
  if (outliers / rs.length > BORDER_MAX_OUTLIER_FRAC) {
    return { ok: false, reason: "background not uniform enough" };
  }

  // Per-pixel alpha from distance to the background. RGB untouched.
  const out = Buffer.alloc(data.length);
  const span = HIGH - LOW;
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const dist = Math.max(
      Math.abs(r - bg[0]),
      Math.abs(g - bg[1]),
      Math.abs(b - bg[2]),
    );
    let alpha: number;
    if (dist <= LOW) alpha = 0;
    else if (dist >= HIGH) alpha = 255;
    else {
      const t = (dist - LOW) / span;
      alpha = Math.round(t * t * (3 - 2 * t) * 255); // smoothstep
    }
    if (alpha === 0) {
      out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
    } else {
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = alpha;
    }
  }

  const png = await sharp(out, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer();
  return { ok: true, png, raw: out, width: w, height: h };
}

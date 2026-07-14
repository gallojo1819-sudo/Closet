import "server-only";
import sharp from "sharp";

// Chroma-key removal, per the round-B2 algorithm.
//
//  - Sample the median RGB from a ~4px band around all four borders = the key.
//  - Per pixel: distance = max per-channel |diff| from the key.
//      <= LOW  -> alpha 0
//      >= HIGH -> keep original alpha
//      between -> smoothstep ramp, multiplied by original alpha.
//  - Despill partially-transparent pixels: cap key-dominant channels to the
//    strongest non-key channel.
//  - Fully-transparent pixels collapse to (0,0,0,0).
//  - If the sampled background is visibly non-uniform, fail rather than matte.

const BORDER_BAND = 4;
const LOW = 12;
const HIGH = 220;
// A border pixel further than this from the key counts as an outlier; if too
// many disagree the "background" isn't a uniform chroma field.
const BORDER_OUTLIER_TOL = 40;
const BORDER_MAX_OUTLIER_FRAC = 0.12;

export type Rgb = [number, number, number];

export interface ChromaOk {
  ok: true;
  /** Encoded RGBA PNG. */
  png: Buffer;
  /** Raw RGBA pixels (4 channels), for QA without re-decoding. */
  raw: Buffer;
  width: number;
  height: number;
  key: Rgb;
}
export interface ChromaFail {
  ok: false;
  reason: string;
}
export type ChromaResult = ChromaOk | ChromaFail;

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** Indices (0=R,1=G,2=B) where the key is "on" (>=128). */
function dominantChannels(key: Rgb): number[] {
  const d: number[] = [];
  for (let c = 0; c < 3; c++) if (key[c] >= 128) d.push(c);
  return d;
}

function inBorderBand(x: number, y: number, w: number, h: number): boolean {
  return (
    x < BORDER_BAND ||
    y < BORDER_BAND ||
    x >= w - BORDER_BAND ||
    y >= h - BORDER_BAND
  );
}

export async function removeChroma(
  image: Buffer,
  keyHexOverride?: string,
): Promise<ChromaResult> {
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  if (info.channels !== 4) return { ok: false, reason: "not RGBA after decode" };

  // --- sample the border band ---
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inBorderBand(x, y, w, h)) continue;
      const i = (y * w + x) * 4;
      rs.push(data[i]);
      gs.push(data[i + 1]);
      bs.push(data[i + 2]);
    }
  }
  const key: Rgb = keyHexOverride
    ? hexToRgb(keyHexOverride)
    : [median(rs), median(gs), median(bs)];

  // --- uniformity gate: too many border pixels disagreeing => fail ---
  let outliers = 0;
  for (let i = 0; i < rs.length; i++) {
    const dist = Math.max(
      Math.abs(rs[i] - key[0]),
      Math.abs(gs[i] - key[1]),
      Math.abs(bs[i] - key[2]),
    );
    if (dist > BORDER_OUTLIER_TOL) outliers++;
  }
  if (rs.length === 0 || outliers / rs.length > BORDER_MAX_OUTLIER_FRAC) {
    return { ok: false, reason: "non-uniform background" };
  }

  // --- per-pixel keying + despill ---
  const dominant = dominantChannels(key);
  const nonKey = [0, 1, 2].filter((c) => !dominant.includes(c));
  const out = Buffer.alloc(data.length);
  const span = HIGH - LOW;

  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a0 = data[i + 3];

    const dist = Math.max(
      Math.abs(r - key[0]),
      Math.abs(g - key[1]),
      Math.abs(b - key[2]),
    );

    let alpha: number;
    if (dist <= LOW) alpha = 0;
    else if (dist >= HIGH) alpha = a0;
    else {
      const t = (dist - LOW) / span;
      const s = t * t * (3 - 2 * t); // smoothstep
      alpha = Math.round(s * a0);
    }

    if (alpha === 0) {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
      continue;
    }

    const px = [r, g, b];
    if (alpha < 255) {
      // Despill: cap each key-dominant channel to the strongest non-key channel.
      let strongestNonKey = 0;
      for (const c of nonKey) strongestNonKey = Math.max(strongestNonKey, px[c]);
      for (const c of dominant) px[c] = Math.min(px[c], strongestNonKey);
    }
    out[i] = px[0];
    out[i + 1] = px[1];
    out[i + 2] = px[2];
    out[i + 3] = alpha;
  }

  const png = await sharp(out, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer();

  return { ok: true, png, raw: out, width: w, height: h, key };
}

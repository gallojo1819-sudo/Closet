import { hexToRgb, type Rgb } from "./chroma";

// Automated QA gates for a keyed cutout. Pure: operates on the final RGBA raw
// buffer produced by removeChroma. Every gate must pass or the attempt fails.

const A_TRANSPARENT = 16; // <= this alpha counts as transparent
const A_CONTENT = 128; // > this alpha counts as solid content
const BORDER_BAND = 4;
const BORDER_MIN_TRANSPARENT_FRAC = 0.9;
const MIN_CONTENT_FRAC = 0.03;
const MAX_CONTENT_FRAC = 0.97;

export interface QaResult {
  pass: boolean;
  failures: string[];
}

function dominantChannels(key: Rgb): number[] {
  const d: number[] = [];
  for (let c = 0; c < 3; c++) if (key[c] >= 128) d.push(c);
  return d;
}

/** A partial-alpha pixel still carrying the key's hue (chroma bleed). */
function isChromaLike(px: Rgb, dominant: number[], nonKey: number[]): boolean {
  let maxNonKey = 0;
  for (const c of nonKey) maxNonKey = Math.max(maxNonKey, px[c]);
  for (const c of dominant) {
    if (px[c] <= 100 || px[c] <= maxNonKey + 40) return false;
  }
  return dominant.length > 0;
}

export function runQaGates(
  raw: Buffer,
  width: number,
  height: number,
  // Chroma key of the generation route; pass null for segmentation (real
  // pixels on an arbitrary background), which skips the chroma-edge gate.
  keyHex: string | null,
): QaResult {
  const failures: string[] = [];
  const w = width;
  const h = height;
  const n = w * h;
  const key = keyHex ? hexToRgb(keyHex) : null;
  const dominant = key ? dominantChannels(key) : [];
  const nonKey = key ? [0, 1, 2].filter((c) => !dominant.includes(c)) : [];
  const alphaAt = (x: number, y: number) => raw[(y * w + x) * 4 + 3];

  let transparentCount = 0;
  let contentCount = 0;
  let borderCount = 0;
  let borderTransparent = 0;
  let chromaEdge = 0;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = raw[i + 3];

      if (a <= A_TRANSPARENT) transparentCount++;
      if (a > A_CONTENT) {
        contentCount++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }

      const border =
        x < BORDER_BAND ||
        y < BORDER_BAND ||
        x >= w - BORDER_BAND ||
        y >= h - BORDER_BAND;
      if (border) {
        borderCount++;
        if (a <= A_TRANSPARENT) borderTransparent++;
      }

      if (key && a > 0 && a < 255) {
        if (isChromaLike([raw[i], raw[i + 1], raw[i + 2]], dominant, nonKey)) {
          chromaEdge++;
        }
      }
    }
  }

  // 1. alpha has both transparent and visible (solid) pixels
  if (transparentCount === 0 || contentCount === 0) {
    failures.push("alpha lacks both transparent and visible pixels");
  }

  // 2. all four corners transparent
  const corners = [
    alphaAt(0, 0),
    alphaAt(w - 1, 0),
    alphaAt(0, h - 1),
    alphaAt(w - 1, h - 1),
  ];
  if (corners.some((a) => a > A_TRANSPARENT)) {
    failures.push("a corner is not transparent");
  }

  // 2b. outer border substantially transparent
  if (borderCount === 0 || borderTransparent / borderCount < BORDER_MIN_TRANSPARENT_FRAC) {
    failures.push("outer border is not substantially transparent");
  }

  // 3. content neither < 3% nor > 97% of canvas
  const contentFrac = contentCount / n;
  if (contentFrac < MIN_CONTENT_FRAC) {
    failures.push("too little content (<3%)");
  } else if (contentFrac > MAX_CONTENT_FRAC) {
    failures.push("too much content (>97%)");
  }

  // 4. alpha bounding box leaves visible padding on all sides
  const pad = Math.max(4, Math.round(0.01 * Math.min(w, h)));
  if (maxX < 0) {
    failures.push("no content bounding box");
  } else if (
    minX < pad ||
    minY < pad ||
    maxX > w - 1 - pad ||
    maxY > h - 1 - pad
  ) {
    failures.push("content clipped or touching an edge (no padding)");
  }

  // 5. no chroma-colored pixels along partially transparent edges
  //    (generation route only — segmentation has no chroma key)
  if (key) {
    const chromaTol = Math.max(20, Math.round(0.0005 * n));
    if (chromaEdge > chromaTol) {
      failures.push("chroma-colored pixels along transparent edges");
    }
  }

  return { pass: failures.length === 0, failures };
}

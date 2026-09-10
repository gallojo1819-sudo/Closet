/**
 * Client-side catalog matte.
 * Always returns a 4:5 paper canvas. Never edge-to-edge bedroom crops.
 * Floods only background connected to the frame so khaki-on-cream stays.
 */

const PAPER = { r: 244, g: 239, b: 230 };
const BORDER = 10;
const OUTLIER_TOL = 34;
const OUT_W = 720;
const OUT_H = 900;
const PAD = 0.12;

export type MatteQuality = "clean" | "ok" | "busy";

export type MatteResult = {
  cutoutSrc: string;
  quality: MatteQuality;
  reason: string;
  /** True when the shot is already catalog-like (white/grey studio bg) — no flood. */
  official: boolean;
};

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

function dist(r: number, g: number, b: number, cr: number, cg: number, cb: number) {
  return Math.max(Math.abs(r - cr), Math.abs(g - cg), Math.abs(b - cb));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read that photo"));
    img.src = src;
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export async function readAsImageSrc(file: File): Promise<string> {
  return fileToDataUrl(file);
}

function drawFit(
  img: HTMLImageElement,
  max = 1100,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(2, Math.round(img.naturalWidth * scale));
  const h = Math.max(2, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas, ctx };
}

function sampleBlock(
  data: Uint8ClampedArray,
  w: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      rs.push(data[i]!);
      gs.push(data[i + 1]!);
      bs.push(data[i + 2]!);
    }
  }
  return { r: median(rs), g: median(gs), b: median(bs) };
}

function sampleBorder(data: Uint8ClampedArray, w: number, h: number) {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const ds: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= BORDER && y >= BORDER && x < w - BORDER && y < h - BORDER) continue;
      const i = (y * w + x) * 4;
      rs.push(data[i]!);
      gs.push(data[i + 1]!);
      bs.push(data[i + 2]!);
    }
  }
  const bg = { r: median(rs), g: median(gs), b: median(bs) };
  let outliers = 0;
  for (let i = 0; i < rs.length; i++) {
    const d = dist(rs[i]!, gs[i]!, bs[i]!, bg.r, bg.g, bg.b);
    ds.push(d);
    if (d > OUTLIER_TOL) outliers++;
  }
  const frac = rs.length ? outliers / rs.length : 1;
  const med = median(ds);
  const mad = median(ds.map((d) => Math.abs(d - med)));
  return { bg, frac, mad, floodTol: Math.max(28, med + 2.4 * mad + 12) };
}

/** A studio/product shot: border is uniform, near-white and near-achromatic.
 *  A cream wall or wood floor fails at least one leg and gets the flood. */
function looksOfficial(
  bg: { r: number; g: number; b: number },
  frac: number,
  mad: number,
): boolean {
  const lo = Math.min(bg.r, bg.g, bg.b);
  const spread =
    Math.max(bg.r, bg.g, bg.b) - lo;
  return frac <= 0.06 && mad <= 6 && lo >= 200 && spread <= 10;
}

function sampleForeground(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  bg: { r: number; g: number; b: number },
) {
  const regions = [
    [0.38, 0.38, 0.62, 0.62],
    [0.28, 0.22, 0.72, 0.45],
    [0.28, 0.5, 0.72, 0.78],
    [0.2, 0.3, 0.45, 0.7],
    [0.55, 0.3, 0.8, 0.7],
  ] as const;
  let best = { r: 40, g: 40, b: 40 };
  let bestD = -1;
  for (const [a, b, c, d] of regions) {
    const fg = sampleBlock(
      data,
      w,
      Math.floor(w * a),
      Math.floor(h * b),
      Math.floor(w * c),
      Math.floor(h * d),
    );
    const dd = dist(fg.r, fg.g, fg.b, bg.r, bg.g, bg.b);
    if (dd > bestD) {
      bestD = dd;
      best = fg;
    }
  }
  return { fg: best, sep: bestD };
}

function floodBackground(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  bg: { r: number; g: number; b: number },
  fg: { r: number; g: number; b: number },
  floodTol: number,
  sep: number,
) {
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (seen[p]) return;
    seen[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  const close = sep < 22;
  while (stack.length) {
    const p = stack.pop()!;
    const i = p * 4;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const db = dist(r, g, b, bg.r, bg.g, bg.b);
    const df = dist(r, g, b, fg.r, fg.g, fg.b);
    const isBg = close ? db <= 16 : db < df - 4 && db <= floodTol;
    if (!isBg) continue;
    data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
    const x = p % w;
    const y = (p / w) | 0;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
}

function opaqueBounds(data: Uint8ClampedArray, w: number, h: number) {
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3]!;
      if (a < 24) continue;
      count++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (count < w * h * 0.015 || maxX <= minX || maxY <= minY) return null;
  return { minX, minY, maxX, maxY, count };
}

function compositePaper(
  src: HTMLCanvasElement,
  box: { minX: number; minY: number; maxX: number; maxY: number } | null,
): string {
  const out = document.createElement("canvas");
  out.width = OUT_W;
  out.height = OUT_H;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.fillStyle = `rgb(${PAPER.r}, ${PAPER.g}, ${PAPER.b})`;
  ctx.fillRect(0, 0, OUT_W, OUT_H);

  const innerW = OUT_W * (1 - PAD * 2);
  const innerH = OUT_H * (1 - PAD * 2);
  let sx = 0;
  let sy = 0;
  let sw = src.width;
  let sh = src.height;
  if (box) {
    sx = box.minX;
    sy = box.minY;
    sw = box.maxX - box.minX + 1;
    sh = box.maxY - box.minY + 1;
  }
  const scale = Math.min(innerW / sw, innerH / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (OUT_W - dw) / 2;
  const dy = (OUT_H - dh) / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
  return out.toDataURL("image/jpeg", 0.85);
}

export async function matteToPaper(imageSrc: string): Promise<MatteResult> {
  const img = await loadImage(imageSrc);
  const { canvas, ctx } = drawFit(img);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { bg, frac, mad, floodTol } = sampleBorder(image.data, canvas.width, canvas.height);

  if (looksOfficial(bg, frac, mad)) {
    return {
      cutoutSrc: compositePaper(canvas, null),
      quality: "clean",
      official: true,
      reason: "Already a catalog shot — centered on paper, pixels untouched.",
    };
  }

  const { fg, sep } = sampleForeground(image.data, canvas.width, canvas.height, bg);

  floodBackground(image.data, canvas.width, canvas.height, bg, fg, floodTol, sep);
  ctx.putImageData(image, 0, 0);

  const box = opaqueBounds(image.data, canvas.width, canvas.height);
  const cutoutSrc = compositePaper(canvas, box);

  let quality: MatteQuality = "clean";
  let reason = "Kept your real pixels — same fabric, same color — on paper.";
  if (frac > 0.28 || sep < 18) {
    quality = "busy";
    reason =
      "Floated on paper from this shot. A cream sheet and window light will cut cleaner.";
  } else if (frac > 0.12) {
    quality = "ok";
    reason = "Floated on paper. Soft edge — a plainer surface will be tighter.";
  }
  return { cutoutSrc, quality, reason, official: false };
}

export function preflightHints(file: File): string[] {
  const hints: string[] = [];
  if (file.size > 12 * 1024 * 1024) hints.push("Very large file — processing may be slow.");
  return hints;
}

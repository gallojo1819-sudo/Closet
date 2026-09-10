/**
 * Client-side catalog matte.
 * Always returns a 4:5 paper canvas. Never edge-to-edge bedroom crops.
 */

const PAPER = { r: 244, g: 239, b: 230 };
const BORDER = 8;
const LOW = 18;
const HIGH = 72;
const OUTLIER_TOL = 34;
const OUTLIER_FRAC = 0.12;
const OUT_W = 720;
const OUT_H = 900;
const PAD = 0.1;

export type MatteQuality = "clean" | "ok" | "busy";

export type MatteResult = {
  cutoutSrc: string;
  quality: MatteQuality;
  reason: string;
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

function sampleBorder(data: Uint8ClampedArray, w: number, h: number) {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
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
    if (dist(rs[i]!, gs[i]!, bs[i]!, bg.r, bg.g, bg.b) > OUTLIER_TOL) outliers++;
  }
  const frac = rs.length ? outliers / rs.length : 1;
  return { bg, frac };
}

function punchBackground(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  bg: { r: number; g: number; b: number },
) {
  const span = HIGH - LOW;
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const d = dist(r, g, b, bg.r, bg.g, bg.b);
    let a: number;
    if (d <= LOW) a = 0;
    else if (d >= HIGH) a = 255;
    else {
      const t = (d - LOW) / span;
      a = Math.round(t * t * (3 - 2 * t) * 255);
    }
    if (a === 0) {
      data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
    } else {
      data[i + 3] = Math.min(data[i + 3]!, a);
    }
  }
}

function floodFromEdges(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  bg: { r: number; g: number; b: number },
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
  while (stack.length) {
    const p = stack.pop()!;
    const i = p * 4;
    const d = dist(data[i]!, data[i + 1]!, data[i + 2]!, bg.r, bg.g, bg.b);
    if (d > HIGH + 8) continue;
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
  if (count < w * h * 0.02 || maxX <= minX || maxY <= minY) return null;
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
  return out.toDataURL("image/jpeg", 0.88);
}

export async function matteToPaper(imageSrc: string): Promise<MatteResult> {
  const img = await loadImage(imageSrc);
  const { canvas, ctx } = drawFit(img);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { bg, frac } = sampleBorder(image.data, canvas.width, canvas.height);

  let quality: MatteQuality = "clean";
  let reason = "Kept your real pixels — same fabric, same color — on paper.";
  if (frac > 0.28) {
    quality = "busy";
    reason =
      "Busy background. Floated the photo on paper anyway — reshoot on a plain sheet for a true cutout.";
  } else if (frac > OUTLIER_FRAC) {
    quality = "ok";
    reason = "Background was a little uneven. Cutout may have soft edges — a plain surface will be cleaner.";
  }

  if (quality !== "busy") {
    floodFromEdges(image.data, canvas.width, canvas.height, bg);
    punchBackground(image.data, canvas.width, canvas.height, bg);
    ctx.putImageData(image, 0, 0);
  }

  const box = quality === "busy" ? null : opaqueBounds(image.data, canvas.width, canvas.height);
  const cutoutSrc = compositePaper(canvas, box);
  return { cutoutSrc, quality, reason };
}

export function preflightHints(file: File): string[] {
  const hints: string[] = [];
  if (file.size > 12 * 1024 * 1024) hints.push("Very large file — processing may be slow.");
  return hints;
}

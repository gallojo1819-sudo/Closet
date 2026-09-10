import type { Category } from "./types";

const SWATCHES: { name: string; r: number; g: number; b: number }[] = [
  { name: "navy", r: 28, g: 40, b: 68 },
  { name: "black", r: 22, g: 22, b: 22 },
  { name: "white", r: 236, g: 234, b: 228 },
  { name: "cream", r: 232, g: 222, b: 198 },
  { name: "khaki", r: 186, g: 168, b: 128 },
  { name: "olive", r: 92, g: 98, b: 62 },
  { name: "grey", r: 140, g: 140, b: 138 },
  { name: "charcoal", r: 64, g: 64, b: 66 },
  { name: "brown", r: 92, g: 62, b: 40 },
  { name: "tan", r: 176, g: 142, b: 98 },
  { name: "blue", r: 70, g: 110, b: 168 },
  { name: "red", r: 150, g: 42, b: 38 },
  { name: "green", r: 52, g: 92, b: 62 },
];

const PAPER = { r: 244, g: 239, b: 230 };

function dist(r: number, g: number, b: number, s: { r: number; g: number; b: number }) {
  return Math.abs(r - s.r) + Math.abs(g - s.g) + Math.abs(b - s.b);
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("guess"));
    img.src = src;
  });
}

export async function guessGarment(cutoutSrc: string): Promise<{
  name: string;
  category: Category;
  subtype: string;
  colors: string[];
}> {
  const img = await load(cutoutSrc);
  const w = 80;
  const h = 100;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return { name: "Piece", category: "other", subtype: "", colors: [] };
  }
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let rs = 0;
  let gs = 0;
  let bs = 0;
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      if (dist(r, g, b, PAPER) < 28) continue;
      n++;
      rs += r;
      gs += g;
      bs += b;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const color =
    n === 0
      ? "cream"
      : SWATCHES.reduce(
          (best, s) => {
            const d = dist(rs / n, gs / n, bs / n, s);
            return d < best.d ? { name: s.name, d } : best;
          },
          { name: "grey", d: 9999 },
        ).name;
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const aspect = bw / bh;
  let category: Category = "other";
  let subtype = "";
  let noun = "piece";
  if (aspect < 0.72) {
    category = "bottom";
    subtype = color === "khaki" || color === "tan" || color === "olive" ? "chinos" : "pants";
    noun = subtype;
  } else if (aspect > 1.15 && bh < h * 0.45) {
    category = "footwear";
    subtype = "shoes";
    noun = "shoes";
  } else if (aspect > 0.95) {
    category = "top";
    subtype = "shirt";
    noun = "shirt";
  } else {
    category = "top";
    noun = "piece";
  }
  const name = `${color[0]!.toUpperCase()}${color.slice(1)} ${noun}`;
  return { name, category, subtype, colors: [color] };
}

export function looksLikeFilename(name: string): boolean {
  return /^(img|dsc|pxl|photo|image)[\s._-]?\d/i.test(name.trim()) || !name.trim();
}

import type { Garment, Occasion } from "./types.ts";

export const PALETTE = [
  "navy",
  "light blue",
  "cream",
  "white",
  "ivory",
  "khaki",
  "beige",
  "tan",
  "camel",
  "brown",
  "chocolate",
  "olive",
  "forest",
  "maroon",
  "burgundy",
  "wine",
  "pink",
  "blush",
  "grey",
  "charcoal",
  "black",
  "rust",
  "gold",
] as const;

export type PaletteColor = (typeof PALETTE)[number];

const RGB: Record<PaletteColor, [number, number, number]> = {
  navy: [28, 42, 82],
  "light blue": [142, 176, 208],
  cream: [240, 228, 204],
  white: [246, 246, 246],
  ivory: [244, 238, 220],
  khaki: [184, 164, 118],
  beige: [210, 190, 158],
  tan: [188, 148, 104],
  camel: [178, 128, 74],
  brown: [108, 68, 38],
  chocolate: [72, 42, 24],
  olive: [92, 102, 48],
  forest: [40, 72, 42],
  maroon: [112, 32, 42],
  burgundy: [88, 22, 40],
  wine: [78, 20, 36],
  pink: [220, 138, 158],
  blush: [230, 178, 184],
  grey: [138, 138, 140],
  charcoal: [58, 58, 64],
  black: [22, 22, 24],
  rust: [168, 68, 38],
  gold: [188, 148, 58],
};

const PAPER: [number, number, number] = [244, 239, 230];

const BLUE = new Set<PaletteColor>(["navy", "light blue"]);
const EARTH = new Set<PaletteColor>(["brown", "chocolate", "camel", "tan", "beige", "khaki", "rust"]);
const RED = new Set<PaletteColor>(["maroon", "burgundy", "wine"]);
const PINK = new Set<PaletteColor>(["pink", "blush"]);
const GREEN = new Set<PaletteColor>(["olive", "forest"]);
const NEUTRAL = new Set<PaletteColor>([
  "navy",
  "grey",
  "cream",
  "white",
  "ivory",
  "khaki",
  "brown",
  "olive",
  "black",
  "charcoal",
  "beige",
  "tan",
  "camel",
  "chocolate",
]);
const ACCENT = new Set<PaletteColor>(["pink", "burgundy", "gold", "wine", "maroon", "blush"]);
const TRIAD = new Set<PaletteColor>(["navy", "cream", "white", "ivory", "brown", "tan", "camel", "chocolate"]);

export function canonicalize(raw: string | undefined | null): PaletteColor | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(/_/g, " ");
  if ((PALETTE as readonly string[]).includes(s)) return s as PaletteColor;
  if (s === "gray") return "grey";
  if (s === "navy blue") return "navy";
  if (s === "lightblue") return "light blue";
  if (s === "off white" || s === "off-white") return "ivory";
  return null;
}

/** Weighted distance: navy (blue-heavy) stays navy, not olive or charcoal. */
export function nearestName(r: number, g: number, b: number): PaletteColor {
  let best: PaletteColor = "grey";
  let bestD = Infinity;
  for (const name of PALETTE) {
    const [cr, cg, cb] = RGB[name];
    const d = Math.sqrt(2 * (r - cr) ** 2 + 4 * (g - cg) ** 2 + 3 * (b - cb) ** 2);
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

function isPaper(r: number, g: number, b: number): boolean {
  const dr = Math.abs(r - PAPER[0]);
  const dg = Math.abs(g - PAPER[1]);
  const db = Math.abs(b - PAPER[2]);
  if (Math.max(dr, dg, db) < 26) return true;
  return r > 236 && g > 230 && b > 218;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("color"));
    el.src = src;
  });
}

/** Median fabric color(s) of a cover, ignoring paper padding. Dominant first. */
export async function sampleCover(dataUrl: string): Promise<PaletteColor[]> {
  const img = await loadImage(dataUrl);
  const max = 80;
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const votes = new Map<PaletteColor, number>();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const a = data[i + 3]!;
    if (a < 20) continue;
    if (isPaper(r, g, b)) continue;
    const name = nearestName(r, g, b);
    votes.set(name, (votes.get(name) ?? 0) + 1);
  }
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return [];
  const total = ranked.reduce((n, [, v]) => n + v, 0);
  const out: PaletteColor[] = [ranked[0]![0]];
  const second = ranked[1];
  if (second && second[1] / total >= 0.16 && second[0] !== out[0]) out.push(second[0]);
  return out.slice(0, 2);
}

/** Tag color vs pixels: navy vs olive is a lot. Keep pixels. */
export function preferPixels(
  sampled: PaletteColor[],
  tagged: string[] | undefined,
): PaletteColor[] {
  if (!sampled.length) {
    return (tagged ?? []).map(canonicalize).filter((c): c is PaletteColor => Boolean(c)).slice(0, 2);
  }
  const t0 = canonicalize(tagged?.[0]);
  const s0 = sampled[0]!;
  if (!t0 || t0 === s0) return sampled;
  const far =
    (BLUE.has(s0) && GREEN.has(t0)) ||
    (GREEN.has(s0) && BLUE.has(t0)) ||
    (s0 === "navy" && (t0 === "white" || t0 === "cream" || t0 === "olive" || t0 === "charcoal")) ||
    (RED.has(s0) && EARTH.has(t0)) ||
    (EARTH.has(s0) && RED.has(t0)) ||
    (s0 === "light blue" && (t0 === "white" || t0 === "grey"));
  return far ? sampled : [t0, ...sampled.filter((c) => c !== t0)].slice(0, 2);
}

const COLOR_LEAD =
  /^(?:(?:dark|light|pale|bright|deep|off)\s+)?(?:navy|olive|khaki|cream|white|black|brown|maroon|burgundy|pink|blue|grey|gray|tan|camel|ivory|red|green|charcoal|beige|stone|ecru|wine|rust|chocolate|blush|forest|gold)\s+/i;

export function titleColor(color: string): string {
  return color
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function nameWithColor(name: string, color: string): string {
  const titled = titleColor(color);
  if (!titled) return name;
  if (COLOR_LEAD.test(name)) return name.replace(COLOR_LEAD, `${titled} `);
  return name;
}

function role(g: Garment): "top" | "bottom" | "footwear" | "other" {
  const b = `${g.subtype} ${g.name}`.toLowerCase();
  if (/\b(shoes?|loafers?|mules?|sneakers?|boots?)\b/.test(b)) return "footwear";
  if (/\b(pants?|chinos?|jeans?|trousers?|shorts?)\b/.test(b)) return "bottom";
  if (g.category === "footwear" || g.category === "bottom" || g.category === "top") {
    return g.category;
  }
  return "other";
}

function colorsOf(g: Garment): PaletteColor[] {
  const out: PaletteColor[] = [];
  for (const c of g.colors) {
    const n = canonicalize(c);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

function has(set: PaletteColor[], ...names: PaletteColor[]): boolean {
  return names.some((n) => set.includes(n));
}

export function harmony(
  pieces: Garment[],
  opts?: { occasion?: Occasion; f?: number },
): number {
  const top = pieces.find((g) => role(g) === "top");
  const bottom = pieces.find((g) => role(g) === "bottom");
  const shoes = pieces.find((g) => role(g) === "footwear");
  const tc = top ? colorsOf(top) : [];
  const bc = bottom ? colorsOf(bottom) : [];
  const sc = shoes ? colorsOf(shoes) : [];
  const all = [...new Set([...tc, ...bc, ...sc])];
  if (!all.length) return 0;

  let s = 0;
  const shoeBlob = shoes ? `${shoes.subtype} ${shoes.name}`.toLowerCase() : "";
  const loafer = /loafer/.test(shoeBlob);
  const sneaker = /sneaker/.test(shoeBlob);

  if (
    (has(all, "navy") && has(all, "light blue")) ||
    (EARTH.size && [...EARTH].filter((c) => all.includes(c)).length >= 2) ||
    ((has(all, "maroon") || has(all, "burgundy")) && has(all, "navy"))
  ) {
    s += 3;
  }
  if (all.every((c) => NEUTRAL.has(c))) s += 2;
  const accents = all.filter((c) => ACCENT.has(c));
  const baseNavyCreamKhaki =
    has(all, "navy") || has(all, "cream") || has(all, "khaki") || has(all, "white");
  if (accents.length === 1 && baseNavyCreamKhaki) s += 2;
  if (top && (has(tc, "cream") || has(tc, "white") || has(tc, "ivory")) && bottom) s += 1;

  if (has(tc, "navy") && has(bc, "olive") && (has(sc, "brown") || has(sc, "tan") || has(sc, "camel"))) {
    s -= 4;
  }
  if (
    (has(all, "black") && (has(sc, "brown") || has(sc, "tan") || has(sc, "camel"))) &&
    !has(all, "navy")
  ) {
    s -= 5;
  }
  if (accents.length >= 2) s -= 5;
  if (sneaker && has(all, "white") && (has(all, "burgundy") || has(all, "maroon")) && opts?.occasion === "dinner") {
    s -= 3;
  }
  const competing = all.filter((c) => !TRIAD.has(c) && !NEUTRAL.has(c) || GREEN.has(c) || PINK.has(c) || RED.has(c));
  const uniqueHues = new Set(
    all.map((c) => {
      if (BLUE.has(c)) return "blue";
      if (EARTH.has(c)) return "earth";
      if (RED.has(c) || PINK.has(c)) return "red";
      if (GREEN.has(c)) return "green";
      return "neutral";
    }),
  );
  if (uniqueHues.size >= 3 && !(has(all, "navy") && has(all, "cream") && has(all, "brown"))) {
    s -= 2;
  }
  void competing;

  if (has(all, "navy") && (has(all, "cream") || has(all, "white") || has(all, "ivory")) && (has(sc, "brown") || has(sc, "tan") || has(sc, "camel") || loafer)) {
    s += 2.5;
  }
  if (has(all, "light blue") && (has(bc, "khaki") || has(bc, "cream")) && (has(sc, "brown") || has(sc, "tan") || loafer)) {
    s += 2.5;
  }
  if (has(all, "olive") && has(all, "khaki") && (has(sc, "brown") || has(sc, "tan") || has(sc, "camel"))) {
    s += 2;
  }
  if ((has(all, "maroon") || has(all, "burgundy")) && has(all, "navy") && (has(all, "cream") || has(all, "white") || has(all, "ivory"))) {
    s += 2.5;
  }
  if (has(all, "pink") && (has(bc, "navy") || has(bc, "cream") || has(bc, "white")) && loafer) {
    s += 2;
  }
  if (has(all, "charcoal") && (has(all, "white") || has(all, "ivory")) && (has(all, "black") || has(all, "burgundy"))) {
    s += 2;
  }
  if (has(all, "camel") && (has(all, "cream") || has(all, "ivory")) && (has(sc, "brown") || has(sc, "tan"))) {
    s += 2;
  }

  const f = opts?.f ?? 68;
  if (f > 75 && (has(all, "olive") || has(all, "burgundy") || has(all, "maroon") || has(all, "forest"))) {
    s -= 2;
  }
  if (f < 55 && (has(all, "navy") || has(all, "charcoal") || has(all, "camel") || has(all, "burgundy") || has(all, "forest"))) {
    s += 1;
  }

  return s;
}

/** Quiet line: “Navy × cream × brown — Ralph.” */
export function colorLine(pieces: Garment[], house?: string): string {
  const order: PaletteColor[] = [];
  const push = (g: Garment | undefined) => {
    const c = g ? colorsOf(g)[0] : undefined;
    if (c && !order.includes(c)) order.push(c);
  };
  push(pieces.find((g) => role(g) === "bottom"));
  push(pieces.find((g) => role(g) === "top"));
  push(pieces.find((g) => role(g) === "footwear"));
  for (const g of pieces) push(g);
  const names = order.slice(0, 3).map((c, i) => (i === 0 ? titleColor(c) : c));
  const palette = names.join(" × ");
  if (house && palette) return `${palette} — ${house}.`;
  return palette;
}

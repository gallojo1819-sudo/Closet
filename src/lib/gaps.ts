import { canonicalize, type PaletteColor } from "./color.ts";
import { daysIdle, housesOf, slotOf } from "./style.ts";
import type { Garment } from "./types.ts";

const EVEN = "The rack is even. Wear what’s sitting.";

function blobOf(g: Garment): string {
  return `${g.subtype} ${g.name} ${g.material}`.toLowerCase();
}

function his(garments: Garment[]): Garment[] {
  return garments.filter((g) => !g.archived && !g.demo);
}

function colorsOf(g: Garment): PaletteColor[] {
  const out: PaletteColor[] = [];
  for (const c of g.colors) {
    const n = canonicalize(c);
    if (n && !out.includes(n)) out.push(n);
  }
  if (!out.length) {
    const b = `${g.name} ${g.subtype}`.toLowerCase();
    for (const p of [
      "navy",
      "light blue",
      "cream",
      "white",
      "ivory",
      "khaki",
      "olive",
      "brown",
      "maroon",
    ] as const) {
      if (b.includes(p) && !out.includes(p)) out.push(p);
    }
  }
  return out;
}

function hasColor(g: Garment, ...names: PaletteColor[]): boolean {
  const cs = colorsOf(g);
  return names.some((n) => cs.includes(n));
}

type Kind =
  | "oxford"
  | "polo"
  | "knit"
  | "chino"
  | "jean"
  | "loafer"
  | "mule"
  | "sneaker"
  | "linen"
  | "rugby"
  | "trouser";

function isKind(g: Garment, kind: Kind): boolean {
  const b = blobOf(g);
  const slot = slotOf(g);
  switch (kind) {
    case "oxford":
      if (/knit|sweater|polo|hoodie|\btee\b|t-shirt|rugby/.test(b)) return false;
      return /oxford/.test(b);
    case "polo":
      return /polo/.test(b);
    case "knit":
      return /knit|sweater|crewneck|pullover|merino|cashmere|cardigan|v-?neck/.test(b);
    case "chino":
      return /chino/.test(b);
    case "jean":
      return /\bjeans?\b|denim/.test(b);
    case "loafer":
      return /loafer/.test(b);
    case "mule":
      return /mule/.test(b);
    case "sneaker":
      return /sneaker|trainer/.test(b);
    case "linen":
      if (!/linen/.test(b)) return false;
      return slot === "top" || slot === "dress";
    case "rugby":
      return /rugby/.test(b);
    case "trouser":
      return /trouser/.test(b);
  }
}

function slotCount(pool: Garment[], slot: "top" | "bottom" | "footwear" | "outerwear"): number {
  if (slot === "top") {
    return pool.filter((g) => {
      const s = slotOf(g);
      return s === "top" || s === "dress";
    }).length;
  }
  return pool.filter((g) => slotOf(g) === slot).length;
}

/**
 * 4–8 catalog lines about holes in HIS closet. No shop, no cart, no brand to buy.
 * Recomputes from garments — no persist key.
 */
export function rackGaps(garments: Garment[]): string[] {
  const pool = his(garments);
  if (!pool.length) return [];

  const lines: string[] = [];
  const push = (s: string) => {
    if (lines.length >= 8) return;
    if (!lines.includes(s)) lines.push(s);
  };

  const tops = slotCount(pool, "top");
  const shoes = slotCount(pool, "footwear");
  const oxfords = pool.filter((g) => isKind(g, "oxford"));
  const knits = pool.filter((g) => isKind(g, "knit"));
  const polos = pool.filter((g) => isKind(g, "polo"));
  const linens = pool.filter((g) => isKind(g, "linen"));
  const loafers = pool.filter((g) => isKind(g, "loafer"));
  const mules = pool.filter((g) => isKind(g, "mule"));
  const trousers = pool.filter((g) => isKind(g, "trouser"));
  const idle = pool.filter((g) => daysIdle(g) >= 21);
  const navy = pool.filter((g) => hasColor(g, "navy"));
  const cream = pool.filter((g) => hasColor(g, "cream", "ivory"));
  const brown = pool.filter((g) => hasColor(g, "brown", "chocolate", "camel", "tan"));
  const whiteOxford = oxfords.filter((g) => hasColor(g, "white"));
  const lightBlueOxford = oxfords.filter((g) => hasColor(g, "light blue"));
  const navyOxford = oxfords.filter((g) => hasColor(g, "navy"));
  const navyKnits = knits.filter((g) => hasColor(g, "navy"));
  const oliveKhaki = pool.filter((g) => hasColor(g, "olive", "khaki", "forest"));
  const ralph = pool.filter((g) => housesOf(g).includes("ralph"));
  const summer =
    pool.filter((g) => g.warmth <= 2).length >= 4 ||
    pool.some((g) => g.seasons.some((s) => /summer|spring/i.test(s))) ||
    pool.some((g) => {
      const hs = housesOf(g);
      return hs.includes("faloni") || hs.includes("fiveFourFive");
    });

  if (idle.length >= 5) {
    push(`${idle.length} pieces sitting. Wear them before anything new.`);
  }

  if (tops > 3 * shoes) {
    push(`${tops} tops, ${shoes} shoes — the rack is waiting on footwear.`);
  }

  if (trousers.length > 0 && loafers.length === 0 && mules.length === 0) {
    push("Trousers without a leather shoe.");
  }

  let saidOxford = false;
  if (oxfords.length === 0 && (knits.length > 0 || polos.length >= 5)) {
    push("Need an oxford (white or light blue) under the knits.");
    saidOxford = true;
  } else if (
    oxfords.length > 0 &&
    navyOxford.length > 0 &&
    whiteOxford.length === 0 &&
    lightBlueOxford.length === 0
  ) {
    push("Light blue or white oxford — you already have the navy.");
    saidOxford = true;
  }

  if (linens.length === 0 && summer) {
    push("No linen shirt. Italian summer is knit-only until you add one.");
  }

  const navyN = navy.length;
  const creamN = cream.length;
  const brownN = brown.length;
  const livesRalphColor =
    (navyN >= 8 || creamN >= 6 || brownN >= 6 || navyN + creamN + brownN >= 12) &&
    (ralph.length >= 4 || oxfords.length + polos.length >= 3);
  if (livesRalphColor && whiteOxford.length === 0 && !saidOxford) {
    push("No white oxford. Ralph looks stall without one.");
  }

  if (navyKnits.length >= 4 && oliveKhaki.length === 0) {
    push("Navy is covered. Khaki or olive would unlock weekday.");
  }

  if (!lines.length) return [EVEN];
  return lines.slice(0, 8);
}

export function rackLine(garments: Garment[]): string | null {
  const lines = rackGaps(garments);
  return lines[0] ?? null;
}

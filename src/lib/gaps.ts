import { canonicalize, type PaletteColor } from "./color.ts";
import { housesOf, slotOf } from "./style.ts";
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
      "burgundy",
      "maroon",
      "black",
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

type Wear = "top" | "bottom" | "footwear" | "outer";

function wearOf(g: Garment): Wear | null {
  const s = slotOf(g);
  if (s === "top" || s === "dress") return "top";
  if (s === "bottom") return "bottom";
  if (s === "footwear") return "footwear";
  if (s === "outerwear") return "outer";
  return null;
}

function isOxford(g: Garment): boolean {
  const b = blobOf(g);
  if (/knit|sweater|polo|hoodie|\btee\b|t-shirt|rugby/.test(b)) return false;
  return /oxford/.test(b);
}

function isKnit(g: Garment): boolean {
  return /knit|sweater|crewneck|pullover|merino|cashmere|cardigan|v-?neck/.test(blobOf(g));
}

function isLinenShirt(g: Garment): boolean {
  if (!/linen/.test(blobOf(g))) return false;
  return wearOf(g) === "top";
}

function isLoafer(g: Garment): boolean {
  return /loafer/.test(blobOf(g));
}

function isMule(g: Garment): boolean {
  return /mule/.test(blobOf(g));
}

function isSneaker(g: Garment): boolean {
  return /sneaker|trainer/.test(blobOf(g));
}

function isTrouser(g: Garment): boolean {
  return /trouser/.test(blobOf(g));
}

function isChino(g: Garment): boolean {
  return /chino/.test(blobOf(g));
}

function isCord(g: Garment): boolean {
  return /cord/.test(blobOf(g));
}

function isLeatherShoe(g: Garment): boolean {
  return isLoafer(g) || isMule(g);
}

function paleOxford(g: Garment): boolean {
  return isOxford(g) && hasColor(g, "white", "light blue", "ivory");
}

/**
 * Outfit holes: name the plates he owns, then the missing type + color.
 * No shop, no cart, no brand. Recomputes from garments — no persist key.
 */
export function rackGaps(garments: Garment[]): string[] {
  const pool = his(garments);
  if (!pool.length) return [];

  const lines: string[] = [];
  const push = (s: string) => {
    if (lines.length >= 8) return;
    if (!lines.includes(s)) lines.push(s);
  };

  const tops = pool.filter((g) => wearOf(g) === "top");
  const bottoms = pool.filter((g) => wearOf(g) === "bottom");
  const shoes = pool.filter((g) => wearOf(g) === "footwear");
  const knits = tops.filter(isKnit);
  const oxfords = tops.filter(isOxford);
  const linens = tops.filter(isLinenShirt);
  const trousers = bottoms.filter(isTrouser);
  const chinos = bottoms.filter(isChino);
  const cords = bottoms.filter(isCord);
  const loafers = shoes.filter(isLoafer);
  const sneakers = shoes.filter(isSneaker);
  const leather = shoes.filter(isLeatherShoe);
  const creamTrousers = trousers.filter((g) => hasColor(g, "cream", "ivory"));
  const navyLoafers = loafers.filter((g) => hasColor(g, "navy"));
  const navyKnits = knits.filter((g) => hasColor(g, "navy"));
  const oliveKhakiBottoms = bottoms.filter((g) => hasColor(g, "olive", "khaki", "forest"));
  const dressLoafers = loafers.filter((g) =>
    hasColor(g, "brown", "chocolate", "tan", "camel", "burgundy", "wine", "maroon"),
  );
  const paleOx = oxfords.filter(paleOxford);
  const summer =
    pool.filter((g) => g.warmth <= 2).length >= 4 ||
    pool.some((g) => g.seasons.some((s) => /summer|spring/i.test(s))) ||
    pool.some((g) => {
      const hs = housesOf(g);
      return hs.includes("faloni") || hs.includes("fiveFourFive");
    });

  const dressedBottom =
    creamTrousers[0] ?? trousers[0] ?? chinos[0] ?? cords[0];
  const dressedShoe = navyLoafers[0] ?? leather[0];
  if (dressedBottom && dressedShoe && paleOx.length === 0) {
    push(
      `Light blue or white oxford would finish the ${dressedBottom.name} + ${dressedShoe.name}.`,
    );
  }

  if (trousers.length > 0 && leather.length === 0 && (knits.length > 0 || sneakers.length > 0)) {
    const t = trousers[0]!;
    const verb = /s$/i.test(t.name.trim()) ? "are" : "is";
    push(`${t.name} ${verb} waiting on a loafer, not another knit.`);
  }

  if (cords.length > 0 && dressLoafers.length === 0 && sneakers.length > 0) {
    const c = cords[0]!;
    push(
      `Brown or burgundy loafer would dress the ${c.name}. Sneakers are the only shoe on them now.`,
    );
  }

  if (navyKnits.length >= 3 && oliveKhakiBottoms.length === 0) {
    push("Navy knits have no khaki/olive bottom — weekday is navy-on-navy.");
  }

  const heatBottom = creamTrousers[0] ?? bottoms.find((g) => g.warmth <= 2);
  if (linens.length === 0 && knits.length > 0 && heatBottom && (summer || creamTrousers.length > 0)) {
    push(
      `Linen shirt would unlock the ${heatBottom.name} in heat. Knits are doing that job now.`,
    );
  }

  if (!lines.length) return [EVEN];
  return lines.slice(0, 8);
}

export function rackLine(garments: Garment[]): string | null {
  const lines = rackGaps(garments);
  return lines[0] ?? null;
}

import { canonicalize, type PaletteColor } from "./color.ts";
import { daysIdle, HOUSE_LABEL, housesOf, lookHouses, slotOf } from "./style.ts";
import type { Garment } from "./types.ts";

export type RackNote = {
  title: string;
  body: string;
  finishes: string[];
};

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

function pair(a: Garment, b: Garment): string {
  return `${a.name} + ${b.name}`;
}

function houseOf(pieces: Garment[]): string {
  const h = lookHouses(pieces)[0] ?? housesOf(pieces[0]!)[0];
  return h ? HOUSE_LABEL[h] : "Ralph";
}

const EVEN: RackNote = {
  title: "The rack is even",
  body: "Wear what’s sitting.",
  finishes: [],
};

/**
 * Stylist notes: missing type + color, why, which of HIS plates it finishes.
 * 3–6 when there are holes. No shop, no cart, no brand. No persist key.
 */
export function rackNotes(garments: Garment[]): RackNote[] {
  const pool = his(garments);
  if (!pool.length) return [];

  const notes: RackNote[] = [];
  const seen = new Set<string>();
  const push = (n: RackNote) => {
    if (notes.length >= 6) return;
    if (seen.has(n.title)) return;
    if (/navy knit/i.test(n.title)) return;
    seen.add(n.title);
    notes.push(n);
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
  const oliveKhakiBottoms = bottoms.filter((g) =>
    hasColor(g, "olive", "khaki", "forest"),
  );
  const dressLoafers = loafers.filter((g) =>
    hasColor(g, "brown", "chocolate", "tan", "camel", "burgundy", "wine", "maroon"),
  );
  const paleOx = oxfords.filter(paleOxford);
  const idle = pool.filter((g) => daysIdle(g) >= 21);
  const summer =
    pool.filter((g) => g.warmth <= 2).length >= 4 ||
    pool.some((g) => g.seasons.some((s) => /summer|spring/i.test(s))) ||
    pool.some((g) => {
      const hs = housesOf(g);
      return hs.includes("faloni") || hs.includes("fiveFourFive");
    });

  if (idle.length >= 5) {
    const names = [...idle]
      .sort((a, b) => daysIdle(b) - daysIdle(a))
      .slice(0, 3)
      .map((g) => g.name);
    push({
      title: "Wear what’s sitting",
      body: `${idle.length} pieces haven’t been out in three weeks. ${names.join(", ")}. Wear them before anything new.`,
      finishes: names,
    });
  }

  const dressedBottom =
    creamTrousers[0] ?? trousers[0] ?? chinos[0] ?? cords[0];
  const dressedShoe = navyLoafers[0] ?? leather[0];
  if (dressedBottom && dressedShoe && paleOx.length === 0) {
    const house = houseOf([dressedBottom, dressedShoe]);
    const knit = knits[0];
    const navyOx = oxfords.find((g) => hasColor(g, "navy"));
    const extra = navyOx
      ? ` You already have the ${navyOx.name}; white or light blue is the one that finishes this.`
      : knit
        ? ` The ${knit.name} is doing the shirt’s job.`
        : "";
    push({
      title: "White oxford",
      body: `Tucked into the ${dressedBottom.name} with the ${dressedShoe.name} — ${house} weekday. You have the bottom and the shoe.${extra}`,
      finishes: [pair(dressedBottom, dressedShoe)],
    });
  }

  if (trousers.length > 0 && leather.length === 0 && (knits.length > 0 || sneakers.length > 0)) {
    const t = trousers[0]!;
    const knit = knits[0];
    const sn = sneakers[0];
    const why = knit
      ? `Not another knit. The ${knit.name} already covers the top.`
      : "Not another trainer.";
    const shoeNow = sn ? ` ${sn.name} is the only shoe on them now.` : "";
    push({
      title: "Brown loafer",
      body: `The ${t.name} are waiting on leather. ${why}${shoeNow} Ralph doesn’t sit on a sneaker.`,
      finishes: [knit ? pair(t, knit) : t.name],
    });
  }

  if (cords.length > 0 && dressLoafers.length === 0 && sneakers.length > 0) {
    const c = cords[0]!;
    const sn = sneakers[0]!;
    if (!seen.has("Brown loafer")) {
      push({
        title: "Brown loafer",
        body: `The ${c.name} want brown or burgundy leather, not ${sn.name}. Sweet Stable doesn’t sit on a sneaker. You have the cords; the shoe is the hole.`,
        finishes: [c.name],
      });
    } else {
      push({
        title: "Burgundy loafer",
        body: `The ${c.name} want brown or burgundy leather. ${sn.name} is the only shoe on them now. Sweet Stable, not a trainer.`,
        finishes: [c.name],
      });
    }
  }

  if (navyKnits.length >= 4 && oliveKhakiBottoms.length === 0) {
    const k = navyKnits[0]!;
    const sh = leather[0] ?? sneakers[0];
    push({
      title: "Khaki chino",
      body: `${k.name} and the rest of the navy knits have no khaki or olive bottom — weekday is navy-on-navy. Ralph wants earth under navy. Not another navy knit.`,
      finishes: [sh ? pair(k, sh) : k.name],
    });
  }

  const heatBottom = creamTrousers[0] ?? bottoms.find((g) => g.warmth <= 2);
  if (
    linens.length === 0 &&
    knits.length > 0 &&
    heatBottom &&
    (summer || creamTrousers.length > 0)
  ) {
    const sh = leather[0] ?? sneakers[0];
    push({
      title: "Linen camp shirt",
      body: `Heat would put the ${heatBottom.name} with a linen camp collar, not a knit. Faloni in summer. The knits are doing that job now.`,
      finishes: [sh ? pair(heatBottom, sh) : heatBottom.name],
    });
  }

  if (!notes.length) return [EVEN];
  return notes.slice(0, 6);
}

export function rackLine(garments: Garment[]): string | null {
  const notes = rackNotes(garments);
  const n = notes[0];
  if (!n) return null;
  if (n.title === EVEN.title) return "The rack is even. Wear what’s sitting.";
  if (n.finishes[0]) return `${n.title} — ${n.finishes[0]}`;
  return n.title;
}

export function rackGaps(garments: Garment[]): string[] {
  return rackNotes(garments).map((n) =>
    n.finishes[0] ? `${n.title} — ${n.finishes[0]}` : n.title,
  );
}

/** One hole the current look still doesn’t fill, or null. */
export function lookMissing(
  pieces: Garment[],
  garments: Garment[],
): { title: string; finishes: string } | null {
  for (const n of rackNotes(garments)) {
    if (!n.finishes.length) continue;
    if (n.title === "Wear what’s sitting") continue;
    const t = n.title.toLowerCase();
    if (t.includes("oxford") && pieces.some(paleOxford)) continue;
    if (t.includes("loafer") && pieces.some(isLeatherShoe)) continue;
    if (
      t.includes("chino") &&
      pieces.some((g) => wearOf(g) === "bottom" && hasColor(g, "olive", "khaki", "forest"))
    ) {
      continue;
    }
    if (t.includes("linen") && pieces.some(isLinenShirt)) continue;
    return { title: n.title, finishes: n.finishes[0]! };
  }
  return null;
}

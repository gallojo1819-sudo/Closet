import { harmony } from "./color.ts";
import type { Garment, Moment, Occasion, WeatherSnap } from "./types.ts";
import { todayISO } from "./utils.ts";

export type { Moment, Occasion };
export type House =
  | "ralph"
  | "ald"
  | "faloni"
  | "italianWinter"
  | "fiveFourFive"
  | "sweetStable";

export const HOUSE_LABEL: Record<House, string> = {
  ralph: "Ralph",
  ald: "ALD",
  faloni: "Faloni",
  italianWinter: "Italian winter",
  fiveFourFive: "FiveFourFive",
  sweetStable: "Sweet Stable",
};

const HOUSES: House[] = [
  "ralph",
  "ald",
  "faloni",
  "italianWinter",
  "fiveFourFive",
  "sweetStable",
];

export function defaultOccasion(d = new Date()): Occasion {
  const day = d.getDay();
  return day === 0 || day === 6 ? "weekend" : "weekday";
}

export function momentOfDay(d = new Date()): Moment {
  const h = d.getHours();
  if (h < 11) return "morning";
  if (h >= 17) return "evening";
  return "day";
}

export function daysIdle(g: Garment, today = todayISO()): number {
  const last = g.wornOn.at(-1) ?? g.createdAt.slice(0, 10);
  if (!last) return 0;
  const ms = Date.parse(today) - Date.parse(last);
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.round(ms / 86_400_000));
}

export function housesOf(g: Garment): House[] {
  const blob = `${g.subtype} ${g.name} ${g.material} ${g.colors.join(" ")} ${g.notes}`.toLowerCase();
  const houses = new Set<House>();
  if (/oxford|polo|chino|cable|blazer/.test(blob) && !/\bhoodies?\b/.test(blob)) {
    houses.add("ralph");
  }
  if (/trouser/.test(blob) && g.formality >= 3) houses.add("ralph");
  if (/loafer/.test(blob) && g.formality >= 3) houses.add("ralph");
  if (
    /navy/.test(blob) &&
    g.formality >= 3 &&
    g.formality <= 4 &&
    !/\bhoodies?\b/.test(blob)
  ) {
    houses.add("ralph");
  }
  if (/\bhoodies?\b|graphic|90s|90's|\bflag\b/.test(blob)) houses.add("ald");
  if (/rugby|oversized|yankee|\b990\b|new balance/.test(blob)) houses.add("ald");
  if (g.formality >= 2 && g.formality <= 3 && /jean|cap|loafer|cream/.test(blob)) {
    houses.add("ald");
  }
  if (g.warmth <= 2 && /linen|silk|no-show/.test(blob)) houses.add("faloni");
  if (g.warmth <= 2 && /trouser/.test(blob) && /light|linen/.test(blob)) houses.add("faloni");
  if (/cashmere|flannel|merino|suede|overcoat/.test(blob)) houses.add("italianWinter");
  if (/linen|sangallo|tailored short|light cashmere/.test(blob)) houses.add("fiveFourFive");
  if (/rugby|gingham|cord|horse|equestrian|ski/.test(blob)) houses.add("sweetStable");
  if (houses.size === 0) houses.add(g.formality >= 3 ? "ralph" : "ald");
  return [...houses];
}

function houseClimateScore(g: Garment, f: number, occasion: Occasion): number {
  const hs = housesOf(g);
  let s = 0;
  if (f > 75 && hs.includes("faloni")) s += 2;
  if (f < 55 && hs.includes("italianWinter")) s += 2;
  if (
    (occasion === "weekend" || occasion === "travel") &&
    (hs.includes("fiveFourFive") || hs.includes("sweetStable"))
  ) {
    s += 1.4;
  }
  if (
    (occasion === "weekday" || occasion === "client" || occasion === "dinner") &&
    hs.includes("ralph")
  ) {
    s += 1.1;
  }
  if (occasion === "weekend" && hs.includes("ald")) s += 1.2;
  return s;
}

function formalityTarget(occasion: Occasion, moment: Moment): number {
  if (occasion === "client") return 4;
  if (occasion === "dinner") return 4;
  if (occasion === "weekend" || occasion === "travel") return 2;
  void moment;
  return 3;
}

function blobOf(g: Garment): string {
  return `${g.subtype} ${g.name} ${g.notes ?? ""}`.toLowerCase();
}

export function isHoodiePiece(g: Garment): boolean {
  return /\b(hoodies?|sweatshirts?)\b/.test(blobOf(g));
}

export function isCampCollar(g: Garment): boolean {
  return /camp/.test(blobOf(g));
}

export function isFairIsle(g: Garment): boolean {
  return /fair\s*isle/.test(blobOf(g));
}

/** 90s / flag / logo / hoodie / printed sweatshirt. Weekend ALD only. */
export function isGraphic(g: Garment): boolean {
  const b = blobOf(g);
  if (/\bhoodies?\b/.test(b)) return true;
  if (/90s|90's/.test(b)) return true;
  if (/\bflag\b|\blogo\b|graphic/.test(b)) return true;
  if (/\bsweatshirts?\b/.test(b) && /print|printed|graphic|flag|logo|90/.test(b)) return true;
  return false;
}

/** Occasion briefs: mixed houses, not costume. Penalties beat idle. */
function occasionScore(g: Garment, occasion: Occasion): number {
  const b = blobOf(g);
  const sneaker = /sneaker|trainer/.test(b);
  const gym = /gym|runner|running|athletic/.test(b);
  const tee = /\btee\b|t-shirt|hoodie/.test(b);
  const jean = /\bjeans?\b|denim/.test(b);
  const cargo = /cargo/.test(b);
  const oxford = /oxford/.test(b);
  const polo = /polo/.test(b);
  const loafer = /loafer/.test(b);
  const trouser = /trouser/.test(b);
  const knit = /knit|sweater|merino/.test(b);
  const overshirt = /overshirt/.test(b);
  const distressed = /distress|ripped|destroyed/.test(b);
  let s = 0;
  if (occasion === "client") {
    if (sneaker || tee || gym) s -= 5;
    if (jean || distressed) s -= 4;
    if (trouser || oxford || loafer) s += 3;
  } else if (occasion === "dinner") {
    if (gym || (sneaker && gym)) s -= 5;
    if (sneaker) s -= 3.5;
    if (cargo) s -= 5;
    if (jean) s -= 2.5;
    if (tee) s -= 2;
    if (loafer) s += 2.5;
    if (trouser) s += 2;
    if (oxford) s += 1.5;
  } else if (occasion === "weekend") {
    if (jean || sneaker || polo) s += 1.5;
    if (/\bhoodies?\b/.test(b)) s += 1;
  } else if (occasion === "travel") {
    if (knit || overshirt || sneaker || loafer) s += 1.5;
  }
  if (
    (occasion === "weekday" || occasion === "client" || occasion === "dinner") &&
    /\bhoodies?\b|90s|graphic/.test(b)
  ) {
    s -= 6;
  }
  return s;
}

const KNOWN_SLOTS = [
  "top",
  "bottom",
  "outerwear",
  "dress",
  "footwear",
  "accessory",
] as const;

type Slot = (typeof KNOWN_SLOTS)[number];

/**
 * Wear slot for pickLook. Name/subtype win when they name a garment
 * (a loafer tagged "bottom" is still footwear). True unknowns stay out
 * so they are never parked on the legs.
 */
export function slotOf(g: Garment): Slot | null {
  const blob = `${g.subtype} ${g.name}`.toLowerCase();
  const footwear = /\b(shoes?|loafers?|mules?|sneakers?|boots?|booties)\b/.test(blob);
  const bottom = /\b(pants?|chinos?|jeans?|trousers?|shorts?)\b/.test(blob);
  const hoodieTop = /\b(hoodies?|sweatshirts?|graphic\s*knits?)\b/.test(blob);
  const top =
    hoodieTop ||
    /\b(t-shirts?|tees?|shirts?|oxfords?|polos?|knits?|sweaters?|rugbys?|cardigans?|jumpers?|pullovers?|crewnecks?|henleys?|cable[- ]?knits?|zip[- ]?(up)?\s*(sweater|knit)?)\b/.test(
      blob,
    );
  const outer =
    /\b(jackets?|coats?|overshirts?|blazers?|bombers?|parkas?|trench|puffers?|windbreakers?|anoraks?|shearlings?)\b/.test(
      blob,
    );
  // "boot cut jeans" is bottom; a lone "loafer" is never pants.
  if (footwear && !bottom) return "footwear";
  if (bottom) return "bottom";
  // Hoodie / sweatshirt / graphic knit is a top, never a coat.
  if (hoodieTop) return "top";
  if (top) return "top";
  if (outer) return "outerwear";
  if (g.category === "other") return null;
  if ((KNOWN_SLOTS as readonly string[]).includes(g.category)) {
    return g.category as Slot;
  }
  return null;
}

/**
 * Graphic / 90s hoodie with pleated trousers and loafers is costume.
 * ALD hoodie only with jean/chino and sneaker. Hoodie is never a coat.
 */
export function houseMixPenalty(pieces: Garment[]): number {
  const graphic = pieces.find(isGraphic);
  if (!graphic) return 0;
  const rest = pieces.filter((g) => g.id !== graphic.id);
  const blob = rest.map((g) => `${g.subtype} ${g.name}`).join(" ").toLowerCase();
  let p = 0;
  if (rest.some(isCampCollar) || rest.some(isFairIsle)) p -= 16;
  if (/loafer|mule|pleat/.test(blob)) p -= 16;
  if (/\boxfords?\b/.test(blob)) p -= 12;
  if (/trouser/.test(blob) && !/\b(chinos?|jeans?)\b/.test(blob)) p -= 16;
  const jean = /\bjeans?\b|denim/.test(blob);
  const chino = /chino/.test(blob);
  const sneaker = /sneaker|trainer|\b990\b/.test(blob);
  if ((jean || chino) && sneaker) p += 2;
  return p;
}

/** House the TOP belongs to. The look follows that house. */
export function leadHouse(pieces: Garment[]): House {
  const top =
    pieces.find((g) => {
      const s = slotOf(g);
      return s === "top" || s === "dress";
    }) ?? pieces[0];
  if (!top) return "ralph";
  const b = blobOf(top);
  if (isGraphic(top)) return "ald";
  if (/sangallo|light cashmere/.test(b)) return "fiveFourFive";
  if (/camp|linen/.test(b) && top.warmth <= 2) return "faloni";
  if (/fair\s*isle|gingham|cord/.test(b)) return "sweetStable";
  if (/rugby/.test(b)) return "ald";
  if (/merino|flannel|cashmere|suede/.test(b)) return "italianWinter";
  if (/oxford|polo|cable|blazer/.test(b)) return "ralph";
  return housesOf(top)[0] ?? "ralph";
}

export function pickLook(
  garments: Garment[],
  opts: {
    weather?: WeatherSnap;
    occasion: Occasion;
    moment: Moment;
    avoid?: Record<string, number>;
    recentWorn?: string[];
    /** Last drop's ids — one reroll only, scored −8. Avoid still caps separately. */
    previousIds?: string[];
  },
): string[] {
  const real = garments.filter((g) => !g.archived && !g.demo);
  // Real closet only. Samples fill Today only when nothing real is on the rack.
  const pool = real.length ? real : garments.filter((g) => !g.archived);
  const by = (slot: Slot) => pool.filter((g) => slotOf(g) === slot);
  const f = opts.weather?.f ?? 68;
  const cool = f < 62;
  const warm = f > 78;
  const target = formalityTarget(opts.occasion, opts.moment);

  const avoid = opts.avoid ?? {};
  const recent = new Set(opts.recentWorn ?? []);
  const previous = new Set(opts.previousIds ?? []);
  const score = (g: Garment) => {
    let s = 0;
    s += 4 - Math.abs(g.formality - target);
    if (cool) s += g.warmth;
    if (warm) s += 6 - g.warmth;
    if (g.wornOn.at(-1) === todayISO()) s -= 6;
    if (recent.has(g.id) && slotOf(g) !== "accessory") s -= 2.5;
    s -= Math.min(avoid[g.id] ?? 0, 4) * 1.6;
    if (previous.has(g.id)) s -= 8;
    s += Math.min(daysIdle(g), 90) / 10;
    s += occasionScore(g, opts.occasion);
    s += houseClimateScore(g, f, opts.occasion);
    return s + Math.random() * 0.25;
  };

  const best = (list: Garment[]) =>
    [...list].sort((a, b) => score(b) - score(a))[0];
  const rank = (slot: Slot) => [...by(slot)].sort((a, b) => score(b) - score(a));

  const tops = rank("top").slice(0, 7);
  const topList = tops.length ? tops : rank("dress").slice(0, 4);
  const bottoms = rank("bottom").slice(0, 7);
  const shoeList = rank("footwear").slice(0, 7);

  type Combo = { ids: string[]; s: number; h: number; pieces: Garment[] };
  const combos: Combo[] = [];
  for (const t of topList) {
    const bottomsOr = bottoms.length ? bottoms : [undefined];
    const shoesOr = shoeList.length ? shoeList : [undefined];
    for (const b of bottomsOr) {
      for (const sh of shoesOr) {
        const pieces = [t, b, sh].filter((g): g is Garment => Boolean(g));
        if (pieces.length < 2) continue;
        const h = harmony(pieces, { occasion: opts.occasion, f });
        const s =
          pieces.reduce((n, g) => n + score(g), 0) + h + houseMixPenalty(pieces);
        combos.push({ ids: pieces.map((g) => g.id), s, h, pieces });
      }
    }
  }
  const ok = combos.filter((c) => c.h >= 0);
  const poolC = (ok.length ? ok : combos).sort((a, b) => b.s - a.s);
  const win = poolC[0];
  const ids: string[] = win ? [...win.ids] : [];
  // Weekday look is top + bottom + footwear. Empty slots omitted, never invented.
  if (cool) {
    // Outerwear only when it's actually cool. Hoodie is not a coat.
    const coats = by("outerwear").filter((g) => !isHoodiePiece(g));
    const outer = best(coats);
    if (outer && !(warm && outer.warmth >= 5)) ids.push(outer.id);
  }
  const acc = by("accessory");
  const belt = acc.find((a) => a.subtype === "belt");
  const shoes = win?.pieces.find((g) => slotOf(g) === "footwear");
  if (
    belt &&
    shoes &&
    /loafer/.test(`${shoes.subtype} ${shoes.name}`.toLowerCase())
  ) {
    ids.push(belt.id);
  }

  const used = new Set(ids);
  const idle = [...pool]
    .filter((g) => !used.has(g.id) && !previous.has(g.id) && daysIdle(g) >= 21)
    .sort((a, b) => daysIdle(b) - daysIdle(a));
  const candidate = idle[0];
  if (candidate) {
    const candSlot = slotOf(candidate);
    const slot = ids.findIndex((id) => {
      const g = pool.find((x) => x.id === id);
      return g && slotOf(g) === candSlot;
    });
    if (slot >= 0) {
      const occupant = pool.find((x) => x.id === ids[slot]);
      // Don't swap a dinner trouser for idle jeans. Client/dinner stay brief-driven.
      const formal = opts.occasion === "client" || opts.occasion === "dinner";
      if (occupant && daysIdle(occupant) < 21 && !formal) {
        const nextIds = ids.map((id, i) => (i === slot ? candidate.id : id));
        const nextPieces = nextIds
          .map((id) => pool.find((x) => x.id === id))
          .filter((g): g is Garment => Boolean(g));
        if (houseMixPenalty(nextPieces) < -8) {
          // keep the occupant — don't drop a 90s hoodie onto pleats + loafer
        } else {
          const hNow = harmony(
            ids.map((id) => pool.find((x) => x.id === id)).filter((g): g is Garment => Boolean(g)),
            { occasion: opts.occasion, f },
          );
          const hNext = harmony(nextPieces, { occasion: opts.occasion, f });
          if (hNext >= 0 || hNext >= hNow) ids[slot] = candidate.id;
        }
      }
    } else if (candSlot === "accessory") {
      ids.push(candidate.id);
    } else if (candSlot === "outerwear" && !isHoodiePiece(candidate)) {
      ids.push(candidate.id);
    }
  }

  return ids;
}

export function lookHouses(pieces: Garment[]): House[] {
  const counts = Object.fromEntries(HOUSES.map((h) => [h, 0])) as Record<House, number>;
  for (const g of pieces) {
    for (const h of housesOf(g)) counts[h] += 1;
  }
  return HOUSES.filter((h) => counts[h] > 0).sort((a, b) => counts[b] - counts[a]);
}

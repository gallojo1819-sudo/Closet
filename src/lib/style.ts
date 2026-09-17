import { harmony } from "./color.ts";
import type { Garment, Moment, Occasion, WearEntry, WeatherSnap } from "./types.ts";
import { lastDays, todayISO } from "./utils.ts";
import { isLinenCampPiece, isOvercoatPiece, seasonFromWeather } from "./season.ts";
import { livePool } from "./rack.ts";
import { onlyTopIsUntucked, resolveTuck } from "./tuck.ts";

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

export const HOUSE_CHIPS: { id: House; label: string }[] = [
  { id: "ralph", label: "Ralph" },
  { id: "ald", label: "ALD" },
  { id: "faloni", label: "Faloni" },
  { id: "fiveFourFive", label: "545" },
  { id: "sweetStable", label: "Sweet Stable" },
  { id: "italianWinter", label: "Italian winter" },
];

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
  if (occasion === "weekday" && hs.includes("sweetStable")) s += 1.1;
  if (
    (occasion === "weekday" || occasion === "out") &&
    hs.includes("ralph")
  ) {
    s += 1.1;
  }
  if ((occasion === "weekend" || occasion === "comfy") && hs.includes("ald")) s += 1.2;
  if (occasion === "comfy" && hs.includes("sweetStable")) s += 1.2;
  return s;
}

function formalityTarget(occasion: Occasion, moment: Moment): number {
  if (occasion === "out") return 4;
  if (occasion === "weekend" || occasion === "travel" || occasion === "comfy") return 2;
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

export function isRugbyPiece(g: Garment): boolean {
  return /rugby/.test(blobOf(g));
}

export function isHeavyCable(g: Garment): boolean {
  const b = blobOf(g);
  if (!/cable|chunky|aran|fisherman/.test(b)) return false;
  return !/fine|silk|thin/.test(b);
}

export function isSangalloPiece(g: Garment): boolean {
  return /sangallo|bowling/.test(blobOf(g));
}

export function isWesternPiece(g: Garment): boolean {
  return /western|cowboy|bolo|pearl\s*snap/.test(blobOf(g));
}

export function isBlazerPiece(g: Garment): boolean {
  return /blazer|sport\s*coats?/.test(blobOf(g));
}

export function isCordBlazer(g: Garment): boolean {
  return isBlazerPiece(g) && /cord/.test(blobOf(g));
}

export function isMulePiece(g: Garment): boolean {
  return /mule/.test(blobOf(g));
}

export function isShortsPiece(g: Garment): boolean {
  return /\bshorts?\b/.test(blobOf(g));
}

export function isDistressedJean(g: Garment): boolean {
  const b = blobOf(g);
  return /\b(jeans?|denim)\b/.test(b) && /distress|ripped|destroyed/.test(b);
}

export function is990Shoe(g: Garment): boolean {
  return /\b990\b|new balance/.test(blobOf(g));
}

function isWhiteAthleticSneaker(g: Garment): boolean {
  const b = blobOf(g);
  if (!/sneaker|trainer/.test(b)) return false;
  return /athletic|gym|runner|running|court/.test(b) && /white|ivory/.test(b);
}

function isTrailSneaker(g: Garment): boolean {
  return /trail|hiker|runner|running/.test(blobOf(g));
}

function isOversizedOxford(g: Garment): boolean {
  const b = blobOf(g);
  return /oxford/.test(b) && /oversized|\bald\b/.test(b);
}

function isItalianKnitPolo(g: Garment): boolean {
  const b = blobOf(g);
  if (!/polo/.test(b)) return false;
  return /linen|silk|italian|knit polo/.test(b);
}

const LOUD =
  /\b(plaid|checks?|gingham|stripes?|striped|floral|print|printed|houndstooth|paisley|camo|leopard|argyle|fair\s*isle)\b/i;

function isLoud(g: Garment): boolean {
  return LOUD.test(`${g.name} ${g.subtype} ${g.notes}`) || isGraphic(g);
}

function isLayerTop(g: Garment): boolean {
  const s = slotOf(g);
  return s === "top" || s === "dress";
}

/**
 * Hard invalid looks. Do not soften. Rugby + loafer is legal; rugby + blazer is not.
 */
export function clashes(pieces: Garment[]): boolean {
  if (pieces.length < 2) return false;
  const tops = pieces.filter(isLayerTop);
  const bottoms = pieces.filter((g) => slotOf(g) === "bottom");
  const camp = pieces.some(isCampCollar);
  const rugby = pieces.some(isRugbyPiece);
  const fairIsle = pieces.some(isFairIsle);
  const heavyCable = pieces.some(isHeavyCable);
  const sangallo = pieces.some(isSangalloPiece);
  const hoodie = pieces.some(isHoodiePiece);
  const graphic = pieces.some(isGraphic);
  const blazer = pieces.some(isBlazerPiece);
  const cordBlazer = pieces.some(isCordBlazer);
  const mule = pieces.some(isMulePiece);
  const overcoat = pieces.some(isOvercoatPiece);
  const nb990 = pieces.some(is990Shoe);
  const flannel = pieces.some((g) => /flannel/.test(blobOf(g)));
  const linenBottom = bottoms.some((g) => /linen/.test(blobOf(g)));
  const linenShort = bottoms.some((g) => isShortsPiece(g) && /linen/.test(blobOf(g)));
  const westernN = pieces.filter(isWesternPiece).length;
  const navyBlazer = pieces.some((g) => isBlazerPiece(g) && /navy/.test(blobOf(g)));

  if (pieces.filter(isLoud).length >= 2) return true;
  if (pieces.filter(isGraphic).length >= 2) return true;
  if (camp && tops.length > 1) return true;
  if (camp && (cordBlazer || nb990 || fairIsle || rugby || heavyCable)) return true;
  if (rugby && blazer) return true;
  if (fairIsle && (mule || sangallo || pieces.some(isWhiteAthleticSneaker) || navyBlazer)) {
    return true;
  }
  if (sangallo && (flannel || overcoat || westernN > 0 || fairIsle)) return true;
  if (heavyCable && (blazer || mule || linenShort)) return true;
  if (mule && (rugby || fairIsle || pieces.some(isTrailSneaker))) return true;
  if (overcoat && (linenBottom || camp || mule)) return true;
  const linenOnly =
    tops.length > 0 &&
    tops.every((g) => isLinenCampPiece(g) || /linen/.test(blobOf(g)));
  if (linenOnly && (overcoat || fairIsle || flannel)) return true;
  if (hoodie && blazer) return true;
  if (westernN >= 2) return true;
  if (blazer && mule) return true;
  if (bottoms.some(isShortsPiece) && overcoat) return true;
  if (graphic) {
    const rest = pieces.filter((g) => g.id !== pieces.find(isGraphic)!.id);
    if (rest.some(isMulePiece)) return true;
    if (rest.some((g) => /loafer/.test(blobOf(g)))) return true;
    if (rest.some((g) => /pleat|trouser/.test(blobOf(g)) && !/\b(chinos?|jeans?)\b/.test(blobOf(g)))) {
      return true;
    }
    if (rest.some((g) => /oxford/.test(blobOf(g)) && isLayerTop(g))) return true;
    if (rest.some(isCampCollar) || rest.some(isFairIsle)) return true;
    if (
      rest.some(
        (g) =>
          /knit|sweater|merino|cable/.test(blobOf(g)) &&
          (/burgundy|wine|dress|cable|merino/.test(blobOf(g)) || g.formality >= 3),
      )
    ) {
      return true;
    }
  }
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
  const blazer = /blazer|sport\s*coats?/.test(b);
  let s = 0;
  if (occasion === "out") {
    if (gym) s -= 4;
    if (trouser || loafer || oxford || knit || blazer) s += 3;
    if (jean) s += 0.4;
    if (sneaker && !gym) s += 0.3;
    if (/\bhoodies?\b|90s/.test(b)) s -= 4;
  } else if (occasion === "weekday") {
    if (oxford || polo || /cable/.test(b)) s += 1;
    if (/chino/.test(b) || trouser || (jean && !distressed)) s += 1;
    if (blazer) s += 1.2;
    if (/\bhoodies?\b|90s|graphic/.test(b)) s -= 6;
  } else if (occasion === "weekend") {
    if (jean || sneaker || polo) s += 1.5;
    if (/\bhoodies?\b/.test(b)) s += 1;
  } else if (occasion === "travel") {
    if (knit || overshirt || sneaker || loafer) s += 1.5;
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

/** House the TOP belongs to. Default PoloDefault (ralph) when unsure. */
export function leadHouse(pieces: Garment[]): House {
  const top =
    pieces.find((g) => {
      const s = slotOf(g);
      return s === "top" || s === "dress";
    }) ?? pieces[0];
  if (!top) return "ralph";
  const b = blobOf(top);
  if (isCampCollar(top) || isItalianKnitPolo(top) || (/linen/.test(b) && top.warmth <= 2 && !isSangalloPiece(top))) {
    return "faloni";
  }
  if (isRugbyPiece(top) || isOversizedOxford(top) || isGraphic(top)) return "ald";
  if (isFairIsle(top) || /gingham/.test(b)) return "sweetStable";
  if (isSangalloPiece(top) || /resort/.test(b)) return "fiveFourFive";
  if (isHeavyCable(top)) return "ralph";
  if (/oxford|polo/.test(b) || (/cable/.test(b) && !isHeavyCable(top))) return "ralph";
  if (/merino|turtleneck|rollneck|flannel|cashmere/.test(b)) return "italianWinter";
  if (/linen/.test(b) || (/knit/.test(b) && top.warmth <= 2 && /silk|linen|soft/.test(b))) {
    return "faloni";
  }
  return "ralph";
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Bottom+shoe and top+bottom pairs worn in the last 7 days. */
export function weekUniformKeys(
  journal: WearEntry[],
  garments: Garment[],
  today = todayISO(),
): Set<string> {
  const week = new Set(lastDays(7, today));
  const byId = new Map(garments.map((g) => [g.id, g]));
  const keys = new Set<string>();
  for (const j of journal) {
    if (j.verdict !== "worn" || !week.has(j.date)) continue;
    const pieces = j.garmentIds
      .map((id) => byId.get(id))
      .filter((g): g is Garment => Boolean(g));
    const top = pieces.find((g) => {
      const s = slotOf(g);
      return s === "top" || s === "dress";
    });
    const bottom = pieces.find((g) => slotOf(g) === "bottom");
    const shoe = pieces.find((g) => slotOf(g) === "footwear");
    if (bottom && shoe) keys.add(pairKey(bottom.id, shoe.id));
    if (top && bottom) keys.add(pairKey(top.id, bottom.id));
  }
  return keys;
}

export function avoidedUniformLine(
  journal: WearEntry[],
  currentIds: string[],
  garments: Garment[],
  today = todayISO(),
): string | null {
  const week = lastDays(7, today);
  const worn = journal.filter((j) => j.verdict === "worn" && week.includes(j.date));
  if (!worn.length) return null;
  const byId = new Map(garments.map((g) => [g.id, g]));
  const of = (ids: string[]) => {
    const pieces = ids.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
    return {
      bottom: pieces.find((g) => slotOf(g) === "bottom"),
      shoe: pieces.find((g) => slotOf(g) === "footwear"),
    };
  };
  const cur = of(currentIds);
  const last = of(worn[0]!.garmentIds);
  if (!cur.bottom || !cur.shoe || !last.bottom || !last.shoe) return null;
  if (pairKey(cur.bottom.id, cur.shoe.id) === pairKey(last.bottom.id, last.shoe.id)) {
    return null;
  }
  return `Not the ${last.bottom.name} + ${last.shoe.name} again.`;
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
    /** These ids stay in their slots. Reroll only the rest. */
    lockedIds?: string[];
    /** Pair keys (bottom|shoe, top|bottom) worn this week — score −12 unless locked. */
    repeatPairs?: Set<string> | string[];
    /** Scarce-first: 1/(1+lookCount). Dress-this-piece partners. */
    usedCount?: Map<string, number>;
  },
): string[] {
  const pool = livePool(garments);
  const by = (slot: Slot) => pool.filter((g) => slotOf(g) === slot);
  const f = opts.weather?.f ?? 68;
  const cool = f < 62;
  const warm = f > 78;
  const target = formalityTarget(opts.occasion, opts.moment);

  const avoid = opts.avoid ?? {};
  const recent = new Set(opts.recentWorn ?? []);
  const previous = new Set(opts.previousIds ?? []);
  const lockedSet = new Set(opts.lockedIds ?? []);
  const lockedGs = [...lockedSet]
    .map((id) => pool.find((g) => g.id === id))
    .filter((g): g is Garment => Boolean(g));
  const pin = new Map<Slot, Garment>();
  for (const g of lockedGs) {
    const s = slotOf(g);
    if (!s) continue;
    if (s === "dress") pin.set("top", g);
    else if (!pin.has(s)) pin.set(s, g);
  }
  const repeats = opts.repeatPairs
    ? opts.repeatPairs instanceof Set
      ? opts.repeatPairs
      : new Set(opts.repeatPairs)
    : new Set<string>();
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
    const season = seasonFromWeather(f);
    if (season === "summer" && (g.warmth >= 4 || isOvercoatPiece(g))) s -= 4;
    if (season === "winter" && isLinenCampPiece(g)) s -= 6;
    if (season === "winter" && g.warmth <= 2) s -= 2;
    if (opts.usedCount) s += 8 / (1 + (opts.usedCount.get(g.id) ?? 0));
    return s + Math.random() * 0.25;
  };

  const best = (list: Garment[]) =>
    [...list].sort((a, b) => score(b) - score(a))[0];
  const rank = (slot: Slot) => [...by(slot)].sort((a, b) => score(b) - score(a));

  const pinnedTop = pin.get("top") ?? pin.get("dress" as Slot);
  const tops = pinnedTop ? [pinnedTop] : rank("top").slice(0, 7);
  const topList = tops.length ? tops : pinnedTop ? [pinnedTop] : rank("dress").slice(0, 4);
  const bottoms = pin.get("bottom") ? [pin.get("bottom")!] : rank("bottom").slice(0, 7);
  const shoeList = pin.get("footwear")
    ? [pin.get("footwear")!]
    : rank("footwear").slice(0, 7);

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
        let s =
          pieces.reduce((n, g) => n + score(g), 0) + h + houseMixPenalty(pieces);
        const topG = pieces.find((g) => {
          const sl = slotOf(g);
          return sl === "top" || sl === "dress";
        });
        const botG = pieces.find((g) => slotOf(g) === "bottom");
        const shoeG = pieces.find((g) => slotOf(g) === "footwear");
        if (botG && shoeG && repeats.has(pairKey(botG.id, shoeG.id))) {
          if (!lockedSet.has(botG.id) && !lockedSet.has(shoeG.id)) s -= 12;
        }
        if (topG && botG && repeats.has(pairKey(topG.id, botG.id))) {
          if (!lockedSet.has(topG.id) && !lockedSet.has(botG.id)) s -= 12;
        }
        if (
          opts.occasion === "out" &&
          f < 75 &&
          onlyTopIsUntucked(pieces) &&
          topG &&
          /camp/.test(`${topG.subtype} ${topG.name}`)
        ) {
          continue;
        }
        if (f < 55 && topG && isLinenCampPiece(topG) && !lockedSet.has(topG.id)) {
          const hasKnit = pool.some((g) => {
            if (isHoodiePiece(g) || isLinenCampPiece(g)) return false;
            const sl = slotOf(g);
            if (sl !== "top" && sl !== "dress") return false;
            return /knit|sweater|merino|cable/.test(`${g.subtype} ${g.name}`.toLowerCase());
          });
          if (hasKnit) continue;
        }
        if (
          (opts.occasion === "weekend" || opts.occasion === "travel") &&
          topG &&
          resolveTuck(topG, opts.occasion, pieces) === "out"
        ) {
          s += 1.2;
        }
        if (
          (opts.occasion === "weekday" || opts.occasion === "out") &&
          topG &&
          resolveTuck(topG, opts.occasion, pieces) === "in"
        ) {
          s += 0.6;
        }
        combos.push({ ids: pieces.map((g) => g.id), s, h, pieces });
      }
    }
  }
  const legal = combos.filter(
    (c) => houseMixPenalty(c.pieces) >= -8 && !clashes(c.pieces),
  );
  const ok = (legal.length ? legal : combos.filter((c) => !clashes(c.pieces))).filter(
    (c) => c.h >= 0,
  );
  const poolC = (ok.length ? ok : legal).sort((a, b) => b.s - a.s);
  const win = poolC[0];
  const ids: string[] = win ? [...win.ids] : lockedGs.map((g) => g.id);
  // Weekday look is top + bottom + footwear. Empty slots omitted, never invented.
  if (pin.get("outerwear")) {
    const o = pin.get("outerwear")!;
    if (!ids.includes(o.id)) ids.push(o.id);
  } else if (cool && !warm) {
    const coats = by("outerwear").filter((g) => {
      if (isHoodiePiece(g)) return false;
      return !/blazer|sport\s*coats?/.test(`${g.subtype} ${g.name}`.toLowerCase());
    });
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
      if (occupant && lockedSet.has(occupant.id)) {
        // locked slot stays
      } else {
        // Don't swap an Out trouser for idle jeans. Out stays brief-driven.
        const formal = opts.occasion === "out";
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
      }
    } else if (candSlot === "accessory") {
      ids.push(candidate.id);
    } else if (candSlot === "outerwear" && !isHoodiePiece(candidate)) {
      const sport = /blazer|sport\s*coats?/.test(
        `${candidate.subtype} ${candidate.name}`.toLowerCase(),
      );
      if (sport) {
        // Lookbook / Today: never complete a look with a random sport coat.
      } else if (!(f >= 75 && (candidate.warmth >= 4 || isOvercoatPiece(candidate)))) {
        ids.push(candidate.id);
      }
    }
  }

  for (const g of lockedGs) {
    const s = slotOf(g);
    if (!s) {
      if (!ids.includes(g.id)) ids.push(g.id);
      continue;
    }
    const idx = ids.findIndex((id) => {
      const x = pool.find((p) => p.id === id);
      return x && slotOf(x) === s;
    });
    if (idx >= 0) ids[idx] = g.id;
    else if (!ids.includes(g.id)) ids.push(g.id);
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

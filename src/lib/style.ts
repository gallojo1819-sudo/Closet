import { harmony } from "./color.ts";
import type { Garment, Moment, Occasion, WearEntry, WeatherSnap } from "./types.ts";
import { lastDays, todayISO } from "./utils.ts";
import { isLinenCampPiece, isOvercoatPiece, seasonFromWeather } from "./season.ts";
import { livePool } from "./rack.ts";
import { onlyTopIsUntucked, resolveTuck } from "./tuck.ts";
import {
  HOUSE_CHIPS,
  HOUSE_LABEL,
  housesOf,
  leadHouse,
  lookHouses,
  lookPrint,
  shoeFamily,
  type House,
} from "./houses.ts";
import {
  isCreamCable,
  pickRecipe,
  recipeAxesDiffer,
  recipeById,
  type ChapterTrack,
  type Recipe,
  type RecipeId,
} from "./recipes.ts";

export type { Moment, Occasion, House };
export { HOUSE_CHIPS, HOUSE_LABEL, housesOf, leadHouse, lookHouses };

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
    (occasion === "weekday" || occasion === "out") &&
    hs.includes("polo")
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

/** Cardigan / fleece / zip-sweater / hoodie — mid layer, never a coat. */
export function isMidlayer(g: Garment): boolean {
  const b = blobOf(g);
  if (isHoodiePiece(g)) return true;
  return /cardigan|fleece|quarter[- ]?zip|zip[- ]?(up)?\s*(sweater|knit)/.test(b);
}

/**
 * True outer: blazer, chore, field, denim trucker, suede/shearling/bomber/toggle/plaid jacket.
 * Not hoodie, cardigan, fleece, zip sweater.
 */
export function isTrueOuter(g: Garment): boolean {
  if (isMidlayer(g) || isHoodiePiece(g)) return false;
  const b = blobOf(g);
  if (/blazer|sport\s*coats?|chore|field|trucker|denim jacket|shearling|suede|bomber|toggle|plaid jacket|overshirt|parkas?|trench|anorak/.test(b)) {
    return true;
  }
  if (g.category === "outerwear" && /jacket|coat/.test(b)) return true;
  return g.category === "outerwear" && !isMidlayer(g) && !/hoodie|cardigan|fleece/.test(b);
}

export type OuterKind = "blazer" | "chore" | "field" | "denim" | "suede" | "other";

export function outerKind(g: Garment): OuterKind {
  const b = blobOf(g);
  if (isBlazerPiece(g)) return "blazer";
  if (/chore/.test(b)) return "chore";
  if (/field/.test(b)) return "field";
  if (/trucker|denim jacket/.test(b) || (/denim/.test(b) && /jacket/.test(b))) return "denim";
  if (/shearling|suede/.test(b)) return "suede";
  return "other";
}

export function isWeekendSoftJacket(g: Garment): boolean {
  const k = outerKind(g);
  return k === "chore" || k === "field" || k === "denim" || k === "suede";
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
  const trueOuters = pieces.filter(isTrueOuter);
  const extraMid = pieces.filter((g) => isMidlayer(g) && !isHeavyCable(g) && !isHoodiePiece(g));
  if (heavyCable && trueOuters.length > 0 && extraMid.length > 0) return true;
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
    /\b(t-shirts?|tees?|shirts?|oxfords?|polos?|knits?|sweaters?|rugbys?|cardigans?|jumpers?|pullovers?|crewnecks?|henleys?|cable[- ]?knits?|fleece|quarter[- ]?zips?|zip[- ]?(up)?\s*(sweater|knit)?)\b/.test(
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
  if (pairKey(cur.bottom.id, cur.shoe.id) !== pairKey(last.bottom.id, last.shoe.id)) {
    return null;
  }
  return `Same ${cur.bottom.name} + ${cur.shoe.name} as last wear.`;
}

function rngFromSalt(salt: number): () => number {
  let a = salt >>> 0 || 1;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

function shuffle<T>(list: T[], rng: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

export function coreSlotIds(
  ids: string[],
  garments: Garment[],
): { top?: string; bottom?: string; shoe?: string } {
  const byId = new Map(garments.map((g) => [g.id, g]));
  const pieces = ids.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
  const top = pieces.find((g) => {
    const s = slotOf(g);
    return s === "top" || s === "dress";
  });
  const bottom = pieces.find((g) => slotOf(g) === "bottom");
  const shoe = pieces.find((g) => slotOf(g) === "footwear");
  return { top: top?.id, bottom: bottom?.id, shoe: shoe?.id };
}

export function coreComboKey(ids: string[], garments: Garment[]): string {
  const c = coreSlotIds(ids, garments);
  return [c.top, c.bottom, c.shoe].filter(Boolean).sort().join("|");
}

export function slotsChanged(prev: string[], next: string[], garments: Garment[]): number {
  const a = coreSlotIds(prev, garments);
  const b = coreSlotIds(next, garments);
  let n = 0;
  if (a.top && b.top && a.top !== b.top) n += 1;
  if (a.bottom && b.bottom && a.bottom !== b.bottom) n += 1;
  if (a.shoe && b.shoe && a.shoe !== b.shoe) n += 1;
  return n;
}

export function silhouetteKey(ids: string[], garments: Garment[], occasion?: Occasion): string {
  const byId = new Map(garments.map((g) => [g.id, g]));
  const pieces = ids.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
  const p = lookPrint(pieces, occasion);
  return `${p.top_type}|${p.bottom_type}|${p.shoe_family}`;
}

function daysSinceCreated(g: Garment, today = todayISO()): number {
  const d = Date.parse((g.createdAt ?? "").slice(0, 10));
  const t = Date.parse(today);
  if (!Number.isFinite(d) || !Number.isFinite(t)) return 99;
  return Math.max(0, Math.round((t - d) / 86_400_000));
}

function outerRequired(
  occasion: Occasion,
  f: number,
  recipe: Recipe | undefined,
  house?: House | "all" | null,
): boolean {
  if (recipe?.outerRequired) return true;
  if (recipe?.outer === "none") return false;
  if (house === "faloni" && f > 72) return false;
  if (house === "purple" || house === "italianWinter") return true;
  const cool = f < 62;
  const season = seasonFromWeather(f);
  const fallWinter = season === "fall" || season === "winter";
  if (fallWinter && cool && (occasion === "weekday" || occasion === "out" || occasion === "travel")) {
    return true;
  }
  return false;
}

function scoreOuterForRecipe(
  g: Garment,
  recipe: Recipe | undefined,
  house: House | "all" | null | undefined,
  occasion: Occasion,
): number {
  const k = outerKind(g);
  const b = blobOf(g);
  let s = 0;
  if (/camel/.test(b) && /overcoat|topcoat/.test(b)) s -= 24;
  if (recipe?.outer === "blazer" && k === "blazer") s += 8;
  if (recipe?.outer === "optional_blazer" && k === "blazer") s += 6;
  if (recipe?.outer === "chore" && (k === "chore" || k === "field" || k === "denim")) s += 8;
  if (recipe?.outer === "field" && k === "field") s += 8;
  if (recipe?.outer === "denim" && k === "denim") s += 8;
  if (recipe?.outer === "suede" && k === "suede") s += 8;
  if (recipe?.outer === "soft" && (k === "blazer" || k === "chore" || k === "field")) s += 6;
  if (recipe?.outer === "cold" && (k === "suede" || k === "blazer" || isOvercoatPiece(g))) s += 8;
  if (house === "ald") {
    if (k === "chore" || k === "denim" || k === "field") s += 8;
    if (k === "blazer" && /navy/.test(b)) s -= 20;
  }
  if (house === "rrl") {
    if (k === "chore" || k === "denim" || k === "suede") s += 8;
    if (k === "blazer" && /navy/.test(b)) s -= 20;
  }
  if (house === "purple" && k === "blazer" && /taupe|ivory|cord|beige/.test(b)) s += 8;
  if (house === "polo" && occasion === "weekday" && k === "blazer") s += 5;
  if (house === "polo" && occasion === "weekend" && k === "field") s += 6;
  if (house === "italianSummer" && k === "blazer" && /taupe|ivory/.test(b)) s += 6;
  if (house === "italianWinter" && (k === "suede" || k === "blazer")) s += 6;
  if (house === "faloni") s -= 12;
  if (occasion === "weekend" && isWeekendSoftJacket(g)) s += 4;
  if (occasion === "weekend" && k === "blazer" && /navy/.test(b)) s -= 6;
  return s;
}

export function pickTrueOuter(
  outers: Garment[],
  core: Garment[],
  recipe: Recipe | undefined,
  opts: {
    occasion: Occasion;
    house?: House | "all" | null;
    f: number;
    legalCombo?: (pieces: Garment[]) => boolean;
    usedOuters?: Set<string>;
  },
): Garment | undefined {
  const ranked = [...outers]
    .filter(isTrueOuter)
    .filter((g) => !core.some((c) => c.id === g.id))
    .sort(
      (a, b) =>
        scoreOuterForRecipe(b, recipe, opts.house, opts.occasion) -
        scoreOuterForRecipe(a, recipe, opts.house, opts.occasion),
    );
  const unused = ranked.filter((g) => !opts.usedOuters?.has(g.id));
  const list = unused.length ? unused : ranked;
  for (const o of list) {
    const next = [...core, o];
    if (clashes(next)) continue;
    if (isBlazerPiece(o)) {
      const shoe = core.find((g) => slotOf(g) === "footwear");
      if (shoe && /mule|sneaker|trainer|\b990\b/.test(blobOf(shoe))) continue;
      if (core.some(isRugbyPiece) || core.some(isHoodiePiece) || core.some(isHeavyCable)) continue;
    }
    if (opts.legalCombo && !opts.legalCombo(next)) continue;
    if (opts.f > 78 && (o.warmth >= 5 || isOvercoatPiece(o))) continue;
    if (scoreOuterForRecipe(o, recipe, opts.house, opts.occasion) < -8) continue;
    return o;
  }
  return undefined;
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
    /** House HARD filter. Empty rather than PoloDefault. */
    legalCombo?: (pieces: Garment[]) => boolean;
    house?: House | "all" | null;
    recipeId?: RecipeId;
    chapter?: ChapterTrack;
    /** Shuffle pool before scoring. Today / Skip pass Date.now() or skip count. */
    salt?: number;
    /** combo keys (sorted ids) already on screen or recently worn/skipped. */
    excludeKeys?: Iterable<string>;
    /** Consecutive Skip: ≥2 of top/bottom/shoe ids must change. */
    minSlotChange?: number;
    /** Consecutive Skip: same silhouette + recolor is illegal. */
    requireSilhouetteChange?: boolean;
  },
): string[] {
  const pool = livePool(garments);
  const rng = rngFromSalt(opts.salt ?? 1);
  const salted = opts.salt != null;
  const by = (slot: Slot) => {
    const list = pool.filter((g) => slotOf(g) === slot);
    return salted ? shuffle(list, rng) : list;
  };
  const f = opts.weather?.f ?? 68;
  const cool = f < 62;
  const warm = f > 78;
  const target = formalityTarget(opts.occasion, opts.moment);
  const house = opts.house && opts.house !== "all" ? opts.house : undefined;
  const chapter = opts.chapter;
  const recipe =
    recipeById(opts.recipeId) ??
    pickRecipe(opts.occasion, pool, { house: opts.house, track: chapter });

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
    if (opts.usedCount) {
      const n = opts.usedCount.get(g.id) ?? 0;
      s += 8 / (1 + n);
      if (n === 0) s += 8;
    }
    if (daysSinceCreated(g) <= 14) s += 8;
    if (chapter) {
      const sl = slotOf(g);
      if (sl === "top" || sl === "dress") {
        if (chapter.usedTops.has(g.id)) s -= 18;
        if (isCreamCable(g) && chapter.creamCableUsed) s -= 20;
      }
      if (sl === "bottom" && chapter.usedBottoms.has(g.id)) s -= 8;
      if (sl === "footwear" && chapter.usedShoes.has(g.id)) s -= 16;
      if (sl === "outerwear" && chapter.usedOuters.has(g.id)) s -= 10;
    }
    if (recipe.top(g) && (slotOf(g) === "top" || slotOf(g) === "dress")) s += 4;
    if (recipe.bottom(g) && slotOf(g) === "bottom") s += 3;
    if (recipe.shoe(g) && slotOf(g) === "footwear") s += 3;
    return s + rng() * (salted ? 2.5 : 0.25);
  };

  const rank = (slot: Slot) => [...by(slot)].sort((a, b) => score(b) - score(a));

  const pinnedTop = pin.get("top") ?? pin.get("dress" as Slot);
  const rankTops = rank("top");
  const unusedTops = rankTops.filter((g) => !chapter?.usedTops.has(g.id));
  const recipeTops = (unusedTops.length ? unusedTops : rankTops).filter((g) => recipe.top(g));
  const exclusiveRecipe = !opts.legalCombo && !house && !salted;
  let topsSrc = exclusiveRecipe && recipeTops.length ? recipeTops : unusedTops.length ? unusedTops : rankTops;
  if (chapter?.creamCableUsed) {
    const withoutCable = topsSrc.filter((g) => !isCreamCable(g));
    if (withoutCable.length) topsSrc = withoutCable;
  }
  const tops = pinnedTop ? [pinnedTop] : topsSrc.slice(0, salted ? 6 : 10);
  const topList = tops.length ? tops : pinnedTop ? [pinnedTop] : rank("dress").slice(0, 4);
  const rankBots = rank("bottom");
  const recipeBots = rankBots.filter((g) => recipe.bottom(g));
  const bottoms = pin.get("bottom")
    ? [pin.get("bottom")!]
    : (exclusiveRecipe && recipeBots.length ? recipeBots : rankBots).slice(0, salted ? 4 : 8);
  const rankShoes = rank("footwear");
  let shoesSrc = exclusiveRecipe ? rankShoes.filter((g) => recipe.shoe(g)) : rankShoes;
  if (!shoesSrc.length) shoesSrc = rankShoes;
  if (chapter) {
    const last3ids = new Set(chapter.recentShoeIds);
    const last3fam = new Set(chapter.recentShoeFamilies);
    const rotated = shoesSrc.filter(
      (g) => !last3ids.has(g.id) && !last3fam.has(shoeFamily(g)),
    );
    const famChange = shoesSrc.filter((g) => !last3fam.has(shoeFamily(g)));
    shoesSrc = rotated.length ? rotated : famChange.length ? famChange : shoesSrc.filter((g) => !last3ids.has(g.id));
    if (!shoesSrc.length) shoesSrc = rankShoes;
  }
  const shoeList = pin.get("footwear") ? [pin.get("footwear")!] : shoesSrc.slice(0, salted ? 4 : 8);

  type Combo = { ids: string[]; s: number; h: number; pieces: Garment[] };
  const combos: Combo[] = [];
  for (const t of topList) {
    const bottomsOr = bottoms.length ? bottoms : [undefined];
    const shoesOr = shoeList.length ? shoeList : [undefined];
    for (const b of bottomsOr) {
      for (const sh of shoesOr) {
        const pieces = [t, b, sh].filter((g): g is Garment => Boolean(g));
        if (pieces.length < 2) continue;
        const h = salted ? 0 : harmony(pieces, { occasion: opts.occasion, f });
        let s =
          pieces.reduce((n, g) => n + score(g), 0) + h + (salted ? 0 : houseMixPenalty(pieces));
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
        if (recipe.top(t)) s += 2;
        if (b && recipe.bottom(b)) s += 1.5;
        if (sh && recipe.shoe(sh)) s += 1.5;
        if (chapter?.lastPrint && topG && botG && shoeG) {
          const print = lookPrint(pieces, opts.occasion);
          const last = chapter.lastPrint;
          if (
            print.top_type === last.top_type &&
            print.shoe_family === last.shoe_family &&
            print.bottom_type === last.bottom_type
          ) {
            s -= 10;
          }
          if (recipeAxesDiffer(last, print, chapter.lastRecipe, recipe.id) < 3) s -= 14;
        }
        if (chapter && topG && chapter.usedTops.has(topG.id)) {
          const leftover = topList.filter((x) => !chapter.usedTops.has(x.id));
          if (leftover.length) continue;
        }
        combos.push({ ids: pieces.map((g) => g.id), s, h, pieces });
      }
    }
  }
  const houseOk = opts.legalCombo
    ? combos.filter((c) => !clashes(c.pieces) && opts.legalCombo!(c.pieces))
    : salted
      ? combos.filter((c) => c.pieces.length >= 3)
      : combos.filter((c) => houseMixPenalty(c.pieces) >= -8 && !clashes(c.pieces));
  const legal = houseOk;
  const ok = (legal.length ? legal : opts.legalCombo ? legal : combos.filter((c) => !clashes(c.pieces))).filter(
    (c) => c.h >= 0,
  );
  const banned = new Set(opts.excludeKeys ?? []);
  let poolC = (ok.length ? ok : legal).sort((a, b) => b.s - a.s);
  if (banned.size) {
    const fresh = poolC.filter((c) => !banned.has(coreComboKey(c.ids, pool)));
    if (fresh.length) poolC = fresh;
  }
  if (opts.minSlotChange && opts.minSlotChange > 0 && (opts.previousIds?.length ?? 0) >= 3) {
    const moved = poolC.filter(
      (c) => slotsChanged(opts.previousIds!, c.ids, pool) >= (opts.minSlotChange ?? 0),
    );
    if (moved.length) poolC = moved;
  }
  if (opts.requireSilhouetteChange && (opts.previousIds?.length ?? 0) >= 3) {
    const prevSilh = silhouetteKey(opts.previousIds!, pool, opts.occasion);
    const changed = poolC.filter((c) => silhouetteKey(c.ids, pool, opts.occasion) !== prevSilh);
    if (changed.length) poolC = changed;
  }
  const win = poolC[0];
  const ids: string[] = win ? [...win.ids] : lockedGs.map((g) => g.id);
  const corePieces = ids
    .map((id) => pool.find((g) => g.id === id))
    .filter((g): g is Garment => Boolean(g));
  const hasCore =
    corePieces.some((g) => {
      const s = slotOf(g);
      return s === "top" || s === "dress";
    }) &&
    corePieces.some((g) => slotOf(g) === "bottom") &&
    corePieces.some((g) => slotOf(g) === "footwear");
  if (pin.get("outerwear")) {
    const o = pin.get("outerwear")!;
    if (hasCore && !ids.includes(o.id) && isTrueOuter(o) && !clashes([...corePieces, o])) ids.push(o.id);
  } else if (hasCore) {
    const want =
      outerRequired(opts.occasion, f, recipe, house) ||
      (cool && !warm && recipe.outer !== "none") ||
      recipe.outer === "blazer" ||
      recipe.outer === "optional_blazer" ||
      recipe.outer === "cold";
    if (want) {
      const outer = pickTrueOuter(by("outerwear"), corePieces, recipe, {
        occasion: opts.occasion,
        house: opts.house,
        f,
        legalCombo: opts.legalCombo,
        usedOuters: chapter?.usedOuters,
      });
      if (outer && !ids.includes(outer.id)) ids.push(outer.id);
    }
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
  const idle =
    salted || (opts.previousIds?.length ?? 0) > 0
      ? []
      : [...pool]
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



/**
 * Piece classifiers, the hard clashes, the occasion and season checks, and the pick. Since the
 * probability round (Oct 15 2026) nothing here scores: pickLook draws at random among the looks
 * that pass the rules (passesRules in stylist/legal.ts), with rotation weights (draw.ts) and a
 * seed the caller hands in, so the same seed and closet give the same look.
 */
import { drawOrder, JEANS_BLAZER_ODDS, lookWeight, pieceWeight, rngFromSalt, type Rng, type WeightCtx } from "./draw.ts";
import {
  mapOccasion,
  type DailyDrop,
  type Garment,
  type Moment,
  type Occasion,
  type WearEntry,
  type WeatherSnap,
} from "./types.ts";
import { lastDays, todayISO, todayNY } from "./utils.ts";
import { garmentMemo, piecesMemo } from "./garment-memo.ts";
import { isLinenCampPiece, isOvercoatPiece, lookFitsSeason, pieceFitsSeason, seasonFromWeather, seasonWarmth, type Season } from "./season.ts";
import { jacketInfo, jeansWithBlazer, slotPieces, wearSlot } from "./stylist/jackets.ts";
import { JACKET_COVER_IDS, needsJacketOnly, pieceRuleFails, relaxTiers, ruleFails, type RuleCtx } from "./stylist/legal.ts";
import { livePool } from "./rack.ts";
import { onlyTopIsUntucked, resolveTuck } from "./tuck.ts";
import { pieceVetoIds, tuckHabitIds, type TasteMemory } from "./taste.ts";
import {
  HOUSE_CHIPS,
  HOUSE_LABEL,
  housesOf,
  leadHouse,
  lookHouses,
  lookPrint,
  type House,
} from "./houses.ts";

export type { Moment, Occasion, House };
export { HOUSE_CHIPS, HOUSE_LABEL, housesOf, leadHouse, lookHouses };

export function defaultOccasion(d = new Date()): Occasion {
  const day = d.getDay();
  return day === 0 || day === 6 ? "weekend" : "weekday";
}

/** Stored occasion counts only when that drop is dated today. */
export function todayOccasion(
  drop: DailyDrop | null | undefined,
  today = todayISO(),
  now = new Date(),
): Occasion {
  if (drop?.date === today && drop.occasion) return mapOccasion(drop.occasion);
  return defaultOccasion(now);
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

/** Days since the last real wear. Null when wornOn is empty. Does not use createdAt. */
export function lastWornDays(g: Garment, today = todayISO()): number | null {
  const last = g.wornOn.at(-1);
  if (!last) return null;
  const ms = Date.parse(today) - Date.parse(last);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round(ms / 86_400_000));
}

function blobOf(g: Garment): string {
  return garmentMemo(g, "style.blob", buildBlob);
}

function buildBlob(g: Garment): string {
  return `${g.subtype} ${g.name} ${g.notes ?? ""}`.toLowerCase();
}

/* The classifiers below read only fields garmentMemo checks, so each runs once per garment object. */

export function isHoodiePiece(g: Garment): boolean {
  return garmentMemo(g, "style.hoodie", hoodieTest);
}

function hoodieTest(g: Garment): boolean {
  return /\b(hoodies?|sweatshirts?)\b/.test(blobOf(g));
}

export function isCampCollar(g: Garment): boolean {
  return garmentMemo(g, "style.camp", campTest);
}

function campTest(g: Garment): boolean {
  return /camp/.test(blobOf(g));
}

export function isFairIsle(g: Garment): boolean {
  return garmentMemo(g, "style.fairIsle", fairIsleTest);
}

function fairIsleTest(g: Garment): boolean {
  return /fair\s*isle/.test(blobOf(g));
}

/** 90s / flag / logo / hoodie / printed sweatshirt. Weekend ALD only. */
export function isGraphic(g: Garment): boolean {
  return garmentMemo(g, "style.graphic", graphicTest);
}

function graphicTest(g: Garment): boolean {
  const b = blobOf(g);
  if (/\bhoodies?\b/.test(b)) return true;
  if (/90s|90's/.test(b)) return true;
  if (/\bflag\b|\blogo\b|graphic/.test(b)) return true;
  if (/\bsweatshirts?\b/.test(b) && /print|printed|graphic|flag|logo|90/.test(b)) return true;
  return false;
}

export function isRugbyPiece(g: Garment): boolean {
  return garmentMemo(g, "style.rugby", rugbyTest);
}

function rugbyTest(g: Garment): boolean {
  return /rugby/.test(blobOf(g));
}

export function isHeavyCable(g: Garment): boolean {
  return garmentMemo(g, "style.heavyCable", heavyCableTest);
}

function heavyCableTest(g: Garment): boolean {
  const b = blobOf(g);
  if (!/cable|chunky|aran|fisherman/.test(b)) return false;
  return !/fine|silk|thin/.test(b);
}

export function isSangalloPiece(g: Garment): boolean {
  return garmentMemo(g, "style.sangallo", sangalloTest);
}

function sangalloTest(g: Garment): boolean {
  return /sangallo|bowling/.test(blobOf(g));
}

export function isWesternPiece(g: Garment): boolean {
  return garmentMemo(g, "style.western", westernTest);
}

function westernTest(g: Garment): boolean {
  return /western|cowboy|bolo|pearl\s*snap/.test(blobOf(g));
}

export function isBlazerPiece(g: Garment): boolean {
  return garmentMemo(g, "style.blazer", blazerTest);
}

function blazerTest(g: Garment): boolean {
  return /blazer|sport\s*coats?/.test(blobOf(g));
}

/** Cardigan / fleece / zip-sweater / hoodie — mid layer, never a coat. */
export function isMidlayer(g: Garment): boolean {
  return garmentMemo(g, "style.midlayer", midlayerTest);
}

function midlayerTest(g: Garment): boolean {
  const b = blobOf(g);
  if (isHoodiePiece(g)) return true;
  return /cardigan|fleece|quarter[- ]?zip|zip[- ]?(up)?\s*(sweater|knit)/.test(b);
}

/**
 * True outer: blazer, chore, field, denim trucker, suede/shearling/bomber/toggle/plaid jacket.
 * Not hoodie, cardigan, fleece, zip sweater.
 */
export function isTrueOuter(g: Garment): boolean {
  return garmentMemo(g, "style.trueOuter", trueOuterTest);
}

function trueOuterTest(g: Garment): boolean {
  if (isMidlayer(g) || isHoodiePiece(g)) return false;
  const b = blobOf(g);
  if (/\bvests?\b/.test(b) && !/\b(jacket|blazer|coat)\b/.test(b)) return false;
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
  return garmentMemo(g, "style.cordBlazer", cordBlazerTest);
}

function cordBlazerTest(g: Garment): boolean {
  return isBlazerPiece(g) && /cord/.test(blobOf(g));
}

export function isMulePiece(g: Garment): boolean {
  return garmentMemo(g, "style.mule", muleTest);
}

function muleTest(g: Garment): boolean {
  return /mule/.test(blobOf(g));
}

export function isShortsPiece(g: Garment): boolean {
  return garmentMemo(g, "style.shorts", shortsTest);
}

function shortsTest(g: Garment): boolean {
  return /\bshorts?\b/.test(blobOf(g));
}

export function isDistressedJean(g: Garment): boolean {
  const b = blobOf(g);
  return /\b(jeans?|denim)\b/.test(b) && /distress|ripped|destroyed/.test(b);
}

export function is990Shoe(g: Garment): boolean {
  return garmentMemo(g, "style.990", nb990Test);
}

function nb990Test(g: Garment): boolean {
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

const LOUD =
  /\b(plaid|checks?|gingham|stripes?|striped|floral|print|printed|houndstooth|paisley|camo|leopard|argyle|fair\s*isle)\b/i;

function isLoud(g: Garment): boolean {
  return garmentMemo(g, "style.loud", loudTest);
}

function loudTest(g: Garment): boolean {
  return LOUD.test(`${g.name} ${g.subtype} ${g.notes}`) || isGraphic(g);
}

function isLayerTop(g: Garment): boolean {
  const s = slotOf(g);
  return s === "top" || s === "dress";
}

const CHECK_WORD = /\b(gingham|tattersall|windowpane|houndstooth|checks?|plaids?|graph)\b/;

/** Small gingham is not the same scale as windowpane or plaid. Fair isle is not a check. */
export function checkScale(g: Garment): string | null {
  const b = blobOf(g);
  if (!CHECK_WORD.test(b)) return null;
  if (/gingham|tattersall|micro|mini/.test(b)) return "small";
  if (/windowpane/.test(b)) return "window";
  if (/houndstooth/.test(b)) return "hound";
  if (/plaid|buffalo|large|oversized/.test(b)) return "large";
  return "check";
}

/** Two checks of one scale (PATTERN-SCALE): a fail the relax ladder may waive when nothing else passes. */
export function sameScaleChecks(pieces: Garment[]): boolean {
  const scales = pieces.map(checkScale).filter((s): s is string => Boolean(s));
  return new Set(scales).size < scales.length;
}

/** A linen piece, by its name, subtype, notes or material. */
export function isLinenPiece(g: Garment): boolean {
  return /linen/.test(`${blobOf(g)} ${(g.material ?? "").toLowerCase()}`);
}

/** A flannel piece, by its name, subtype, notes or material. */
export function isFlannelPiece(g: Garment): boolean {
  return /flannel/.test(`${blobOf(g)} ${(g.material ?? "").toLowerCase()}`);
}

/**
 * Hard invalid looks. Do not soften. Rugby + loafer is legal; rugby + blazer is not. Linen and
 * flannel never share a look (any linen piece with any flannel piece). A hoodie or a graphic
 * may wear loafers: no rule bans loafers from that look family (Joe, Oct 15 2026).
 */
export function clashes(pieces: Garment[]): boolean {
  return piecesMemo(pieces, "style.clashes", clashTest);
}

function clashTest(pieces: Garment[]): boolean {
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
  const flannel = pieces.some(isFlannelPiece);
  const linen = pieces.some(isLinenPiece);
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
  if (linen && flannel) return true;
  const linenOnly =
    tops.length > 0 &&
    tops.every((g) => isLinenCampPiece(g) || /linen/.test(blobOf(g)));
  if (linenOnly && (overcoat || fairIsle)) return true;
  if (hoodie && blazer) return true;
  if (hoodie && pieces.some((g) => slotOf(g) === "bottom" && /pleat/.test(blobOf(g)))) return true;
  const trueOuters = pieces.filter(isTrueOuter);
  const extraMid = pieces.filter((g) => isMidlayer(g) && !isHeavyCable(g) && !isHoodiePiece(g));
  if (heavyCable && trueOuters.length > 0 && extraMid.length > 0) return true;
  if (westernN >= 2) return true;
  if (blazer && mule) return true;
  const mids = pieces.filter((g) => isMidlayer(g));
  if (mids.length > 1) return true;
  const denimShirt = pieces.some(
    (g) => slotOf(g) === "top" && /denim/.test(blobOf(g)) && /shirt/.test(blobOf(g)),
  );
  const denimTrucker = pieces.some((g) => /trucker|denim jacket/.test(blobOf(g)));
  const jeanBottom = bottoms.some((g) => /\bjeans?\b|denim/.test(blobOf(g)));
  if (denimShirt && denimTrucker && jeanBottom) return true;
  if (bottoms.some(isShortsPiece) && overcoat) return true;
  if (graphic) {
    const rest = pieces.filter((g) => g.id !== pieces.find(isGraphic)!.id);
    if (rest.some(isMulePiece)) return true;
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

/**
 * The occasion checks Today's pick once scored, as named fails. Out: no gym shoe, no hoodie,
 * no untucked camp shirt on a cool night. Weekday: no hoodie or graphic. Comfy: no collared
 * woven shirt, no tailored trouser, no oxford, no blazer, and not a shirt over tailoring.
 */
export function occasionFails(pieces: Garment[], occasion: Occasion, f?: number): string[] {
  const ids: string[] = [];
  const push = (id: string) => {
    if (!ids.includes(id)) ids.push(id);
  };
  const top = pieces.find(isLayerTop);
  for (const g of pieces) {
    const b = blobOf(g);
    const gym = /gym|runner|running|athletic/.test(b) && slotOf(g) === "footwear";
    const jean = /\bjeans?\b|denim/.test(b);
    const oxford = /oxford/.test(b);
    const trouser = /trouser/.test(b);
    const blazer = /blazer|sport\s*coats?/.test(b);
    if (occasion === "out") {
      if (gym) push("OCC-OUT-GYM");
      if (/\bhoodies?\b|90s/.test(b)) push("OCC-OUT-HOODIE");
    } else if (occasion === "weekday") {
      if (/\bhoodies?\b|90s|graphic/.test(b)) push("OCC-WEEKDAY-GRAPHIC");
    } else if (occasion === "comfy") {
      if (slotOf(g) === "top" && isWovenCollarShirt(b)) push("OCC-COMFY-SHIRT");
      if (slotOf(g) === "bottom" && trouser && !jean) push("OCC-COMFY-TROUSER");
      if (oxford && isLayerTop(g)) push("OCC-COMFY-OXFORD");
      if (blazer) push("OCC-COMFY-BLAZER");
    }
  }
  if (occasion === "comfy" && comfyCostume(pieces)) push("OCC-COMFY-COSTUME");
  if (occasion === "out" && top && (f ?? 68) < 75 && onlyTopIsUntucked(pieces) && /camp/.test(`${top.subtype} ${top.name}`)) {
    push("OCC-OUT-CAMP-UNTUCKED");
  }
  return ids;
}

/**
 * The season and weather checks Today's pick once scored, as named fails. Summer: no warmth-4
 * piece, no overcoat. Winter: no linen or camp piece. Any season: the season's hard fits
 * (lookFitsSeason: a summer shirt in the cold, shorts in winter, a linen top in winter, a
 * solstice mix), a piece whose own seasons leave this one out, an outermost upper layer (the
 * jacket, else the mid, else the top) two steps from the season's weight (WARMTH-FIT: a
 * warmth-2 layer alone in winter, a warmth-4 layer in summer), and a linen camp top as the
 * only top below 55°F while the closet owns a knit. The old per-piece "warmth 2 in winter"
 * nudge is not a rule: the jacket rules (XC-SEA-2, JKT-COV-2) judge the upper body's warmth.
 */
export function seasonFails(pieces: Garment[], season: Season, f?: number, pool?: readonly Garment[]): string[] {
  const ids: string[] = [];
  const push = (id: string) => {
    if (!ids.includes(id)) ids.push(id);
  };
  const target = seasonWarmth(season);
  for (const g of pieces) {
    if (slotOf(g) === "accessory") continue;
    if (season === "summer" && (g.warmth >= 4 || isOvercoatPiece(g))) push("SEA-SUMMER-WARM");
    if (season === "winter" && isLinenCampPiece(g)) push("SEA-WINTER-LINEN");
    if (!pieceFitsSeason(g, season)) push("SEA-PIECE");
  }
  const slots = slotPieces(pieces);
  const outermost = (slots.outer ?? slots.mid ?? slots.top) as Garment | undefined;
  if (outermost && Math.abs(outermost.warmth - target) >= 2) push("WARMTH-FIT");
  if (pieces.length >= 2 && !lookFitsSeason(pieces, season)) push("SEA-FIT");
  const top = pieces.find(isLayerTop);
  if (f !== undefined && f < 55 && top && isLinenCampPiece(top)) {
    const hasKnit = (pool ?? []).some((g) => {
      if (isHoodiePiece(g) || isLinenCampPiece(g)) return false;
      const sl = slotOf(g);
      if (sl !== "top" && sl !== "dress") return false;
      return /knit|sweater|merino|cable/.test(`${g.subtype} ${g.name}`.toLowerCase());
    });
    if (hasKnit) push("WEATHER-LINEN-COLD");
  }
  return ids;
}

/** The one preference that was a reject in all but name: a blazer over two casual pieces. */
export function trendFails(pieces: Garment[]): string[] {
  const blazer = pieces.some(isBlazerPiece);
  const casual = pieces.filter(
    (g) => isHoodiePiece(g) || isCampCollar(g) || /\b(tee|t-shirt|jeans?|sneaker)\b/.test(blobOf(g)),
  );
  return blazer && casual.length >= 2 ? ["TREND-BLAZER-CASUAL"] : [];
}

/** A collared woven shirt: oxford, button-down, poplin, flannel, chambray, or a plain "shirt" that is not a knit, polo, tee or sweat. */
function isWovenCollarShirt(blob: string): boolean {
  if (/\b(polo|knit|sweater|tee|t-shirt|sweatshirt|hoodie|rugby|overshirt)\b/.test(blob)) return false;
  return /\b(oxford|button[- ]?down|poplin|flannel|chambray|twill shirt|dress shirt|linen shirt|shirts?)\b/.test(blob);
}

/** A tailored trouser: trousers, pleats, wool, slacks, dress pants; not jeans or chinos. */
function isTailoredTrouser(blob: string): boolean {
  if (/\b(jeans?|denim|chinos?|cords?|corduroy|sweatpants?|joggers?)\b/.test(blob)) return false;
  return /\b(trousers?|pleat(ed)?|slacks|dress pants?|wool pants?|flannel pants?)\b/.test(blob);
}

/** Comfy's one hard rule: not a collared woven shirt over tailored trousers. */
export function comfyCostume(pieces: Garment[]): boolean {
  const shirt = pieces.some((g) => slotOf(g) === "top" && isWovenCollarShirt(blobOf(g)));
  const trouser = pieces.some((g) => slotOf(g) === "bottom" && isTailoredTrouser(blobOf(g)));
  return shirt && trouser;
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
const JACKET_WORD = /\b(jackets?|blazers?|coats?|bombers?|chore|field|trucker|trench)\b/;

/** Brown / tan suede or shearling outer. Hoodie and fleece are not this. */
export function isBrownSuedeOuter(g: Garment): boolean {
  if (isHoodiePiece(g) || (isMidlayer(g) && !isTrueOuter(g))) return false;
  const b = blobOf(g);
  const outerish = isTrueOuter(g) || JACKET_WORD.test(b);
  return outerish && /suede|shearling/.test(b) && /brown|tan|camel|chocolate/.test(b);
}

export function slotOf(g: Garment): Slot | null {
  return garmentMemo(g, "style.slotOf", slotTest);
}

function slotTest(g: Garment): Slot | null {
  const worn = wearSlot(g);
  if (worn === "outer") return "outerwear";
  if (worn === "mid" || worn === "top") return "top";
  if (worn === "bottom") return "bottom";
  if (worn === "shoe") return "footwear";
  const blob = `${g.subtype} ${g.name} ${g.notes ?? ""}`.toLowerCase();
  const footwear = /\b(shoes?|loafers?|mules?|sneakers?|boots?|booties)\b/.test(blob);
  const bottom = /\b(pants?|chinos?|jeans?|trousers?|shorts?)\b/.test(blob);
  const hoodieTop = /\b(hoodies?|sweatshirts?)\b/.test(blob);
  const jacketWord = JACKET_WORD.test(blob);
  const top =
    hoodieTop ||
    /\b(t-shirts?|tees?|shirts?|oxfords?|polos?|knits?|sweaters?|rugbys?|cardigans?|jumpers?|pullovers?|crewnecks?|henleys?|cable[- ]?knits?|fleece|quarter[- ]?zips?|zip[- ]?(up)?\s*(sweater|knit)?)\b/.test(
      blob,
    );
  const outer =
    jacketWord ||
    /\b(overshirts?|parkas?|puffers?|windbreakers?|anoraks?|shearlings?)\b/.test(blob);
  // "boot cut jeans" is bottom; a lone "loafer" is never pants.
  if (footwear && !bottom && !jacketWord) return "footwear";
  if (bottom && !jacketWord) return "bottom";
  // Hoodie / sweatshirt stays a top, even if the category says outerwear.
  if (hoodieTop) return "top";
  // Cardigan, fleece, zip-sweater, and vest are never the outer.
  if (
    /\b(cardigans?|fleece|vests?)\b/.test(blob) ||
    /zip[- ]?(up)?\s*(sweater|knit)/.test(blob)
  ) {
    return "top";
  }
  // A jacket filed as a top is still outerwear. Stored category is not rewritten.
  if (jacketWord) return "outerwear";
  if (top) return "top";
  if (outer) return "outerwear";
  if (g.category === "other") return null;
  if ((KNOWN_SLOTS as readonly string[]).includes(g.category)) {
    return g.category as Slot;
  }
  return null;
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

/** A piece that may sit as the outer layer: a true outer, or a top the jacket table lets be worn open over another top. */
export function isOuterCandidate(g: Garment): boolean {
  if (jacketInfo(g).outerEligible) return true;
  return slotOf(g) === "outerwear" && isTrueOuter(g);
}

/** A never-tuck habit keeps the shirt and wears it out. The garment record is not rewritten. */
export function lookTuck(
  g: Garment,
  occasion: Occasion | undefined,
  pieces: Garment[],
  taste?: TasteMemory,
): "in" | "out" {
  if (taste && tuckHabitIds(taste).includes(g.id)) return "out";
  return resolveTuck(g, occasion, pieces);
}

export type OuterDrawOpts = {
  /** The rule context the finished look must pass. */
  ctx: RuleCtx;
  /** The seeded stream; a fresh one from the salt when absent. */
  rng?: Rng;
  /** The rotation weights' inputs; without them every outer weighs the same. */
  weights?: WeightCtx;
  /** The caller's extra gate. */
  legalCombo?: (pieces: Garment[]) => boolean;
  /** Outers already on other cards: tried after the rest. */
  usedOuters?: Set<string>;
  /** The cheap filter before the rules: a mid or a hoodie is never the outer. */
  salt?: number;
};

/**
 * One outer for a core, drawn by rotation weight among the outers whose finished look passes
 * the rules (passesRules). Outers already on other cards come after the rest. Undefined when
 * no outer finishes the core.
 */
export function pickTrueOuter(outers: Garment[], core: Garment[], opts: OuterDrawOpts): Garment | undefined {
  const rng = opts.rng ?? rngFromSalt(opts.salt ?? 1);
  const weight = (g: Garment) => (opts.weights ? pieceWeight(g, opts.weights) : 1);
  const candidates = outers.filter((g) => isOuterCandidate(g) && !core.some((c) => c.id === g.id));
  const ordered = drawOrder(candidates, weight, rng);
  const fresh = ordered.filter((g) => !opts.usedOuters?.has(g.id));
  const spent = ordered.filter((g) => opts.usedOuters?.has(g.id));
  for (const o of [...fresh, ...spent]) {
    const next = [...core, o];
    if (opts.legalCombo && !opts.legalCombo(next)) continue;
    if (ruleFails(next, opts.ctx).length) continue;
    return o;
  }
  return undefined;
}

export type PickOpts = {
  weather?: WeatherSnap;
  occasion: Occasion;
  /** The season bucket; from the weather (or the calendar) when absent. */
  season?: Season;
  /** Last drop's ids: a Skip changes at least minSlotChange slots from them when it can. */
  previousIds?: string[];
  /** These ids stay in their slots. Draw only the rest. */
  lockedIds?: string[];
  /** Pair keys (bottom|shoe, top|bottom) worn this week: half the weight unless locked. */
  repeatPairs?: Set<string> | string[];
  /** Pieces already on cards: weight 1/(1+n). */
  usedCount?: Map<string, number>;
  /** The caller's own hard gate (a house, a theme). */
  legalCombo?: (pieces: Garment[]) => boolean;
  house?: House | "all" | null;
  /** The seed of this surface's draw (drawSeed). */
  salt?: number;
  /** combo keys (sorted ids) already on screen or recently worn/skipped. */
  excludeKeys?: Iterable<string>;
  /** Pieces left out of the draw altogether (an exclusion, never a weight); a locked piece stays. */
  excludeIds?: Iterable<string>;
  /** Consecutive Skip: ≥2 of top/bottom/shoe ids must change. */
  minSlotChange?: number;
  /** Consecutive Skip: same silhouette + recolor is illegal. */
  requireSilhouetteChange?: boolean;
  /** A piece veto leaves the pool unless that piece is locked; a pairing veto is a rule. */
  taste?: TasteMemory;
  /** A jacket day. The winner is a core a rule-passing outer finishes, and it wears that outer. */
  requireOuter?: boolean;
  /** Rule checks the whole draw may spend before giving up (the hero-looks surface caps its search); unbounded by default, so the daily pick is exhaustive. */
  maxTries?: number;
  /** The rotation weights' inputs; today defaults to the clock's day. */
  today?: string;
  journal?: WeightCtx["journal"];
  suggested?: ReadonlyMap<string, string>;
};

export type PickResultDetail = {
  ids: string[];
  /** Rule ids waived to find a look; empty when the look passes every rule. */
  relaxed: string[];
  /** Rule checks spent. */
  tried: number;
  /** The hero the look was built around. */
  hero: string | null;
};

/** Heroes a draw may try before giving up. */
const HERO_TRIES = 12;
/** Rule checks one hero may spend on its partners and outers under the strict rules. */
const HERO_BUDGET = 320;
/** Rule checks one hero may spend per relax tier after the strict pass failed. */
const TIER_BUDGET = 96;
/** Partner pairs one hero may try. */
const PAIR_TRIES = 144;
/** The wide pass's multiplier on every budget, when the bounded pass found nothing. */
const WIDE_SCALE = 8;
/** Heroes at the head of the draw that get the wide search at once when the bounded one fails: the pieces whose turn it is are not passed over. */
const WIDE_HEROES = 3;
/** On a day the jacket is optional, the odds the look goes bare rather than drawing an outer. */
const BARE_ODDS = 0.5;

function isTopSlot(g: Garment): boolean {
  const s = slotOf(g);
  return s === "top" || s === "dress";
}

/**
 * The pick: a seeded draw among rule-passing looks. A hero is drawn by rotation weight from the
 * core slots, its partners in each other slot by the same weights (Efraimidis–Spirakis order),
 * and the first core the rules pass (passesRules) wins; a jacket day draws an outer the same
 * way among those that finish the core. A hero no strict look can hold is tried again under
 * the relax ladder (RELAX_TIERS: colour, then texture, then proportion rules waived, in that
 * order; never a hard rule, season, weather, occasion or the clashes), so the piece whose turn
 * it is still gets dressed, and `relaxed` says which rules were waived; a hero that trips a
 * per-piece rule (a hoodie on a weekday) is passed over at once. Empty ids mean nothing legal.
 */
export function pickLookWith(garments: Garment[], opts: PickOpts): PickResultDetail {
  const pool = livePool(garments);
  const rng = rngFromSalt(opts.salt ?? 1);
  const lockedSet = new Set(opts.lockedIds ?? []);
  const taste = opts.taste;
  const vetoed = taste ? pieceVetoIds(taste) : new Set<string>();
  const today = opts.today ?? todayNY();
  const wctx: WeightCtx = { today, journal: opts.journal, suggested: opts.suggested };
  const repeats = opts.repeatPairs
    ? opts.repeatPairs instanceof Set
      ? opts.repeatPairs
      : new Set(opts.repeatPairs)
    : new Set<string>();
  const f = opts.weather?.f ?? 68;
  const measuredF = opts.weather?.measured ? opts.weather.f : undefined;
  const season = opts.season ?? seasonFromWeather(opts.weather?.f);
  const house = opts.house && opts.house !== "all" ? opts.house : undefined;
  const baseCtx: RuleCtx = {
    occasion: opts.occasion,
    season,
    house: house ?? null,
    ...(measuredF !== undefined ? { weatherF: measuredF } : {}),
    pool,
    taste,
    lockedIds: lockedSet,
  };
  const weight = (g: Garment) => {
    if (lockedSet.has(g.id)) return 1;
    let w = pieceWeight(g, wctx);
    if (opts.usedCount) w /= 1 + (opts.usedCount.get(g.id) ?? 0);
    return w;
  };
  const excluded = new Set(opts.excludeIds ?? []);
  const dressable = excluded.size ? pool.filter((g) => !excluded.has(g.id) || lockedSet.has(g.id)) : pool;
  const by = (test: (g: Garment) => boolean, required = true) => {
    const raw = dressable.filter(test);
    const kept = raw.filter((g) => !vetoed.has(g.id) || lockedSet.has(g.id));
    return kept.length || !required ? kept : raw;
  };
  const pin = new Map<"top" | "bottom" | "footwear" | "outerwear", Garment>();
  for (const id of lockedSet) {
    const g = pool.find((x) => x.id === id);
    if (!g) continue;
    const s = slotOf(g);
    if (!s || s === "accessory") continue;
    const key = s === "dress" ? "top" : s;
    if (!pin.has(key)) pin.set(key, g);
  }
  const tops = pin.get("top") ? [pin.get("top")!] : by(isTopSlot);
  const bottoms = pin.get("bottom") ? [pin.get("bottom")!] : by((g) => slotOf(g) === "bottom");
  const shoes = pin.get("footwear") ? [pin.get("footwear")!] : by((g) => slotOf(g) === "footwear");
  const outers = pin.get("outerwear") ? [pin.get("outerwear")!] : by(isOuterCandidate, false);
  const banned = new Set(opts.excludeKeys ?? []);
  const previous = opts.previousIds ?? [];
  const wantOuter = Boolean(opts.requireOuter) || Boolean(pin.get("outerwear")) || f < 62;
  let tried = 0;
  /* The whole draw's cap on rule checks (maxTries); never reached by default. */
  const spent = () => opts.maxTries !== undefined && tried >= opts.maxTries;

  const coreOk = (core: Garment[], strict: boolean): boolean => {
    if (new Set(core.map((g) => g.id)).size !== core.length) return false;
    if (banned.size && banned.has(coreComboKey(core.map((g) => g.id), pool))) return false;
    if (strict && previous.length >= 3) {
      const ids = core.map((g) => g.id);
      if (opts.minSlotChange && slotsChanged(previous, ids, pool) < opts.minSlotChange) return false;
      if (opts.requireSilhouetteChange && silhouetteKey(ids, pool, opts.occasion) === silhouetteKey(previous, pool, opts.occasion)) {
        return false;
      }
    }
    return true;
  };
  const pairPenalty = (core: Garment[]): number => {
    const top = core.find(isTopSlot);
    const bottom = core.find((g) => slotOf(g) === "bottom");
    const shoe = core.find((g) => slotOf(g) === "footwear");
    let w = 1;
    if (bottom && shoe && repeats.has(pairKey(bottom.id, shoe.id)) && !lockedSet.has(bottom.id) && !lockedSet.has(shoe.id)) w *= 0.5;
    if (top && bottom && repeats.has(pairKey(top.id, bottom.id)) && !lockedSet.has(top.id) && !lockedSet.has(bottom.id)) w *= 0.5;
    return w;
  };

  type Found = { ids: string[]; hero: string; relaxed: string[] };
  const tiers = relaxTiers();
  const relaxable = new Set(tiers[tiers.length - 1]);
  /* Whether, in the strict pass of a hero, some look failed on waivable rules alone: only then can a tier help. */
  let softSeen = false;
  const noteFailed = (failed: readonly string[]) => {
    if (!softSeen && failed.every((id) => relaxable.has(id) || JACKET_COVER_IDS.includes(id))) softSeen = true;
  };

  /** One hero under one tier of the ladder: its partners in draw order, the first passing core (and outer) wins. */
  const dressHero = (hero: Garment, relax: readonly string[], strict: boolean, budgetStart: number): Found | null => {
    const ctx: RuleCtx = { ...baseCtx, relax };
    let budget = budgetStart;
    const heroSlot = isTopSlot(hero) ? "top" : slotOf(hero) === "bottom" ? "bottom" : "shoe";
    /* A closet short of a core slot dresses nothing: a look is one top, one bottom and one pair of shoes. */
    const order = (list: Garment[], own: boolean): (Garment | null)[] =>
      own ? [hero] : drawOrder(list.filter((g) => g.id !== hero.id), weight, rng);
    const topList = order(tops, heroSlot === "top");
    const bottomList = order(bottoms, heroSlot === "bottom");
    const shoeList = order(shoes, heroSlot === "shoe");
    /* Pairs of partner ranks by their sum: the two best-drawn partners first, then the next. */
    const pairs: [number, number, number][] = [];
    const [aList, bList] = heroSlot === "top" ? [bottomList, shoeList] : heroSlot === "bottom" ? [topList, shoeList] : [topList, bottomList];
    for (let i = 0; i < aList.length; i += 1) for (let j = 0; j < bList.length; j += 1) pairs.push([i + j, i, j]);
    pairs.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    let pairsTried = 0;
    /* A jeans-and-blazer look the coin passed over: it is still the hero's look when nothing else is found, so the odds halve and never block. */
    let held: Found | null = null;
    for (const [, i, j] of pairs) {
      if (pairsTried >= PAIR_TRIES || budget <= 0 || spent()) break;
      pairsTried += 1;
      const a = aList[i];
      const b = bList[j];
      const core = (heroSlot === "top" ? [hero, a, b] : heroSlot === "bottom" ? [a, hero, b] : [a, b, hero]).filter(
        (g): g is Garment => Boolean(g),
      );
      if (core.length < 2 || !coreOk(core, strict)) continue;
      if (opts.legalCombo && !opts.legalCombo(core) && !(opts.requireOuter || wantOuter)) continue;
      /* A repeated pair halves the look's odds: a coin by the seeded stream. */
      if (pairPenalty(core) < 1 && rng() >= pairPenalty(core)) continue;
      budget -= 1;
      tried += 1;
      const failed = ruleFails(core, ctx);
      const bareOk = failed.length === 0 && (!opts.legalCombo || opts.legalCombo(core));
      const jacketOnly = needsJacketOnly(failed);
      if (!bareOk && !jacketOnly) {
        noteFailed(failed);
        continue;
      }
      /* The jacket is optional: a coin from the stream says bare or an outer, so the jackets take their turns too. */
      if (bareOk && !wantOuter && rng() < BARE_ODDS) return { ids: core.map((g) => g.id), hero: hero.id, relaxed: waivedBy(core) };
      const outerOrder = drawOrder(outers.filter((o) => !core.some((c) => c.id === o.id)), weight, rng);
      for (const o of outerOrder) {
        if (budget <= 0 || spent()) break;
        const full = [...core, o];
        if (opts.legalCombo && !opts.legalCombo(full)) continue;
        budget -= 1;
        tried += 1;
        const fullFailed = ruleFails(full, ctx);
        if (fullFailed.length) {
          noteFailed(fullFailed);
          continue;
        }
        const found: Found = { ids: full.map((g) => g.id), hero: hero.id, relaxed: waivedBy(full) };
        /* Jeans under a sport coat pass at half odds (JEANS_BLAZER_ODDS): a coin from the stream, else the next outer; the look is held in case nothing else dresses the hero. */
        if (jeansWithBlazer(full) && rng() >= JEANS_BLAZER_ODDS) {
          held ??= found;
          continue;
        }
        return found;
      }
      /* A bare core is a look only when no outer is asked for or pinned: a locked jacket is worn, or the core is not the look. */
      if (bareOk && !opts.requireOuter && !pin.get("outerwear")) return { ids: core.map((g) => g.id), hero: hero.id, relaxed: waivedBy(core) };
    }
    return held;
  };
  /** The rules the found look needed waived: what it fails under the strict rules (empty when it passes them). */
  const waivedBy = (look: Garment[]): string[] => ruleFails(look, baseCtx);

  /**
   * Heroes in draw order; each tried strictly, then under the ladder, before the next hero. The
   * bounded pass tries HERO_TRIES heroes on the usual budgets; the wide pass (when the bounded
   * one found nothing: a day when the pieces whose turn it is are hard to dress) tries every
   * hero with WIDE_SCALE times the budget, so a closet with a passing look always yields one.
   */
  /* A locked core piece is the hero: every look holds it, and its partner draw already covers the rest, so no other hero is searched. */
  const lockedCore = [pin.get("top"), pin.get("bottom"), pin.get("footwear")].filter((g): g is Garment => Boolean(g));
  const attempt = (strict: boolean, wide = false): Found | null => {
    const heroPool = lockedCore.length ? lockedCore : [...tops, ...bottoms, ...shoes].filter((g, i, all) => all.findIndex((x) => x.id === g.id) === i);
    const ordered = drawOrder(heroPool, weight, rng);
    const heroes = wide ? ordered : ordered.slice(0, HERO_TRIES);
    const scale = wide ? WIDE_SCALE : 1;
    const ladder = (hero: Garment, at: number): Found | null => {
      softSeen = false;
      for (const [t, relax] of tiers.entries()) {
        /* A tier is worth a search only when the strict pass saw a look fail on waivable rules alone. */
        if (t > 0 && !softSeen) break;
        const found = dressHero(hero, relax, strict, (t === 0 ? HERO_BUDGET : TIER_BUDGET) * at);
        if (found) return found;
      }
      return null;
    };
    /* The wide pass sweeps the heroes the bounded pass never reached on the usual budget first: a hero that dresses at once costs little, and the eightfold budget is spent only when every hero has failed it. */
    if (wide) {
      for (const hero of ordered.slice(HERO_TRIES)) {
        if (spent()) return null;
        if (pieceRuleFails(hero, baseCtx).length) continue;
        const found = ladder(hero, 1);
        if (found) return found;
      }
    }
    for (const [i, hero] of heroes.entries()) {
      if (spent()) return null;
      if (pieceRuleFails(hero, baseCtx).length) continue;
      const found = ladder(hero, scale) ?? (!wide && i < WIDE_HEROES ? ladder(hero, WIDE_SCALE) : null);
      if (found) return found;
    }
    return null;
  };

  let found: Found | null = null;
  /* A Skip's slot-change asks are tried first and given up before a hero is passed over. */
  const skipAsks = previous.length >= 3 && Boolean(opts.minSlotChange || opts.requireSilhouetteChange);
  for (const strict of skipAsks ? [true, false] : [false]) {
    found = attempt(strict);
    if (found) break;
  }
  if (!found) found = attempt(false, true);
  if (!found) {
    const locked = [...lockedSet].filter((id) => pool.some((g) => g.id === id));
    return { ids: locked, relaxed: [], tried, hero: null };
  }
  const relaxed = found.relaxed;
  const ids = [...found.ids];
  const acc = by((g) => slotOf(g) === "accessory");
  const belt = acc.find((a) => a.subtype === "belt");
  const shoe = pool.find((g) => ids.includes(g.id) && slotOf(g) === "footwear");
  if (belt && shoe && /loafer/.test(`${shoe.subtype} ${shoe.name}`.toLowerCase()) && !ids.includes(belt.id)) ids.push(belt.id);
  for (const id of lockedSet) {
    const g = pool.find((x) => x.id === id);
    if (!g) continue;
    if (!ids.includes(g.id)) ids.push(g.id);
  }
  return { ids, relaxed, tried, hero: found.hero };
}

/** The ids of pickLookWith. */
export function pickLook(garments: Garment[], opts: PickOpts): string[] {
  return pickLookWith(garments, opts).ids;
}

/** The look's weight under the rotation (draw.ts), for callers that draw among finished looks. */
export function lookRotationWeight(pieces: readonly Garment[], ctx: WeightCtx): number {
  return lookWeight(pieces.filter((g) => slotOf(g) !== "accessory"), ctx);
}

/** The slotted plates of a look (top, bottom, shoe, outer, mid), as the rules read them. */
export function lookSlots(pieces: Garment[]) {
  return slotPieces(pieces);
}

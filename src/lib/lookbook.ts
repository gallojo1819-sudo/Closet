import { canonicalize } from "./color.ts";
import { liveIdsKey } from "./daily-pick.ts";
import { drawOrder, drawSeed, pieceWeight, rngFromSalt, type Rng, type WeightCtx } from "./draw.ts";
import { garmentMemo } from "./garment-memo.ts";
import { livePool } from "./rack.ts";
import {
  clashes as styleClashes,
  daysIdle,
  isBlazerPiece,
  isBrownSuedeOuter,
  isCampCollar,
  isFairIsle,
  isGraphic,
  isHeavyCable,
  isHoodiePiece,
  isRugbyPiece,
  isTrueOuter,
  isWeekendSoftJacket,
  HOUSE_CHIPS,
  leadHouse,
  lookHouses,
  lookRotationWeight,
  outerKind,
  pickLook,
  pickTrueOuter,
  slotOf,
  type House,
} from "./style.ts";
import { applyAtlas, pieceVetoIds, type TasteMemory } from "./taste.ts";
import {
  bottomType,
  houseFingerprintOk,
  houseGapNote,
  houseLegalCombo,
  housePieceBanned,
  houseProfile,
  HOUSE_LABEL,
  isHardHouseLook,
  lookPrint,
  mapHouse,
  profilePhraseHits,
  shoeFamily,
  topType,
} from "./houses.ts";
import { buildHouseMatrix, type MatrixLook } from "./stylist/matrix.ts";
import { engineKey, engineStore } from "./engine-store.ts";
import { lookFitsOccasion } from "./occasion-gate.ts";
import { isLegal, passesRules, pieceRuleFails } from "./stylist/legal.ts";
import { fwEligibleJackets, houseCode, jacketHits, jacketRequired, slotPieces, wearSlot as jacketWearSlot } from "./stylist/jackets.ts";
import { rep3Fails, repCaps, recipeOuterIssue } from "./stylist/row.ts";
import { approvedProfile } from "./house-profiles/load.ts";
import { evaluateColor, colorEmptyCopy } from "./stylist/colorChip.ts";
import { assignSlots } from "./house-profiles/evaluate.ts";
import { isCreamCable, matchRecipe } from "./recipes.ts";
import { lookFitsSeason, seasonFromWeather, weatherForSeason } from "./season.ts";
import { mapOccasion, OCCASIONS, type Garment, type Look, type Occasion, type Season, type WeatherSnap } from "./types.ts";
import { todayISO, todayNY } from "./utils.ts";

export const CHAPTER_CAP = 10;

/** Hydrate / visibility must not drip more AI covers once the blob exists. */
export function lookbookIsFrozen(
  looks: { lookbook?: boolean; source?: string }[],
): boolean {
  const ai = looks.filter((l) => l.lookbook && l.source === "ai").length;
  return ai >= 7;
}

export function lookbookPool(garments: Garment[]): Garment[] {
  return livePool(garments);
}

/** Houses with at least three legal looks for this chapter and season. A gate is not three looks. */
export function dressableHouses(
  garments: Garment[],
  occasion: Occasion,
  season: Season,
): House[] {
  const matrix = buildHouseMatrix(lookbookPool(garments), occasion, season);
  const out: House[] = [];
  for (const chip of HOUSE_CHIPS) {
    const cell = matrix.houses[chip.id];
    if (!cell || cell.gate) continue;
    if (Math.max(cell.pool.length, cell.looks.length) < 3) continue;
    out.push(chip.id);
  }
  return out;
}

function bySlot(pool: Garment[], slot: "top" | "bottom" | "footwear" | "outerwear" | "dress") {
  return pool.filter((g) => slotOf(g) === slot);
}

function blobOf(g: Garment): string {
  return `${g.subtype} ${g.name}`.toLowerCase();
}

/** Graphic top + Italian/Ralph leather is costume. Two loud graphics don't share a look. */
export function lookClashes(pieces: Garment[]): boolean {
  return styleClashes(pieces);
}

/** The pieces in a weighted draw order (draw.ts): rotation weights for the day, a stream from the salt. */
function rank(list: Garment[], today: string, salt = 0): Garment[] {
  const ctx: WeightCtx = { today };
  return drawOrder(list, (g) => pieceWeight(g, ctx), rngFromSalt(hashSeed(`${today}|${salt}`)));
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) || 1;
}

export function comboKey(ids: string[]): string {
  return [...ids].sort().join("|");
}

/**
 * This week with the tapped house's looks first. House ranks; it never drops a real look
 * from the row. One card per combination, eight at most. No house leaves the row alone.
 */
export function houseFirstRow(
  row: Look[],
  house: House | "all" | null | undefined,
  garments: Garment[],
  occasion: Occasion,
  season?: Season,
): Look[] {
  if (!house || house === "all") return row;
  const pool = lookbookPool(garments);
  const byId = new Map(pool.map((g) => [g.id, g]));
  const real = row.filter((look) => !look.gate && !look.needsPieces && look.garmentIds.length >= 3);
  const fits = (look: Look) => {
    const pieces = look.garmentIds.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
    return pieces.length >= 3 && lookFitsHouse(pieces, house, occasion, pool, season);
  };
  const lead = real.filter(fits);
  const rest = real.filter((look) => !lead.includes(look));
  const seen = new Set<string>();
  const out: Look[] = [];
  for (const look of [...lead, ...rest]) {
    const key = comboKey(look.garmentIds);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(look);
    if (out.length >= 8) break;
  }
  return out;
}

function isBlazer(g: Garment): boolean {
  return /blazer|sport\s*coats?/.test(blobOf(g));
}

const SAND =
  /beige|cream|tan|camel|khaki|sand|ecru|stone|bone|ivory/;

function isSandPiece(g: Garment): boolean {
  if (g.colors.some((c) => SAND.test(canonicalize(c) || c))) return true;
  return SAND.test(`${g.name} ${g.subtype} ${g.colors.join(" ")}`.toLowerCase());
}

function beigePlateCount(pieces: Garment[]): number {
  return pieces.filter(
    (g) => slotOf(g) !== "accessory" && isSandPiece(g),
  ).length;
}

function jacketBlocked(pieces: Garment[], occasion: Occasion | undefined, season?: Season, house?: House | null): boolean {
  return jacketHits(slotPieces(pieces), {
    occasion: occasion ?? "weekday",
    season: season ?? "fall",
    house: house ? houseCode(house) : undefined,
  }).some((hit) => hit.severity === "hard");
}

/** Jacket only when the layering rules allow it. Default look is three pieces. */
export function lookAllowsBlazer(
  core: Garment[],
  jacket: Garment,
  occasion?: Occasion,
  season?: Season,
  house?: House | null,
): boolean {
  if (!isBlazer(jacket)) return false;
  if (core.some((g) => slotOf(g) === "outerwear")) return false;
  if (occasion === "comfy") return false;
  if (core.some(isHoodiePiece) || core.some(isGraphic)) return false;
  const top = topsOf(core)[0];
  const bottom = bottomsOf(core)[0];
  const shoe = shoesOf(core)[0];
  if (!top || !shoe) return false;
  const tb = pieceBlob(top);
  const sb = pieceBlob(shoe);
  if (/mule|sneaker|trainer|\b990\b/.test(sb)) return false;
  if (!/loafer|oxford/.test(sb)) return false;
  if (isCampCollar(top) || /linen/.test(tb)) return false;
  if (isRugbyPiece(top) || /rugby/.test(tb)) return false;
  if (isHeavyCable(top)) return false;
  const shirt =
    /oxford|polo/.test(tb) ||
    ((/merino|fine|silk/.test(tb) || /knit|sweater/.test(tb)) &&
      !isHeavyCable(top) &&
      !/fair\s*isle/.test(tb));
  if (!shirt) return false;
  const lead = leadHouse(core);
  if (lead === "polo" && isHeavyCable(top)) return false;
  if (occasion === "weekend" && isFairIsle(top)) return false;
  if (bottom && isSandPiece(top) && isSandPiece(bottom) && isSandPiece(jacket)) {
    return false;
  }
  if (beigePlateCount([...core, jacket]) >= 3) return false;
  if (jacketBlocked([...core, jacket], occasion, season, house)) return false;
  return true;
}

const NAME_ORDER = ["top", "dress", "bottom", "outerwear", "footwear", "accessory"];

function nameOf(pieces: Garment[]): string {
  return [...pieces]
    .sort((a, b) => {
      const sa = NAME_ORDER.indexOf(slotOf(a) ?? a.category);
      const sb = NAME_ORDER.indexOf(slotOf(b) ?? b.category);
      return (sa < 0 ? 99 : sa) - (sb < 0 ? 99 : sb);
    })
    .map((g) => g.name)
    .join(" · ");
}

/** A Lookbook plate opened in the sheet: a temporary look with the plate's exact pieces. Writes nothing. */
export function draftFromPlate(pieces: Garment[], occasion: Occasion | string, today = todayISO()): Look {
  const ids = pieces.map((p) => p.id);
  return {
    id: `draft_${comboKey(ids).replace(/\|/g, "_")}`,
    name: nameOf(pieces),
    occasion: mapOccasion(occasion),
    garmentIds: ids,
    source: "ai",
    lookbook: false,
    createdAt: `${today}T00:00:00.000Z`,
  };
}

function maxBlazerLooks(occasion?: Occasion): number {
  if (occasion === "comfy") return 0;
  if (occasion === "weekend") return 2;
  if (occasion === "weekday") return 6;
  if (occasion === "out") return 6;
  if (occasion === "travel") return 4;
  return 2;
}

function maybeAttachBlazer(
  core: Garment[],
  outers: Garment[],
  today: string,
  occasion: Occasion | undefined,
  season: Season | undefined,
  blazerLooks: number,
  usedBlazers: Set<string>,
  atCap: (g: Garment) => boolean,
): Garment[] {
  if (core.some(isGraphic) || core.some(isHoodiePiece)) return core;
  if (core.some((g) => isTrueOuter(g) || (slotOf(g) === "outerwear" && !isHoodiePiece(g)))) return core;
  const max = maxBlazerLooks(occasion);
  if (occasion === "comfy") return core;
  const tryOn = (o: Garment): Garment[] | null => {
    if (core.some((g) => g.id === o.id)) return null;
    if (usedBlazers.has(o.id)) return null;
    if (atCap(o)) return null;
    if (blazerLooks >= max) return null;
    if (!lookAllowsBlazer(core, o, occasion, season)) return null;
    if (season === "summer" && o.warmth >= 4) return null;
    const next = [...core, o];
    if (lookClashes(next)) return null;
    if (beigePlateCount(next) >= 3) return null;
    if (season && !lookFitsSeason(next, season)) return null;
    if (!passesRules(next, { occasion: occasion ?? "weekday", season: season ?? "fall" }).pass) return null;
    return next;
  };
  if (occasion === "weekend") {
    for (const o of rank(outers.filter((x) => isWeekendSoftJacket(x) && !atCap(x)), today)) {
      if (core.some((g) => g.id === o.id) || usedBlazers.has(o.id)) continue;
      const next = [...core, o];
      if (jacketBlocked(next, occasion, season)) continue;
      if (lookClashes(next)) continue;
      if (season && !lookFitsSeason(next, season)) continue;
      if (!passesRules(next, { occasion, season: season ?? "fall" }).pass) continue;
      return next;
    }
  }
  if (occasion === "travel") {
    for (const o of rank(
      outers.filter((x) => x.warmth <= 3 && isTrueOuter(x)),
      today,
    )) {
      if (core.some((g) => g.id === o.id) || atCap(o)) continue;
      const next = [...core, o];
      if (jacketBlocked(next, occasion, season)) continue;
      if (lookClashes(next)) continue;
      if (season && !lookFitsSeason(next, season)) continue;
      return next;
    }
    return core;
  }
  const blazers = outers.filter(isBlazer);
  const light = season === "summer" ? blazers.filter((o) => o.warmth <= 3) : blazers;
  for (const o of rank(light, today)) {
    const next = tryOn(o);
    if (next) return next;
  }
  const rest = outers.filter((x) => isTrueOuter(x) && !isBlazer(x));
  for (const o of rank(rest, today)) {
    if (core.some((g) => g.id === o.id) || atCap(o) || usedBlazers.has(o.id)) continue;
    const next = [...core, o];
    if (jacketBlocked(next, occasion, season)) continue;
    if (lookClashes(next)) continue;
    if (season && !lookFitsSeason(next, season)) continue;
    if (!passesRules(next, { occasion: occasion ?? "weekday", season: season ?? "fall" }).pass) continue;
    return next;
  }
  return core;
}

function repairJacketQuotas(
  looks: Look[],
  pool: Garment[],
  occasion: Occasion,
  house: House | undefined,
  season: Season | undefined,
  usedBlazers: Set<string>,
  atCap: (g: Garment) => boolean,
): Look[] {
  if (occasion === "comfy") return looks;
  const byId = new Map(pool.map((g) => [g.id, g]));
  const outers = pool.filter(isTrueOuter);
  const piecesOf = (l: Look) =>
    l.garmentIds.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
  const hasOuter = (l: Look) => piecesOf(l).some(isTrueOuter);
  const hasBlazer = (l: Look) => piecesOf(l).some(isBlazerPiece);
  const hasSoft = (l: Look) => piecesOf(l).some(isWeekendSoftJacket);
  const hasCold = (l: Look) =>
    piecesOf(l).some((g) => isTrueOuter(g) && (isBlazerPiece(g) || g.warmth >= 4 || /shearling|coat/.test(`${g.name} ${g.subtype}`.toLowerCase())));
  const attach = (l: Look, prefer: (g: Garment) => boolean): Look => {
    const core = piecesOf(l);
    if (core.some(isTrueOuter)) return l;
    const o = pickTrueOuter(outers.filter((x) => prefer(x) && !atCap(x)), core, {
      ctx: { occasion, season: season ?? "fall", house: house ?? null, pool },
      salt: hashSeed(l.id),
      legalCombo: house ? (p) => houseLegalCombo(p, house, occasion, undefined, pool) : undefined,
      usedOuters: usedBlazers,
    });
    if (!o) return l;
    const next = [...core, o];
    if (jacketBlocked(next, occasion, season, house)) return l;
    if (lookClashes(next)) return l;
    if (season && !lookFitsSeason(next, season)) return l;
    usedBlazers.add(o.id);
    return {
      ...l,
      garmentIds: next.map((g) => g.id),
      name: nameOf(next),
      recipeId: l.recipeId ?? matchRecipe(next, occasion, house),
    };
  };
  const next = looks.map((l) => ({ ...l }));
  const pass = (prefer: (g: Garment) => boolean, stillNeed: () => boolean) => {
    for (let i = 0; i < next.length && stillNeed(); i++) {
      if (hasOuter(next[i]!)) continue;
      next[i] = attach(next[i]!, prefer);
    }
  };
  if (occasion === "weekday") {
    pass(isBlazerPiece, () => next.filter(hasBlazer).length < 2);
    pass(isTrueOuter, () => next.filter(hasOuter).length < 4);
  } else if (occasion === "out") {
    pass(
      (g) => isBlazerPiece(g) || g.warmth >= 4,
      () => next.filter(hasCold).length < Math.ceil(next.length * 0.4),
    );
  } else if (occasion === "weekend") {
    pass(isWeekendSoftJacket, () => next.filter(hasSoft).length < 3);
  } else if (occasion === "travel") {
    pass((g) => isTrueOuter(g) && g.warmth <= 3, () => next.filter(hasOuter).length < 2);
  }
  return preferSingleBrownSuede(next, pool);
}

/** Second brown-suede outer loses when another real outer exists. Never drops the chapter to 0. */
function preferSingleBrownSuede(looks: Look[], pool: Garment[]): Look[] {
  const others = pool.filter((g) => isTrueOuter(g) && !isBrownSuedeOuter(g));
  if (!others.length) return looks;
  const byId = new Map(pool.map((g) => [g.id, g]));
  let seen = false;
  return looks.map((look) => {
    const pieces = look.garmentIds
      .map((id) => byId.get(id))
      .filter((g): g is Garment => Boolean(g));
    const suede = pieces.find(isBrownSuedeOuter);
    if (!suede) return look;
    if (!seen) {
      seen = true;
      return look;
    }
    for (const outer of others) {
      if (pieces.some((p) => p.id === outer.id)) continue;
      const next = pieces.filter((p) => p.id !== suede.id).concat(outer);
      if (next.length < 3 || lookClashes(next) || jacketBlocked(next, "weekday")) continue;
      return {
        ...look,
        garmentIds: next.map((g) => g.id),
        name: nameOf(next),
      };
    }
    return look;
  });
}

/**
 * Best looks from this closet — four chapters, 10 each.
 */
export function buildLookbook(
  garments: Garment[],
  today = todayNY(),
  salt = 0,
): Look[] {
  const all: Look[] = [];
  for (const { id } of OCCASIONS) {
    all.push(...buildChapter(garments, id, { cap: CHAPTER_CAP, salt, today }));
  }
  return coverUnused(garments, all);
}

/** Two looks starring this piece — unused-rail tap. */
export function forceLooksForPiece(
  garmentId: string,
  garments: Garment[],
  n = 2,
): Look[] {
  const looks = buildLookbook(garments);
  return looks.filter((l) => l.garmentIds.includes(garmentId)).slice(0, n);
}

/** The piece's searchable text, built once per garment (garmentMemo tracks the fields read here). */
function pieceBlob(g: Garment): string {
  return garmentMemo(g, "lookbook.blob", buildPieceBlob);
}

function buildPieceBlob(g: Garment): string {
  return `${g.subtype} ${g.name} ${g.notes ?? ""}`.toLowerCase();
}

function topsOf(pieces: Garment[]): Garment[] {
  return pieces.filter((g) => {
    const s = slotOf(g);
    return s === "top" || s === "dress";
  });
}

function bottomsOf(pieces: Garment[]): Garment[] {
  return pieces.filter((g) => slotOf(g) === "bottom");
}

function shoesOf(pieces: Garment[]): Garment[] {
  return pieces.filter((g) => slotOf(g) === "footwear");
}

export { isLongSleeveTop, lookFitsOccasion, type OccasionGateOptions } from "./occasion-gate.ts";

export function lookFitsHouse(
  pieces: Garment[],
  house: House | string,
  occasion: Occasion,
  pool?: Garment[],
  season?: Season,
): boolean {
  const h = mapHouse(house);
  if (h === "all") return true;
  if (!houseFingerprintOk(pieces, h, occasion, pool, season)) return false;
  return lookFitsOccasion(pieces, occasion, pool, h);
}

export function seenKey(occasion: Occasion, house?: House | "all" | null): string {
  if (!house || house === "all") return occasion;
  return `${occasion}:${house}`;
}

export function pieceLookCap(slotCount: number): number {
  if (slotCount >= 12) return 1;
  if (slotCount >= 6) return 2;
  return 3;
}

function wearCapSlot(g: Garment): "top" | "bottom" | "footwear" | "outerwear" | null {
  const worn = jacketWearSlot(g);
  if (worn === "outer") return "outerwear";
  if (worn === "mid" || worn === "top") return "top";
  if (worn === "bottom") return "bottom";
  if (worn === "shoe") return "footwear";
  const s = slotOf(g);
  if (s === "top" || s === "dress") return "top";
  if (s === "bottom") return "bottom";
  if (s === "footwear") return "footwear";
  if (s === "outerwear") return "outerwear";
  return null;
}

function slotCapsFor(pool: Garment[]) {
  return {
    top: pieceLookCap(bySlot(pool, "top").length + bySlot(pool, "dress").length),
    bottom: pieceLookCap(bySlot(pool, "bottom").length),
    footwear: pieceLookCap(bySlot(pool, "footwear").length),
    outerwear: pieceLookCap(bySlot(pool, "outerwear").length),
  };
}

/** Keep at most one look per blazer id; strip that jacket from the rest. Max 2 blazered looks (1 on weekend). */
export function stripRepeatBlazers(looks: Look[], garments: Garment[]): Look[] {
  const byId = new Map(garments.map((g) => [g.id, g]));
  const keptJacket = new Map<string, Set<string>>();
  const blazerLooks = new Map<string, number>();
  return looks.map((l) => {
    if (l.source === "manual" || !l.lookbook) return l;
    const occ = mapOccasion(l.occasion);
    if (occ !== "weekday" && occ !== "out" && occ !== "weekend") return l;
    const jackets = l.garmentIds
      .map((id) => byId.get(id))
      .filter((g): g is Garment => g != null && isBlazer(g));
    if (!jackets.length) return l;
    const seen = keptJacket.get(occ) ?? new Set<string>();
    const count = blazerLooks.get(occ) ?? 0;
    const max = maxBlazerLooks(occ);
    const keep = new Set<string>();
    for (const j of jackets) {
      if (seen.has(j.id)) continue;
      if (count + keep.size >= max) continue;
      keep.add(j.id);
    }
    const strip = jackets.filter((j) => !keep.has(j.id)).map((j) => j.id);
    if (!strip.length) {
      for (const id of keep) seen.add(id);
      keptJacket.set(occ, seen);
      blazerLooks.set(occ, count + keep.size);
      return l;
    }
    const ids = l.garmentIds.filter((id) => !strip.includes(id));
    if (ids.length < 3) return l;
    const pieces = ids.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
    const replacement = byId.size
      ? [...byId.values()].find(
          (g) =>
            isBlazer(g) &&
            !ids.includes(g.id) &&
            !seen.has(g.id) &&
            !jacketBlocked([...pieces, g], occ),
        )
      : undefined;
    if (replacement) {
      const next = [...pieces, replacement];
      seen.add(replacement.id);
      keptJacket.set(occ, seen);
      blazerLooks.set(occ, count + keep.size + 1);
      for (const id of keep) seen.add(id);
      return { ...l, garmentIds: next.map((g) => g.id), name: nameOf(next) };
    }
    for (const id of keep) seen.add(id);
    keptJacket.set(occ, seen);
    blazerLooks.set(occ, count + keep.size);
    // JKT-COV-1: do not leave a required card bare. Mark it demoted.
    return { ...l, garmentIds: ids, name: nameOf(pieces), demoted: "JKT-COV-1" };
  });
}

/** Drop extra auto looks so no shirt/pant/shoe exceeds the per-chapter cap. Manual stays. */
export function enforcePieceCap(looks: Look[], garments: Garment[]): Look[] {
  const pool = lookbookPool(garments);
  const byId = new Map(pool.map((g) => [g.id, g]));
  const caps = slotCapsFor(pool);
  const usedByOcc = new Map<string, Map<string, number>>();
  const out: Look[] = [];
  const over = (occ: string, ids: string[]) => {
    const used = usedByOcc.get(occ) ?? new Map<string, number>();
    for (const id of ids) {
      const g = byId.get(id);
      if (!g) continue;
      const slot = wearCapSlot(g);
      if (!slot) continue;
      if ((used.get(id) ?? 0) >= caps[slot]) return true;
    }
    return false;
  };
  const bump = (occ: string, ids: string[]) => {
    let used = usedByOcc.get(occ);
    if (!used) {
      used = new Map();
      usedByOcc.set(occ, used);
    }
    for (const id of ids) used.set(id, (used.get(id) ?? 0) + 1);
  };
  for (const l of looks) {
    const occ = mapOccasion(l.occasion);
    if (l.source === "manual" || !l.lookbook || l.id.startsWith("week_")) {
      out.push(l);
      bump(occ, l.garmentIds);
      continue;
    }
    if (over(occ, l.garmentIds)) continue;
    bump(occ, l.garmentIds);
    out.push(l);
  }
  return out;
}

export function buildChapter(
  garments: Garment[],
  occasion: Occasion,
  opts?: {
    exclude?: Set<string>;
    cap?: number;
    salt?: number;
    today?: string;
    season?: Season;
    usedCount?: Map<string, number>;
    blazerLooks?: number;
    usedBlazers?: Set<string>;
    house?: House;
  },
): Look[] {
  const cap = opts?.cap ?? CHAPTER_CAP;
  const exclude = opts?.exclude ?? new Set<string>();
  const today = opts?.today ?? todayNY();
  const salt = opts?.salt ?? 0;
  const season = opts?.season;
  const house = opts?.house;
  const pool = lookbookPool(garments);
  const outers = bySlot(pool, "outerwear");
  const byId = new Map(pool.map((g) => [g.id, g]));
  const caps = slotCapsFor(pool);
  const usedCount = opts?.usedCount ?? new Map<string, number>();
  let blazerLooks = opts?.blazerLooks ?? 0;
  const usedBlazers = opts?.usedBlazers ?? new Set<string>();
  const atCap = (g: Garment) => {
    const slot = wearCapSlot(g);
    if (!slot) return false;
    return (usedCount.get(g.id) ?? 0) >= caps[slot];
  };
  const bump = (ids: string[]) => {
    for (const id of ids) usedCount.set(id, (usedCount.get(id) ?? 0) + 1);
  };
  const out: Look[] = [];
  const used = new Set(exclude);
  let prev: string[] = [];
  const weather = season ? weatherForSeason(season) : weatherForOcc(occasion, season);

  const tryPush = (pieces: Garment[], force = false): boolean => {
    if (pieces.length < 3) return false;
    if (!lookFitsOccasion(pieces, occasion, pool, house)) return false;
    if (house && !houseLegalCombo(pieces, house, occasion, undefined, pool)) return false;
    if (season && !lookFitsSeason(pieces, season)) return false;
    if (beigePlateCount(pieces) >= 3) return false;
    if (!force) {
      for (const g of pieces) {
        if (atCap(g)) return false;
      }
    } else {
      for (const g of pieces) {
        const slot = wearCapSlot(g);
        if (!slot) continue;
        if ((usedCount.get(g.id) ?? 0) >= 1 && atCap(g)) return false;
      }
    }
    const key = comboKey(pieces.map((p) => p.id));
    if (used.has(key)) return false;
    used.add(key);
    bump(pieces.map((p) => p.id));
    const recipeId = matchRecipe(pieces, occasion, house);
    out.push({
      id: `lb2_${occasion}_${key.replace(/\|/g, "_")}`,
      name: nameOf(pieces),
      occasion,
      garmentIds: pieces.map((p) => p.id),
      source: "ai",
      lookbook: true,
      recipeId,
      createdAt: `${today}T00:00:00.000Z`,
    });
    return true;
  };

  const weatherUse = season ? weatherForSeason(season) : weather;
  const seed = drawSeed(today, `chapter:${occasion}:${house ?? ""}`, liveIdsKey(pool), salt);
  /* A jacket is one plate of the chapter: a draw that seats a jacket already on a card is refused, so the draw finds another. */
  const jacketFree = (p: Garment[]) => {
    const outer = p.find(isTrueOuter);
    return !outer || !usedBlazers.has(outer.id);
  };
  const combo = (p: Garment[]) => jacketFree(p) && (!house || houseLegalCombo(p, house, occasion, undefined, pool));

  for (let i = 0; i < 220 && out.length < cap; i++) {
    const available = pool.filter((g) => !atCap(g));
    if (available.length < 3) break;
    const ids = pickLook(available, {
      occasion,
      weather: weatherUse,
      ...(season ? { season } : {}),
      previousIds: prev,
      usedCount,
      house,
      salt: seed + i,
      today,
      excludeKeys: used,
      legalCombo: combo,
    });
    if (ids.length < 3) break;
    prev = ids;
    let pieces = ids.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
    if (pieces.length < 3) continue;
    const core = pieces;
    if (!pieces.some(isTrueOuter)) {
      const tryJacket =
        occasion === "weekday" ||
        occasion === "out" ||
        occasion === "travel" ||
        occasion === "weekend";
      if (tryJacket) {
        pieces = maybeAttachBlazer(
          pieces,
          outers,
          today,
          occasion,
          season,
          blazerLooks,
          usedBlazers,
          atCap,
        );
      }
    }
    // A jacket the house bans must not throw away a legal top+bottom+shoe.
    let pushed = tryPush(pieces);
    if (!pushed && pieces !== core) {
      pieces = core;
      pushed = tryPush(pieces);
    }
    if (pushed) {
      const last = out[out.length - 1]!;
      const lastPieces = last.garmentIds
        .map((id) => byId.get(id))
        .filter((g): g is Garment => Boolean(g));
      for (const g of lastPieces) {
        if (isBlazer(g) || isTrueOuter(g)) {
          if (isBlazer(g)) blazerLooks += 1;
          usedBlazers.add(g.id);
        }
      }
    }
  }

  if (out.length < cap) {
    const leftovers = pool.filter((g) => {
      const slot = wearCapSlot(g);
      if (!slot) return false;
      return (usedCount.get(g.id) ?? 0) === 0;
    });
    for (const [i, g] of leftovers.entries()) {
      if (out.length >= cap) break;
      const ids = pickLook(pool.filter((x) => x.id === g.id || !atCap(x)), {
        occasion,
        weather,
        ...(season ? { season } : {}),
        lockedIds: [g.id],
        house,
        salt: seed + 1000 + i,
        today,
        excludeKeys: used,
        legalCombo: combo,
      });
      const pieces = ids.map((id) => byId.get(id)).filter((x): x is Garment => Boolean(x));
      if (!pieces.some((x) => x.id === g.id)) continue;
      if (tryPush(pieces, true)) for (const x of pieces) if (isBlazer(x) || isTrueOuter(x)) usedBlazers.add(x.id);
    }
  }
  return repairJacketQuotas(out, pool, occasion, house, season, usedBlazers, atCap);
}

/**
 * Extra looks for one occasion until `min` or the rack is exhausted.
 * Tagged with that occasion. HIS plates only.
 */
export function fillOccasionLooks(
  garments: Garment[],
  looks: Look[],
  occasion: Occasion,
  min = CHAPTER_CAP,
  exclude?: Set<string>,
  season?: Season,
  house?: House,
): Look[] {
  const occ = mapOccasion(occasion);
  const byId = new Map(garments.map((g) => [g.id, g]));
  const have = looks.filter((l) => {
    if (mapOccasion(l.occasion) !== occ) return false;
    const pieces = l.garmentIds
      .map((id) => byId.get(id))
      .filter((g): g is Garment => Boolean(g));
    if (pieces.length < 3) return false;
    return true;
  });
  if (have.length >= min) return [];
  const keys = new Set([
    ...(exclude ?? []),
    ...have.map((l) => comboKey(l.garmentIds)),
  ]);
  const usedCount = new Map<string, number>();
  const usedBlazers = new Set<string>();
  let blazerLooks = 0;
  for (const l of have) {
    for (const id of l.garmentIds) usedCount.set(id, (usedCount.get(id) ?? 0) + 1);
    const jackets = l.garmentIds
      .map((id) => byId.get(id))
      .filter((g): g is Garment => g != null && isBlazer(g));
    if (jackets.length) {
      blazerLooks += 1;
      for (const j of jackets) usedBlazers.add(j.id);
    }
  }
  return buildChapter(garments, occ, {
    exclude: keys,
    cap: min - have.length,
    season,
    usedCount,
    blazerLooks,
    usedBlazers,
    house,
  });
}

export function looksToKeepOnShuffle(
  looks: Look[],
  occasion: Occasion,
  _garments: Garment[] = [],
  _season?: Season,
  house?: House,
): Look[] {
  const occ = mapOccasion(occasion);
  return looks.filter((l) => {
    if (mapOccasion(l.occasion) !== occ) return true;
    if (l.source === "manual") return true;
    if (l.id.startsWith("week_")) return true;
    void house;
    return false;
  });
}

/** Shuffle one chapter: drop unsaved rows, fill up to 10 unseen combos. Saved stay. */
export function applyShuffle(
  garments: Garment[],
  looks: Look[],
  occasion: Occasion,
  seen: string[],
  today?: string,
  season?: Season,
  house?: House,
): { looks: Look[]; added: Look[]; seen: string[] } {
  const occ = mapOccasion(occasion);
  const kept = looksToKeepOnShuffle(looks, occ, garments, season, house);
  const exclude = new Set(seen);
  const usedCount = new Map<string, number>();
  const usedBlazers = new Set<string>();
  let blazerLooks = 0;
  const byId = new Map(garments.map((g) => [g.id, g]));
  for (const l of kept) {
    if (mapOccasion(l.occasion) !== occ) continue;
    exclude.add(comboKey(l.garmentIds));
    for (const id of l.garmentIds) usedCount.set(id, (usedCount.get(id) ?? 0) + 1);
    const jackets = l.garmentIds
      .map((id) => byId.get(id))
      .filter((g): g is Garment => g != null && isBlazer(g));
    if (jackets.length) {
      blazerLooks += 1;
      for (const j of jackets) usedBlazers.add(j.id);
    }
  }
  const added = buildChapter(garments, occ, {
    exclude,
    cap: 8,
    today,
    usedCount,
    blazerLooks,
    usedBlazers,
    house,
  });
  const nextSeen = [...new Set([...seen, ...added.map((l) => comboKey(l.garmentIds))])];
  return { looks: [...kept, ...added], added, seen: nextSeen };
}

/** Migrate old client/dinner tags and cap auto rows at 10 per chapter. Manual stays. */
export function capChapterLooks(looks: Look[]): Look[] {
  const mapped = looks.map((l) => ({ ...l, occasion: mapOccasion(l.occasion) }));
  const out: Look[] = [];
  const used = new Set<string>();
  for (const l of mapped) {
    if (l.source === "manual" || !l.lookbook) {
      out.push(l);
      used.add(l.id);
    }
  }
  for (const { id: occ } of OCCASIONS) {
    let n = 0;
    for (const l of mapped) {
      if (used.has(l.id)) continue;
      if (l.occasion !== occ) continue;
      if (n >= CHAPTER_CAP * 4) continue;
      out.push(l);
      used.add(l.id);
      n += 1;
    }
  }
  return out;
}

export function lookHasColor(pieces: Garment[], color: string): boolean {
  const want = color.toLowerCase();
  return pieces.some((g) => g.colors.some((c) => c.toLowerCase() === want));
}

export function lookbookStats(
  looks: Look[],
  garments: Garment[],
): {
  looks: number;
  used: number;
  total: number;
  unusedNames: string[];
  everyPieceUsed: boolean;
} {
  const pool = lookbookPool(garments);
  const slotted = pool.filter((g) => {
    const s = slotOf(g);
    return s === "top" || s === "bottom" || s === "footwear" || s === "dress" || s === "outerwear";
  });
  const usedIds = new Set(looks.flatMap((l) => l.garmentIds));
  const unused = slotted.filter((g) => !usedIds.has(g.id));
  const used = slotted.filter((g) => usedIds.has(g.id)).length;
  return {
    looks: looks.length,
    used,
    total: pool.length,
    unusedNames: unused.map((g) => g.name),
    everyPieceUsed: slotted.length > 0 && unused.length === 0,
  };
}

export function mergeLookbook(
  existing: Look[],
  book: Look[],
  garments: Garment[] = [],
): Look[] {
  const byId = new Map(garments.map((g) => [g.id, g]));
  const valid = (l: Look) => {
    if (!garments.length) return true;
    const pieces = l.garmentIds
      .map((id) => byId.get(id))
      .filter((g): g is Garment => Boolean(g));
    if (pieces.length < 2) return true;
    return !lookClashes(pieces);
  };
  // Auto builder ids are lb_*. Invalid hoodie+Italian looks drop even if saved.
  const kept = existing.filter(
    (l) => (l.source === "manual" || !l.lookbook || !l.id.startsWith("lb_")) && valid(l),
  );
  const keys = new Set(kept.map((l) => comboKey(l.garmentIds)));
  const extra = book.filter(
    (b) => valid(b) && !keys.has(comboKey(b.garmentIds)),
  );
  return [...kept, ...extra];
}

type WearSlot = "top" | "bottom" | "footwear" | "outer";

function wearSlot(g: Garment): WearSlot | null {
  const s = slotOf(g);
  if (s === "top" || s === "dress") return "top";
  if (s === "bottom") return "bottom";
  if (s === "footwear") return "footwear";
  if (s === "outerwear") return "outer";
  return null;
}

function lookWear(pieces: Garment[]): Map<WearSlot, string> {
  const m = new Map<WearSlot, string>();
  for (const g of pieces) {
    const slot = wearSlot(g);
    if (!slot || m.has(slot)) continue;
    m.set(slot, g.id);
  }
  return m;
}

function slotsDifferent(a: Garment[], b: Garment[]): number {
  const A = lookWear(a);
  const B = lookWear(b);
  const keys = new Set<WearSlot>([...A.keys(), ...B.keys()]);
  let n = 0;
  for (const k of keys) {
    if (A.get(k) !== B.get(k)) n += 1;
  }
  return n;
}

function lookColors(pieces: Garment[]): Set<string> {
  const s = new Set<string>();
  for (const g of pieces) {
    for (const c of g.colors) {
      const n = canonicalize(c);
      if (n) s.add(n);
    }
  }
  return s;
}

/**
 * Same occasion + shared colors/houses. At least two wear-slots different. Those are the
 * gates; among the looks that pass them, up to `n` are drawn by rotation weight (draw.ts),
 * seeded by the day and the seed look, never the seed itself.
 */
export function moreLikeThis(
  look: Look,
  looks: Look[],
  garments: Garment[],
  n = 3,
  lockedIds: string[] = [],
  today = todayNY(),
): Look[] {
  const byId = new Map(garments.map((g) => [g.id, g]));
  const pieces = look.garmentIds
    .map((id) => byId.get(id))
    .filter((g): g is Garment => Boolean(g));
  if (pieces.length < 2) return [];
  const houses = new Set(lookHouses(pieces));
  const colors = lookColors(pieces);
  const occ = look.occasion;

  const resolve = (l: Look) =>
    l.garmentIds.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));

  const alike = (cand: Look): boolean => {
    if (cand.id === look.id) return false;
    const p = resolve(cand);
    if (p.length < 3) return false;
    if (lockedIds.length && lockedIds.some((id) => !cand.garmentIds.includes(id))) return false;
    const minDiff = lockedIds.length ? 1 : 2;
    if (slotsDifferent(pieces, p) < minDiff) return false;
    const sharedH = lookHouses(p).filter((h) => houses.has(h)).length;
    let sharedC = 0;
    for (const c of lookColors(p)) if (colors.has(c)) sharedC += 1;
    if (sharedH === 0 && sharedC === 0) return false;
    if (lookClashes(p)) return false;
    return cand.occasion === occ;
  };

  const candidates = looks.filter(alike);
  const wctx: WeightCtx = { today };
  const rng = rngFromSalt(drawSeed(today, `more-like:${look.id}`, liveIdsKey(garments)));
  return drawOrder(candidates, (l) => Math.max(lookRotationWeight(resolve(l), wctx), Number.MIN_VALUE), rng).slice(0, n);
}

const HERO_OCCASIONS: Occasion[] = ["weekday", "out", "weekend", "travel", "comfy"];
/** How many looks "N looks with this" fills toward. */
export const HERO_LOOKS = 5;
/**
 * Rule checks one hero draw may spend (pickLook's maxTries): the sheet's count must not freeze
 * the page on a piece no look holds (a heavy shearling in fall searched every partner for
 * seconds per occasion). The daily pick and Outfit with this stay exhaustive.
 */
export const HERO_PICK_TRIES = 1500;

/**
 * The hero occasions a piece can be dressed for at all, in the fixed order: the five, less those
 * whose per-piece rules refuse the piece on its own (pieceRuleFails: a hoodie on a weekday, a
 * summer piece under the occasion's weather). No partner search here; a look is still found or
 * not by the draw.
 */
export function heroOccasionsFor(g: Garment, pool?: readonly Garment[]): Occasion[] {
  return HERO_OCCASIONS.filter(
    (occasion) => pieceRuleFails(g, { house: null, occasion, season: seasonFromWeather(weatherForOcc(occasion).f), pool }).length === 0,
  );
}

/** "1 look with this", "3 looks with this": the heading and the button say the real count. */
export function looksWithLabel(n: number, who = "this"): string {
  return `${n} ${n === 1 ? "look" : "looks"} with ${who}`;
}

function heroHonest(g: Garment, occ: Occasion, pieces: Garment[]): boolean {
  if (lookFitsOccasion(pieces, occ)) return true;
  const blob = pieces.map((p) => `${p.subtype} ${p.name}`).join(" ").toLowerCase();
  const hoodie = pieces.some(isHoodiePiece) || pieces.some(isGraphic);
  const loafer = /loafer/.test(blob);
  if (occ === "weekend" && /trouser|gurkha/.test(`${g.subtype} ${g.name}`) && loafer && !hoodie) {
    return true;
  }
  if (occ === "weekend" && slotOf(g) === "footwear" && /loafer/.test(`${g.subtype} ${g.name}`) && !hoodie) {
    return true;
  }
  return false;
}

function weatherForOcc(occasion: Occasion, season?: Season) {
  if (season === "summer") return { f: 78, label: "Warm", code: 2 };
  if (season === "winter") return { f: 42, label: "Cold", code: 2 };
  if (occasion === "comfy") return { f: 72, label: "Fair", code: 2 };
  if (occasion === "weekend") return { f: 64, label: "Mild", code: 2 };
  return { f: 58, label: "Cool", code: 2 };
}

function starLook(
  g: Garment,
  garments: Garment[],
  occasion: Occasion,
  seen: Set<string>,
  previousIds: string[],
  turn = 0,
): Look | null {
  const pool = lookbookPool(garments);
  const byId = new Map(pool.map((x) => [x.id, x]));
  const today = todayNY();
  const ids = pickLook(pool, {
    occasion,
    weather: weatherForOcc(occasion),
    lockedIds: [g.id],
    previousIds,
    excludeKeys: seen,
    salt: drawSeed(today, `hero:${g.id}:${occasion}`, liveIdsKey(pool), turn),
    today,
    maxTries: HERO_PICK_TRIES,
  });
  const ordered = ids.includes(g.id) ? ids : [g.id, ...ids.filter((id) => id !== g.id)];
  if (ordered.length < 3 || !ordered.includes(g.id)) return null;
  const key = comboKey(ordered);
  if (seen.has(key)) return null;
  const pieces = ordered.map((id) => byId.get(id)).filter((x): x is Garment => Boolean(x));
  if (pieces.length < 3) return null;
  if (lookClashes(pieces)) return null;
  return {
    id: `hero_${g.id}_${occasion}_${key.slice(0, 10)}`,
    name: nameOf(pieces),
    occasion,
    garmentIds: ordered,
    source: "ai",
    lookbook: true,
    createdAt: `${todayISO()}T00:00:00.000Z`,
  };
}

/**
 * Up to HERO_LOOKS looks starring this piece: one draw (the surface `hero:<id>:<occasion>`) per
 * hero occasion the piece can be dressed for (heroOccasionsFor), then further turns of the same
 * occasions until the count is reached or the draws run dry. Every look passes the rules
 * (pickLook draws among rule-passing looks); nothing pads. The caller shows the real count.
 */
export function looksForHero(
  g: Garment,
  garments: Garment[],
  opts?: { seen?: string[] },
): Look[] {
  const seen = new Set(opts?.seen ?? []);
  const previous: string[] = [];
  const out: Look[] = [];
  const occasions = heroOccasionsFor(g, lookbookPool(garments));
  const take = (occasion: Occasion, turn: number): boolean => {
    const look = starLook(g, garments, occasion, seen, previous, turn);
    if (!look) return false;
    const pieces = look.garmentIds
      .map((id) => garments.find((x) => x.id === id))
      .filter((x): x is Garment => Boolean(x));
    if (!lookFitsOccasion(pieces, occasion, garments) && !heroHonest(g, occasion, pieces)) return false;
    out.push(look);
    seen.add(comboKey(look.garmentIds));
    previous.push(...look.garmentIds.filter((id) => id !== g.id));
    return true;
  };
  /* An occasion whose first draw finds nothing is dropped: a later turn only reseeds the same exhaustive search. */
  const live = occasions.filter((occasion) => {
    const found = take(occasion, 0);
    return found;
  });
  if (out.length >= HERO_LOOKS) return out.slice(0, HERO_LOOKS);
  /* Further turns of the occasions that dressed the piece, in order, until the count is reached or the draws run dry. */
  for (let t = 0; t < 12 && out.length < HERO_LOOKS && live.length; t++) {
    take(live[t % live.length]!, Math.floor(t / live.length) + 1);
  }
  return out;
}

/** Chip-filter the 5 looks starring a piece; fill to ≥3 without dropping the piece. */
export function visibleHero(
  g: Garment,
  looks: Look[],
  garments: Garment[],
  opts?: { occasion?: Occasion; season?: Season; house?: House | "all"; color?: string | null; min?: number },
): Look[] {
  const pool = lookbookPool(garments);
  const byId = new Map(pool.map((x) => [x.id, x]));
  const season = opts?.season;
  const house = opts?.house && opts.house !== "all" ? opts.house : undefined;
  const min = opts?.min ?? 3;
  const resolve = (l: Look) =>
    l.garmentIds.map((id) => byId.get(id)).filter((x): x is Garment => Boolean(x));
  let rows = looks.filter((l) => {
    if (!l.garmentIds.includes(g.id)) return false;
    const pieces = resolve(l);
    if (pieces.length < 3) return false;
    if (lookClashes(pieces)) return false;
    if (season && !lookFitsSeason(pieces, season)) return false;
    if (opts?.color && !lookHasColor(pieces, opts.color)) return false;
    return true;
  });
  if (opts?.occasion) {
    const occRows = rows.filter((l) => mapOccasion(l.occasion) === opts.occasion);
    if (occRows.length >= min) rows = occRows;
  }
  rows = [...rows].sort((a, b) => {
    if (!house) return 0;
    const ha = lookFitsHouse(resolve(a), house, opts?.occasion ?? "weekday", pool) ? 1 : 0;
    const hb = lookFitsHouse(resolve(b), house, opts?.occasion ?? "weekday", pool) ? 1 : 0;
    return hb - ha;
  });
  if (rows.length < min) {
    const extra = looksForHero(g, garments, { seen: rows.map((l) => comboKey(l.garmentIds)) });
    const more = extra.filter((l) => l.garmentIds.includes(g.id));
    const keys = new Set(rows.map((l) => comboKey(l.garmentIds)));
    for (const l of more) {
      const k = comboKey(l.garmentIds);
      if (keys.has(k)) continue;
      keys.add(k);
      rows.push(l);
    }
  }
  return rows.filter((l) => l.garmentIds.includes(g.id)).slice(0, 5);
}

/** Today’s 7 cells: thisWeek first, then ranked weekday looks. Skip a look with <2 real plates. */
export function todayStripLooks(
  thisWeek: Look[],
  book: Look[],
  garments: Garment[],
  n = 7,
): Look[] {
  const pool = lookbookPool(garments);
  const byId = new Map(pool.map((g) => [g.id, g]));
  const resolve = (l: Look) =>
    l.garmentIds.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
  const ok = (l: Look) => mapOccasion(l.occasion) === "weekday" && resolve(l).length >= 2;
  const ranked =
    book.length > 0
      ? chapterVisible(book, garments, "weekday", { min: n })
      : [];
  const out: Look[] = [];
  const seen = new Set<string>();
  for (const l of [...thisWeek, ...ranked]) {
    if (out.length >= n) break;
    if (!ok(l)) continue;
    const key = comboKey(l.garmentIds);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

export type WeekStripCell = { iso: string; look: Look | null };

function resolvingIds(ids: readonly string[], byId: Map<string, Garment>): number {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
  }
  return seen.size;
}

function stripLook(id: string, garmentIds: string[], iso: string): Look {
  return {
    id,
    name: "",
    occasion: "weekday",
    garmentIds,
    source: "manual",
    lookbook: false,
    createdAt: iso,
  };
}

/**
 * One cell per day. Today is the drop when that drop still has two real pieces.
 * Other days use a worn journal entry, then thisWeek. A past day may stay empty.
 */
export function weekStripDays(input: {
  days: readonly string[];
  today: string;
  drop: { date: string; garmentIds: readonly string[] } | null;
  journal: readonly { date: string; garmentIds: readonly string[]; verdict: string }[];
  thisWeek: readonly Look[];
  garments: Garment[];
}): WeekStripCell[] {
  const byId = new Map(lookbookPool(input.garments).map((g) => [g.id, g]));
  const enough = (ids: readonly string[]) => resolvingIds(ids, byId) >= 2;
  const queued = input.thisWeek.filter((look) => enough(look.garmentIds));
  let nextWeek = 0;
  return input.days.map((iso) => {
    if (
      iso === input.today &&
      input.drop &&
      input.drop.date === input.today &&
      enough(input.drop.garmentIds)
    ) {
      return { iso, look: stripLook(`drop-${iso}`, [...input.drop.garmentIds], iso) };
    }
    const worn = input.journal.find(
      (entry) => entry.date === iso && entry.verdict === "worn" && enough(entry.garmentIds),
    );
    if (worn) return { iso, look: stripLook(`worn-${iso}`, [...worn.garmentIds], iso) };
    const look = queued[nextWeek];
    if (look) {
      nextWeek += 1;
      return { iso, look };
    }
    return { iso, look: null };
  });
}

export function rackCanDress(garments: Garment[]): boolean {
  const pool = lookbookPool(garments);
  const top = pool.some((g) => {
    const s = slotOf(g);
    return s === "top" || s === "dress";
  });
  const bottom = pool.some((g) => slotOf(g) === "bottom");
  const shoe = pool.some((g) => slotOf(g) === "footwear");
  return top && bottom && shoe;
}

/** Empty-chapter copy. Null when the rack can dress — never the only content. */
export function emptyFilterCopy(
  chapter: string,
  seasonLabel: string,
  seasonChip: "auto" | Season,
  houseChip: House | "all",
  color: string | null,
  canDress: boolean,
): string | null {
  if (canDress) return null;
  const named = [chapter];
  const seasonName = seasonLabel.replace(/^Auto · /, "");
  if (seasonChip !== "auto") named.push(seasonName);
  if (houseChip !== "all") {
    named.push(HOUSE_CHIPS.find((h) => h.id === houseChip)?.label ?? houseChip);
  }
  if (color) named.push(color);
  let hint = "Switch Weekend.";
  if (seasonChip !== "auto") hint = `Clear ${seasonName} or switch Weekend.`;
  else if (houseChip !== "all") {
    hint = `Clear ${HOUSE_CHIPS.find((h) => h.id === houseChip)?.label ?? "house"} or switch Weekend.`;
  } else if (color) hint = `Clear ${color} or switch Weekend.`;
  return `Add a top, a bottom, and shoes before this chapter can dress. ${hint}`;
}

/**
 * Shown-equivalent for one chapter.
 * Occasion is the chapter key. House and season rank; they never return fewer looks than the untapped chapter.
 */
export function chapterVisible(
  looks: Look[],
  garments: Garment[],
  occasion: Occasion,
  opts?: {
    season?: Season;
    house?: House | "all";
    color?: string | null;
    min?: number;
    /** False: do not invent extra trios to reach min. The critic decides. */
    pad?: boolean;
  },
): Look[] {
  const pool = lookbookPool(garments);
  const byId = new Map(pool.map((g) => [g.id, g]));
  const season = opts?.season;
  const house = opts?.house && opts.house !== "all" ? opts.house : undefined;
  const min = opts?.min ?? 3;
  const resolve = (l: Look) =>
    l.garmentIds.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));

  const rows = looks.filter((look) => {
    const pieces = resolve(look);
    if (pieces.length < 3) return false;
    if (mapOccasion(look.occasion) !== occasion) return false;
    if (lookClashes(pieces)) return false;
    if (season && !lookFitsSeason(pieces, season)) return false;
    return true;
  });

  const fit = new Map<string, number>();
  const hard = new Map<string, number>();
  if (house) {
    for (const look of rows) {
      const pieces = resolve(look);
      fit.set(look.id, lookFitsHouse(pieces, house, occasion, pool) ? 1 : 0);
      hard.set(
        look.id,
        isLegal(pieces, { house, occasion, season: season ?? "fall", color: opts?.color }) ? 1 : 0,
      );
    }
  }
  const order = (byHouse: boolean) =>
    [...rows].sort((a, b) => {
      const pa = resolve(a);
      const pb = resolve(b);
      if (byHouse) {
        const fits = (fit.get(b.id) ?? 0) - (fit.get(a.id) ?? 0);
        if (fits) return fits;
        const legal = (hard.get(b.id) ?? 0) - (hard.get(a.id) ?? 0);
        if (legal) return legal;
      }
      if (opts?.color) {
        const ca = lookHasColor(pa, opts.color) ? 1 : 0;
        const cb = lookHasColor(pb, opts.color) ? 1 : 0;
        if (cb !== ca) return cb - ca;
      }
      return 0;
    });
  const shown = (byHouse: boolean) => enforcePieceCap(stripRepeatBlazers(order(byHouse), garments), garments);
  if (!house) return shown(false);

  /* House ranks. The untapped chapter is the floor; a note only when the rack itself is short. */
  let out = shown(true);
  const untapped = shown(false);
  if (out.length < untapped.length) {
    const have = new Set(out.map((look) => look.id));
    out = [...out, ...untapped.filter((look) => !have.has(look.id))];
  }
  if (opts?.pad === false || out.length >= min) return out;
  const note = houseGapNote(house, pool, occasion) || "Needs pieces from this house.";
  return [
    ...out,
    {
      id: `needs_${house}_${occasion}`,
      name: note,
      occasion,
      garmentIds: [],
      source: "ai" as const,
      lookbook: false,
      gap: note,
      needsPieces: true,
      createdAt: `${todayISO()}T00:00:00.000Z`,
    },
  ];
}

/** Exhausted only after a full chapter was shown and shuffle-after-reset added nothing. */
export function chapterExhausted(
  visible: number,
  shuffleAdded: number,
  resetAdded: number,
): boolean {
  return visible >= 3 && shuffleAdded === 0 && resetAdded === 0;
}

/** Put idle livePool pieces into looks so the whole rack is in the book. */
export function coverUnused(garments: Garment[], looks: Look[]): Look[] {
  const pool = lookbookPool(garments);
  const byId = new Map(pool.map((g) => [g.id, g]));
  const used = new Set(looks.flatMap((l) => l.garmentIds));
  const extra: Look[] = looks.map((l) => ({ ...l, garmentIds: [...l.garmentIds] }));
  const keys = new Set(extra.map((l) => comboKey(l.garmentIds)));
  for (const g of pool) {
    if (used.has(g.id)) continue;
    const slot = slotOf(g);
    if (slot === "accessory" || g.category === "accessory" || !slot) {
      const idx = extra.findIndex((l) => {
        const pieces = l.garmentIds
          .map((id) => byId.get(id))
          .filter((x): x is Garment => Boolean(x));
        return (
          pieces.length >= 3 &&
          !pieces.some((p) => slotOf(p) === "accessory" || p.category === "accessory")
        );
      });
      if (idx >= 0) {
        const host = extra[idx]!;
        extra[idx] = { ...host, garmentIds: [...host.garmentIds, g.id] };
        used.add(g.id);
      }
      continue;
    }
    const occ: Occasion =
      isGraphic(g) || isHoodiePiece(g) ? "weekend" : isCampCollar(g) ? "weekend" : "weekday";
    const ids = pickLook(pool, {
      occasion: occ,
      weather: { f: 64, label: "Mild", code: 2 },
      lockedIds: [g.id],
      excludeKeys: keys,
      salt: drawSeed(todayNY(), `cover:${g.id}`, liveIdsKey(pool)),
    });
    const ordered = ids.includes(g.id) ? ids : [g.id, ...ids.filter((id) => id !== g.id)];
    if (ordered.length < 3 || !ordered.includes(g.id)) continue;
    const pieces = ordered.map((id) => byId.get(id)).filter((x): x is Garment => Boolean(x));
    if (pieces.length < 3 || lookClashes(pieces)) continue;
    const key = comboKey(ordered);
    if (keys.has(key)) continue;
    keys.add(key);
    for (const id of ordered) used.add(id);
    extra.push({
      id: `lb2_cover_${g.id}_${key.replace(/\|/g, "_")}`,
      name: nameOf(pieces),
      occasion: occ,
      garmentIds: ordered,
      source: "ai",
      lookbook: true,
      createdAt: `${todayISO()}T00:00:00.000Z`,
    });
  }
  return extra;
}

export const WEEK_ENERGIES: Occasion[] = [
  "weekday",
  "out",
  "weekend",
  "weekday",
  "out",
  "weekend",
  "weekday",
];

export function mondayISO(iso = todayISO()): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  const day = dt.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + diff);
  return dt.toISOString().slice(0, 10);
}

export function isThisWeekLook(l: Look, monday: string): boolean {
  return l.id.startsWith(`week_${monday}_`);
}

export function lookCountMap(looks: Look[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of looks) {
    for (const id of l.garmentIds) m.set(id, (m.get(id) ?? 0) + 1);
  }
  return m;
}

/** Scarce pieces first. Hubs with 159 looks get 1/160. */
export function weekWeight(lookCount: number): number {
  return 1 / (1 + lookCount);
}

export const RESHUFFLE_ROW = 8;
export const RESHUFFLE_MAX_PICKS = 4;
export const SKIP_MAX_PICKS = 8;

function knitTop(g: Garment): boolean {
  const t = topType(g);
  return (
    t === "cable" ||
    t === "merino" ||
    t === "cashmere_top" ||
    t === "turtleneck" ||
    t === "fair_isle"
  );
}

function lookOuter(pieces: Garment[]): Garment | undefined {
  return pieces.find((g) => isTrueOuter(g) && slotOf(g) === "outerwear");
}

function lookTop(pieces: Garment[]): Garment | undefined {
  return pieces.find((g) => {
    const s = slotOf(g);
    return s === "top" || s === "dress";
  });
}

function lookShoe(pieces: Garment[]): Garment | undefined {
  return pieces.find((g) => slotOf(g) === "footwear");
}

function reshuffleAxes(
  pieces: Garment[],
  recipeId: string | undefined,
): { top_type: string; bottom_type: string; shoe_family: string; outer_id: string; recipe_id: string } {
  const print = lookPrint(pieces);
  const bot = pieces.find((g) => slotOf(g) === "bottom");
  return {
    top_type: print.top_type,
    bottom_type: bot ? bottomType(bot) : print.bottom_type,
    shoe_family: print.shoe_family,
    outer_id: lookOuter(pieces)?.id ?? "none",
    recipe_id: recipeId ?? "",
  };
}

function reshuffleAxesDiff(
  a: ReturnType<typeof reshuffleAxes>,
  b: ReturnType<typeof reshuffleAxes>,
): number {
  let n = 0;
  if (a.top_type !== b.top_type) n += 1;
  if (a.bottom_type !== b.bottom_type) n += 1;
  if (a.shoe_family !== b.shoe_family) n += 1;
  if (a.outer_id !== b.outer_id) n += 1;
  if (a.recipe_id && b.recipe_id && a.recipe_id !== b.recipe_id) n += 1;
  return n;
}

function knitColorTwin(a: Garment[], b: Garment[]): boolean {
  const ta = lookTop(a);
  const tb = lookTop(b);
  if (!ta || !tb || !knitTop(ta) || !knitTop(tb)) return false;
  const pa = lookPrint(a);
  const pb = lookPrint(b);
  return pa.bottom_type === pb.bottom_type && pa.shoe_family === pb.shoe_family;
}

function jacketNameHits(g: Garment, name: string): boolean {
  const b = `${g.name} ${g.subtype}`.toLowerCase();
  if (name === "blazer") return isBlazerPiece(g) && slotOf(g) === "outerwear";
  if (name === "overcoat") return slotOf(g) === "outerwear" && /overcoat|topcoat/.test(b);
  if (slotOf(g) !== "outerwear") return false;
  const k = outerKind(g);
  if (name === "chore") return k === "chore";
  if (name === "denim") return k === "denim";
  if (name === "suede") return k === "suede";
  if (name === "field") return k === "field";
  return false;
}

/**
 * This week row from livePool. Not Monday-keyed. Does not append lookbook AI covers.
 */
function piecesOfLook(look: MatrixLook, byId: Map<string, Garment>): Garment[] {
  return [look.top, look.bottom, look.shoe, look.outer]
    .filter((id): id is string => Boolean(id))
    .map((id) => byId.get(id))
    .filter((g): g is Garment => Boolean(g));
}

function stampRecipe(pieces: Garment[], occasion: Occasion, house?: House): string | undefined {
  const id = matchRecipe(pieces, occasion, house);
  if (!id) return undefined;
  const outer = pieces.find((g) => slotOf(g) === "outerwear");
  const issue = recipeOuterIssue(id, outer ? `${outer.name} ${outer.subtype}` : undefined);
  if (issue) return undefined;
  return id;
}

function lookFromPieces(
  pieces: Garment[],
  occasion: Occasion,
  index: number,
  house?: House,
  extra?: Partial<Look>,
): Look {
  const key = comboKey(pieces.map((p) => p.id));
  return {
    id: `reshuffle_${occasion}_${index}_${key.replace(/\|/g, "_") || "card"}`,
    name: pieces.length ? nameOf(pieces) : extra?.name || "Needs pieces",
    occasion,
    garmentIds: pieces.map((p) => p.id),
    source: "ai",
    lookbook: false,
    recipeId: pieces.length >= 3 ? stampRecipe(pieces, occasion, house) : undefined,
    createdAt: `${todayISO()}T00:00:00.000Z`,
    ...extra,
  };
}

function fillHouseRow(
  top: MatrixLook[],
  pool: MatrixLook[],
  cap: number,
  salt: number,
): MatrixLook[] {
  const row = [...top];
  const seen = new Set(row.map((l) => `${l.top}|${l.bottom}|${l.shoe}|${l.outer ?? ""}`));
  const start = pool.length ? salt % pool.length : 0;
  for (let n = 0; n < pool.length && row.length < cap; n++) {
    const look = pool[(start + n) % pool.length]!;
    const key = `${look.top}|${look.bottom}|${look.shoe}|${look.outer ?? ""}`;
    if (seen.has(key)) continue;
    const slots = [...row, look].map((l) => ({ top: l.top, bottom: l.bottom, shoe: l.shoe, outer: l.outer }));
    if (rep3Fails(slots).length) continue;
    seen.add(key);
    row.push(look);
  }
  return row;
}

function rotateJackets(
  looks: Look[],
  pool: Garment[],
  house: House,
  occasion: Occasion,
  season: Season,
  taste?: TasteMemory,
): Look[] {
  if (season === "summer" || looks.length < 4) return looks;
  const raw =
    (
      approvedProfile(house) as unknown as {
        allowed_jackets?: { joe_plate_ids?: Array<string | { id: string }> };
      }
    ).allowed_jackets?.joe_plate_ids ?? [];
  const ids = raw.map((item) => (typeof item === "string" ? item : item.id));
  const byId = new Map(pool.map((g) => [g.id, g]));
  const veto = taste ? pieceVetoIds(taste) : new Set<string>();
  const jackets = ids
    .map((id) => byId.get(id))
    .filter((g): g is Garment => {
      if (!g) return false;
      return !veto.has(g.id);
    });
  if (jackets.length < 4) return looks;
  const next = looks.map((look) => ({ ...look, garmentIds: [...look.garmentIds] }));
  const claimed = new Set<string>();
  const limit = Math.min(6, next.length);
  for (let i = 0; i < limit; i++) {
    const look = next[i]!;
    const pieces = look.garmentIds.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
    const current = pieces.find((g) => jackets.some((j) => j.id === g.id));
    if (current && !claimed.has(current.id)) {
      claimed.add(current.id);
      continue;
    }
    const want = jackets.find((j) => !claimed.has(j.id));
    if (!want) continue;
    const core = pieces.filter((g) => !jackets.some((j) => j.id === g.id));
    const combined = [...core, want];
    if (!isLegal(combined, { house, occasion, season })) continue;
    look.garmentIds = combined.map((g) => g.id);
    look.recipeId = stampRecipe(combined, occasion, house);
    const key = comboKey(look.garmentIds);
    look.id = `reshuffle_${occasion}_${i}_${key.replace(/\|/g, "_")}`;
    claimed.add(want.id);
  }
  return next;
}

/** A colour row leads with its colour on at least this many looks when the closet allows (re-dressing jackets if it must). */
const COLOR_ROW_MIN = 3;

function finishStyled(
  garments: Garment[],
  occasion: Occasion,
  opts?: {
    house?: House;
    season?: Season;
    excludeKeys?: string[];
    cap?: number;
    salt?: number;
    color?: string | null;
    taste?: TasteMemory;
    today?: string;
  },
): Look[] {
  const cap = opts?.cap ?? RESHUFFLE_ROW;
  const season = opts?.season ?? "fall";
  const pool = lookbookPool(garments);
  const byId = new Map(pool.map((g) => [g.id, g]));
  const banned = new Set(opts?.excludeKeys ?? []);
  const matrix = buildHouseMatrix(pool, occasion, season);
  const house = opts?.house;
  const color = opts?.color?.trim().toLowerCase() || "";
  const today = opts?.today ?? todayNY();
  /*
   * The surface's draw: the day, the row (week strip, a house or colour row), the closet and the
   * Reshuffle counter. A colour row is the same draw with or without a house: the house only
   * re-orders it (below), so the house is not in a colour row's seed.
   */
  const rng = rngFromSalt(drawSeed(today, `week-strip:${occasion}:${color ? "" : (house ?? "")}:${color}`, liveIdsKey(pool), opts?.salt ?? 0));
  const wctx: WeightCtx = { today };

  /** The matrix's looks that stand under the vetoes, drawn by rotation weight (draw.ts). */
  const publish = (looks: MatrixLook[], tag?: House): Look[] => {
    const accepted: { pieces: Garment[]; demoted?: MatrixLook["demoted"] }[] = [];
    const plain: { pieces: Garment[]; demoted?: MatrixLook["demoted"] }[] = [];
    for (const look of looks) {
      const raw = piecesOfLook(look, byId);
      if (raw.length < 3) continue;
      if (DELETED_HIT(raw)) continue;
      plain.push({ pieces: raw, demoted: look.demoted });
      const pieces = opts?.taste ? applyAtlas(raw, opts.taste) : raw;
      if (!pieces) continue;
      accepted.push({ pieces, demoted: look.demoted });
    }
    const ranked = drawOrder(accepted.length ? accepted : plain, (item) => Math.max(lookRotationWeight(item.pieces, wctx), Number.MIN_VALUE), rng);
    const out: Look[] = [];
    for (const item of ranked) {
      const pieces = item.pieces;
      const key = comboKey(pieces.map((p) => p.id));
      if (banned.has(key)) continue;
      if (color) {
        const col = evaluateColor(assignSlots(pieces.map((g) => ({
          id: g.id,
          name: g.name,
          category: g.category === "dress" ? "top" : g.category,
          subtype: g.subtype,
          material: g.material,
          colors: g.colors,
          brand: g.brand,
          fit: g.fit,
          warmth: g.warmth,
        }))), color, tag);
        if (!col.passed) continue;
      }
      out.push(lookFromPieces(pieces, occasion, out.length, tag, item.demoted ? { demoted: item.demoted } : undefined));
      if (out.length >= cap) break;
    }
    return out;
  };

  /**
   * The colour row leads with the colour on at least COLOR_ROW_MIN looks when the closet allows.
   * The matrix spreads its jackets across every row built this session, so a look whose only
   * navy piece was its jacket may come back under another jacket and fail the colour. When the
   * matrix's looks leave the row short, the next looks are re-dressed with a jacket that carries
   * the colour (in season, legal with the core, not already on the row), in matrix order.
   */
  const isJacket = (g: Garment) => jacketWearSlot(g) === "outer" || slotOf(g) === "outerwear";
  const plateOf = (g: Garment) => ({
    id: g.id,
    name: g.name,
    category: g.category === "dress" ? "top" : g.category,
    subtype: g.subtype,
    material: g.material,
    colors: g.colors,
    brand: g.brand,
    fit: g.fit,
    warmth: g.warmth,
  });
  const publishColor = (): Look[] => {
    const row = publish(matrix.all);
    const want = Math.min(COLOR_ROW_MIN, cap);
    if (row.length >= want) return row;
    const have = new Set(row.map((look) => comboKey(look.garmentIds)));
    const fw = new Set(season === "fall" || season === "winter" ? fwEligibleJackets() : []);
    const jackets = pool.filter((g) => isJacket(g) && (fw.size === 0 || fw.has(g.id)));
    const out = [...row];
    for (const look of matrix.all) {
      if (out.length >= want) break;
      const raw = piecesOfLook(look, byId);
      if (raw.length < 3 || DELETED_HIT(raw)) continue;
      const core = raw.filter((g) => !isJacket(g));
      if (core.length < 3) continue;
      for (const jacket of jackets) {
        const combined = [...core, jacket];
        const key = comboKey(combined.map((g) => g.id));
        if (banned.has(key) || have.has(key)) continue;
        const pieces = opts?.taste ? applyAtlas(combined, opts.taste) : combined;
        if (!pieces || pieces.length !== combined.length) continue;
        if (!evaluateColor(assignSlots(pieces.map(plateOf)), color).passed) continue;
        if (!isLegal(pieces, { house: null, occasion, season })) continue;
        out.push(lookFromPieces(pieces, occasion, out.length));
        have.add(key);
        break;
      }
    }
    return out;
  };

  if (color && house) {
    /*
     * House ranks here too. The row is the colour row, re-ordered so the looks that fit
     * the house lead. Same count as colour alone; never a gate card.
     */
    const row = publishColor();
    if (row.length) {
      const fits = (look: Look) => {
        const pieces = look.garmentIds.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
        return pieces.length >= 3 && lookFitsHouse(pieces, house, occasion, pool, season);
      };
      return [...row.filter(fits), ...row.filter((look) => !fits(look))];
    }
    const label = HOUSE_LABEL[house];
    const note = colorEmptyCopy(label, color, house);
    return [lookFromPieces([], occasion, 0, house, { name: note, gap: note, needsPieces: true })];
  }

  if (color) {
    const fromAll = publishColor();
    if (fromAll.length) return fromAll;
    return [
      lookFromPieces([], occasion, 0, undefined, {
        name: `No look leads with ${color}.`,
        gap: `No look leads with ${color}.`,
        needsPieces: true,
      }),
    ];
  }

  if (house) {
    const cell = matrix.houses[house];
    if (!cell) return [];
    /* House ranks. Its looks lead; the ALL row fills in behind. A gate is a note, never an empty page. */
    let lead = publish(fillHouseRow(cell.looks, cell.pool, cap, opts?.salt ?? 1), house);
    if (!cell.gate) lead = rotateJackets(lead, pool, house, occasion, season, opts?.taste);
    if (cell.gate) {
      const note = cell.gate.text;
      lead = lead.map((look) => ({ ...look, gap: look.gap || note }));
    }
    const seen = new Set<string>();
    const row: Look[] = [];
    for (const look of [...lead, ...publish(matrix.all)]) {
      const key = comboKey(look.garmentIds);
      if (seen.has(key)) continue;
      seen.add(key);
      row.push(look);
      if (row.length >= cap) break;
    }
    /* House ranks: the looks that fit the house lead, in their drawn order; the rest follow. */
    const fitsHouse = (look: Look) => {
      const pieces = look.garmentIds.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
      return pieces.length >= 3 && lookFitsHouse(pieces, house, occasion, pool, season);
    };
    row.sort((a, b) => Number(fitsHouse(b)) - Number(fitsHouse(a)));
    if (row.length === 0 && cell.gate) {
      return [
        lookFromPieces([], occasion, 0, house, {
          name: cell.gate.text,
          gap: cell.gate.text,
          gate: { occasion: cell.gate.occasion, season: cell.gate.season, text: cell.gate.text },
        }),
      ];
    }
    if (row.length < 3 && !cell.gate) {
      const note = cell.gap || houseGapNote(house, pool, occasion) || "Needs pieces from this house.";
      return [
        ...row,
        lookFromPieces([], occasion, row.length, house, { name: note, gap: note, needsPieces: true }),
      ];
    }
    return row;
  }

  const all = publish(matrix.all);
  if (all.length) return all;
  if (pool.length < 3) return [];
  return [];
}

const DELETED_IDS = new Set(["g_37e5eqjwgd3d", "g_c6qdv5c3gkor", "g_x0ro1mg2gu0a"]);
function DELETED_HIT(pieces: Garment[]): boolean {
  return pieces.some((p) => DELETED_IDS.has(p.id));
}

/** Cards that are outfits. A gap note is not a look. */
export function realWeekLooks(looks: Look[], owned?: ReadonlySet<string>): Look[] {
  return looks.filter((look) => {
    if (look.gate || look.needsPieces) return false;
    const ids = look.garmentIds.filter((id) => typeof id === "string" && id && (!owned || owned.has(id)));
    return new Set(ids).size >= 3;
  });
}

function leadsWithColor(pieces: Garment[], color: string): boolean {
  const plates = pieces.map((g) => ({
    id: g.id,
    name: g.name,
    category: g.category === "dress" ? "top" : g.category,
    subtype: g.subtype,
    material: g.material,
    colors: g.colors,
    brand: g.brand,
    fit: g.fit,
    warmth: g.warmth,
  }));
  return evaluateColor(assignSlots(plates), color).passed;
}

/**
 * The first cards, before the full house rank. Bounded on purpose so the page
 * can paint. The ranked row replaces these once it returns.
 */
export function firstWeekLooks(
  garments: Garment[],
  occasion: Occasion,
  opts?: {
    season?: Season;
    color?: string | null;
    weather?: WeatherSnap | null;
  },
): { looks: Look[]; reason: string } {
  const pool = lookbookPool(garments);
  const season = opts?.season;
  const weatherF =
    opts?.weather?.measured === true && typeof opts.weather.f === "number" && Number.isFinite(opts.weather.f)
      ? opts.weather.f
      : undefined;
  const tops = pool.filter((g) => {
    const slot = slotOf(g);
    return slot === "top" || slot === "dress";
  });
  const bottoms = pool.filter((g) => slotOf(g) === "bottom");
  const shoes = pool.filter((g) => slotOf(g) === "footwear");
  const sea = season ?? "fall";
  const where = `${occasion.charAt(0).toUpperCase()}${occasion.slice(1)} · ${sea.charAt(0).toUpperCase()}${sea.slice(1)}`;
  if (!tops.length || !bottoms.length || !shoes.length) {
    return { looks: [], reason: `${where} needs a top, a bottom, and a shoe from this closet.` };
  }
  const ctx = {
    occasion,
    season: sea,
    ...(weatherF !== undefined ? { weatherF } : {}),
  };
  const need = jacketRequired(occasion, sea, weatherF);
  const jackets = pool.filter((g) => slotOf(g) === "outerwear" || jacketWearSlot(g) === "outer");
  if (need && jackets.length === 0) {
    return {
      looks: [],
      reason: `${where} still needs a jacket, and this closet has no jacket that finishes the look.`,
    };
  }
  const color = opts?.color?.trim().toLowerCase() ?? "";
  const found: Garment[][] = [];
  const seen = new Set<string>();
  let sawLegal = false;
  let tries = 0;
  for (let i = 0; i < tops.length && found.length < 2 && tries < 48; i++) {
    for (let j = 0; j < bottoms.length && found.length < 2 && tries < 48; j++) {
      for (let k = 0; k < shoes.length && found.length < 2 && tries < 48; k++) {
        tries += 1;
        const core = [tops[i]!, bottoms[j]!, shoes[k]!];
        if (new Set(core.map((g) => g.id)).size < 3) continue;
        const candidates: Garment[][] = need ? [] : [core];
        for (const jacket of jackets) {
          if (core.some((g) => g.id === jacket.id)) continue;
          candidates.push([...core, jacket]);
        }
        for (const pieces of candidates) {
          if (!lookFitsOccasion(pieces, occasion, pool)) continue;
          if (season && !lookFitsSeason(pieces, season)) continue;
          if (!isLegal(pieces, ctx)) continue;
          sawLegal = true;
          if (color && !leadsWithColor(pieces, color)) continue;
          const key = comboKey(pieces.map((g) => g.id));
          if (seen.has(key)) continue;
          seen.add(key);
          found.push(pieces);
          break;
        }
      }
    }
  }
  if (!found.length) {
    return {
      looks: [],
      reason:
        color && sawLegal
          ? `No look leads with ${color}.`
          : need
            ? `${where} still needs a jacket, and none of these jackets finish a look.`
            : `Nothing in this closet is legal for ${where}.`,
    };
  }
  return { looks: found.map((pieces, index) => lookFromPieces(pieces, occasion, index)), reason: "" };
}

/**
 * Week cards from rows of pieces (the rotation row, weekRotationRow in detectors/ideas.ts):
 * the same ids, names and recipe stamps the engine's row gets. `demoted` marks the cards that
 * go without the jacket the day asks for.
 */
export function looksFromRows(rows: Garment[][], occasion: Occasion, demoted: readonly number[] = []): Look[] {
  const bare = new Set(demoted);
  return rows.map((pieces, index) =>
    lookFromPieces(pieces, occasion, index, undefined, bare.has(index) ? { demoted: "JKT-COV-1" } : undefined),
  );
}

export function buildReshuffleRow(
  garments: Garment[],
  occasion: Occasion,
  opts?: {
    house?: House;
    season?: Season;
    excludeKeys?: string[];
    usedCount?: Map<string, number>;
    replacing?: Look[];
    cap?: number;
    salt?: number;
    /** Live snap. Used for the 72F jacket rule only when measured. */
    weather?: WeatherSnap;
    /** Star these ids first, one per look, most idle first. */
    mustInclude?: string[];
    color?: string | null;
    taste?: TasteMemory;
    /** The day of the draw (drawSeed); the clock's when absent. */
    today?: string;
  },
): Look[] {
  const cap = opts?.cap ?? RESHUFFLE_ROW;
  const pool = lookbookPool(garments);
  if (opts?.house || opts?.color || pool.some((g) => g.id.startsWith("g_"))) {
    return finishStyled(garments, occasion, opts);
  }
  if (pool.length < 3) return [];
  const byId = new Map(pool.map((g) => [g.id, g]));
  const house = opts?.house;
  const season = opts?.season;
  const live = opts?.weather?.measured ? opts.weather : null;
  const weather = live ?? (season ? weatherForSeason(season) : weatherForOcc(occasion));
  const banned = new Set(opts?.excludeKeys ?? []);
  const today = opts?.today ?? todayNY();
  const salt0 = opts?.salt ?? 1;
  const rng: Rng = rngFromSalt(drawSeed(today, `week-strip:${occasion}:${house ?? ""}`, liveIdsKey(pool), salt0));
  const wctx: WeightCtx = { today };
  /** A weighted draw order (draw.ts): rotation weights, the surface's stream. */
  const shuffle = (list: Garment[]): Garment[] => drawOrder(list, (g) => pieceWeight(g, wctx), rng);
  const vetoIds = opts?.taste ? pieceVetoIds(opts.taste) : new Set<string>();
  const open = (list: Garment[]) => {
    if (!vetoIds.size) return list;
    const kept = list.filter((g) => !vetoIds.has(g.id));
    return kept.length ? kept : list;
  };
  const tops = shuffle(open(pool.filter((g) => {
    const s = slotOf(g);
    return s === "top" || s === "dress";
  })));
  const bottoms = shuffle(open(pool.filter((g) => slotOf(g) === "bottom")));
  const shoes = shuffle(open(pool.filter((g) => slotOf(g) === "footwear")));
  const profile = house ? houseProfile(house) : undefined;
  const onProfile = (g: Garment) => {
    if (!profile) return false;
    if (profile.signals.some((sig) => profilePhraseHits([g], sig, occasion))) return true;
    if (profile.shoes.some((sig) => profilePhraseHits([g], sig, occasion))) return true;
    if (profile.jackets.some((name) => jacketNameHits(g, name))) return true;
    return false;
  };
  const prefer = (list: Garment[]) => {
    if (!profile) return list;
    const yes = list.filter(onProfile);
    return yes;
  };
  const topSrc = prefer(tops);
  const botSrc = prefer(bottoms);
  const shoeSrc = prefer(shoes);
  const jackets = shuffle(
    profile
      ? pool.filter((g) => profile.jackets.some((name) => jacketNameHits(g, name)))
      : pool.filter((g) => isBlazerPiece(g)),
  ).filter((g) => !vetoIds.has(g.id));
  const color = opts?.color?.trim().toLowerCase() ?? "";
  const legal = (pieces: Garment[]): boolean => {
    if (pieces.length < 3) return false;
    if (new Set(pieces.map((p) => p.id)).size !== pieces.length) return false;
    if (!lookTop(pieces) || !pieces.some((g) => slotOf(g) === "bottom") || !lookShoe(pieces)) {
      return false;
    }
    if (!lookFitsOccasion(pieces, occasion, pool, house)) return false;
    if (season && !lookFitsSeason(pieces, season)) return false;
    if (color && !lookHasColor(pieces, color)) return false;
    if (banned.has(comboKey(pieces.map((p) => p.id)))) return false;
    if (house && !isLegal(pieces, { house, occasion, season: season ?? "fall", color: color || null })) return false;
    return true;
  };
  const withJacket = (core: Garment[], jacket: Garment): Garment[] | null => {
    if (core.some((p) => p.id === jacket.id)) return null;
    const next = [...core, jacket];
    if (isBlazerPiece(jacket)) {
      if (!lookAllowsBlazer(core, jacket, occasion, season, house)) return null;
    } else if (jacketBlocked(next, occasion, season, house)) return null;
    return next;
  };
  const acceptJacket = (core: Garment[], jacket: Garment): Garment[] | null => {
    const next = withJacket(core, jacket);
    if (!next) return null;
    if (lookClashes(next)) return null;
    if (!lookFitsOccasion(next, occasion, pool, house)) return null;
    if (house && !isLegal(next, { house, occasion, season: season ?? "fall" })) return null;
    return next;
  };
  const pushJackets = (core: Garment[]) => {
    if (draws.length >= drawLimit) return;
    for (const jacket of jackets) {
      if (draws.length >= drawLimit) break;
      const next = withJacket(core, jacket);
      if (next) pushDraw(next);
    }
    // Bare cores stay in the pool. If a jacket is required, pack() marks them demoted.
    if (draws.length >= drawLimit) return;
    pushDraw(core);
  };
  const draws: Garment[][] = [];
  const seenDraw = new Set<string>();
  const rawDraws: Garment[][] = [];
  const pushDraw = (pieces: Garment[]) => {
    const dressed = opts?.taste ? applyAtlas(pieces, opts.taste) : pieces;
    if (!dressed) {
      rawDraws.push(pieces);
      return;
    }
    if (house && !isLegal(dressed, { house, occasion, season: season ?? "fall", color: color || null })) return;
    if (!legal(dressed)) return;
    const key = comboKey(dressed.map((p) => p.id));
    if (seenDraw.has(key)) return;
    seenDraw.add(key);
    draws.push(dressed);
  };
  const stars = [...new Set(opts?.mustInclude ?? [])]
    .map((id) => byId.get(id))
    .filter((g): g is Garment => Boolean(g))
    .sort((a, b) => daysIdle(b) - daysIdle(a) || a.id.localeCompare(b.id));
  const starIds = new Set(stars.map((g) => g.id));
  const partner = (list: Garment[], offset: number, self: string) => {
    if (!list.length) return undefined;
    for (let k = 0; k < list.length && k < 24; k++) {
      const g = list[(offset + k) % list.length]!;
      if (g.id === self || starIds.has(g.id)) continue;
      return g;
    }
    return list.find((g) => g.id !== self);
  };
  for (let s = 0; s < stars.length && draws.length < cap; s++) {
    const star = stars[s]!;
    const slot = slotOf(star);
    for (let t = 0; t < 24; t++) {
      const off = salt0 + s * 5 + t;
      const top = slot === "top" || slot === "dress" ? star : partner(tops, off, star.id);
      const bot = slot === "bottom" ? star : partner(bottoms, off + 1, star.id);
      const shoe = slot === "footwear" ? star : partner(shoes, off + 2, star.id);
      if (!top || !bot || !shoe) continue;
      const core = [top, bot, shoe];
      if (slot === "outerwear") {
        const next = acceptJacket(core, star);
        if (next) pushDraw(next);
      } else if (slot === "top" || slot === "dress" || slot === "bottom" || slot === "footwear") {
        pushDraw(core);
      }
      if (draws.some((d) => d.some((p) => p.id === star.id))) break;
    }
  }
  const n = Math.max(topSrc.length, botSrc.length, shoeSrc.length, cap * 4);
  const drawLimit = cap * 4;
  for (let i = 0; i < n && draws.length < drawLimit; i++) {
    const top = topSrc[i % topSrc.length];
    const bot = botSrc[(i * 3 + salt0) % Math.max(botSrc.length, 1)];
    const shoe = shoeSrc[(i * 5 + salt0 * 2) % Math.max(shoeSrc.length, 1)];
    if (!top || !bot || !shoe) continue;
    const core = [top, bot, shoe];
    pushJackets(core);
  }
  if (house) {
    const shoeList = shoeSrc.length ? shoeSrc : shoes;
    const topList = topSrc.length ? topSrc : tops;
    const botList = botSrc.length ? botSrc : bottoms;
    const take = Math.min(Math.max(topList.length, botList.length, shoeList.length), 12);
    for (let i = 0; i < take; i++) {
      const top = topList[i % topList.length];
      const bot = botList[i % botList.length];
      const shoe = shoeList[i % shoeList.length];
      if (!top || !bot || !shoe) continue;
      if (new Set([top.id, bot.id, shoe.id]).size < 3) continue;
      const core = [top, bot, shoe];
      pushJackets(core);
    }
  }
  if (house) {
    /* A house row leads with the looks that are the house's own; the rest follow in draw order. */
    const own = draws.filter((pieces) => houseFingerprintOk(pieces, house, occasion, pool) && !housePieceBanned(pieces, house, occasion));
    const rest = draws.filter((pieces) => !own.includes(pieces));
    draws.splice(0, draws.length, ...own, ...rest);
  }
  if (!draws.length && rawDraws.length) {
    for (const pieces of rawDraws) {
      if (house && !isLegal(pieces, { house, occasion, season: season ?? "fall", color: color || null })) continue;
      if (!legal(pieces)) continue;
      const key = comboKey(pieces.map((p) => p.id));
      if (seenDraw.has(key)) continue;
      seenDraw.add(key);
      draws.push(pieces);
    }
  }
  let picks = 0;
  while (picks < RESHUFFLE_MAX_PICKS && draws.length < cap) {
    picks += 1;
    const ids = pickLook(pool, {
      occasion,
      weather,
      ...(season ? { season } : {}),
      salt: drawSeed(today, `week-strip:${occasion}:pick`, liveIdsKey(pool), salt0 * 100 + picks),
      house,
      taste: opts?.taste,
      excludeKeys: seenDraw,
      usedCount: opts?.usedCount,
      today,
    });
    const pieces = ids.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
    pushDraw(pieces);
  }

  type Strict = {
    uniqueIds: boolean;
    uniqueOuter: boolean;
    uniqueShoe: boolean;
    axes3: boolean;
  };

  const slotOwned = {
    top: tops.length,
    bottom: bottoms.length,
    footwear: shoes.length,
    outerwear: pool.filter((g) => slotOf(g) === "outerwear").length,
  };
  const pack = (strict: Strict, allowBanned = false): Look[] => {
    const row: Look[] = [];
    const used = new Set<string>();
    const seen = new Map<string, number>();
    const keys = new Set<string>();
    let cable = false;
    const exemptRepeat = repCaps().exempt;
    const lockedRepeat = (pieces: Garment[]) => {
      if (cap < 8) return false;
      for (const p of pieces) {
        if (exemptRepeat.has(p.id)) continue;
        const slot = wearCapSlot(p);
        if (!slot || slot === "outerwear") continue;
        if (slotOwned[slot] >= 8 && (seen.get(p.id) ?? 0) >= 1) return true;
      }
      return false;
    };
    for (const pieces of draws) {
      if (row.length >= cap) break;
      if (strict.uniqueIds && pieces.some((p) => used.has(p.id))) continue;
      if (lockedRepeat(pieces)) continue;
      if (
        !allowBanned &&
        house &&
        housePieceBanned(pieces, house, occasion) &&
        row.length < 3
      ) {
        continue;
      }
      const top = lookTop(pieces);
      if (top && isCreamCable(top) && cable) continue;
      const recipeId = matchRecipe(pieces, occasion, house);
      if (row.length) {
        const prev = row[row.length - 1]!;
        const prevP = prev.garmentIds.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
        const a = reshuffleAxes(prevP, prev.recipeId);
        const b = reshuffleAxes(pieces, recipeId);
        if (strict.axes3 && reshuffleAxesDiff(a, b) < 3) continue;
        if (knitColorTwin(prevP, pieces)) continue;
        if (strict.uniqueShoe) {
          const prevShoe = lookShoe(prevP);
          const shoe = lookShoe(pieces);
          if (prevShoe && shoe && shoeFamily(prevShoe) === shoeFamily(shoe)) continue;
        }
        if (strict.uniqueOuter) {
          const prevOuter = lookOuter(prevP);
          const outer = lookOuter(pieces);
          if (prevOuter && outer && outerKind(prevOuter) === outerKind(outer)) continue;
        }
      }
      const key = comboKey(pieces.map((p) => p.id));
      if (keys.has(key) || banned.has(key)) continue;
      keys.add(key);
      if (strict.uniqueIds) for (const p of pieces) used.add(p.id);
      for (const p of pieces) seen.set(p.id, (seen.get(p.id) ?? 0) + 1);
      if (top && isCreamCable(top)) cable = true;
      const jacketOn = pieces.some((g) => jacketWearSlot(g) === "outer");
      const demoted =
        season != null && jacketRequired(occasion, season, live?.f) && !jacketOn
          ? ("JKT-COV-1" as const)
          : undefined;
      row.push({
        id: `reshuffle_${occasion}_${row.length}_${key.replace(/\|/g, "_")}`,
        name: nameOf(pieces),
        occasion,
        garmentIds: pieces.map((p) => p.id),
        source: "ai",
        lookbook: false,
        recipeId,
        createdAt: `${todayISO()}T00:00:00.000Z`,
        demoted,
      });
    }
    return row;
  };

  const spreadJackets = (row: Look[]): Look[] => {
    if (!house || jackets.length < 2 || row.length < 2) return row;
    const next = row.map((look) => ({ ...look, garmentIds: [...look.garmentIds] }));
    const limit = Math.min(6, next.length);
    const claimed = new Set<string>();
    const outerOnce = cap >= 8 && slotOwned.outerwear >= 8;
    for (let i = 0; i < limit; i++) {
      const look = next[i]!;
      const pieces = look.garmentIds
        .map((id) => byId.get(id))
        .filter((g): g is Garment => Boolean(g));
      const current = pieces.find((g) => jackets.some((j) => j.id === g.id));
      if (current && !claimed.has(current.id)) {
        claimed.add(current.id);
        continue;
      }
      const want = jackets.find((j) => !claimed.has(j.id));
      if (!want) continue;
      if (outerOnce && next.some((other) => other !== look && other.garmentIds.includes(want.id))) continue;
      const core = pieces.filter((g) => !jackets.some((j) => j.id === g.id));
      const combined = acceptJacket(core, want);
      if (!combined) continue;
      look.garmentIds = combined.map((g) => g.id);
      const key = comboKey(look.garmentIds);
      look.id = `reshuffle_${occasion}_${i}_${key.replace(/\|/g, "_")}`;
      claimed.add(want.id);
    }
    return next;
  };
  const tagGaps = (row: Look[]): Look[] => {
    if (!house) return row;
    const spec = houseProfile(house);
    const missing = spec.requireOwned.some((token) => !profilePhraseHits(pool, token, occasion));
    const hardFlags = row.map((look) => {
      const pieces = look.garmentIds
        .map((id) => byId.get(id))
        .filter((g): g is Garment => Boolean(g));
      return isHardHouseLook(pieces, house, occasion, pool);
    });
    const hardCount = hardFlags.filter(Boolean).length;
    if (hardCount >= 3 && !missing) return row;
    const note = missing ? houseGapNote(house, pool, occasion) || spec.gap : spec.cardNote;
    if (!note) return row;
    return row.map((look, i) => (hardFlags[i] ? look : { ...look, gap: note }));
  };
  const finish = (row: Look[]) => tagGaps(spreadJackets(row));

  const phases: Strict[] = [
    { uniqueIds: true, uniqueOuter: true, uniqueShoe: true, axes3: true },
    { uniqueIds: true, uniqueOuter: false, uniqueShoe: true, axes3: true },
    { uniqueIds: true, uniqueOuter: false, uniqueShoe: false, axes3: true },
    { uniqueIds: true, uniqueOuter: false, uniqueShoe: false, axes3: false },
    { uniqueIds: false, uniqueOuter: false, uniqueShoe: false, axes3: false },
  ];
  let best: Look[] = [];
  for (const strict of phases) {
    const row = pack(strict);
    if (row.length > best.length) best = row;
    if (row.length >= cap) return finish(row);
  }
  return finish(best);
}

const WEEKS = new Map<string, Look[]>();

/**
 * 7 scarce-first spreads. Each id at most once in the week. Pool is livePool, not the book.
 * Same inputs (every garment field, both dates, the excluded keys, the counts, the house) give
 * the same week, so a repeat visit reuses it.
 */
export function buildWeek(
  garments: Garment[],
  today = todayNY(),
  opts?: { excludeKeys?: string[]; usedCount?: Map<string, number>; house?: House },
): Look[] {
  const used = [...(opts?.usedCount ?? new Map<string, number>()).entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const key = engineKey("week", [today, todayNY(), opts?.excludeKeys ?? [], used, opts?.house ?? null, garments]);
  const kept = WEEKS.get(key) ?? (engineStore()?.get(key) as Look[] | undefined);
  if (kept) return structuredClone(kept);
  const week = buildWeekFresh(garments, today, opts);
  WEEKS.set(key, structuredClone(week));
  if (WEEKS.size > 8) {
    const first = WEEKS.keys().next().value;
    if (first) WEEKS.delete(first);
  }
  engineStore()?.put(key, structuredClone(week));
  return week;
}

function buildWeekFresh(
  garments: Garment[],
  today: string,
  opts?: { excludeKeys?: string[]; usedCount?: Map<string, number>; house?: House },
): Look[] {
  const monday = mondayISO(today);
  const pool = lookbookPool(garments);
  const byId = new Map(pool.map((g) => [g.id, g]));
  const usedCount = opts?.usedCount ?? new Map<string, number>();
  const weightOf = (id: string) => weekWeight(usedCount.get(id) ?? 0);
  const weekUsed = new Set<string>();
  const out: Look[] = [];
  const keys = new Set<string>(opts?.excludeKeys ?? []);

  const available = () => pool.filter((g) => !weekUsed.has(g.id));
  const scarceTops = () =>
    available()
      .filter((g) => {
        const s = slotOf(g);
        return s === "top" || s === "dress";
      })
      .sort(
        (a, b) =>
          weightOf(b.id) - weightOf(a.id) ||
          daysIdle(b, today) - daysIdle(a, today) ||
          a.id.localeCompare(b.id),
      );

  const seed = drawSeed(today, `week-strip${opts?.house ? `:${opts.house}` : ""}`, liveIdsKey(pool));
  let turn = 0;
  const pushLook = (occ: Occasion, locked: string[], i: number): boolean => {
    const avail = available();
    const lockedOk = locked.filter((id) => !weekUsed.has(id) && byId.has(id));
    turn += 1;
    const ids = pickLook(avail, {
      occasion: occ,
      weather: weatherForOcc(occ),
      lockedIds: lockedOk,
      usedCount,
      house: opts?.house,
      salt: seed + turn,
      today,
      excludeKeys: keys,
      legalCombo: opts?.house
        ? (p) =>
            houseLegalCombo(p, opts.house, occ, undefined, pool) &&
            isLegal(p, { house: opts.house, occasion: occ, season: "fall" })
        : undefined,
    });
    let pieces = ids
      .map((id) => byId.get(id))
      .filter((x): x is Garment => x !== undefined && !weekUsed.has(x.id));
    const hero = lockedOk[0] ? byId.get(lockedOk[0]) : undefined;
    if (hero && !weekUsed.has(hero.id) && !pieces.some((p) => p.id === hero.id)) {
      const restP = pieces.filter((p) => {
        const s = slotOf(p);
        return s !== "top" && s !== "dress";
      });
      pieces = [hero, ...restP];
    }
    pieces = pieces.filter((p) => !weekUsed.has(p.id));
    if (pieces.length < 3 || lookClashes(pieces)) return false;
    if (!lookFitsOccasion(pieces, occ, avail) && lockedOk.length) return false;
    if (opts?.house && !isLegal(pieces, { house: opts.house, occasion: occ, season: "fall" })) return false;
    if (opts?.house && !houseLegalCombo(pieces, opts.house, occ, undefined, pool)) return false;
    const lookIds = pieces.map((p) => p.id);
    if (lookIds.some((id) => weekUsed.has(id))) return false;
    const key = comboKey(lookIds);
    if (keys.has(key)) return false;
    keys.add(key);
    for (const id of lookIds) weekUsed.add(id);
    const recipeId = matchRecipe(pieces, occ, opts?.house);
    out.push({
      id: `week_${monday}_${i}`,
      name: nameOf(pieces),
      occasion: occ,
      garmentIds: lookIds,
      source: "ai",
      lookbook: true,
      recipeId,
      createdAt: `${today}T00:00:00.000Z`,
    });
    return true;
  };

  for (let i = 0; i < 7; i++) {
    const occ = WEEK_ENERGIES[i]!;
    const top = scarceTops()[0];
    if (top && pushLook(occ, [top.id], i)) continue;
    pushLook(occ, [], i);
  }
  let pad = out.length;
  while (out.length < 7 && pad < 20) {
    const occ = WEEK_ENERGIES[out.length] ?? "weekday";
    pushLook(occ, [], out.length);
    pad += 1;
  }
  return out.slice(0, 7);
}

export function mergeWeekLooks(looks: Look[], week: Look[]): Look[] {
  return [...week, ...looks.filter((l) => !l.id.startsWith("week_"))];
}

export function unusedFromLooks(garments: Garment[], looks: Look[]): Garment[] {
  const pool = lookbookPool(garments);
  const used = new Set(looks.flatMap((l) => l.garmentIds));
  return pool
    .filter((g) => !used.has(g.id))
    .sort((a, b) => daysIdle(b) - daysIdle(a) || a.id.localeCompare(b.id));
}

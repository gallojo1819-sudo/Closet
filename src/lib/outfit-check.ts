/**
 * Outfit Check, the verdict engine. Pure: no React, no store, no model call, no writes.
 * Given the pieces of an outfit it says works / works with a jacket / doesn't / can't tell,
 * gives plain reasons, and suggests swaps and one alternative from the user's own closet.
 * The rules decide. No house, brand or rule id ever reaches an output string, and no
 * suggestion names a garment the user does not own.
 */
import type { Garment, Occasion, Season } from "./types.ts";
import { liveIdsKey } from "./daily-pick.ts";
import { drawOrder, drawSeed, lookWeight, rngFromSalt, type WeightCtx } from "./draw.ts";
import { livePool, isFakeName } from "./rack.ts";
import {
  clashes,
  coreComboKey,
  isShortsPiece,
  isTrueOuter,
  pickLook,
  pickTrueOuter,
  slotOf,
} from "./style.ts";
import { isOvercoatPiece, isSummerShirt, lookFitsSeason } from "./season.ts";
import { clashSentence } from "./detectors.ts";
import {
  DELETED_SNEAKERS,
  JACKET_COVER_IDS,
  legalWithJacket,
  needsJacketOnly,
  ruleFails,
  type LegalCtx,
  type RuleCtx,
} from "./stylist/legal.ts";
import { RULE_SENTENCES } from "./stylist/rule-copy.ts";
import { coatSharesLookWithGraphic, jacketInfo, jacketRequired, wearSlot } from "./stylist/jackets.ts";
import { todayNY } from "./utils.ts";
import {
  chipLabel,
  looksLikeFace,
  parseCropBox,
  sanitizeWornBoxes,
  slotFitsCategory,
  type CropBox,
  type ScanSlot,
  type WornBox,
} from "./scan.ts";
import { emptyTaste, pairingBlocked, pieceVetoIds, type TasteMemory } from "./taste.ts";

export type CheckCtx = {
  occasion: Occasion;
  season: Season;
  /** A measured reading only. Never defaulted. */
  weatherF?: number;
};

export type CheckState = "works" | "works_with_jacket" | "doesnt" | "cant_tell";

export type CheckVerdict = {
  state: CheckState;
  /** The one main line, plain words. */
  reason: string;
  /** At most three plain lines, deduped, main first. */
  reasons: string[];
  /** The owned jacket that finishes the look, as a safe piece name. */
  jacket?: string;
  /** Its id. For swaps and the caller; never shown. */
  jacketId?: string;
  /** For tests and logs. Never shown. */
  ruleIds: string[];
};

export type CheckSwap = {
  slot: "top" | "bottom" | "footwear" | "outerwear";
  outId: string;
  inId: string;
  line: string;
  ids: string[];
  state: "works" | "works_with_jacket";
  jacket?: string;
};

export type PhotoSlot = Exclude<ScanSlot, "accessory">;

export type PhotoPiece = {
  slot: PhotoSlot;
  name: string;
  colors: string[];
  subtype: string;
  material: string;
  pattern?: string;
  box: CropBox | null;
  ownedId: string | null;
  confidence: number;
};

/** A piece seen in the photo and not owned. Transient: never stored, never suggested. */
export type PhotoGarment = Garment & { photoOnly: true; confidence: number };

export const MIN_CONFIDENCE = 0.4;
export const FALLBACK_REASON = "These don't sit well together.";
export const NO_FIX = "Nothing in your closet fixes this look.";
export const WORKS_REASON = "This works.";
export const JACKET_REASON = "Cold enough for a jacket.";
export const NO_JACKET_REASON = "Cold enough for a jacket, and none of yours finishes this look.";
export const SLOTS_REASON = "One top, one bottom and one pair of shoes per look.";

/** The gaps.test.ts list. Case-sensitive, so "knit polo" passes. */
export const HOUSE_WORDS = /\b(Polo|Purple Label|RRL|ALD|Faloni|545|Sweet Stable|Italian summer|Italian winter|Ralph)\b/;
export const RULE_ID = /\b[A-Z]{2,5}-[A-Z0-9]+(?:-\d+)?\b/;

const PHOTO_PREFIX = "photo_";
const SLOT_CATEGORY: Record<PhotoSlot, Garment["category"]> = {
  top: "top",
  bottom: "bottom",
  outerwear: "outerwear",
  footwear: "footwear",
};
const SLOT_WORD: Record<string, string> = {
  top: "top",
  dress: "dress",
  bottom: "trousers",
  footwear: "shoes",
  outerwear: "jacket",
};

export function legalCtx(ctx: CheckCtx): LegalCtx {
  return {
    occasion: ctx.occasion,
    season: ctx.season,
    ...(ctx.weatherF !== undefined && Number.isFinite(ctx.weatherF) ? { weatherF: ctx.weatherF } : {}),
  };
}

/** The rule context Check judges with: the legal context, the closet and the user's vetoes. */
function ruleCtx(ctx: CheckCtx, pool: Garment[], taste?: TasteMemory): RuleCtx {
  return { ...legalCtx(ctx), pool: livePool(pool), taste };
}

export function isPhotoGarment(g: Pick<Garment, "id">): boolean {
  return g.id.startsWith(PHOTO_PREFIX);
}

function warmthFor(text: string): Garment["warmth"] {
  const t = text.toLowerCase();
  if (/cable|chunky|shearling|fleece|flannel|corduroy|cords?\b|tweed|parka|puffer|overcoat/.test(t)) return 4;
  if (/linen|seersucker/.test(t)) return 2;
  return 3;
}

export function photoGarment(piece: PhotoPiece, index: number): PhotoGarment {
  return {
    id: `${PHOTO_PREFIX}${index}`,
    name: piece.name,
    category: SLOT_CATEGORY[piece.slot],
    subtype: piece.subtype,
    colors: [...piece.colors],
    material: piece.material,
    brand: "",
    notes: piece.pattern ?? "",
    formality: 3,
    warmth: warmthFor(`${piece.name} ${piece.subtype} ${piece.material}`),
    seasons: [],
    imageSrc: "",
    cutoutSrc: "",
    imageSource: "photo",
    matteQuality: "ok",
    demo: false,
    wornOn: [],
    archived: false,
    createdAt: "",
    photoOnly: true,
    confidence: piece.confidence,
  };
}

/** Owned pieces become the closet's garments; anything else is a photo garment. */
export function lookFromPieces(pieces: PhotoPiece[], pool: Garment[]): Garment[] {
  const live = livePool(pool);
  return pieces.map((piece, i) => {
    const owned = piece.ownedId ? live.find((g) => g.id === piece.ownedId) : undefined;
    return owned ?? photoGarment(piece, i);
  });
}

export function allOwned(ids: string[], pool: Garment[]): boolean {
  const live = new Set(livePool(pool).map((g) => g.id));
  return ids.length > 0 && ids.every((id) => live.has(id));
}

/* ----------------------------- the model's read ----------------------------- */

const SLOT_WORDS: Record<string, PhotoSlot | "accessory" | null> = {
  top: "top",
  shirt: "top",
  knit: "top",
  sweater: "top",
  bottom: "bottom",
  bottoms: "bottom",
  trousers: "bottom",
  pants: "bottom",
  shorts: "bottom",
  skirt: "bottom",
  outerwear: "outerwear",
  outer: "outerwear",
  jacket: "outerwear",
  coat: "outerwear",
  footwear: "footwear",
  shoes: "footwear",
  shoe: "footwear",
  accessory: "accessory",
  accessories: "accessory",
};

function readSlot(raw: unknown): PhotoSlot | "accessory" | null {
  const key = String(raw ?? "").trim().toLowerCase();
  return SLOT_WORDS[key] ?? null;
}

function cleanName(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 48);
}

function readColors(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => String(c ?? "").trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 3);
}

function readConfidence(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0.5;
  return Math.min(1, Math.max(0, raw));
}

function parseJson(text: string): unknown {
  const stripped = text.replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = Math.min(
      ...[stripped.indexOf("{"), stripped.indexOf("[")].filter((i) => i >= 0),
    );
    const end = Math.max(stripped.lastIndexOf("}"), stripped.lastIndexOf("]"));
    if (!Number.isFinite(start) || end <= start) return null;
    try {
      return JSON.parse(stripped.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/** Validates the model's JSON read of a photo. Owned ids are checked against the closet. */
export function parseOutfitRead(text: string, pool: Garment[]): PhotoPiece[] {
  const data = parseJson(text);
  const rows: unknown[] = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { pieces?: unknown }).pieces)
      ? ((data as { pieces: unknown[] }).pieces)
      : [];
  const live = new Map(livePool(pool).map((g) => [g.id, g]));
  const deleted = new Set<string>(DELETED_SNEAKERS);
  const claimed = new Set<string>();
  const pieces: PhotoPiece[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const slot = readSlot(row.slot ?? row.category);
    if (!slot || slot === "accessory") continue;
    const name = cleanName(row.name ?? row.label);
    if (!name || isFakeName(name)) continue;
    const category = SLOT_CATEGORY[slot];
    const box = parseCropBox(row);
    if (looksLikeFace(name, category, box)) continue;
    let ownedId: string | null = null;
    const rawId = row.ownedId ?? row.id;
    if (typeof rawId === "string") {
      const owned = live.get(rawId);
      if (owned && !deleted.has(rawId) && slotFitsCategory(slot, owned.category) && !claimed.has(rawId)) {
        ownedId = rawId;
        claimed.add(rawId);
      }
    }
    pieces.push({
      slot,
      name,
      colors: readColors(row.colors),
      subtype: cleanName(row.subtype),
      material: cleanName(row.material),
      ...(typeof row.pattern === "string" && row.pattern.trim() ? { pattern: cleanName(row.pattern) } : {}),
      box,
      ownedId,
      confidence: readConfidence(row.confidence),
    });
  }
  const boxes: WornBox[] = pieces.map((p, i) => ({
    id: `${p.slot}-${i}`,
    name: p.name,
    chip: chipLabel(p.name, SLOT_CATEGORY[p.slot]),
    category: SLOT_CATEGORY[p.slot],
    slot: p.slot,
    box: p.box,
  }));
  const kept = sanitizeWornBoxes(boxes);
  const byKey = new Map<string, PhotoPiece>();
  for (const p of pieces) {
    const key = `${p.slot}:${chipLabel(p.name, SLOT_CATEGORY[p.slot]).toLowerCase()}`;
    if (!byKey.has(key)) byKey.set(key, p);
  }
  const out: PhotoPiece[] = [];
  for (const b of kept) {
    const p = byKey.get(`${b.slot}:${b.chip.toLowerCase()}`);
    if (p && !out.includes(p)) out.push({ ...p, box: b.box });
  }
  return out;
}

/* ----------------------------- safe words ----------------------------- */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function brandPatterns(pool: Garment[]): RegExp[] {
  const brands = new Set(pool.map((g) => (g.brand ?? "").trim()).filter(Boolean));
  return [...brands].map((b) => new RegExp(`\\b${escapeRegExp(b)}\\b`));
}

/** The string, or null when it names a house, a rule id, or a brand from the closet. */
export function safeText(s: string, pool: Garment[]): string | null {
  if (HOUSE_WORDS.test(s) || RULE_ID.test(s)) return null;
  for (const re of brandPatterns(pool)) if (re.test(s)) return null;
  return s;
}

function titleCase(s: string): string {
  const t = s.trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : "";
}

function slotWord(g: Garment): string {
  return SLOT_WORD[slotOf(g) ?? ""] ?? SLOT_WORD[g.category] ?? "piece";
}

/** A garment's name with no house, brand or rule id in it. */
export function pieceName(g: Garment, pool: Garment[]): string {
  const named = safeText(g.name.trim(), pool);
  if (named) return named;
  const colour = titleCase(g.colors[0] ?? "");
  const kind = (g.subtype || "").trim().toLowerCase() || slotWord(g);
  const described = safeText(`${colour} ${kind}`.trim(), pool);
  if (described) return described;
  return `your ${slotWord(g)}`;
}

/* ----------------------------- reasons ----------------------------- */

/** The plain sentence per rule id (stylist/rule-copy.ts). */
export const REASON_BY_RULE: Record<string, string> = RULE_SENTENCES;

const OCCASION_IDS = ["JKT-FORM-1", "JKT-FORM-2", "XC-TEX-3", "XC-TEX-8"];
const WEATHER_IDS = ["SEASON", "JKT-COV-2", "JKT-COV-3", "XC-SEA-1", "XC-SEA-2", "XC-SEA-3", "XC-SEA-4"];

function reasonRank(id: string): number {
  /* The chapter gate's sentence is the vaguest: the specific rules speak first, the missing jacket last. */
  if (id === "OCC-GATE") return 3;
  if (OCCASION_IDS.includes(id) || id.startsWith("OCC-")) return 0;
  if (WEATHER_IDS.includes(id) || id.startsWith("SEA-") || id === "WARMTH-FIT" || id === "WEATHER-LINEN-COLD") return 1;
  if (id === "CLASH") return 2;
  if (id === "JKT-COV-1") return 4;
  return 3;
}

/** Occasion first, weather next, the clash, then the rest. A missing jacket goes last. */
export function orderReasons(ids: string[]): string[] {
  const unique = [...new Set(ids)];
  return unique
    .map((id, i) => ({ id, i }))
    .sort((a, b) => reasonRank(a.id) - reasonRank(b.id) || a.i - b.i)
    .map((row) => row.id);
}

function seasonReason(look: Garment[], season: Season): string {
  const tops = look.filter((g) => slotOf(g) === "top" || slotOf(g) === "dress");
  if ((season === "fall" || season === "winter") && tops.some(isSummerShirt)) {
    return season === "fall" ? "A summer shirt in fall." : "A summer shirt in winter.";
  }
  if (season === "winter" && look.some(isShortsPiece)) return "Shorts in winter.";
  if (season === "summer" && look.some(isOvercoatPiece)) return "A heavy coat in summer.";
  return "One piece is out of season.";
}

function reasonLine(id: string, look: Garment[], season: Season): string | null {
  /* The season rules (SEA-PIECE: a piece out of season; SEA-FIT: the look's cloth) read as the specific sentence when one fits. */
  if (id === "SEASON" || id === "SEA-PIECE" || id === "SEA-FIT") return seasonReason(look, season);
  if (id === "CLASH") return clashSentence(look);
  return REASON_BY_RULE[id] ?? clashSentence(look) ?? FALLBACK_REASON;
}

/* ----------------------------- slots ----------------------------- */

type Worn = "top" | "mid" | "bottom" | "shoe" | "outer";

function wornSlot(g: Garment): Worn | null {
  const w = wearSlot(g);
  if (w) return w;
  const s = slotOf(g);
  if (s === "top" || s === "dress") return "top";
  if (s === "bottom") return "bottom";
  if (s === "footwear") return "shoe";
  if (s === "outerwear") return "outer";
  return null;
}

function slotCounts(look: Garment[]): Map<Worn, number> {
  const counts = new Map<Worn, number>();
  const tops = look.filter((g) => wornSlot(g) === "top");
  for (const g of look) {
    let w = wornSlot(g);
    if (!w) continue;
    /* The dual-use overshirt is the outer when it sits over another top. */
    if (w === "top" && jacketInfo(g).outerEligible && tops.length > 1 && !isPhotoGarment(g)) w = "outer";
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return counts;
}

function hasOuter(look: Garment[]): boolean {
  return look.some((g) => slotOf(g) === "outerwear");
}

function corePieces(look: Garment[]) {
  return {
    top: look.find((g) => slotOf(g) === "top" || slotOf(g) === "dress"),
    bottom: look.find((g) => slotOf(g) === "bottom"),
    shoe: look.find((g) => slotOf(g) === "footwear"),
  };
}

function colourReason(look: Garment[], pool: Garment[], weatherF?: number): string {
  const { top, bottom, shoe } = corePieces(look);
  const c = (g?: Garment) => (g?.colors[0] ?? "").trim().toLowerCase();
  let line = "The colours sit well together.";
  if (c(top) && c(bottom) && c(shoe)) {
    line = `${titleCase(c(top))} and ${c(bottom)} with ${c(shoe)} shoes: they sit well together.`;
  }
  if (weatherF !== undefined && Number.isFinite(weatherF)) line += ` Right for ${Math.round(weatherF)}°F.`;
  return safeText(line, pool) ?? WORKS_REASON;
}

function ownedOuters(pool: Garment[], taste: TasteMemory): Garment[] {
  const vetoed = pieceVetoIds(taste);
  return livePool(pool).filter(
    (g) => slotOf(g) === "outerwear" && isTrueOuter(g) && !vetoed.has(g.id) && !isPhotoGarment(g),
  );
}

function finishingJacket(
  look: Garment[],
  ctx: CheckCtx,
  pool: Garment[],
  taste: TasteMemory,
  today = todayNY(),
): Garment | undefined {
  const rc = ruleCtx(ctx, pool, taste);
  const fits = (p: Garment[]) => lookFitsSeason(p, ctx.season) && !pairingBlocked(p, taste);
  const outer = pickTrueOuter(ownedOuters(pool, taste), look, {
    ctx: rc,
    salt: drawSeed(today, `check:jacket:${look.map((g) => g.id).sort().join(",")}`, liveIdsKey(livePool(pool))),
    weights: { today },
    legalCombo: fits,
  });
  if (!outer || isPhotoGarment(outer)) return undefined;
  return fits([...look, outer]) && !ruleFails([...look, outer], rc).length ? outer : undefined;
}

/* ----------------------------- the verdict ----------------------------- */

/** The rules' verdict: works when every rule passes; works with a jacket when the jacket rules alone fail; doesn't otherwise, with the failing rules' sentences. */
export function checkVerdict(
  look: Garment[],
  ctx: CheckCtx,
  pool: Garment[],
  taste: TasteMemory = emptyTaste(),
): CheckVerdict {
  const rc = ruleCtx(ctx, pool, taste);
  const cantTell = (reason: string): CheckVerdict => ({ state: "cant_tell", reason, reasons: [reason], ruleIds: [] });

  if (look.some((g) => slotOf(g) === "dress" || g.category === "dress")) {
    return cantTell("This check can't read a dress yet.");
  }
  const { top, bottom, shoe } = corePieces(look);
  if (!shoe) return cantTell("No shoes in the photo.");
  if (!top) return cantTell("No top in the photo.");
  if (!bottom) return cantTell("No trousers or skirt in the photo.");
  const unclear = [top, bottom, shoe].some(
    (g) => isPhotoGarment(g) && (g as PhotoGarment).confidence < MIN_CONFIDENCE,
  );
  if (unclear) return cantTell("The photo is too unclear to tell.");

  if ([...slotCounts(look).values()].some((n) => n > 1)) {
    return { state: "doesnt", reason: SLOTS_REASON, reasons: [SLOTS_REASON], ruleIds: ["SLOTS"] };
  }

  const failed = ruleFails(look, rc);
  const inSeason = lookFitsSeason(look, ctx.season);
  if (!failed.length && inSeason) {
    const reason = colourReason(look, pool, ctx.weatherF);
    return { state: "works", reason, reasons: [reason], ruleIds: [] };
  }

  if (!hasOuter(look) && inSeason && needsJacketOnly(failed)) {
    const jacket = finishingJacket(look, ctx, pool, taste);
    if (jacket) {
      const name = pieceName(jacket, pool);
      const line = safeText(`Cold enough for a jacket. Add your ${name}.`, pool) ?? JACKET_REASON;
      return { state: "works_with_jacket", reason: line, reasons: [line], jacket: name, jacketId: jacket.id, ruleIds: ["JKT-COV-1"] };
    }
    if (failed.every((id) => id === "JKT-COV-1" || id === "XC-TEX-8")) {
      return { state: "doesnt", reason: NO_JACKET_REASON, reasons: [NO_JACKET_REASON], ruleIds: ["JKT-COV-1"] };
    }
  }

  const ids: string[] = failed.map((id) => (id === "GRAPHIC-COAT" ? "GRAPHIC_COAT" : id)).filter((id) => !JACKET_COVER_IDS.includes(id) || failed.length === 1);
  if (!inSeason) ids.push("SEASON");
  if (clashes(look) && !ids.includes("CLASH")) ids.push("CLASH");
  if (coatSharesLookWithGraphic(look) && !ids.includes("GRAPHIC_COAT")) ids.push("GRAPHIC_COAT");
  const ordered = orderReasons(ids);
  const lines: string[] = [];
  for (const id of ordered) {
    const line = reasonLine(id, look, ctx.season);
    if (!line) continue;
    const safe = safeText(line, pool) ?? FALLBACK_REASON;
    if (!lines.includes(safe)) lines.push(safe);
    if (lines.length >= 3) break;
  }
  if (!lines.length) lines.push(FALLBACK_REASON);
  return { state: "doesnt", reason: lines[0]!, reasons: lines, ruleIds: ordered };
}

/* ----------------------------- swaps ----------------------------- */

const SWAP_ORDER: CheckSwap["slot"][] = ["footwear", "top", "bottom", "outerwear"];

/**
 * Up to two swaps, one slot each: among the owned pieces whose swap makes the look pass the
 * rules, one is drawn by rotation weight (draw.ts), seeded by the day and the look.
 */
export function checkSwaps(
  look: Garment[],
  pool: Garment[],
  ctx: CheckCtx,
  taste: TasteMemory = emptyTaste(),
  n = 2,
  today = todayNY(),
): CheckSwap[] {
  const limit = Math.max(0, Math.min(2, Math.floor(n)));
  if (!limit) return [];
  if (checkVerdict(look, ctx, pool, taste).state !== "doesnt") return [];
  const live = livePool(pool);
  const vetoed = pieceVetoIds(taste);
  const deleted = new Set<string>(DELETED_SNEAKERS);
  const inLook = new Set(look.map((g) => g.id));
  const slotOfPiece = (g: Garment): CheckSwap["slot"] | null => {
    const s = slotOf(g);
    return s === "top" || s === "bottom" || s === "footwear" || s === "outerwear" ? s : null;
  };
  const present = look
    .map((g) => ({ g, slot: slotOfPiece(g) }))
    .filter((row): row is { g: Garment; slot: CheckSwap["slot"] } => Boolean(row.slot));
  const photoFirst = present.filter((row) => isPhotoGarment(row.g));
  const rest = present
    .filter((row) => !isPhotoGarment(row.g))
    .sort((a, b) => SWAP_ORDER.indexOf(a.slot) - SWAP_ORDER.indexOf(b.slot));
  const out: CheckSwap[] = [];
  const usedSlots = new Set<CheckSwap["slot"]>();
  const wctx: WeightCtx = { today };
  const rng = rngFromSalt(drawSeed(today, `check:swap:${look.map((g) => g.id).sort().join(",")}`, liveIdsKey(live)));
  for (const { g: outPiece, slot } of [...photoFirst, ...rest]) {
    if (out.length >= limit || usedSlots.has(slot)) continue;
    const passing: { swap: CheckSwap; pieces: Garment[] }[] = [];
    for (const cand of live) {
      if (cand.id === outPiece.id || inLook.has(cand.id) || isPhotoGarment(cand)) continue;
      if (vetoed.has(cand.id) || deleted.has(cand.id)) continue;
      if (slotOf(cand) !== slot) continue;
      if (slot === "outerwear" && !isTrueOuter(cand)) continue;
      const next = look.map((g) => (g.id === outPiece.id ? cand : g));
      if (pairingBlocked(next, taste)) continue;
      const v = checkVerdict(next, ctx, pool, taste);
      if (v.state !== "works" && v.state !== "works_with_jacket") continue;
      const jacket = v.jacketId ? live.find((g) => g.id === v.jacketId) : undefined;
      const full = jacket ? [...next, jacket] : next;
      const ids = full.map((g) => g.id);
      if (!allOwned(ids, pool)) continue;
      const outName = pieceName(outPiece, pool);
      const inName = pieceName(cand, pool);
      let line = `Swap the ${outName} for your ${inName}.`;
      if (jacket && v.jacket) line += ` Add your ${v.jacket}.`;
      if (!safeText(line, pool)) continue;
      passing.push({
        pieces: full,
        swap: {
          slot,
          outId: outPiece.id,
          inId: cand.id,
          line,
          ids,
          state: v.state,
          ...(jacket && v.jacket ? { jacket: v.jacket } : {}),
        },
      });
    }
    const drawn = drawOrder(passing, (row) => Math.max(lookWeight(row.pieces, wctx), Number.MIN_VALUE), rng)[0];
    if (drawn) {
      out.push(drawn.swap);
      usedSlots.add(slot);
    }
  }
  return out;
}

/* ----------------------------- the alternative ----------------------------- */

export function checkAlternative(
  look: Garment[],
  pool: Garment[],
  ctx: CheckCtx,
  taste: TasteMemory = emptyTaste(),
  now: Date = new Date(),
): { ids: string[]; kept: string[]; line: string } | null {
  const lc = legalCtx(ctx);
  const live = livePool(pool);
  const liveIds = new Set(live.map((g) => g.id));
  const vetoed = pieceVetoIds(taste);
  const deleted = new Set<string>(DELETED_SNEAKERS);
  const needOuter = jacketRequired(ctx.occasion, ctx.season, ctx.weatherF);
  const photoCore = coreComboKey(look.map((g) => g.id), [...pool, ...look]);
  const owned = (g?: Garment) => (g && !isPhotoGarment(g) && liveIds.has(g.id) ? g.id : null);
  const { top, bottom, shoe } = corePieces(look);
  const locks: string[][] = [];
  for (const id of [owned(top), owned(bottom), owned(shoe)]) if (id) locks.push([id]);
  locks.push([]);
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  for (const [i, lockedIds] of locks.entries()) {
    const ids = pickLook(live, {
      occasion: ctx.occasion,
      season: ctx.season,
      ...(ctx.weatherF !== undefined
        ? { weather: { f: ctx.weatherF, label: "", code: 0, measured: true } }
        : {}),
      lockedIds,
      legalCombo: (p) => lookFitsSeason(p, ctx.season) && legalWithJacket(p, lc),
      requireOuter: needOuter,
      salt: drawSeed(today, `check:alternative:${photoCore}`, liveIdsKey(live), i),
      excludeKeys: [photoCore],
      taste,
      today,
    });
    if (!ids.length) continue;
    if (!ids.every((id) => liveIds.has(id) && !deleted.has(id))) continue;
    const pieces = ids.map((id) => live.find((g) => g.id === id)).filter((g): g is Garment => Boolean(g));
    if (pieces.length !== ids.length) continue;
    if (ruleFails(pieces, ruleCtx(ctx, pool, taste)).length || !lookFitsSeason(pieces, ctx.season)) continue;
    if (needOuter && !hasOuter(pieces)) continue;
    if (pairingBlocked(pieces, taste)) continue;
    if (ids.some((id) => vetoed.has(id) && !lockedIds.includes(id))) continue;
    if (coreComboKey(ids, pool) === photoCore) continue;
    const line = `Or wear: ${pieces.map((g) => pieceName(g, pool)).join(", ")}.`;
    if (!safeText(line, pool)) return null;
    return { ids, kept: [...lockedIds], line };
  }
  return null;
}

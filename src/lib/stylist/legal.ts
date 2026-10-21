/**
 * One pass/fail rule check. A look passes or it does not; nothing here ranks. `isLegal` is the
 * hard core (one top, bottom and shoe; the clashes; the hard stylist, jacket, house and colour
 * hits). `passesRules` is that core plus every rule that used to be a soft delta, each treated
 * as a fail with its id: the stylist rules' soft hits (COL-*, XC-*), the jacket rules' soft
 * hits (JKT-*), the occasion, season, weather, pattern and colour checks Today's pick once
 * weighed (OCC-*, SEA-*, WARMTH-FIT, WEATHER-LINEN-COLD, PATTERN-SCALE, COLOR-HARMONY,
 * TREND-BLAZER-CASUAL) and the user's vetoes (VETO-*). `failed` names every rule a look trips,
 * so a rejection always explains itself. No numeric threshold anywhere. A few soft hits were
 * preferences rather than rules and are dropped (PREFERENCE_IDS, the house soft hits).
 *
 * The relax ladder (RELAX_TIERS) is for a surface that finds no passing look at all: the tiers
 * are dropped in a fixed order, colour and texture preferences first, then proportion; season,
 * weather, occasion, slot and clash checks are never relaxed. A caller passes the rules it has
 * relaxed in `ctx.relax` and reports them.
 */
import { harmony } from "../color.ts";
import { lookFitsOccasion } from "../occasion-gate.ts";
import { clashes, occasionFails, sameScaleChecks, seasonFails, slotOf, trendFails } from "../style.ts";
import type { Garment, Occasion, Season } from "../types.ts";
import type { House } from "../houses.ts";
import { approvedProfile } from "../house-profiles/load.ts";
import { assignSlots, evaluatePlates, gateOff, type EvalResult, type Plate } from "../house-profiles/evaluate.ts";
import { pairingBlocked, pieceVetoIds, type TasteMemory } from "../taste.ts";
import { evaluateColor } from "./colorChip.ts";
import { piecesFromIds, stylistHits, type StylistHit } from "./rules.ts";
import { coatSharesLookWithGraphic, isJacketAddition, jacketHits, jacketRequired, slotPieces, supersededStylist, wearSlot } from "./jackets.ts";
import { DELETED_SET, DELETED_SNEAKERS } from "./deleted.ts";

export { DELETED_SNEAKERS };
const DELETED = DELETED_SET;

export type LegalCtx = {
  house?: House | null;
  occasion: Occasion | string;
  season?: Season | string;
  color?: string | null;
  /** A measured reading. Omitted when the service has no temperature. Never invented. */
  weatherF?: number;
  /** Display fill for a gated house. The gate note stays; the outfits still have to be legal. */
  ignoreGate?: boolean;
};

/** passesRules' context: the legal context, the pool (for the rules that read it), the taste vetoes and the relaxed rules. */
export type RuleCtx = LegalCtx & {
  pool?: readonly Garment[];
  taste?: TasteMemory;
  /** Pieces a user locked: a locked piece is not refused by its own veto. */
  lockedIds?: Iterable<string>;
  /** Rule ids waived by the relax ladder. */
  relax?: Iterable<string>;
};

export type RuleVerdict = { pass: boolean; failed: string[] };

/**
 * Rule ids a jacket may put right: a bare core whose only fails are these is a core an outer
 * may finish (the finished look is checked in full). The jacket-day rules, the cold-night
 * layer, the winter upper-body warmth and the outermost layer's weight.
 */
export const JACKET_COVER_IDS: readonly string[] = ["JKT-COV-1", "XC-TEX-8", "XC-SEA-2", "WARMTH-FIT"];

/**
 * The pass-list: soft hits that pass the rules rather than fail them. Only a soft hit is read
 * here; the hard hit of the same id still fails.
 *  - JKT-COV-1 soft (jackets.ts: "jacket preferred" on a fall weekend or travel day, "waived
 *    above 72F" on a weekday or out). Joe confirmed 2026-10-19: a preference, not a rule; as a
 *    fail it forced a jacket on every such look. The hard hit, the jacket day proper, still
 *    fails a bare core.
 *  - JKT-LAY-3 soft (jackets.ts: ecru or mid-wash clean jeans with a sport coat). Joe
 *    2026-10-18: "jeans can go with blazer sometimes if it works"; 2026-10-19: it passes and
 *    draws at half odds (JEANS_BLAZER_ODDS in draw.ts). Light-wash, white, striped, distressed
 *    and lounge stay hard.
 * Two more Joe-kept passes are not hits at all any more: XC-SEA-3's cold-weather mule in fall
 * and XC-TEX-4's tassel-loafer half were deleted in rules.ts (Joe 2026-10-15, confirmed
 * 2026-10-19), and JKT-LAY-2's soft cases (a tee under a soft sport coat, a zip knit, cardigan,
 * resort shirt or unrated top under a sport coat) pass in underHit (jackets.ts), which fails a
 * chunky or cable knit, the graphic or collegiate cases, and a plain tee or henley under a
 * structured sport coat.
 */
export const PREFERENCE_IDS: ReadonlySet<string> = new Set(["JKT-COV-1", "JKT-LAY-3"]);

/**
 * The relax ladder: tiers of rule ids a surface with no passing look may waive, in this order.
 * Colour preferences first, then texture and formality, then proportion. Nothing else is ever
 * waived: not season, weather, occasion, the slots or the clashes.
 */
export const RELAX_TIERS: readonly { id: string; rules: readonly string[] }[] = [
  { id: "colour", rules: ["COLOR-HARMONY", "COL-5", "COL-13", "COL-12", "COL-11", "COL-9", "COL-10", "COL-7", "COL-8", "XC-DEN-1"] },
  {
    id: "texture",
    rules: ["PATTERN-SCALE", "XC-PAT-1", "XC-TEX-7", "XC-TEX-9", "XC-TEX-6", "XC-TEX-5", "XC-TEX-3", "JKT-LAY-7", "JKT-FORM-2", "JKT-LAY-3", "JKT-LAY-4", "JKT-FORM-1", "TREND-BLAZER-CASUAL", "VETO-PAIR"],
  },
  { id: "proportion", rules: ["XC-PROP-2", "XC-PROP-1"] },
];

export function deletedSneaker(ids: string[]): boolean {
  return ids.some((id) => DELETED.has(id));
}

function seasonOf(ctx: LegalCtx): string {
  return ctx.season || "fall";
}

export function slottedPieces(pieces: Garment[]): Partial<Record<string, Plate>> {
  return slotPieces(pieces);
}

function slotted(pieces: Garment[]): Partial<Record<string, Plate>> {
  return slottedPieces(pieces);
}

function measuredF(ctx: LegalCtx): number | undefined {
  const n = ctx.weatherF;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function activeHits(ps: Partial<Record<string, Plate>>, ctx: LegalCtx): StylistHit[] {
  const season = seasonOf(ctx);
  const stylist = stylistHits(ps, ctx.occasion, season, ctx.house ?? undefined).filter((h) => !supersededStylist(h));
  const weatherF = measuredF(ctx);
  const jacket = jacketHits(ps, {
    occasion: String(ctx.occasion),
    season,
    house: ctx.house ?? undefined,
    ...(weatherF !== undefined ? { tempF: weatherF } : {}),
  });
  return [...stylist, ...jacket];
}

/** House hard-fails caused only by an overlay jacket are not illegal. The soft hits are listed beside them. */
function houseVerdict(ps: Partial<Record<string, Plate>>, ctx: LegalCtx): { passed: boolean; eval?: EvalResult } {
  if (!ctx.house) return { passed: true };
  const profile = ctx.house ? approvedProfile(ctx.house) : undefined;
  if (!profile) return { passed: false };
  const season = seasonOf(ctx);
  if (!ctx.ignoreGate && gateOff(profile as never, { occasion: ctx.occasion, season })) return { passed: false };
  const evalCtx = { occasion: ctx.occasion, season };
  let ev = evaluatePlates(profile as never, ps, evalCtx);
  const outer = ps.outer;
  if (!ev.passed && outer && isJacketAddition(ctx.house, outer.id, season)) {
    const bare: Partial<Record<string, Plate>> = { ...ps, outer: undefined };
    const without = evaluatePlates(profile as never, bare, evalCtx);
    const keep = ev.hardFails.filter((id) => without.hardFails.includes(id));
    ev = { ...ev, hardFails: keep, passed: keep.length === 0 };
  }
  return { passed: ev.passed, eval: ev };
}

export function isLegal(pieces: Garment[], ctx: LegalCtx): boolean {
  if (pieces.length < 3) return false;
  if (coatSharesLookWithGraphic(pieces)) return false;
  if (deletedSneaker(pieces.map((p) => p.id))) return false;
  if (clashes(pieces)) return false;
  const ps = slotted(pieces);
  if (!ps.top || !ps.bottom || !ps.shoe) return false;
  if (!houseVerdict(ps, ctx).passed) return false;
  if (activeHits(ps, ctx).some((h) => h.severity === "hard")) return false;
  if (ctx.color) {
    const col = evaluateColor(ps, ctx.color, ctx.house ?? undefined);
    if (!col.passed) return false;
  }
  return true;
}

/** Worn slot counts: a second top is the mid; a second bottom, shoe or outer is one too many. */
function slotsOverfull(pieces: Garment[]): boolean {
  const counts = new Map<string, number>();
  for (const g of pieces) {
    const w = wearSlot(g) ?? slotOf(g) ?? "";
    const slot = w === "outerwear" ? "outer" : w === "footwear" ? "shoe" : w === "dress" ? "top" : w;
    if (!slot || slot === "accessory") continue;
    counts.set(slot, (counts.get(slot) ?? 0) + 1);
  }
  if ((counts.get("bottom") ?? 0) > 1 || (counts.get("shoe") ?? 0) > 1) return true;
  /* A top, a mid and an outer-eligible dual piece are the most layers a look holds. */
  const layers = (counts.get("top") ?? 0) + (counts.get("mid") ?? 0) + (counts.get("outer") ?? 0);
  if (layers > 3) return true;
  if ((counts.get("outer") ?? 0) > 1) return true;
  return false;
}

export type RuleHits = {
  /** The hard rules the look trips: never waived. */
  hard: string[];
  /** The rules that were soft deltas, now fails: the relax ladder may waive these, in tier order. */
  soft: string[];
};

/**
 * Every rule a look trips, in a stable order, hard and soft apart. Same rejects as isLegal
 * first (hard), then the rules that were soft deltas (soft), then the named checks Today's pick
 * once weighed (occasion, season and weather are hard: the ladder never waives them; pattern
 * scale, colour harmony and the blazer-casual check are soft).
 */
export function ruleHits(pieces: Garment[], ctx: RuleCtx): RuleHits {
  const hard: string[] = [];
  const soft: string[] = [];
  const pushHard = (id: string) => {
    if (!hard.includes(id)) hard.push(id);
  };
  const pushSoft = (id: string) => {
    if (!soft.includes(id) && !hard.includes(id)) soft.push(id);
  };
  const ps = slotted(pieces);
  if (pieces.length < 3 || !ps.top || !ps.bottom || !ps.shoe) pushHard("SLOTS");
  if (new Set(pieces.map((p) => p.id)).size !== pieces.length || slotsOverfull(pieces)) pushHard("SLOTS");
  if (deletedSneaker(pieces.map((p) => p.id))) pushHard("DELETED");
  if (clashes(pieces)) pushHard("CLASH");
  if (coatSharesLookWithGraphic(pieces)) pushHard("GRAPHIC-COAT");
  const verdict = houseVerdict(ps, ctx);
  if (ctx.house && !verdict.passed) {
    for (const id of verdict.eval?.hardFails ?? []) pushHard(id);
    if (!verdict.eval) pushHard("HOUSE-GATE");
  }
  /* A house's soft hits ranked its looks; with no ranking they are preferences and do not fail a look (the hard house fails above still do). */
  for (const hit of activeHits(ps, ctx)) {
    if (hit.severity === "soft" && PREFERENCE_IDS.has(hit.id)) continue;
    (hit.severity === "hard" ? pushHard : pushSoft)(hit.id);
  }
  if (ctx.color) {
    const col = evaluateColor(ps, ctx.color, ctx.house ?? undefined);
    for (const id of col.hardFails) pushHard(id);
    for (const [id] of col.soft) pushSoft(id);
  }
  const season = seasonOf(ctx) as Season;
  const occasion = String(ctx.occasion) as Occasion;
  const f = measuredF(ctx);
  /* The chapter's own gate (occasion-gate.ts): what weekday, out, weekend, comfy and travel admit. */
  if (!lookFitsOccasion(pieces, occasion, ctx.pool, ctx.house ?? undefined, { wideWeekdayTops: true })) pushHard("OCC-GATE");
  for (const id of occasionFails(pieces, occasion, f)) pushHard(id);
  for (const id of seasonFails(pieces, season, f, ctx.pool)) pushHard(id);
  if (sameScaleChecks(pieces)) pushSoft("PATTERN-SCALE");
  if (harmony(pieces, { occasion, ...(f !== undefined ? { f } : {}) }) < 0) pushSoft("COLOR-HARMONY");
  for (const id of trendFails(pieces)) pushSoft(id);
  if (ctx.taste) {
    const locked = new Set(ctx.lockedIds ?? []);
    const vetoed = pieceVetoIds(ctx.taste);
    if (pieces.some((g) => vetoed.has(g.id) && !locked.has(g.id))) pushHard("VETO-PIECE");
    if (pairingBlocked(pieces, ctx.taste) && !pieces.some((g) => locked.has(g.id))) pushSoft("VETO-PAIR");
  }
  const soft2 = soft.filter((id) => !hard.includes(id));
  return { hard, soft: soft2 };
}

/**
 * Every rule id a look trips, in a stable order; empty when it passes. The soft rules named
 * in `ctx.relax` are waived; a hard rule never is.
 */
export function ruleFails(pieces: Garment[], ctx: RuleCtx): string[] {
  const hits = ruleHits(pieces, ctx);
  const relax = new Set(ctx.relax ?? []);
  return [...hits.hard, ...(relax.size ? hits.soft.filter((id) => !relax.has(id)) : hits.soft)];
}

/** The pass/fail verdict: pass when no rule trips; `failed` lists every rule that did. */
export function passesRules(pieces: Garment[], ctx: RuleCtx): RuleVerdict {
  const failed = ruleFails(pieces, ctx);
  return { pass: failed.length === 0, failed };
}

/** The ladder's tiers, each cumulative: [] (strict), the colour rules, then texture, then proportion. */
export function relaxTiers(): readonly (readonly string[])[] {
  const out: (readonly string[])[] = [[]];
  for (const tier of RELAX_TIERS) out.push([...out[out.length - 1]!, ...tier.rules]);
  return out;
}

/**
 * The rules a single piece trips on its own, whatever it is worn with: the per-piece occasion
 * and season checks and the deleted list. None of them is ever waived, so a draw can pass such
 * a piece over without a search.
 */
export function pieceRuleFails(g: Garment, ctx: RuleCtx): string[] {
  const ids: string[] = [];
  if (deletedSneaker([g.id])) ids.push("DELETED");
  const occasion = String(ctx.occasion) as Occasion;
  const season = seasonOf(ctx) as Season;
  for (const id of occasionFails([g], occasion, measuredF(ctx))) if (id !== "OCC-COMFY-COSTUME" && id !== "OCC-OUT-CAMP-UNTUCKED") ids.push(id);
  for (const id of seasonFails([g], season, undefined, undefined)) if (id !== "SEA-FIT" && id !== "WARMTH-FIT") ids.push(id);
  if (ctx.taste && !new Set(ctx.lockedIds ?? []).has(g.id) && pieceVetoIds(ctx.taste).has(g.id)) ids.push("VETO-PIECE");
  return ids;
}

/** A bare core that fails only because the day asks for a jacket: an outer may still finish it. */
export function needsJacketOnly(failed: readonly string[]): boolean {
  return failed.length > 0 && failed.every((id) => JACKET_COVER_IDS.includes(id));
}

/**
 * A core with no jacket whose only hard problem is JKT-COV-1 (and a house rule that
 * merely requires an outer). Used to demote a card instead of shipping it bare.
 */
export function missingJacketOnly(pieces: Garment[], ctx: LegalCtx): boolean {
  if (pieces.length < 3) return false;
  if (deletedSneaker(pieces.map((p) => p.id))) return false;
  if (clashes(pieces)) return false;
  const ps = slotted(pieces);
  if (!ps.top || !ps.bottom || !ps.shoe || ps.outer) return false;
  const hits = activeHits(ps, ctx);
  if (hits.some((h) => h.severity === "hard" && h.id !== "JKT-COV-1")) return false;
  if (!hits.some((h) => h.id === "JKT-COV-1" && h.severity === "hard")) return false;
  if (!ctx.house) return true;
  const profile = ctx.house ? approvedProfile(ctx.house) : undefined;
  if (!profile) return false;
  const season = seasonOf(ctx);
  if (!ctx.ignoreGate && gateOff(profile as never, { occasion: ctx.occasion, season })) return false;
  const ev = evaluatePlates(profile as never, ps, { occasion: ctx.occasion, season });
  const outerRules = new Set(
    ((profile as { pairing_rules?: { type?: string; id?: string }[] }).pairing_rules ?? [])
      .filter((pr) => pr.type === "requires_outer" && pr.id)
      .map((pr) => String(pr.id)),
  );
  return ev.hardFails.every((id) => outerRules.has(id));
}

/**
 * Legal as worn, or a bare core whose only hard miss is the jacket on a day that needs one.
 * Today and Check share this. The jacket itself is chosen by the caller.
 */
export function legalWithJacket(pieces: Garment[], ctx: LegalCtx): boolean {
  if (isLegal(pieces, ctx)) return true;
  return (
    jacketRequired(String(ctx.occasion), seasonOf(ctx), measuredF(ctx)) &&
    !pieces.some((g) => slotOf(g) === "outerwear") &&
    missingJacketOnly(pieces, ctx)
  );
}

export function explain(
  pieces: Garment[],
  ctx: LegalCtx,
): { legal: boolean; house?: EvalResult; hits: StylistHit[]; colorNote: string | null } {
  const ps = slotted(pieces);
  const verdict = houseVerdict(ps, ctx);
  const hits = activeHits(ps, ctx);
  const col = ctx.color ? evaluateColor(ps, ctx.color, ctx.house ?? undefined) : null;
  const legal =
    !coatSharesLookWithGraphic(pieces) &&
    !deletedSneaker(pieces.map((p) => p.id)) &&
    !clashes(pieces) &&
    Boolean(ps.top && ps.bottom && ps.shoe) &&
    verdict.passed &&
    !hits.some((h) => h.severity === "hard") &&
    (!col || col.passed);
  return { legal, house: verdict.eval, hits, colorNote: col?.note ?? null };
}

export function slotsOf(pieces: Plate[]): Partial<Record<string, Plate>> {
  return assignSlots(pieces);
}

export function hitsForIds(
  look: Record<string, string | undefined>,
  by: Map<string, Plate>,
  occ: string,
  season: string,
  house?: string | null,
): StylistHit[] {
  return stylistHits(piecesFromIds(look, by), occ, season, house);
}

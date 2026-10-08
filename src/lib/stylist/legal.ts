/**
 * One legality check and one rank. A house chip never borrows another house's row.
 */
import { clashes } from "../style.ts";
import { seasonRank } from "../season.ts";
import type { Garment, Occasion, Season } from "../types.ts";
import type { House } from "../houses.ts";
import { approvedProfile } from "../house-profiles/load.ts";
import {
  assignSlots,
  evaluatePlates,
  gateOff,
  rankBonus,
  type EvalResult,
  type Plate,
} from "../house-profiles/evaluate.ts";
import { evaluateColor } from "./colorChip.ts";
import { piecesFromIds, stylistHits, type StylistHit } from "./rules.ts";
import { coatSharesLookWithGraphic, isJacketAddition, jacketHits, slotPieces, supersededStylist } from "./jackets.ts";

export const DELETED_SNEAKERS = ["g_37e5eqjwgd3d", "g_c6qdv5c3gkor", "g_x0ro1mg2gu0a"] as const;
const DELETED = new Set<string>(DELETED_SNEAKERS);

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

function softDelta(hits: StylistHit[]): number {
  return hits.reduce((sum, h) => (h.severity === "soft" ? sum + h.delta : sum), 0);
}

/** House hard-fails caused only by an overlay jacket are not illegal. The soft penalties stay. */
function houseVerdict(
  ps: Partial<Record<string, Plate>>,
  ctx: LegalCtx,
): { passed: boolean; eval?: EvalResult; score: number } {
  if (!ctx.house) return { passed: true, score: 0 };
  const profile = ctx.house ? approvedProfile(ctx.house) : undefined;
  if (!profile) return { passed: false, score: Number.NEGATIVE_INFINITY };
  const season = seasonOf(ctx);
  if (!ctx.ignoreGate && gateOff(profile as never, { occasion: ctx.occasion, season })) {
    return { passed: false, score: Number.NEGATIVE_INFINITY };
  }
  const evalCtx = { occasion: ctx.occasion, season };
  let ev = evaluatePlates(profile as never, ps, evalCtx);
  const outer = ps.outer;
  if (!ev.passed && outer && isJacketAddition(ctx.house, outer.id, season)) {
    const bare: Partial<Record<string, Plate>> = { ...ps, outer: undefined };
    const without = evaluatePlates(profile as never, bare, evalCtx);
    const keep = ev.hardFails.filter((id) => without.hardFails.includes(id));
    ev = { ...ev, hardFails: keep, passed: keep.length === 0 };
  }
  if (!ev.passed) return { passed: false, eval: ev, score: Number.NEGATIVE_INFINITY };
  const soft = ev.soft.reduce((sum, [, d]) => sum + d, 0);
  const score = 10 * ev.minSignalGroups + soft + rankBonus(profile as never, ps, evalCtx);
  return { passed: true, eval: ev, score };
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

/** Same rejects as isLegal, then the rank. Illegal is -Infinity. */
export function scoreLook(pieces: Garment[], ctx: LegalCtx): number {
  if (pieces.length < 3) return Number.NEGATIVE_INFINITY;
  if (coatSharesLookWithGraphic(pieces)) return Number.NEGATIVE_INFINITY;
  if (deletedSneaker(pieces.map((p) => p.id))) return Number.NEGATIVE_INFINITY;
  if (clashes(pieces)) return Number.NEGATIVE_INFINITY;
  const ps = slotted(pieces);
  if (!ps.top || !ps.bottom || !ps.shoe) return Number.NEGATIVE_INFINITY;
  return rankLook(pieces, ctx);
}

export function rankLook(pieces: Garment[], ctx: LegalCtx): number {
  const ps = slotted(pieces);
  const season = seasonOf(ctx) as Season;
  let score = seasonRank(pieces, season);
  /* A season clash is a reject, not a penalty. The matrix drops the look. */
  if (score < 0) return Number.NEGATIVE_INFINITY;
  const verdict = houseVerdict(ps, ctx);
  if (!verdict.passed) return Number.NEGATIVE_INFINITY;
  score += verdict.score;
  const hits = activeHits(ps, ctx);
  if (hits.some((h) => h.severity === "hard")) return Number.NEGATIVE_INFINITY;
  score += softDelta(hits);
  if (ctx.color) {
    const col = evaluateColor(ps, ctx.color, ctx.house ?? undefined);
    if (!col.passed) return Number.NEGATIVE_INFINITY;
    score += col.soft.reduce((s, [, d]) => s + d, 0);
  }
  return score;
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

/**
 * One legality check and one rank. A house chip never borrows another house's row.
 */
import { clashes } from "../style.ts";
import { seasonRank } from "../season.ts";
import type { Garment, Occasion, Season } from "../types.ts";
import type { House } from "../houses.ts";
import { APPROVED } from "../house-profiles/load.ts";
import {
  assignSlots,
  evaluatePlates,
  gateOff,
  scorePlates,
  type EvalResult,
  type Plate,
} from "../house-profiles/evaluate.ts";
import { evaluateColor } from "./colorChip.ts";
import { piecesFromIds, stylistHits, stylistSoftDelta, type StylistHit } from "./rules.ts";

export const DELETED_SNEAKERS = ["g_37e5eqjwgd3d", "g_c6qdv5c3gkor", "g_x0ro1mg2gu0a"] as const;
const DELETED = new Set<string>(DELETED_SNEAKERS);

export type LegalCtx = {
  house?: House | null;
  occasion: Occasion | string;
  season?: Season | string;
  color?: string | null;
};

export function deletedSneaker(ids: string[]): boolean {
  return ids.some((id) => DELETED.has(id));
}

export function isLegal(pieces: Garment[], ctx: LegalCtx): boolean {
  if (pieces.length < 3) return false;
  if (deletedSneaker(pieces.map((p) => p.id))) return false;
  if (clashes(pieces)) return false;
  const ps = assignSlots(pieces);
  if (!ps.top || !ps.bottom || !ps.shoe) return false;
  const season = ctx.season || "fall";
  if (ctx.house) {
    const profile = APPROVED[ctx.house];
    if (!profile) return false;
    if (gateOff(profile as never, { occasion: ctx.occasion, season })) return false;
    const ev = evaluatePlates(profile as never, ps, { occasion: ctx.occasion, season });
    if (!ev.passed) return false;
  }
  const hits = stylistHits(ps, ctx.occasion, season, ctx.house ?? undefined);
  if (hits.some((h) => h.severity === "hard")) return false;
  if (ctx.color) {
    const col = evaluateColor(ps, ctx.color, ctx.house ?? undefined);
    if (!col.passed) return false;
  }
  return true;
}

export function explain(
  pieces: Garment[],
  ctx: LegalCtx,
): { legal: boolean; house?: EvalResult; hits: StylistHit[]; colorNote: string | null } {
  const ps = assignSlots(pieces);
  const season = ctx.season || "fall";
  const house = ctx.house ? evaluatePlates(APPROVED[ctx.house] as never, ps, { occasion: ctx.occasion, season }) : undefined;
  const hits = stylistHits(ps, ctx.occasion, season, ctx.house ?? undefined);
  const col = ctx.color ? evaluateColor(ps, ctx.color, ctx.house ?? undefined) : null;
  const legal =
    !deletedSneaker(pieces.map((p) => p.id)) &&
    !clashes(pieces) &&
    Boolean(ps.top && ps.bottom && ps.shoe) &&
    (!house || house.passed) &&
    !hits.some((h) => h.severity === "hard") &&
    (!col || col.passed);
  return { legal, house, hits, colorNote: col?.note ?? null };
}

export function rankLook(pieces: Garment[], ctx: LegalCtx): number {
  const ps = assignSlots(pieces);
  const season = (ctx.season || "fall") as Season;
  let score = seasonRank(pieces, season);
  if (ctx.house) {
    const profile = APPROVED[ctx.house];
    const house = scorePlates(profile as never, ps, { occasion: ctx.occasion, season });
    if (!house.eval.passed) return Number.NEGATIVE_INFINITY;
    score += house.score;
  }
  const hits = stylistHits(ps, ctx.occasion, season, ctx.house ?? undefined);
  if (hits.some((h) => h.severity === "hard")) return Number.NEGATIVE_INFINITY;
  score += stylistSoftDelta(hits);
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

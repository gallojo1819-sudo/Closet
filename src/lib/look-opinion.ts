/**
 * The Suggest builder's verdict: the rules' pass/fail result in plain words. "Passes the rules."
 * when every rule passes (passesRules); otherwise "Fails: <the first rule's sentence>" with every
 * failing rule's sentence beside it. A better piece is one swap, drawn among the owned pieces
 * whose swap passes, never a ranked one. Pure: relative imports only, no React, no store.
 */
import { liveIdsKey } from "./daily-pick.ts";
import { drawOrder, drawSeed, pieceWeight, rngFromSalt, type WeightCtx } from "./draw.ts";
import { slotOf } from "./style.ts";
import { passesRules, type RuleCtx } from "./stylist/legal.ts";
import { ruleSentence } from "./stylist/rule-copy.ts";
import { pairingBlocked, pieceVetoIds, type TasteMemory } from "./taste.ts";
import type { Garment, Occasion, Season } from "./types.ts";
import type { House } from "./houses.ts";
import { todayNY } from "./utils.ts";

export type OpinionSlot = "top" | "bottom" | "footwear" | "outerwear";

export type OpinionSwap = {
  id: string;
  slot: OpinionSlot;
  line: string;
};

export const PASSES_LINE = "Passes the rules.";
export const FAILS_PREFIX = "Fails: ";

export type LookOpinion = {
  /** PASSES_LINE, or FAILS_PREFIX and the first failing rule's sentence. */
  headline: string;
  /** The failing rules' sentences, one line each; the pass line when none. */
  reason: string;
  /** The failing rule ids, for tests and logs. Never shown. */
  failed: string[];
  house: House | null;
  swaps: OpinionSwap[];
  stuck: string | null;
};

function slotOfPiece(g: Garment): OpinionSlot | null {
  const s = slotOf(g);
  if (s === "top" || s === "dress") return "top";
  if (s === "bottom" || s === "footwear" || s === "outerwear") return s;
  return null;
}

function skipped(pieces: Garment[], taste?: TasteMemory): boolean {
  if (!taste) return false;
  if (pieces.some((g) => pieceVetoIds(taste).has(g.id))) return true;
  return pairingBlocked(pieces, taste);
}

/** One swap, drawn by rotation weight among the owned pieces whose swap passes the rules. */
function oneSwap(pieces: Garment[], pool: Garment[], taste: TasteMemory | undefined, ctx: RuleCtx, today: string): OpinionSwap | null {
  const order: OpinionSlot[] = ["footwear", "top", "bottom", "outerwear"];
  const wctx: WeightCtx = { today };
  const rng = rngFromSalt(drawSeed(today, `suggest:swap:${pieces.map((g) => g.id).sort().join(",")}`, liveIdsKey(pool)));
  for (const slot of order) {
    const current = pieces.find((g) => slotOfPiece(g) === slot);
    if (!current) continue;
    const candidates = drawOrder(
      pool.filter((cand) => cand.id !== current.id && !pieces.some((g) => g.id === cand.id) && slotOfPiece(cand) === slot),
      (g) => Math.max(pieceWeight(g, wctx), Number.MIN_VALUE),
      rng,
    );
    for (const cand of candidates) {
      if (taste && pieceVetoIds(taste).has(cand.id)) continue;
      const next = pieces.map((g) => (g.id === current.id ? cand : g));
      if (skipped(next, taste) || !passesRules(next, ctx).pass) continue;
      return {
        id: cand.id,
        slot,
        line: `Better: ${cand.name}, not the ${current.name}.`,
      };
    }
  }
  return null;
}

/**
 * Two pieces or more. The rules' verdict in plain words, and one owned swap that passes, or
 * nothing. No shop, no rank.
 */
export function lookOpinion(
  pieces: Garment[],
  pool: Garment[],
  opts?: {
    occasion?: Occasion;
    season?: Season;
    house?: House | null;
    taste?: TasteMemory;
    today?: string;
  },
): LookOpinion | null {
  void opts?.house;
  if (pieces.length < 2) return null;
  const taste = opts?.taste;
  const today = opts?.today ?? todayNY();
  const ctx: RuleCtx = { house: null, occasion: opts?.occasion ?? "weekday", season: opts?.season ?? "fall", pool, taste };
  const verdict = passesRules(pieces, ctx);
  if (verdict.pass) {
    return { headline: PASSES_LINE, reason: PASSES_LINE, failed: [], house: null, swaps: [], stuck: null };
  }
  const sentences = [...new Set(verdict.failed.map(ruleSentence))];
  const swap = oneSwap(pieces, pool, taste, ctx, today);
  return {
    headline: `${FAILS_PREFIX}${sentences[0] ?? ruleSentence("CLASH")}`,
    reason: sentences.join(" "),
    failed: verdict.failed,
    house: null,
    swaps: swap ? [swap] : [],
    stuck: swap ? null : "Nothing you own swaps in to pass.",
  };
}

/** One line. A better piece is named only when this closet already has it. */
export function suggestLine(opinion: LookOpinion, pool: Garment[]): string {
  if (opinion.headline === PASSES_LINE) return PASSES_LINE;
  const owned = new Set(pool.map((g) => g.id));
  const swap = opinion.swaps.find((row) => owned.has(row.id));
  const piece = swap ? pool.find((g) => g.id === swap.id) : undefined;
  if (piece) return `${opinion.headline} Better: ${piece.name}`;
  return opinion.headline;
}

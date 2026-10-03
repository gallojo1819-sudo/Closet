import { clashSentence, sharedDetector } from "./detectors.ts";
import { slotOf } from "./style.ts";
import { pairingBlocked, pieceVetoIds, type TasteMemory } from "./taste.ts";
import type { Garment, Occasion, Season } from "./types.ts";
import type { House } from "./houses.ts";

export type OpinionSlot = "top" | "bottom" | "footwear" | "outerwear";

export type OpinionSwap = {
  id: string;
  slot: OpinionSlot;
  line: string;
};

export type LookOpinion = {
  headline: string;
  reason: string;
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

function oneSwap(
  pieces: Garment[],
  pool: Garment[],
  taste?: TasteMemory,
): OpinionSwap | null {
  const order: OpinionSlot[] = ["footwear", "top", "bottom", "outerwear"];
  for (const slot of order) {
    const current = pieces.find((g) => slotOfPiece(g) === slot);
    if (!current) continue;
    for (const cand of pool) {
      if (cand.id === current.id || pieces.some((g) => g.id === cand.id)) continue;
      if (slotOfPiece(cand) !== slot) continue;
      if (taste && pieceVetoIds(taste).has(cand.id)) continue;
      const next = pieces.map((g) => (g.id === current.id ? cand : g));
      if (skipped(next, taste) || !sharedDetector(next)) continue;
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
 * Two pieces. Match names the clothes. A miss names his pieces and the reason.
 * One better plate he already owns, or nothing. No shop.
 */
export function lookOpinion(
  pieces: Garment[],
  pool: Garment[],
  opts?: {
    occasion?: Occasion;
    season?: Season;
    house?: House | null;
    taste?: TasteMemory;
  },
): LookOpinion | null {
  void opts?.occasion;
  void opts?.season;
  void opts?.house;
  if (pieces.length < 2) return null;
  const taste = opts?.taste;
  const names = pieces.map((g) => g.name).join(", ");
  if (!skipped(pieces, taste)) {
    const hit = sharedDetector(pieces);
    if (hit) {
      return { headline: "This matches.", reason: hit.title, house: null, swaps: [], stuck: null };
    }
  }
  const why = skipped(pieces, taste)
    ? "You skipped this."
    : (clashSentence(pieces) ?? "They don't finish one way of dressing.");
  const swap = oneSwap(pieces, pool, taste);
  return {
    headline: "This doesn't match.",
    reason: `${names}. ${why}`,
    house: null,
    swaps: swap ? [swap] : [],
    stuck: null,
  };
}

/**
 * A vest, gilet, or cropped layer is shorter than the shirt under it.
 * Waist-cut jackets (bomber, trucker, corduroy) are not short outers.
 */
import type { Garment } from "../types.ts";
import { isKnitTop, isShirtLike, shirtLockedOut } from "../tuck.ts";
import { wearSlot } from "./jackets.ts";
import { oversizedOf } from "./oversized.ts";

const SHORT_OUTER = /\bvests?\b|\bgilets?\b|\bcropped\b/i;

export function isShortOuter(g: { name?: string; subtype?: string }): boolean {
  return SHORT_OUTER.test(`${g.name ?? ""} ${g.subtype ?? ""}`);
}

/** A top or a mid, matched on text and wear slot. A vest is sometimes "top" and sometimes "mid". */
function isTopOrMid(g: Garment): boolean {
  const worn = wearSlot(g);
  if (worn === "outer" || worn === "bottom" || worn === "shoe") return false;
  if (worn === "top" || worn === "mid") return true;
  return g.category === "top" || g.category === "dress";
}

/**
 * The shirt whose hem is outermost, the same order as leadTop: a knit first,
 * else a shirt. A short outer is not the shirt.
 */
function leadShirt(pieces: readonly Garment[]): Garment | null {
  const tops = pieces.filter((g) => !isShortOuter(g) && isTopOrMid(g));
  const lead = tops.find((g) => isKnitTop(g)) ?? tops.find((g) => isShirtLike(g)) ?? null;
  if (!lead || !isShirtLike(lead) || isKnitTop(lead)) return null;
  return lead;
}

/**
 * Hard JKT-LAY-10. Fires when a short outer is in the look and either an oversized
 * top or mid sits under it, or the lead shirt is worn out (saved, noted, camp or
 * straight hem, or oversized).
 */
export function shortOuterHits(pieces: readonly Garment[]): string[] {
  if (!pieces.some(isShortOuter)) return [];
  for (const g of pieces) {
    if (isShortOuter(g)) continue;
    if (isTopOrMid(g) && oversizedOf(g)) return ["JKT-LAY-10"];
  }
  const lead = leadShirt(pieces);
  if (lead && shirtLockedOut(lead)) return ["JKT-LAY-10"];
  return [];
}

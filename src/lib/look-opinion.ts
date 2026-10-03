import { HOUSE_LABEL, houseFingerprintOk, housesOf, leadHouse, type House } from "./houses.ts";
import { isLinenCampPiece } from "./season.ts";
import { clashes, isHoodiePiece, slotOf } from "./style.ts";
import { pairingBlocked, pieceVetoIds, type TasteMemory } from "./taste.ts";
import type { Garment, Occasion, Season } from "./types.ts";

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

function blob(g: Garment): string {
  return `${g.name} ${g.subtype} ${g.notes ?? ""}`.toLowerCase();
}

function slotOfPiece(g: Garment): OpinionSlot | null {
  const s = slotOf(g);
  if (s === "top" || s === "dress") return "top";
  if (s === "bottom" || s === "footwear" || s === "outerwear") return s;
  return null;
}

function loudKnit(g: Garment): boolean {
  const b = blob(g);
  return /knit|cable|sweater|fair\s*isle/.test(b) && /plaid|check|gingham|stripe|floral|print|fair\s*isle|graphic|90s/.test(b);
}

function clashReason(pieces: Garment[], season?: Season): string | null {
  const hoodie = pieces.some(isHoodiePiece);
  const loafer = pieces.some((g) => slotOf(g) === "footwear" && /loafer/.test(blob(g)));
  if (hoodie && loafer) return "Hoodie with loafers.";
  if (pieces.filter(loudKnit).length >= 2) return "Two loud knits.";
  const tops = pieces.filter((g) => {
    const s = slotOf(g);
    return s === "top" || s === "dress";
  });
  if (season === "winter" && tops.length > 0 && tops.every((g) => isLinenCampPiece(g))) {
    return "Linen as the only top in winter.";
  }
  if (hoodie && pieces.some((g) => /blazer/.test(blob(g)))) return "Hoodie under a blazer.";
  if (pieces.some((g) => /blazer/.test(blob(g))) && pieces.some((g) => /mule/.test(blob(g)))) {
    return "Blazer with mules.";
  }
  return null;
}

function brokenHouse(
  pieces: Garment[],
  occasion: Occasion,
  season: Season | undefined,
  selected?: House | null,
): House | null {
  if (selected && !houseFingerprintOk(pieces, selected, occasion, undefined, season)) return selected;
  for (const g of pieces) {
    for (const house of housesOf(g)) {
      if (!houseFingerprintOk(pieces, house, occasion, undefined, season)) return house;
    }
  }
  return selected ?? null;
}

function fullCore(pieces: Garment[]): boolean {
  let top = false;
  let bottom = false;
  let shoe = false;
  for (const g of pieces) {
    const s = slotOf(g);
    if (s === "top" || s === "dress") top = true;
    else if (s === "bottom") bottom = true;
    else if (s === "footwear") shoe = true;
  }
  return top && bottom && shoe;
}

function tasteClash(pieces: Garment[], taste?: TasteMemory): boolean {
  if (!taste) return false;
  if (pieces.some((g) => pieceVetoIds(taste).has(g.id))) return true;
  return pairingBlocked(pieces, taste);
}

/** A veto, a blocked pairing, or a plate clash. Missing a house is not this. */
function hardClash(pieces: Garment[], season: Season | undefined, taste?: TasteMemory): boolean {
  return tasteClash(pieces, taste) || clashes(pieces) || Boolean(clashReason(pieces, season));
}

/**
 * One opinion from plates he owns and the house profiles.
 * Two pieces are enough. Nothing here invents a garment.
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
  if (pieces.length < 2) return null;
  const occasion = opts?.occasion ?? "weekday";
  const season = opts?.season;
  const taste = opts?.taste;
  const skipped =
    Boolean(taste && pieces.some((g) => pieceVetoIds(taste).has(g.id))) ||
    Boolean(taste && pairingBlocked(pieces, taste));
  const spoken = clashReason(pieces, season);
  const house = leadHouse(pieces, occasion, season, !fullCore(pieces));
  const clashesNow = clashes(pieces) || Boolean(spoken);
  if (!skipped && !clashesNow && house) {
    return {
      headline: `This matches. ${HOUSE_LABEL[house]}.`,
      reason: "",
      house,
      swaps: [],
      stuck: null,
    };
  }
  const broke = brokenHouse(pieces, occasion, season, opts?.house);
  const reason = skipped
    ? "You skipped this."
    : [spoken ?? "These plates don't sit together.", broke ? HOUSE_LABEL[broke] : ""]
        .filter(Boolean)
        .join(" ");
  const swaps = betterSwaps(pieces, pool, occasion, season, taste, hardClash(pieces, season, taste));
  return {
    headline: "This doesn't match.",
    reason,
    house: broke,
    swaps,
    stuck: swaps.length ? null : "Nothing else in the closet fixes this.",
  };
}

function betterSwaps(
  pieces: Garment[],
  pool: Garment[],
  occasion: Occasion,
  season: Season | undefined,
  taste: TasteMemory | undefined,
  hadHard: boolean,
): OpinionSwap[] {
  const order: OpinionSlot[] = ["footwear", "top", "bottom", "outerwear"];
  const out: OpinionSwap[] = [];
  const seen = new Set<string>();
  for (const slot of order) {
    const current = pieces.find((g) => slotOfPiece(g) === slot);
    if (!current) continue;
    for (const cand of pool) {
      if (cand.id === current.id || seen.has(cand.id)) continue;
      if (slotOfPiece(cand) !== slot) continue;
      if (pieces.some((g) => g.id === cand.id)) continue;
      if (taste && pieceVetoIds(taste).has(cand.id)) continue;
      const next = pieces.map((g) => (g.id === current.id ? cand : g));
      if (hardClash(next, season, taste)) continue;
      // A hard clash is fixed when the plates sit together, even if no house is complete.
      // If the only miss was a house, the swap has to land on one.
      if (!hadHard && !leadHouse(next, occasion, season)) continue;
      seen.add(cand.id);
      out.push({
        id: cand.id,
        slot,
        line: `Better: ${cand.name}, not the ${current.name}.`,
      });
      if (out.length >= 3) return out;
    }
  }
  return out;
}

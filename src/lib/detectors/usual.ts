import { slotOf } from "../style.ts";
import type { Garment, Occasion, Season } from "../types.ts";
import { jacketRequired, wearSlot } from "../stylist/jackets.ts";
import { isLegal } from "../stylist/legal.ts";

export type UsualResult = { looks: Garment[][]; reason: string };

function finiteTemp(n: unknown): number | undefined {
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function isJacket(g: Garment): boolean {
  return wearSlot(g) === "outer" || slotOf(g) === "outerwear";
}

function isTop(g: Garment): boolean {
  if (wearSlot(g) === "outer" || wearSlot(g) === "mid") return false;
  const slot = slotOf(g);
  return slot === "top" || slot === "dress";
}

function label(occasion: string, season: string): string {
  const occ = occasion.charAt(0).toUpperCase() + occasion.slice(1);
  const sea = season.charAt(0).toUpperCase() + season.slice(1);
  return `${occ} · ${sea}`;
}

/**
 * A legal outfit from the live pool. Not the first six of each slot, and not
 * every detector ban at once. A jacket is added only when the rule still requires one.
 */
/** `salt` rotates a slot's start index; 0 leaves the order as stored. */
function rotate<T>(list: T[], by: number): T[] {
  if (!list.length || !by) return list;
  const k = ((by % list.length) + list.length) % list.length;
  return k ? [...list.slice(k), ...list.slice(0, k)] : list;
}

export function usualFromCloset(
  garments: Garment[],
  opts: { occasion: Occasion | string; season: Season | string; weatherF?: number; max?: number; salt?: number },
): UsualResult {
  const max = opts.max ?? 3;
  const salt = opts.salt ?? 0;
  /* The 240-try cap stays for the default three; a longer row may look further, bounded. */
  const tryCap = max > 3 ? Math.min(800, 240 + (max - 3) * 112) : 240;
  const live = garments.filter((g) => !g.archived);
  const tops = rotate(live.filter(isTop), salt);
  const bottoms = rotate(live.filter((g) => slotOf(g) === "bottom"), salt * 7);
  const shoes = rotate(live.filter((g) => slotOf(g) === "footwear"), salt * 13);
  const jackets = live.filter(isJacket);
  const weatherF = finiteTemp(opts.weatherF);
  const ctx = {
    occasion: opts.occasion,
    season: opts.season,
    ...(weatherF !== undefined ? { weatherF } : {}),
  };
  const need = jacketRequired(String(opts.occasion), String(opts.season), weatherF);
  const where = label(String(opts.occasion), String(opts.season));
  if (!tops.length || !bottoms.length || !shoes.length) {
    return { looks: [], reason: `${where} needs a top, a bottom, and a shoe from this closet.` };
  }
  if (need && jackets.length === 0) {
    return {
      looks: [],
      reason: `${where} still needs a jacket, and this closet has no jacket that finishes the look.`,
    };
  }
  const looks: Garment[][] = [];
  const seen = new Set<string>();
  let tries = 0;
  for (const top of tops) {
    for (const bottom of bottoms) {
      for (const shoe of shoes) {
        if (tries >= tryCap || looks.length >= max) break;
        tries += 1;
        if (new Set([top.id, bottom.id, shoe.id]).size < 3) continue;
        const core = [top, bottom, shoe];
        const candidates: Garment[][] = need ? [] : [core];
        for (const jacket of jackets) {
          if (core.some((g) => g.id === jacket.id)) continue;
          candidates.push([...core, jacket]);
        }
        for (const pieces of candidates) {
          if (!isLegal(pieces, ctx)) continue;
          const key = pieces
            .map((g) => g.id)
            .sort()
            .join("|");
          if (seen.has(key)) continue;
          seen.add(key);
          looks.push(pieces);
          break;
        }
      }
    }
  }
  if (looks.length) return { looks, reason: "" };
  if (need) {
    return { looks: [], reason: `${where} still needs a jacket, and none of these jackets finish a look.` };
  }
  return { looks: [], reason: `Nothing in this closet is legal for ${where}.` };
}

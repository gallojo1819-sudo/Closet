/**
 * The draw: every surface that chooses a look (Today, its Suggest alternates, the week strip,
 * the Lookbook rows, the stylist, Check) draws at random among the looks that pass the rules
 * (passesRules in stylist/legal.ts). Nothing is ranked. The random stream is seeded by the day
 * in New York, the surface and the live closet (drawSeed), so a look stays the same all day and
 * changes the next day; Skip, Reshuffle and Re-dress mix their own counter into the seed.
 *
 * The weights come from rotation alone (pieceWeight): a piece worn today is out; one worn in the
 * last RECENT_DAYS climbs from RECENT_MIN back to 1; past that its weight keeps growing with
 * the days idle, so what has waited longest leads; a piece never worn, or not put in front of the
 * user for FRESH_DAYS, counts double. No formality, warmth, house, technique or colour enters a
 * weight. A look's weight is the product of its core pieces' weights.
 *
 * Draws use Efraimidis–Spirakis keys (u^(1/w)): each candidate gets one key from the seeded rng,
 * and the largest keys win, so a weighted draw without replacement is one pass and one sort,
 * deterministic for the same seed and inputs. Pure: relative imports only, no React, no store.
 */
import { dailySalt } from "./daily-pick.ts";
import { jeansWithBlazer } from "./stylist/jackets.ts";
import type { Garment, WearEntry } from "./types.ts";

/** Days over which a worn piece climbs from RECENT_MIN back to full weight. */
export const RECENT_DAYS = 14;
/** The weight of a piece worn yesterday. */
export const RECENT_MIN = 0.1;
/** A piece not worn and not suggested for this many days counts double. */
export const FRESH_DAYS = 21;
/** The multiplier for a never-worn or long-unsuggested piece. */
export const FRESH_BOOST = 2;
/** Past RECENT_DAYS idle a piece gains this much weight per further RECENT_DAYS idle. */
export const IDLE_GAIN = 1;
/**
 * The weight is raised to this power before the draw: 1 is the plain rotation weight; higher
 * sharpens the rotation (the longest-idle lead more surely) without making it a queue.
 */
export const WEIGHT_POWER = 2;
/**
 * Joe 2026-10-19: jeans with a blazer = half odds. A look that pairs ecru or mid-wash clean jeans
 * with a sport coat or blazer passes the rules (JKT-LAY-3's soft case, a preference in
 * stylist/legal.ts) and its weight is halved. The one multiplier on a look's weight that is not
 * rotation; it applies to every draw surface.
 */
export const JEANS_BLAZER_ODDS = 0.5;

export type Rng = () => number;

/** A small LCG on a 32-bit salt: the same stream pickLook has always drawn from. */
export function rngFromSalt(salt: number): Rng {
  let a = salt >>> 0 || 1;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

export function shuffle<T>(list: readonly T[], rng: Rng): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

/**
 * The seed of one surface's draw: the day (todayISO, the reader's New York date), the surface
 * id (e.g. "today", "lookbook:weekday:week"), the sorted live ids (liveIdsKey) and a counter
 * the surface's own Skip/Reshuffle/Re-dress bumps. The same inputs give the same seed.
 */
export function drawSeed(dateNY: string, surfaceId: string, liveIdsKey: string, counter = 0): number {
  return dailySalt(`${dateNY}|${surfaceId}|${counter}`, liveIdsKey);
}

export type WeightCtx = {
  /** The day the draw is for (ISO date). */
  today: string;
  /** The wear journal, read for worn entries beside wornOn (a simulated wear needs only wornOn). */
  journal?: readonly Pick<WearEntry, "date" | "garmentIds" | "verdict">[];
  /** Last day each piece was put in front of the user (lastSuggested in detectors/ideas.ts). Absent: unknown. */
  suggested?: ReadonlyMap<string, string>;
};

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10));
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.round(ms / 86_400_000));
}

/** The last day a piece was worn, by its wornOn list or a worn journal entry; null when never. */
export function lastWorn(g: Pick<Garment, "id" | "wornOn">, journal?: WeightCtx["journal"]): string | null {
  let last: string | null = null;
  for (const day of g.wornOn ?? []) if (!last || day > last) last = day;
  for (const row of journal ?? []) {
    if (row.verdict !== "worn" || !row.garmentIds.includes(g.id)) continue;
    if (!last || row.date > last) last = row.date;
  }
  return last;
}

/**
 * A piece's odds, from rotation only. 0 when worn today (excluded). Worn d days ago: RECENT_MIN
 * rising to 1 at RECENT_DAYS, then 1 + IDLE_GAIN per RECENT_DAYS past that. Never worn: 1 plus
 * the same idle gain from the day it was added, times FRESH_BOOST; a piece not suggested in
 * FRESH_DAYS (when suggestions are known) is also times FRESH_BOOST, once.
 */
export function pieceWeight(g: Garment, ctx: WeightCtx): number {
  const worn = lastWorn(g, ctx.journal);
  let fresh = false;
  let idle: number;
  if (worn) {
    idle = daysBetween(worn, ctx.today);
    if (idle <= 0) return 0;
  } else {
    fresh = true;
    idle = daysBetween((g.createdAt ?? "").slice(0, 10) || ctx.today, ctx.today);
  }
  let w: number;
  if (worn && idle < RECENT_DAYS) w = RECENT_MIN + (1 - RECENT_MIN) * (idle / RECENT_DAYS);
  else w = 1 + (IDLE_GAIN * Math.max(0, idle - RECENT_DAYS)) / RECENT_DAYS;
  if (!fresh && ctx.suggested) {
    const last = ctx.suggested.get(g.id);
    if (!last || daysBetween(last, ctx.today) >= FRESH_DAYS) fresh = true;
  }
  return Math.pow(fresh ? w * FRESH_BOOST : w, WEIGHT_POWER);
}

/**
 * The product of the pieces' weights (a look with a piece worn today weighs nothing), times
 * JEANS_BLAZER_ODDS when the look is jeans under a sport coat or blazer.
 */
export function lookWeight(pieces: readonly Garment[], ctx: WeightCtx): number {
  let w = 1;
  for (const g of pieces) w *= pieceWeight(g, ctx);
  return jeansWithBlazer([...pieces]) ? w * JEANS_BLAZER_ODDS : w;
}

/** The Efraimidis–Spirakis key of one candidate: u^(1/w); 0 for a weight of 0. */
export function drawKey(weight: number, rng: Rng): number {
  if (!(weight > 0)) return 0;
  const u = rng();
  return Math.pow(u > 0 ? u : Number.MIN_VALUE, 1 / weight);
}

/**
 * The candidates in draw order: the largest keys first, a weighted draw without replacement.
 * Candidates of weight 0 come last, in their given order, so a caller that must choose
 * something still can; `drawWithoutReplacement` and `drawLook` leave them out.
 */
export function drawOrder<T>(items: readonly T[], weight: (item: T) => number, rng: Rng): T[] {
  const keyed = items.map((item, i) => ({ item, i, key: drawKey(weight(item), rng) }));
  keyed.sort((a, b) => b.key - a.key || a.i - b.i);
  return keyed.map((row) => row.item);
}

/** Up to k candidates of positive weight, drawn without replacement. */
export function drawWithoutReplacement<T>(k: number, items: readonly T[], weight: (item: T) => number, rng: Rng): T[] {
  const out: T[] = [];
  for (const item of drawOrder(items, weight, rng)) {
    if (out.length >= k) break;
    if (!(weight(item) > 0)) break;
    out.push(item);
  }
  return out;
}

/** One candidate of positive weight, or null when none has any. */
export function drawLook<T>(candidates: readonly T[], weight: (item: T) => number, rng: Rng): T | null {
  return drawWithoutReplacement(1, candidates, weight, rng)[0] ?? null;
}

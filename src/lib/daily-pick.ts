/**
 * The daily pick's fixed inputs. Today's first look of the day is a pure function of the day,
 * the live closet and the day's season bucket: the same closet opened twice on one day shows
 * one look. The clock (momentOfDay), the live temperature inside a season bucket, the memory-
 * only week row and the Lookbook's auto looks are not inputs; Skip and Reshuffle keep their
 * own salts (skipCount, reshuffleCount) because those are the user asking for something else.
 * Pure: relative imports only, no React, no DOM, no store.
 */
import { weatherForSeason, type Season } from "./season.ts";
import type { Garment, Moment, WeatherSnap } from "./types.ts";

/** The moment the daily pick scores against, whatever the clock says. */
export const DAILY_MOMENT: Moment = "day";

/** localStorage key of the day's frozen season bucket. Not closet.v6, not closet_meta. */
export const TODAY_SEASON_KEY = "closet.today-season.v1";

/** localStorage key of the day's frozen high, rain and wind. Not closet.v6, not closet_meta. */
export const TODAY_CONDITIONS_KEY = "closet.today-conditions.v1";

/** What the first reading of the day froze. Later readings the same day do not replace it. */
export type FrozenConditions = {
  date: string;
  highF?: number;
  wet?: boolean;
  windy?: boolean;
};

export type DayConditions = {
  highF?: number;
  wet?: boolean;
  windy?: boolean;
};

/** Live owned ids, sorted: the closet as the pick sees it. */
export function liveIdsKey(garments: readonly Pick<Garment, "id" | "archived">[]): string {
  return garments
    .filter((g) => !g.archived)
    .map((g) => g.id)
    .sort()
    .join(",");
}

/** FNV-1a over the day and the sorted live ids: a non-zero 32-bit salt for pickLook's rng. */
export function dailySalt(today: string, liveIds: string): number {
  let h = 2166136261;
  const s = `${today}|${liveIds}`;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) || 1;
}

/**
 * The weather the pick scores and gates on. With no frozen conditions it is the bucket's own
 * reading (weatherForSeason) and carries no `measured`, so jacketRequired and legalWithJacket
 * read the season alone. A frozen high, rain or wind is added beside that reading; `measured`
 * is set only when a high was frozen, and `f` stays the bucket's degree either way. A reading
 * that moves inside the day cannot move the look.
 */
export function dailyPickWeather(season: Season, cond?: DayConditions | null): WeatherSnap {
  const { f, label, code } = weatherForSeason(season);
  const highF = typeof cond?.highF === "number" && Number.isFinite(cond.highF) ? cond.highF : undefined;
  const wet = typeof cond?.wet === "boolean" ? cond.wet : undefined;
  const windy = typeof cond?.windy === "boolean" ? cond.windy : undefined;
  if (highF === undefined && wet === undefined && windy === undefined) return { f, label, code };
  const snap: WeatherSnap = { f, label, code };
  if (highF !== undefined) {
    snap.highF = highF;
    snap.measured = true;
  }
  if (wet !== undefined) snap.wet = wet;
  if (windy !== undefined) snap.windy = windy;
  return snap;
}

export type FrozenSeason = { date: string; season: Season };

/** Parse what the day's key holds. Anything odd is nothing. */
export function readFrozenSeason(raw: string | null | undefined): FrozenSeason | null {
  if (!raw) return null;
  try {
    const got = JSON.parse(raw) as Partial<FrozenSeason> | null;
    if (!got || typeof got.date !== "string" || typeof got.season !== "string") return null;
    if (!["spring", "summer", "fall", "winter"].includes(got.season)) return null;
    return { date: got.date, season: got.season as Season };
  } catch {
    return null;
  }
}

/**
 * The day's season bucket: the one frozen for today when there is one, else the live bucket,
 * which then becomes today's. `next` is what to store (null when nothing changes).
 */
export function freezeSeason(
  stored: FrozenSeason | null,
  today: string,
  live: Season,
): { season: Season; next: FrozenSeason | null } {
  if (stored && stored.date === today) return { season: stored.season, next: null };
  return { season: live, next: { date: today, season: live } };
}

/** Parse what the day's conditions key holds. Anything odd is nothing. */
export function readFrozenConditions(raw: string | null | undefined): FrozenConditions | null {
  if (!raw) return null;
  try {
    const got = JSON.parse(raw) as Partial<FrozenConditions> | null;
    if (!got || typeof got !== "object" || Array.isArray(got)) return null;
    if (typeof got.date !== "string" || got.date.length === 0) return null;
    const out: FrozenConditions = { date: got.date };
    if (got.highF !== undefined) {
      if (typeof got.highF !== "number" || !Number.isFinite(got.highF)) return null;
      out.highF = got.highF;
    }
    if (got.wet !== undefined) {
      if (typeof got.wet !== "boolean") return null;
      out.wet = got.wet;
    }
    if (got.windy !== undefined) {
      if (typeof got.windy !== "boolean") return null;
      out.windy = got.windy;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * The day's rain, wind and high: the one frozen for today when there is one, else this
 * reading, which then becomes today's. `next` is what to store (null when nothing changes).
 */
export function freezeConditions(
  stored: FrozenConditions | null,
  today: string,
  live: DayConditions,
): { conditions: FrozenConditions; next: FrozenConditions | null } {
  if (stored && stored.date === today) return { conditions: stored, next: null };
  const next: FrozenConditions = { date: today };
  if (typeof live.highF === "number" && Number.isFinite(live.highF)) next.highF = live.highF;
  if (typeof live.wet === "boolean") next.wet = live.wet;
  if (typeof live.windy === "boolean") next.windy = live.windy;
  return { conditions: next, next };
}

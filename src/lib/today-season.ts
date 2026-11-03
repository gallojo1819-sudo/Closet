/**
 * The day's season bucket, frozen on first sight (daily-pick.ts: freezeSeason under
 * TODAY_SEASON_KEY in localStorage, never closet.v6 or closet_meta): a reading that crosses a
 * bucket edge later in the day does not move today's look. Read by everything that shows
 * Today's look before the pick has landed (today-look.ts via the Today page and the stylist
 * dock), written by the daily-pick effect (use-daily-pick.ts). Without storage the live
 * bucket is used. Client-side only; on the server the live bucket is returned, nothing kept.
 */
import {
  freezeConditions,
  freezeSeason,
  readFrozenConditions,
  readFrozenSeason,
  TODAY_CONDITIONS_KEY,
  TODAY_SEASON_KEY,
  type DayConditions,
  type FrozenConditions,
} from "./daily-pick.ts";
import { seasonFromWeather, type Season } from "./season.ts";
import { todayISO } from "./utils.ts";

function readRaw(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TODAY_SEASON_KEY);
  } catch {
    return null;
  }
}

/** Today's bucket: the one frozen for today when there is one, else the live reading's. Writes nothing. */
export function todaySeasonBucket(weatherF: number | undefined, today = todayISO()): Season {
  return freezeSeason(readFrozenSeason(readRaw()), today, seasonFromWeather(weatherF)).season;
}

function readCondRaw(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TODAY_CONDITIONS_KEY);
  } catch {
    return null;
  }
}

/** Today's frozen high, rain and wind, when the key holds them. Writes nothing. */
export function readTodayConditions(today = todayISO()): FrozenConditions | null {
  const stored = readFrozenConditions(readCondRaw());
  if (!stored || stored.date !== today) return null;
  return stored;
}

/**
 * Today's conditions, frozen on first sight. A missing reading freezes nothing, so a later
 * successful read can still lock the day. The same localStorage key as the season bucket's
 * neighbour; never closet.v6 or closet_meta.
 */
export function freezeTodayConditions(
  live: DayConditions | null | undefined,
  today = todayISO(),
): FrozenConditions | null {
  const stored = readFrozenConditions(readCondRaw());
  if (stored?.date === today) return stored;
  if (!live) return null;
  const { conditions, next } = freezeConditions(null, today, live);
  if (next && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(TODAY_CONDITIONS_KEY, JSON.stringify(next));
    } catch {
      /* memory only */
    }
  }
  return conditions;
}

/** Today's bucket, frozen for the day if it was not yet (the daily-pick effect's call). */
export function freezeTodaySeason(weatherF: number | undefined, today = todayISO()): Season {
  const { season, next } = freezeSeason(readFrozenSeason(readRaw()), today, seasonFromWeather(weatherF));
  if (next && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(TODAY_SEASON_KEY, JSON.stringify(next));
    } catch {
      /* memory only */
    }
  }
  return season;
}

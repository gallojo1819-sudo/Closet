/**
 * The day's season bucket, frozen on first sight (daily-pick.ts: freezeSeason under
 * TODAY_SEASON_KEY in localStorage, never closet.v6 or closet_meta): a reading that crosses a
 * bucket edge later in the day does not move today's look. Read by everything that shows
 * Today's look before the pick has landed (today-look.ts via the Today page and the stylist
 * dock), written by the daily-pick effect (use-daily-pick.ts). Without storage the live
 * bucket is used. Client-side only; on the server the live bucket is returned, nothing kept.
 */
import { freezeSeason, readFrozenSeason, TODAY_SEASON_KEY } from "./daily-pick.ts";
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

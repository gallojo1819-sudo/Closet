/**
 * Today's look, as the Today page shows it: the today cell of the week strip (weekStripDays:
 * the drop when it is dated today and holds two owned pieces, else today's worn entry, else
 * the first queued week look), sorted as the page lists it. When no cell holds a look for
 * today (the drop is yesterday's, or the daily pick has not landed in the store yet), the
 * daily pick itself (drop-pick.ts, the same pure assembly rerollDrop runs) is the look, under
 * the day's season bucket the caller hands in: the same closet on the same day gives the same
 * look on every page and in the stylist dock, before and after the Today effect writes it. The
 * Today page, the stylist dock and answerTodayAsk read this one selector, so "This look" is the
 * look on the page. No React and no store. The day's conditions key is read when the caller
 * does not pass one, the same way the season bucket is frozen, and never closet.v6.
 */
import { draftStamp, effectiveIds } from "./jacket-draft.ts";
import type { FrozenConditions } from "./daily-pick.ts";
import { pickDropIds } from "./drop-pick.ts";
import { sortLook } from "./look.ts";
import { weekStripDays } from "./lookbook.ts";
import { seasonFromWeather, type Season } from "./season.ts";
import { todayOccasion } from "./style.ts";
import type { TasteMemory } from "./taste.ts";
import { readTodayConditions } from "./today-season.ts";
import type { DailyDrop, Garment, Look } from "./types.ts";
import { lastDays, todayNY } from "./utils.ts";

export type TodayLookState = {
  drop: DailyDrop | { date: string; garmentIds: readonly string[] } | null | undefined;
  journal?: readonly { date: string; garmentIds: readonly string[]; verdict: string }[];
  thisWeek?: readonly Look[];
  garments: readonly Garment[];
  /** The user's vetoes (the store's taste); absent means none. */
  taste?: TasteMemory;
  /** The day's season bucket (today-season.ts); the drop's reading, else the calendar, when absent. */
  season?: Season;
  /**
   * The day's frozen high, rain and wind. Absent: read today's key (nothing, when storage has
   * none). Null: ignore storage. Not closet.v6.
   */
  conditions?: FrozenConditions | null;
};

function isDrop(drop: TodayLookState["drop"]): drop is DailyDrop {
  return Boolean(drop && "worn" in drop && "verdict" in drop);
}

/**
 * The daily pick's ids for this state (drop-pick.ts), or [] when the closet cannot dress. The
 * same inputs the Today effect hands rerollDrop: the day, the live closet, the bucket's weather.
 */
export function dailyPickIds(state: TodayLookState, today = todayNY()): string[] {
  const drop = isDrop(state.drop) ? state.drop : null;
  const season =
    state.season ?? seasonFromWeather(drop?.weather?.f !== undefined ? drop.weather.f : undefined);
  const conditions = state.conditions !== undefined ? state.conditions ?? undefined : readTodayConditions(today) ?? undefined;
  const owned = state.garments.filter((g) => !g.archived);
  if (!owned.length) return [];
  const journal = (state.journal ?? []).map((j) => ({ id: `j-${j.date}`, date: j.date, garmentIds: [...j.garmentIds], verdict: j.verdict as "worn" | "skipped" }));
  return pickDropIds(
    { garments: [...state.garments], journal, drop, taste: state.taste },
    { daily: { season, ...(conditions ? { conditions } : {}) }, today },
  ).ids;
}

/** The ids on Today before a session jacket draft, in the page's order. */
function todayBaseIds(state: TodayLookState, today: string): string[] {
  const garments = [...state.garments];
  const cells = weekStripDays({
    days: lastDays(7, today),
    today,
    drop: state.drop ?? null,
    journal: state.journal ?? [],
    thisWeek: state.thisWeek ?? [],
    garments,
  });
  const cell = cells.find((c) => c.iso === today);
  return cell?.look?.garmentIds?.length ? [...cell.look.garmentIds] : dailyPickIds(state, today);
}

/** The pieces on Today, in the page's order. A session jacket draft replaces the jacket only. */
export function todayLookPieces(state: TodayLookState, today = todayNY()): Garment[] {
  const garments = [...state.garments];
  const ids = todayLookIds(state, today);
  const drop = isDrop(state.drop) ? state.drop : null;
  const season = state.season ?? seasonFromWeather(drop?.weather?.f);
  const stamp = draftStamp({
    date: today,
    occasion: todayOccasion(drop, today),
    season,
    weather: drop?.weather,
  });
  const owned = new Set(garments.filter((g) => !g.archived).map((g) => g.id));
  const over = effectiveIds(ids, stamp, owned);
  return sortLook(
    (over ?? ids)
      .map((id) => garments.find((g) => g.id === id))
      .filter((g): g is Garment => Boolean(g)),
  );
}

/** The page's ids before a jacket draft, in the page's order. */
export function todayLookIds(state: TodayLookState, today = todayNY()): string[] {
  const garments = [...state.garments];
  return sortLook(
    todayBaseIds(state, today)
      .map((id) => garments.find((g) => g.id === id))
      .filter((g): g is Garment => Boolean(g)),
  ).map((g) => g.id);
}

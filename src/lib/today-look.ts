/**
 * Today's look, as the Today page shows it: the today cell of the week strip (weekStripDays:
 * the drop when it is dated today and holds two owned pieces, else today's worn entry, else
 * the first queued week look), sorted as the page lists it. When no cell holds a look for
 * today (the drop is yesterday's, or the daily pick has not landed in the store yet), the
 * daily pick itself (drop-pick.ts, the same pure assembly rerollDrop runs) is the look, under
 * the day's season bucket the caller hands in: the same closet on the same day gives the same
 * look on every page and in the stylist dock, before and after the Today effect writes it. The
 * Today page, the stylist dock and answerTodayAsk read this one selector, so "This look" is the
 * look on the page. Pure: relative imports only, no React, no store.
 */
import { pickDropIds } from "./drop-pick.ts";
import { sortLook } from "./look.ts";
import { weekStripDays } from "./lookbook.ts";
import { seasonFromWeather, type Season } from "./season.ts";
import type { TasteMemory } from "./taste.ts";
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
  const owned = state.garments.filter((g) => !g.archived);
  if (!owned.length) return [];
  const journal = (state.journal ?? []).map((j) => ({ id: `j-${j.date}`, date: j.date, garmentIds: [...j.garmentIds], verdict: j.verdict as "worn" | "skipped" }));
  return pickDropIds(
    { garments: [...state.garments], journal, drop, taste: state.taste },
    { daily: { season }, today },
  ).ids;
}

/** The pieces on Today, in the page's order. Empty only when the closet cannot dress at all. */
export function todayLookPieces(state: TodayLookState, today = todayNY()): Garment[] {
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
  const ids = cell?.look?.garmentIds?.length ? cell.look.garmentIds : dailyPickIds(state, today);
  return sortLook(
    ids
      .map((id) => garments.find((g) => g.id === id))
      .filter((g): g is Garment => Boolean(g)),
  );
}

/** The ids of todayLookPieces. */
export function todayLookIds(state: TodayLookState, today = todayNY()): string[] {
  return todayLookPieces(state, today).map((g) => g.id);
}

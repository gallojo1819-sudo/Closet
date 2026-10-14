/**
 * Today's look, as the Today page shows it: the today cell of the week strip (weekStripDays:
 * the drop when it is dated today and holds two owned pieces, else today's worn entry, else
 * the first queued week look), sorted as the page lists it. The Today page, the stylist dock
 * and answerTodayAsk read this one selector, so "This look" is the look on the page.
 * Pure: relative imports only, no React, no store.
 */
import { sortLook } from "./look.ts";
import { weekStripDays } from "./lookbook.ts";
import type { Garment, Look } from "./types.ts";
import { lastDays, todayISO } from "./utils.ts";

export type TodayLookState = {
  drop: { date: string; garmentIds: readonly string[] } | null | undefined;
  journal?: readonly { date: string; garmentIds: readonly string[]; verdict: string }[];
  thisWeek?: readonly Look[];
  garments: readonly Garment[];
};

/** The pieces on Today, in the page's order. Empty when nothing is on the rack for today. */
export function todayLookPieces(state: TodayLookState, today = todayISO()): Garment[] {
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
  return sortLook(
    (cell?.look?.garmentIds ?? [])
      .map((id) => garments.find((g) => g.id === id))
      .filter((g): g is Garment => Boolean(g)),
  );
}

/** The ids of todayLookPieces. */
export function todayLookIds(state: TodayLookState, today = todayISO()): string[] {
  return todayLookPieces(state, today).map((g) => g.id);
}

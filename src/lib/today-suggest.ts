/**
 * Today's Suggest: up to three alternates to the day's look, each a draw among rule-passing
 * looks (pickDropWith, the surface "today-suggest" with the alternate's index in the seed),
 * none repeating today's core combination or leading with today's lead piece, and none
 * repeating one another. When nothing passes, one plain line says why: the rules a draw would
 * have had to waive. Pure: relative imports only, no React, no store; the Today page wires
 * Wear/Use and Save to the store's existing setDrop and saveLook.
 */
import { dailyPickWeather, liveIdsKey } from "./daily-pick.ts";
import { drawSeed } from "./draw.ts";
import { pickDropWith, type PickState } from "./drop-pick.ts";
import { weekLeadPiece } from "./look.ts";
import type { Season } from "./season.ts";
import { coreComboKey } from "./style.ts";
import { ruleSentence } from "./stylist/rule-copy.ts";
import type { Garment, Occasion } from "./types.ts";
import { todayNY } from "./utils.ts";

export const SUGGEST_SURFACE = "today-suggest";
export const SUGGEST_COUNT = 3;
export const NO_ALTERNATES = "No other look passes the rules today.";

export type TodaySuggestion = { ids: string[]; pieces: Garment[]; relaxed: string[] };

export type TodaySuggest = {
  alternates: TodaySuggestion[];
  /** The plain line to show instead of the block when there are no alternates. */
  reason: string | null;
};

export function todaySuggestions(
  state: PickState,
  input: { todayIds: readonly string[]; occasion: Occasion; season: Season; today?: string; count?: number },
): TodaySuggest {
  const today = input.today ?? todayNY();
  const pool = state.garments.filter((g) => !g.archived);
  const byId = new Map(pool.map((g) => [g.id, g]));
  const todayPieces = input.todayIds.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
  const lead = weekLeadPiece(todayPieces);
  const exclude = new Set<string>();
  if (todayPieces.length >= 2) exclude.add(coreComboKey(todayPieces.map((g) => g.id), pool));
  const liveIds = liveIdsKey(pool);
  const out: TodaySuggestion[] = [];
  const relaxedAll = new Set<string>();
  const want = input.count ?? SUGGEST_COUNT;
  for (let i = 0; i < want * 2 && out.length < want; i += 1) {
    const picked = pickDropWith(
      [...state.garments],
      dailyPickWeather(input.season),
      input.occasion,
      {
        salt: drawSeed(today, SUGGEST_SURFACE, liveIds, i),
        season: input.season,
        excludeKeys: [...exclude],
        taste: state.taste,
        today,
        journal: state.journal,
      },
    );
    if (picked.ids.length < 3) break;
    const pieces = picked.ids.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
    const key = coreComboKey(picked.ids, pool);
    exclude.add(key);
    if (lead && weekLeadPiece(pieces)?.id === lead.id) continue;
    for (const id of picked.relaxed) relaxedAll.add(id);
    out.push({ ids: picked.ids, pieces, relaxed: picked.relaxed });
  }
  if (out.length) return { alternates: out, reason: null };
  const why = [...relaxedAll].map(ruleSentence);
  return { alternates: [], reason: why.length ? `${NO_ALTERNATES} ${why[0]}` : NO_ALTERNATES };
}

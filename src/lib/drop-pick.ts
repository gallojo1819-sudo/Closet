/**
 * The drop's pick, pure: what rerollDrop in store.ts rolls and what Today and the stylist
 * dock read when no drop for today has landed yet (today-look.ts). One assembly of the inputs
 * (pickDropIds) feeds both, so the look the page shows is the look the store would set. The
 * daily pick (daily-pick.ts): a seed from the day, the surface and the live closet (drawSeed),
 * the day's bucket weather, no week row; Skip and Reshuffle mix their own counters into the
 * seed. The pick is a draw among rule-passing looks (pickLook in style.ts), weighted by
 * rotation alone. Relative imports only, no React, no store.
 */
import { dailyPickWeather, liveIdsKey } from "./daily-pick.ts";
import { drawSeed } from "./draw.ts";
import { comboKey } from "./lookbook.ts";
import { seasonFromWeather, type Season } from "./season.ts";
import { coreComboKey, defaultOccasion, momentOfDay, pickLookWith, weekUniformKeys } from "./style.ts";
import { jacketRequired } from "./stylist/jackets.ts";
import type { TasteMemory } from "./taste.ts";
import { mapOccasion, type DailyDrop, type Garment, type Look, type Moment, type Occasion, type WearEntry, type WeatherSnap } from "./types.ts";
import { todayNY } from "./utils.ts";

/** The daily pick's fixed inputs, from the Today effect: the day's frozen season bucket. */
export type DailyPick = { season: Season };

/** The surface ids of the drop's draws (drawSeed). */
export const TODAY_SURFACE = "today";
export const SKIP_SURFACE = "today:skip";
export const RESHUFFLE_SURFACE = "today:reshuffle";

export type PickDropExtra = {
  /** The seed (drawSeed). */
  salt?: number;
  previousIds?: string[];
  lockedIds?: string[];
  repeatPairs?: Set<string>;
  excludeKeys?: string[];
  skip?: boolean;
  taste?: TasteMemory;
  /** The daily pick: the day's frozen bucket, so the clock is not an input. */
  season?: Season;
  /** The rotation weights' inputs. */
  today?: string;
  journal?: readonly Pick<WearEntry, "date" | "garmentIds" | "verdict">[];
  suggested?: ReadonlyMap<string, string>;
};

export type PickDropDetail = { ids: string[]; relaxed: string[]; tried: number };

export function pickDropWith(
  garments: Garment[],
  weather?: WeatherSnap,
  occasion?: Occasion,
  extra: PickDropExtra = {},
  now: Date = new Date(),
): PickDropDetail {
  const occ = occasion ?? defaultOccasion(now);
  /* A measured reading only. A missing reading stays missing; the bucket's reading dresses the day. */
  const tempF = weather?.measured ? weather.f : undefined;
  const season = extra.season ?? seasonFromWeather(weather?.f, now);
  const needJacket = jacketRequired(occ, season, tempF);
  const picked = pickLookWith(garments, {
    weather,
    occasion: occ,
    season,
    requireOuter: needJacket,
    previousIds: extra.previousIds,
    lockedIds: extra.lockedIds,
    repeatPairs: extra.repeatPairs,
    salt: extra.salt ?? 1,
    excludeKeys: extra.excludeKeys,
    minSlotChange: extra.skip ? 2 : 0,
    requireSilhouetteChange: Boolean(extra.skip),
    taste: extra.taste,
    today: extra.today,
    journal: extra.journal,
    suggested: extra.suggested,
  });
  return { ids: picked.ids, relaxed: picked.relaxed, tried: picked.tried };
}

export function pickDrop(
  garments: Garment[],
  weather?: WeatherSnap,
  occasion?: Occasion,
  extra: PickDropExtra = {},
  now: Date = new Date(),
): string[] {
  return pickDropWith(garments, weather, occasion, extra, now).ids;
}

/** The store fields the pick reads. */
export type PickState = {
  garments: Garment[];
  journal: readonly WearEntry[];
  drop: DailyDrop | null;
  taste?: TasteMemory;
  /** The memory-only week row and the saved looks: inputs to a Skip or Reshuffle only, never to the daily pick. */
  thisWeek?: readonly Look[];
  looks?: readonly Look[];
  skipCount?: number;
  reshuffleCount?: number;
};

export type PickOpts = {
  weather?: WeatherSnap;
  occasion?: Occasion;
  previousIds?: string[];
  skippedKeys?: string[];
  daily?: DailyPick;
  today?: string;
};

export type PickResult = {
  ids: string[];
  occ: Occasion;
  moment: Moment;
  lockedIds: string[];
  sameDay: boolean;
  todaySkipped: string[];
  shownWeather: WeatherSnap | undefined;
  /** Rule ids the draw had to waive to find a look; empty when it passes every rule. */
  relaxed: string[];
};

/**
 * The ids rerollDrop would set, with the fields it writes beside them. The daily pick ignores
 * the week row and the clock; a Skip (previousIds) or Reshuffle mixes its own counter into the
 * seed. Empty ids mean nothing legal: the caller keeps today's sound look.
 */
export function pickDropIds(state: PickState, opts: PickOpts = {}): PickResult {
  const today = opts.today ?? todayNY();
  const prev = state.drop;
  const sameDay = prev?.date === today;
  const occ = mapOccasion(opts.occasion ?? (sameDay ? prev?.occasion : undefined) ?? defaultOccasion());
  /* The drop shows the clock's moment; the pick itself does not read it. */
  const moment = momentOfDay();
  const lockedIds = sameDay ? (prev?.lockedIds ?? []) : [];
  const repeats = weekUniformKeys([...state.journal], state.garments, today);
  const daily = opts.daily;
  /* The week row is memory-only and lands after an idle callback: not a daily-pick input. */
  const weekKeys = daily ? [] : (state.thisWeek ?? []).slice(0, 6).map((l) => comboKey(l.garmentIds));
  const wornKeys = state.journal
    .filter((j) => j.verdict === "worn")
    .slice(0, 7)
    .map((j) => comboKey(j.garmentIds));
  /* Only today's skips stay off. Yesterday's skip was "not that day", so it can come back. */
  const todaySkipped = [
    ...new Set(sameDay ? [...(prev?.skippedKeys ?? []), ...(opts.skippedKeys ?? [])] : (opts.skippedKeys ?? [])),
  ];
  const skippedToday = [
    ...state.journal.filter((j) => j.verdict === "skipped" && j.date === today).map((j) => j.garmentIds),
    ...todaySkipped.map((key) => key.split("|")),
  ];
  /* pickLook bans by core key, so the jacket must not hide a skipped look. */
  const skipKeys = [...new Set(skippedToday.flatMap((ids) => [comboKey(ids), coreComboKey(ids, state.garments)]))];
  const currentKey = prev?.garmentIds?.length ? comboKey(prev.garmentIds) : "";
  const currentCore = prev?.garmentIds?.length ? coreComboKey(prev.garmentIds, state.garments) : "";
  const skip = Boolean(opts.previousIds?.length);
  const liveIds = liveIdsKey(state.garments);
  const salt = daily
    ? drawSeed(today, TODAY_SURFACE, liveIds)
    : skip
      ? drawSeed(today, SKIP_SURFACE, liveIds, state.skipCount || 1)
      : drawSeed(today, RESHUFFLE_SURFACE, liveIds, state.reshuffleCount || 1);
  const shownWeather = opts.weather ?? prev?.weather;
  const picked = pickDropWith(
    state.garments,
    daily ? dailyPickWeather(daily.season) : shownWeather,
    occ,
    {
      salt,
      previousIds: opts.previousIds,
      lockedIds,
      repeatPairs: repeats,
      excludeKeys: [...weekKeys, ...wornKeys, ...skipKeys, currentKey, currentCore].filter(Boolean),
      skip,
      taste: state.taste,
      today,
      journal: state.journal,
      ...(daily ? { season: daily.season } : {}),
    },
  );
  return { ids: picked.ids, occ, moment, lockedIds, sameDay, todaySkipped, shownWeather, relaxed: picked.relaxed };
}

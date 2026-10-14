/**
 * The drop's pick, pure: what rerollDrop in store.ts rolls and what Today and the stylist
 * dock read when no drop for today has landed yet (today-look.ts). One assembly of the inputs
 * (pickDropIds) feeds both, so the look the page shows is the look the store would set. The
 * daily pick (daily-pick.ts): a salt from the day and the live closet, the day's bucket
 * weather, a fixed moment, no week row, no Lookbook auto-look counts; Skip and Reshuffle keep
 * their own salts. Relative imports only, no React, no store.
 */
import { DAILY_MOMENT, dailyPickWeather, dailySalt, liveIdsKey } from "./daily-pick.ts";
import { comboKey, lookCountMap } from "./lookbook.ts";
import { isLinenCampPiece, seasonFromWeather, type Season } from "./season.ts";
import {
  comfyCostume,
  coreComboKey,
  defaultOccasion,
  isMulePiece,
  momentOfDay,
  pickLook,
  weekUniformKeys,
} from "./style.ts";
import { jacketRequired } from "./stylist/jackets.ts";
import { legalWithJacket } from "./stylist/legal.ts";
import type { TasteMemory } from "./taste.ts";
import { mapOccasion, type DailyDrop, type Garment, type Look, type Moment, type Occasion, type WearEntry, type WeatherSnap } from "./types.ts";
import { todayISO } from "./utils.ts";

/** The daily pick's fixed inputs, from the Today effect: the day's frozen season bucket. */
export type DailyPick = { season: Season };

export function pickDrop(
  garments: Garment[],
  weather?: WeatherSnap,
  occasion?: Occasion,
  avoid?: Record<string, number>,
  recentWorn?: string[],
  previousIds?: string[],
  lockedIds?: string[],
  repeatPairs?: Set<string>,
  extra?: {
    salt?: number;
    usedCount?: Map<string, number>;
    excludeKeys?: string[];
    skip?: boolean;
    taste?: TasteMemory;
    /** The daily pick: the day's frozen bucket and a fixed moment, so the clock is not an input. */
    season?: Season;
    moment?: Moment;
  },
  now: Date = new Date(),
): string[] {
  const occ = occasion ?? defaultOccasion(now);
  /* A measured reading only. A missing reading stays missing; pickLook's 68 is for scoring. */
  const tempF = weather?.measured ? weather.f : undefined;
  const season = extra?.season ?? seasonFromWeather(weather?.f, now);
  const cold = season === "fall" || season === "winter";
  const ctx = { occasion: occ, season, ...(tempF !== undefined ? { weatherF: tempF } : {}) };
  const needJacket = jacketRequired(occ, season, tempF);
  return pickLook(garments, {
    weather,
    occasion: occ,
    moment: extra?.moment ?? momentOfDay(now),
    requireOuter: needJacket,
    avoid,
    recentWorn,
    previousIds,
    lockedIds,
    repeatPairs,
    salt: extra?.salt ?? 1,
    usedCount: extra?.usedCount,
    excludeKeys: extra?.excludeKeys,
    minSlotChange: extra?.skip ? 2 : 0,
    requireSilhouetteChange: Boolean(extra?.skip),
    taste: extra?.taste,
    legalCombo: (pieces) => {
      if (occ === "comfy" && comfyCostume(pieces)) return false;
      if (
        cold &&
        pieces.some(
          (g) =>
            isMulePiece(g) ||
            isLinenCampPiece(g) ||
            ((g.seasons?.length ?? 0) > 0 && g.seasons.every((s) => s === "summer")),
        )
      ) {
        return false;
      }
      return legalWithJacket(pieces, ctx);
    },
  });
}


/** The store fields the pick reads. */
export type PickState = {
  garments: Garment[];
  journal: readonly WearEntry[];
  drop: DailyDrop | null;
  avoid?: Record<string, number>;
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
};

/**
 * The ids rerollDrop would set, with the fields it writes beside them. The daily pick ignores
 * the week row, the auto-look counts and the clock; a Skip (previousIds) or Reshuffle uses its
 * own salt. Empty ids mean nothing legal: the caller keeps today's sound look.
 */
export function pickDropIds(state: PickState, opts: PickOpts = {}): PickResult {
  const today = opts.today ?? todayISO();
  const prev = state.drop;
  const sameDay = prev?.date === today;
  const occ = mapOccasion(opts.occasion ?? (sameDay ? prev?.occasion : undefined) ?? defaultOccasion());
  /* The drop shows the clock's moment; the daily pick scores against DAILY_MOMENT. */
  const moment = momentOfDay();
  const lastWorn = state.journal.find((j) => j.verdict === "worn")?.garmentIds;
  const lockedIds = sameDay ? (prev?.lockedIds ?? []) : [];
  const repeats = weekUniformKeys([...state.journal], state.garments);
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
  const salt = daily
    ? dailySalt(today, liveIdsKey(state.garments))
    : skip
      ? state.skipCount || 1
      : state.reshuffleCount || 1;
  const shownWeather = opts.weather ?? prev?.weather;
  const ids = pickDrop(
    state.garments,
    daily ? dailyPickWeather(daily.season) : shownWeather,
    occ,
    state.avoid,
    lastWorn,
    opts.previousIds,
    lockedIds,
    repeats,
    {
      salt,
      usedCount: daily ? undefined : lookCountMap([...(state.looks ?? [])]),
      excludeKeys: [...weekKeys, ...wornKeys, ...skipKeys, currentKey, currentCore].filter(Boolean),
      skip,
      taste: state.taste,
      ...(daily ? { season: daily.season, moment: DAILY_MOMENT } : {}),
    },
  );
  return { ids, occ, moment, lockedIds, sameDay, todaySkipped, shownWeather };
}

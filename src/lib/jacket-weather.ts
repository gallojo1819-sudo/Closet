/**
 * One jacket-weather reading for Today, the Lookbook, and the assistant.
 * A frozen daily high wins. Otherwise only a measured degree counts.
 * A season-bucket degree is never relabeled measured, and missing rain or
 * wind stays missing. No fetch and no invented dry default.
 */
import { jacketRequired, type JacketConditions } from "./stylist/jackets.ts";
import type { WeatherSnap } from "./types.ts";

export type JacketGateConditions = {
  highF?: number;
  wet?: boolean;
  windy?: boolean;
};

export type AtlasConditions = JacketGateConditions & {
  /** True only when a service measured the degree. A bucket reading is not this. */
  measured?: boolean;
};

export type PageJacketWeather = {
  weatherF?: number;
  conditions?: JacketGateConditions;
  measured: boolean;
};

const BUCKET_LABELS = new Set(["Mild", "Warm", "Cold"]);

export function finiteF(n: unknown): number | undefined {
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

/**
 * The jacket temperature Today already uses: frozen high, else a measured f.
 * Unmeasured and bucket degrees return undefined so the 72°F waiver cannot see them.
 */
export function jacketTempOf(input: {
  weatherF?: number;
  measured?: boolean;
  highF?: number;
  label?: string;
}): number | undefined {
  const high = finiteF(input.highF);
  if (high !== undefined) return high;
  if (!input.measured) return undefined;
  if (input.label && BUCKET_LABELS.has(input.label)) return undefined;
  return finiteF(input.weatherF);
}

/** Lookbook and the stylist page: today's snap, with the bucket degree left out of the jacket gate. */
export function pageJacketWeather(
  snap?: Pick<WeatherSnap, "f" | "label" | "measured" | "highF" | "wet" | "windy"> | null,
): PageJacketWeather {
  if (!snap) return { measured: false };
  const highF = finiteF(snap.highF);
  const bucketCarry = highF !== undefined && BUCKET_LABELS.has(snap.label);
  const measuredF = snap.measured && !bucketCarry ? finiteF(snap.f) : undefined;
  const weatherF = highF ?? measuredF;
  const wet = typeof snap.wet === "boolean" ? snap.wet : undefined;
  const windy = typeof snap.windy === "boolean" ? snap.windy : undefined;
  const conditions: JacketGateConditions = {};
  if (highF !== undefined) conditions.highF = highF;
  if (wet !== undefined) conditions.wet = wet;
  if (windy !== undefined) conditions.windy = windy;
  const has = highF !== undefined || wet !== undefined || windy !== undefined;
  return {
    ...(weatherF !== undefined ? { weatherF } : {}),
    ...(has ? { conditions } : {}),
    measured: weatherF !== undefined && (snap.measured === true || highF !== undefined),
  };
}

/**
 * What the page hands the assistant. A measured degree stays measured when rain,
 * wind, and the daily high were not sent. A bucket degree is not marked measured,
 * and missing rain or wind is not filled in as false.
 */
export function assistantConditions(page: PageJacketWeather): AtlasConditions | undefined {
  if (!page.measured && !page.conditions) return undefined;
  return {
    ...(page.measured ? { measured: true } : {}),
    ...(page.conditions?.highF !== undefined ? { highF: page.conditions.highF } : {}),
    ...(page.conditions?.wet !== undefined ? { wet: page.conditions.wet } : {}),
    ...(page.conditions?.windy !== undefined ? { windy: page.conditions.windy } : {}),
  };
}

export function jacketNeed(
  occasion: string,
  season: string,
  weatherF: number | undefined,
  conditions?: JacketGateConditions,
): boolean {
  const temp = jacketTempOf({
    weatherF,
    measured: weatherF !== undefined && conditions?.highF === undefined,
    highF: conditions?.highF,
  });
  const cond: JacketConditions | undefined =
    conditions && (conditions.wet !== undefined || conditions.windy !== undefined)
      ? { wet: conditions.wet, windy: conditions.windy }
      : undefined;
  return jacketRequired(occasion, season, temp, cond);
}

export function snapIsGated(weather?: WeatherSnap | null): boolean {
  if (!weather) return false;
  return (
    weather.measured === true ||
    finiteF(weather.highF) !== undefined ||
    typeof weather.wet === "boolean" ||
    typeof weather.windy === "boolean"
  );
}

export function requireOuterFromSnap(occasion: string, season: string, weather: WeatherSnap): boolean {
  const temp = jacketTempOf({
    weatherF: weather.f,
    measured: weather.measured === true,
    highF: weather.highF,
    label: weather.label,
  });
  return jacketRequired(occasion, season, temp, { wet: weather.wet, windy: weather.windy });
}

/**
 * The draw's weather. A bare number stays the old unmeasured snap (no waiver, no rain).
 * A gated context keeps measured, the frozen high, rain and wind, and sets requireOuter
 * with the same jacketRequired policy as Today. Season is applied by the caller only
 * when this returns requireOuter, so an unmeasured number does not move the draw.
 */
export function atlasPick(input: {
  occasion: string;
  season?: string;
  weatherF?: number;
  conditions?: AtlasConditions;
}): { weather?: WeatherSnap; requireOuter?: boolean; gated: boolean } {
  const f = finiteF(input.weatherF);
  const c = input.conditions;
  const highF = finiteF(c?.highF);
  const gated = Boolean(
    c && (c.measured === true || highF !== undefined || typeof c.wet === "boolean" || typeof c.windy === "boolean"),
  );
  if (!gated) {
    if (f === undefined) return { gated: false };
    return { gated: false, weather: { f, label: "Fair", code: 2 } };
  }
  const measured = c?.measured === true || highF !== undefined;
  const tempF = highF ?? (measured ? f : undefined);
  const snapF = f ?? highF;
  const weather: WeatherSnap = {
    f: snapF ?? 68,
    label: "Fair",
    code: 2,
    ...(measured && snapF !== undefined ? { measured: true } : {}),
    ...(highF !== undefined ? { highF } : {}),
    ...(typeof c?.wet === "boolean" ? { wet: c.wet } : {}),
    ...(typeof c?.windy === "boolean" ? { windy: c.windy } : {}),
  };
  const requireOuter =
    input.season !== undefined
      ? jacketRequired(input.occasion, input.season, tempF, { wet: c?.wet, windy: c?.windy })
      : undefined;
  return {
    gated: true,
    weather,
    ...(requireOuter !== undefined ? { requireOuter } : {}),
  };
}

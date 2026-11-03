import { createServerFn } from "@tanstack/react-start";
import type { WeatherSnap } from "./types";

// Joe confirmed 2026-11-03
export const WEATHER_THRESHOLDS = {
  WET_PCT: 50,
  WIND_MPH: 15,
  GUST_MPH: 25,
  WARM_SHEARLING_F: 65,
} as const;

const WMO: Record<number, string> = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Fog",
  51: "Drizzle",
  53: "Drizzle",
  55: "Drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Rain",
  63: "Rain",
  65: "Rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Snow",
  73: "Snow",
  75: "Snow",
  77: "Snow",
  80: "Showers",
  81: "Showers",
  82: "Showers",
  85: "Snow showers",
  86: "Snow showers",
  95: "Thunder",
  96: "Thunder",
  99: "Thunder",
};

/** Open-meteo rain, drizzle, shower, thunder and snow codes. */
export function wetWeatherCode(code: number): boolean {
  if (code >= 51 && code <= 67) return true;
  if (code >= 71 && code <= 77) return true;
  if (code >= 80 && code <= 86) return true;
  if (code >= 95 && code <= 99) return true;
  return false;
}

function finite(n: number | null | undefined): number | undefined {
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

export type WeatherExtras = {
  highF?: number | null;
  /** Current precipitation, mm. */
  precip?: number | null;
  /** Daily maximum chance of precipitation, percent. */
  precipPct?: number | null;
  windMph?: number | null;
  gustMph?: number | null;
  /** Daily maximum wind, mph. The windy gate reads this, not the current speed. */
  windMaxMph?: number | null;
  /** Daily maximum gust, mph. */
  gustMaxMph?: number | null;
};

let cached: { at: number; snap: WeatherSnap } | null = null;

/**
 * A service reading. Missing or non-finite temperature is not a snap. Wind and rain that the
 * service did not send stay unset: nothing here invents a dry or a calm day.
 */
export function readingToSnap(
  temp: number | null | undefined,
  code: number | null | undefined,
  extra?: WeatherExtras | null,
): WeatherSnap | null {
  if (typeof temp !== "number" || !Number.isFinite(temp)) return null;
  const known = typeof code === "number" && Number.isFinite(code);
  const snap: WeatherSnap = {
    f: Math.round(temp),
    code: known ? code : 0,
    label: known ? (WMO[code] ?? "Current") : "Current",
    measured: true,
  };
  const high = finite(extra?.highF);
  if (high !== undefined) snap.highF = Math.round(high);
  const precipPct = finite(extra?.precipPct);
  const precip = finite(extra?.precip);
  if (precipPct !== undefined) snap.precipPct = precipPct;
  const codeWet = known && wetWeatherCode(code);
  if (codeWet || (precipPct !== undefined && precipPct >= WEATHER_THRESHOLDS.WET_PCT) || (precip !== undefined && precip > 0)) {
    snap.wet = true;
  } else if (precipPct !== undefined || precip !== undefined) {
    snap.wet = false;
  }
  const windMax = finite(extra?.windMaxMph);
  const gustMax = finite(extra?.gustMaxMph);
  const wind = finite(extra?.windMph);
  const gust = finite(extra?.gustMph);
  const windMph = windMax ?? wind;
  const gustMph = gustMax ?? gust;
  if (windMph !== undefined) snap.windMph = windMph;
  if (gustMph !== undefined) snap.gustMph = gustMph;
  if (
    (windMax !== undefined && windMax >= WEATHER_THRESHOLDS.WIND_MPH) ||
    (gustMax !== undefined && gustMax >= WEATHER_THRESHOLDS.GUST_MPH)
  ) {
    snap.windy = true;
  } else if (windMax !== undefined || gustMax !== undefined) {
    snap.windy = false;
  }
  return snap;
}

export const getNycWeather = createServerFn({ method: "POST" }).handler(
  async (): Promise<WeatherSnap | null> => {
    if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.snap;
    try {
      const url =
        "https://api.open-meteo.com/v1/forecast?latitude=40.71&longitude=-74.01&current=temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m,precipitation&daily=temperature_2m_max,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FNew_York&forecast_days=1";
      const res = await fetch(url);
      if (!res.ok) return cached?.snap ?? null;
      const json = (await res.json()) as {
        current?: {
          temperature_2m?: number;
          weather_code?: number;
          wind_speed_10m?: number;
          wind_gusts_10m?: number;
          precipitation?: number;
        };
        daily?: {
          temperature_2m_max?: number[];
          precipitation_probability_max?: number[];
          wind_speed_10m_max?: number[];
          wind_gusts_10m_max?: number[];
        };
      };
      const snap = readingToSnap(json.current?.temperature_2m, json.current?.weather_code, {
        highF: json.daily?.temperature_2m_max?.[0],
        precip: json.current?.precipitation,
        precipPct: json.daily?.precipitation_probability_max?.[0],
        windMph: json.current?.wind_speed_10m,
        gustMph: json.current?.wind_gusts_10m,
        windMaxMph: json.daily?.wind_speed_10m_max?.[0],
        gustMaxMph: json.daily?.wind_gusts_10m_max?.[0],
      });
      if (!snap) return cached?.snap ?? null;
      cached = { at: Date.now(), snap };
      return snap;
    } catch {
      return cached?.snap ?? null;
    }
  },
);

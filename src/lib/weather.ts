import { createServerFn } from "@tanstack/react-start";
import type { WeatherSnap } from "./types";

const WMO: Record<number, string> = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Fog",
  51: "Drizzle",
  61: "Rain",
  63: "Rain",
  71: "Snow",
  80: "Showers",
  95: "Thunder",
};

let cached: { at: number; snap: WeatherSnap } | null = null;

/** A service reading. Missing or non-finite temperature is not a snap. */
export function readingToSnap(
  temp: number | null | undefined,
  code: number | null | undefined,
): WeatherSnap | null {
  if (typeof temp !== "number" || !Number.isFinite(temp)) return null;
  const known = typeof code === "number" && Number.isFinite(code);
  return {
    f: Math.round(temp),
    code: known ? code : 0,
    label: known ? (WMO[code] ?? "Current") : "Current",
    measured: true,
  };
}

export const getNycWeather = createServerFn({ method: "POST" }).handler(
  async (): Promise<WeatherSnap | null> => {
    if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.snap;
    try {
      const url =
        "https://api.open-meteo.com/v1/forecast?latitude=40.71&longitude=-74.01&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=America%2FNew_York";
      const res = await fetch(url);
      if (!res.ok) return cached?.snap ?? null;
      const json = (await res.json()) as {
        current?: { temperature_2m?: number; weather_code?: number };
      };
      const snap = readingToSnap(json.current?.temperature_2m, json.current?.weather_code);
      if (!snap) return cached?.snap ?? null;
      cached = { at: Date.now(), snap };
      return snap;
    } catch {
      return cached?.snap ?? null;
    }
  },
);

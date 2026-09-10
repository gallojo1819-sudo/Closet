import { createServerFn } from "@tanstack/react-start";
import type { WeatherSnap } from "./types";

const FALLBACK: WeatherSnap = { f: 68, label: "Fair", code: 2 };

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

export const getNycWeather = createServerFn({ method: "POST" }).handler(
  async (): Promise<WeatherSnap> => {
    if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.snap;
    try {
      const url =
        "https://api.open-meteo.com/v1/forecast?latitude=40.71&longitude=-74.01&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=America%2FNew_York";
      const res = await fetch(url);
      if (!res.ok) return cached?.snap ?? FALLBACK;
      const json = (await res.json()) as {
        current?: { temperature_2m?: number; weather_code?: number };
      };
      const f = Math.round(json.current?.temperature_2m ?? FALLBACK.f);
      const code = json.current?.weather_code ?? 2;
      const snap = { f, code, label: WMO[code] ?? "Fair" };
      cached = { at: Date.now(), snap };
      return snap;
    } catch {
      return cached?.snap ?? FALLBACK;
    }
  },
);

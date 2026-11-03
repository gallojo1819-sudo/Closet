import { describe, expect, it } from "vitest";
import { WEATHER_THRESHOLDS, readingToSnap, wetWeatherCode } from "./weather.ts";

describe("readingToSnap", () => {
  it("keeps a plain temperature reading and does not invent wind or rain", () => {
    expect(readingToSnap(undefined, 2)).toBeNull();
    expect(readingToSnap(Number.NaN, 1)).toBeNull();
    const snap = readingToSnap(74.2, 1);
    expect(snap).toEqual({ f: 74, code: 1, label: "Mostly clear", measured: true });
    expect(snap?.wet).toBeUndefined();
    expect(snap?.windy).toBeUndefined();
    expect(snap?.highF).toBeUndefined();
    expect(snap?.windMph).toBeUndefined();
    expect(snap?.gustMph).toBeUndefined();
    expect(snap?.precipPct).toBeUndefined();
  });

  it("classifies rain, snow, thunder and the proposed thresholds, and leaves gaps unset", () => {
    expect(WEATHER_THRESHOLDS).toEqual({ WET_PCT: 50, WIND_MPH: 15, GUST_MPH: 25, WARM_SHEARLING_F: 65 });
    const wet = readingToSnap(60, 0, { precipPct: 50, precip: 0, windMaxMph: 14, gustMaxMph: 24 });
    expect(wet?.wet).toBe(true);
    expect(wet?.windy).toBe(false);
    expect(wet?.precipPct).toBe(50);
    const raining = readingToSnap(60, 2, { precip: 0.2, precipPct: 10 });
    expect(raining?.wet).toBe(true);
    const dry = readingToSnap(60, 0, { precipPct: 49, precip: 0, windMaxMph: 14.9, gustMaxMph: 24.9 });
    expect(dry?.wet).toBe(false);
    expect(dry?.windy).toBe(false);
    const gusty = readingToSnap(55, 3, { windMaxMph: 10, gustMaxMph: 25 });
    expect(gusty?.windy).toBe(true);
    expect(gusty?.windMph).toBe(10);
    expect(gusty?.gustMph).toBe(25);
    const windy = readingToSnap(55, 1, { windMaxMph: 15, gustMaxMph: 0 });
    expect(windy?.windy).toBe(true);
    const currentOnly = readingToSnap(55, 1, { windMph: 40, gustMph: 50, precip: undefined });
    expect(currentOnly?.windy).toBeUndefined();
    expect(currentOnly?.wet).toBeUndefined();
    expect(currentOnly?.windMph).toBe(40);
    expect(readingToSnap(40, 61)?.wet).toBe(true);
    expect(readingToSnap(40, 61)?.label).toBe("Rain");
    expect(readingToSnap(30, 73)?.label).toBe("Snow");
    expect(readingToSnap(70, 95)?.label).toBe("Thunder");
    expect(readingToSnap(50, 85)?.label).toBe("Snow showers");
    expect(readingToSnap(48, 56)?.label).toBe("Freezing drizzle");
    expect(readingToSnap(62, 2, { highF: 64.6 })?.highF).toBe(65);
    for (const code of [51, 67, 71, 77, 80, 86, 95, 99]) expect(wetWeatherCode(code), String(code)).toBe(true);
    expect(wetWeatherCode(0)).toBe(false);
    expect(wetWeatherCode(45)).toBe(false);
  });
});

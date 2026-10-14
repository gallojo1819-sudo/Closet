/**
 * Today is pinned: the day's first pick is a function of the day, the live closet and the
 * day's season bucket. On the snapshot closet, ten daily picks across one day (the clock moved
 * from morning to evening, the memory-only week row present or absent, the reading moved
 * inside the fall bucket) give one look; a different day may give another. Nothing is written:
 * the persist gate stays closed, as the Today effect keeps it for an automatic pick.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DAILY_MOMENT, dailySalt, dailyPickWeather, freezeSeason, liveIdsKey, readFrozenSeason } from "./daily-pick.ts";
import { persistGate, useCloset } from "./store.ts";
import { emptyTaste } from "./taste.ts";
import type { Garment, Look, WeatherSnap } from "./types.ts";
import { liveSnapshot } from "./__fixtures__/snapshot.ts";

const CLOSET: Garment[] = liveSnapshot;
const TODAY = "2026-10-14";
const TOMORROW = "2026-10-15";
/* Local-time instants inside one day: morning, midday, evening. */
const CLOCKS = ["T07:30:00", "T12:00:00", "T19:45:00"] as const;
/* Readings inside the fall bucket (55 ≤ f < 75) and a label that moves with them. */
const READINGS: WeatherSnap[] = [
  { f: 58, label: "Overcast", code: 3, measured: true },
  { f: 66, label: "Clear", code: 0, measured: true },
  { f: 73, label: "Partly cloudy", code: 2, measured: true },
];

function weekRow(ids: string[][]): Look[] {
  return ids.map((garmentIds, i) => ({
    id: `week_${i}`,
    name: "week",
    occasion: "weekday",
    garmentIds,
    source: "ai",
    lookbook: true,
    createdAt: `${TODAY}T00:00:00.000Z`,
  }));
}

/** One daily pick from a clean drop, under the given clock, reading and week row. */
function dailyPick(day: string, clock: string, weather: WeatherSnap, thisWeek: Look[]): string[] {
  vi.setSystemTime(new Date(`${day}${clock}`));
  useCloset.setState({ drop: null, thisWeek });
  const wrote = useCloset.getState().rerollDrop(weather, "weekday", undefined, undefined, { season: "fall" });
  expect(wrote).toBe(true);
  return [...(useCloset.getState().drop?.garmentIds ?? [])];
}

let gateWas = false;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T09:00:00`));
  gateWas = persistGate.open;
  persistGate.open = false;
  useCloset.setState({
    garments: CLOSET,
    looks: [],
    journal: [],
    avoid: {},
    taste: emptyTaste(),
    drop: null,
    thisWeek: [],
    skipCount: 0,
    reshuffleCount: 0,
    hydrated: true,
  });
});

afterAll(() => {
  persistGate.open = gateWas;
  vi.useRealTimers();
});

describe("the daily pick's fixed inputs", () => {
  it("the salt is the day and the sorted live ids, nothing else", () => {
    const key = liveIdsKey(CLOSET);
    expect(key.split(",")).toEqual([...key.split(",")].sort());
    expect(liveIdsKey([...CLOSET].reverse())).toBe(key);
    expect(dailySalt(TODAY, key)).toBe(dailySalt(TODAY, key));
    expect(dailySalt(TODAY, key)).not.toBe(dailySalt(TOMORROW, key));
    expect(dailySalt(TODAY, key)).not.toBe(dailySalt(TODAY, liveIdsKey(CLOSET.slice(1))));
    expect(dailySalt(TODAY, key)).toBeGreaterThan(0);
    const archived = [{ ...CLOSET[0]!, archived: true }, ...CLOSET.slice(1)];
    expect(liveIdsKey(archived)).toBe(liveIdsKey(CLOSET.slice(1)));
  });

  it("the pick's weather is the bucket's reading, unmeasured, and the moment is fixed", () => {
    for (const season of ["spring", "summer", "fall", "winter"] as const) {
      const w = dailyPickWeather(season);
      expect(w.measured).toBeUndefined();
      expect(Number.isFinite(w.f)).toBe(true);
    }
    expect(dailyPickWeather("fall")).toEqual(dailyPickWeather("fall"));
    expect(DAILY_MOMENT).toBe("day");
  });

  it("the season bucket freezes on first sight for the day and thaws the next day", () => {
    expect(freezeSeason(null, TODAY, "fall")).toEqual({ season: "fall", next: { date: TODAY, season: "fall" } });
    const frozen = { date: TODAY, season: "fall" as const };
    expect(freezeSeason(frozen, TODAY, "winter")).toEqual({ season: "fall", next: null });
    expect(freezeSeason(frozen, TOMORROW, "winter")).toEqual({ season: "winter", next: { date: TOMORROW, season: "winter" } });
    expect(readFrozenSeason(JSON.stringify(frozen))).toEqual(frozen);
    expect(readFrozenSeason("{bad")).toBeNull();
    expect(readFrozenSeason(JSON.stringify({ date: TODAY, season: "monsoon" }))).toBeNull();
    expect(readFrozenSeason(null)).toBeNull();
  });
});

describe("ten daily picks on the snapshot closet, one day", () => {
  it("give one look whatever the clock, the week row or the reading inside the bucket", () => {
    const picks: { ids: string[]; how: string }[] = [];
    const week = weekRow([
      CLOSET.slice(0, 3).map((g) => g.id),
      CLOSET.slice(3, 6).map((g) => g.id),
      CLOSET.slice(6, 9).map((g) => g.id),
    ]);
    let n = 0;
    for (const clock of CLOCKS) {
      for (const reading of READINGS) {
        const thisWeek = n % 2 ? week : [];
        picks.push({ ids: dailyPick(TODAY, clock, reading, thisWeek), how: `${clock} ${reading.f}° week:${thisWeek.length}` });
        n += 1;
      }
    }
    picks.push({ ids: dailyPick(TODAY, "T23:59:00", READINGS[0]!, week), how: "late, cool, week row" });
    expect(picks.length).toBeGreaterThanOrEqual(10);
    const first = picks[0]!.ids;
    expect(first.length).toBeGreaterThanOrEqual(3);
    for (const pick of picks) expect(pick.ids, pick.how).toEqual(first);
    /* The drop still shows the live reading and the clock's moment; only the pick ignores them. */
    const drop = useCloset.getState().drop!;
    expect(drop.weather?.f).toBe(READINGS[0]!.f);
    expect(drop.moment).toBe("evening");
    expect(drop.date).toBe(TODAY);
    expect(drop.setAt, "an automatic pick carries no setAt stamp").toBeUndefined();
  });

  it("the live reading alone, inside the bucket, moves nothing; a different day may differ", () => {
    const a = dailyPick(TODAY, CLOCKS[1], { f: 56, label: "Cool", code: 3, measured: true }, []);
    const b = dailyPick(TODAY, CLOCKS[1], { f: 74, label: "Warm", code: 0, measured: true }, []);
    expect(a).toEqual(b);
    const other = dailyPick(TOMORROW, CLOCKS[1], READINGS[1]!, []);
    expect(other.length).toBeGreaterThanOrEqual(3);
    /* Only noted: tomorrow's salt differs, so the look usually does; equality is not a failure. */
    console.log(`today-pin: ${TODAY} ${a.join(",")} | ${TOMORROW} ${other.join(",")}`);
  });

  it("a Skip still moves the look (its own salt), and the next daily pick is the day's look again", () => {
    const daily = dailyPick(TODAY, CLOCKS[0], READINGS[1]!, []);
    useCloset.setState({ skipCount: 1 });
    const skipped = useCloset.getState().rerollDrop(READINGS[1]!, "weekday", daily, undefined);
    expect(skipped).toBe(true);
    const afterSkip = [...(useCloset.getState().drop?.garmentIds ?? [])];
    expect(afterSkip).not.toEqual(daily);
    useCloset.setState({ skipCount: 0 });
    expect(dailyPick(TODAY, CLOCKS[2], READINGS[2]!, [])).toEqual(daily);
  });
});

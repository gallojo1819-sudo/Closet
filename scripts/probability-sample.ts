/**
 * A read-only sample of the probability round on the real snapshot closet
 * (src/lib/__fixtures__/engine-garments.json). Prints:
 *   - Today for seven consecutive New York dates, for Weekday, Weekend and Out in fall, with
 *     simulated in-memory wear (each day's look is "worn" before the next), piece names per day;
 *   - Today's Suggest alternates for two dates;
 *   - the Lookbook header's resolution states.
 * Nothing is written: no store, no localStorage, no network.
 *
 *   node --experimental-strip-types scripts/probability-sample.ts
 */
import { dailyPickWeather, liveIdsKey } from "../src/lib/daily-pick.ts";
import { drawSeed } from "../src/lib/draw.ts";
import { pickDropWith } from "../src/lib/drop-pick.ts";
import { FINDING_LOOKS, lookbookCountLine } from "../src/lib/lookbook-status.ts";
import { todaySuggestions } from "../src/lib/today-suggest.ts";
import type { Garment, Occasion, WearEntry } from "../src/lib/types.ts";
import { liveSnapshot } from "../src/lib/__fixtures__/snapshot.ts";

const CLOSET: Garment[] = liveSnapshot;
const BY_ID = new Map(CLOSET.map((g) => [g.id, g]));
const LIVE_IDS = liveIdsKey(CLOSET);
const START = process.argv[2] ?? "2026-10-15";
const SEASON = "fall" as const;

function dateAfter(days: number): string {
  const d = new Date(`${START}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const names = (ids: readonly string[]) => ids.map((id) => BY_ID.get(id)?.name ?? id).join(" / ");

console.log(`Closet: ${CLOSET.length} live pieces (the snapshot). Season bucket: ${SEASON}. Dates from ${START} (New York).\n`);

for (const occasion of ["weekday", "weekend", "out"] as Occasion[]) {
  console.log(`Today · ${occasion} · ${SEASON} (each day's look worn before the next)`);
  const journal: Pick<WearEntry, "date" | "garmentIds" | "verdict">[] = [];
  for (let i = 0; i < 7; i += 1) {
    const date = dateAfter(i);
    const picked = pickDropWith(CLOSET, dailyPickWeather(SEASON), occasion, {
      salt: drawSeed(date, "today", LIVE_IDS),
      season: SEASON,
      today: date,
      journal,
    });
    const waived = picked.relaxed.length ? `  [waived: ${picked.relaxed.join(", ")}]` : "";
    console.log(`  ${date}  ${picked.ids.length ? names(picked.ids) : "(no rule-passing look)"}${waived}`);
    if (picked.ids.length) journal.unshift({ date, garmentIds: picked.ids, verdict: "worn" });
  }
  console.log("");
}

console.log("Today's Suggest alternates (weekday · fall)");
for (const date of [dateAfter(0), dateAfter(1)]) {
  const today = pickDropWith(CLOSET, dailyPickWeather(SEASON), "weekday", { salt: drawSeed(date, "today", LIVE_IDS), season: SEASON, today: date }).ids;
  const got = todaySuggestions({ garments: CLOSET, journal: [], drop: null }, { todayIds: today, occasion: "weekday", season: SEASON, today: date });
  console.log(`  ${date}  today: ${names(today)}`);
  if (got.alternates.length === 0) console.log(`           ${got.reason}`);
  for (const [i, alt] of got.alternates.entries()) console.log(`           alternate ${i + 1}: ${names(alt.ids)}${alt.relaxed.length ? ` [waived: ${alt.relaxed.join(", ")}]` : ""}`);
}
console.log("");

console.log("Lookbook header resolution states");
for (const [resolved, count] of [
  [false, 0],
  [false, 12],
  [true, 0],
  [true, 12],
] as const) {
  console.log(`  resolved=${resolved} count=${count}: "${lookbookCountLine({ resolved, count, chapter: "weekday", season: SEASON })}"${!resolved ? ` (${FINDING_LOOKS === lookbookCountLine({ resolved, count, chapter: "weekday", season: SEASON }) ? "never a number" : "?"})` : ""}`);
}

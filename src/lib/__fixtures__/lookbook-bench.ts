/**
 * R10 Lookbook speed bench + golden. Pure engine, no network, no Supabase, clock pinned.
 * Mirrors the Lookbook page's one-pass order (lookbook.tsx): dressWeek -> recordPage(week)
 * -> visibleDetectors + rowWays(onScreen = week ids, leadIds = week leads) -> recordPage(rows).
 *
 *   node --experimental-strip-types src/lib/__fixtures__/lookbook-bench.ts time [weekend|weekday|out]
 *   node --experimental-strip-types src/lib/__fixtures__/lookbook-bench.ts golden > /tmp/golden.json
 *
 * Run `time` one occasion per process (module caches start cold, like a fresh app open).
 */
import { register } from "node:module";
import { mock } from "node:test";
import { readFileSync } from "node:fs";
import type { Garment, Occasion, Season } from "../types.ts";

register(new URL("../../../scripts/ts-ext.mjs", import.meta.url), { parentURL: import.meta.url });

export const BENCH_NOW = Date.parse("2026-11-14T20:00:00.000Z"); // 3 PM ET, Sat
export const BENCH_SEASON: Season = "winter";
/** Open-Meteo NYC 2026-11-14 ~3:45 PM ET, as pageJacketWeather reads a measured snap with a high. */
export const BENCH_WEATHER_F = 44.4;
export const BENCH_CONDITIONS = { highF: 44.4, wet: false, windy: false };
export const BENCH_FIXTURE = new URL("./lookbook-closet-2026-11-14.json", import.meta.url);

const det = await import("../detectors.ts");
const lb = await import("../lookbook.ts");
const { advanceRotation, emptyRotation } = await import("../rotation.ts");
const { weekLeadPiece } = await import("../look.ts");
const { emptyTaste } = await import("../taste.ts");
const { livePool } = await import("../rack.ts");
const { sittingPieceId } = await import("../gaps.ts");
const { sneakerPiece } = await import("../outfit-rules.ts");

export const benchCloset = livePool(JSON.parse(readFileSync(BENCH_FIXTURE, "utf8")) as Garment[]);

export type BenchPage = { week: string[][]; rows: { id: string; title: string; looks: string[][] }[]; ms: Record<string, number> };

export type BenchOpts = {
  season?: Season;
  weatherF?: number;
  conditions?: { highF: number; wet: boolean; windy: boolean };
  salt?: number;
  /** Overrides the sitting-piece pin. Null dresses with no pin. */
  pin?: string | null;
};

export function benchPage(occasion: Occasion, garments: Garment[] = benchCloset, opts: BenchOpts = {}): BenchPage {
  mock.timers.enable({ apis: ["Date"], now: BENCH_NOW });
  try {
    const ms: Record<string, number> = {};
    const t = <T>(k: string, fn: () => T): T => { const a = performance.now(); const r = fn(); ms[k] = Math.round(performance.now() - a); return r; };
    const season = opts.season ?? BENCH_SEASON;
    const weatherF = opts.weatherF ?? BENCH_WEATHER_F;
    const conditions = opts.conditions ?? { ...BENCH_CONDITIONS, highF: weatherF };
    const salt = opts.salt ?? 0;
    const taste = emptyTaste();
    let rotation = emptyRotation();
    const twins = det.twinGroups(garments);
    const record = (page: string[][]) => {
      rotation = advanceRotation(rotation, {
        page,
        closet: garments.map((g) => g.id),
        eligible: det.rotationEligible(garments, season, taste).map((g) => g.id),
        alike: new Map(garments.map((g) => [g.id, twins.key(g)])),
      }).next;
    };
    const pin = opts.pin === undefined ? sittingPieceId(garments) : opts.pin;
    const built = t("weekRotationRow", () => det.weekRotationRow(garments, { occasion, season, color: null, weatherF, conditions, taste, rotation, cap: 8, salt, pin } as never));
    const weekLooks = det.capScreenLooks(lb.realWeekLooks(lb.looksFromRows(built.looks, occasion, built.demoted), new Set(garments.map((g) => g.id))));
    const week = weekLooks.map((l) => [...l.garmentIds]);
    record(built.looks.map((look) => look.map((g) => g.id)));
    const byId = new Map(garments.map((g) => [g.id, g]));
    const leadIds = week.map((ids) => weekLeadPiece(ids.map((id) => byId.get(id)!))?.id).filter((x): x is string => Boolean(x));
    const found = t("visibleDetectors", () => det.visibleDetectors(garments, { occasion, season, color: null, weatherF, conditions, salt }));
    const shoePrior = {
      cards: week.length,
      sneakers: week.filter((ids) => ids.some((id) => { const g = byId.get(id); return g ? sneakerPiece(g) : false; })).length,
    };
    const shown = t("rowWays", () => det.rowWays(found, garments, { occasion, season, color: null, weatherF, conditions, salt, onScreen: week.flat(), leadIds, rotation, stuck: new Set(built.unpairable.map((g) => g.id)), pin, shoePrior } as never));
    record(shown.flatMap((w) => (w.looks[occasion] ?? []).map((look) => look.map((g) => g.id))));
    return { week, rows: shown.map((w) => ({ id: w.id, title: w.title, looks: (w.looks[occasion] ?? []).map((l) => l.map((g) => g.id)) })), ms };
  } finally {
    mock.timers.reset();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2] ?? "time";
  const occs = (process.argv[3] ? [process.argv[3]] : ["weekend", "weekday", "out"]) as Occasion[];
  if (mode === "golden") {
    const out: Record<string, Omit<BenchPage, "ms">> = {};
    for (const o of occs) { const { week, rows } = benchPage(o); out[o] = { week, rows }; }
    process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
  } else {
    for (const o of occs) { const p = benchPage(o); console.log(`${o} pieces=${benchCloset.length} ${JSON.stringify(p.ms)} rows=${p.rows.length} cards=${p.week.length + p.rows.reduce((n, r) => n + r.looks.length, 0)}`); }
  }
}

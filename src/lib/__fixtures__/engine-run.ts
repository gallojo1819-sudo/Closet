/**
 * Equivalence run for the engine speed work. 142 stripped pieces (engine-garments.json:
 * real ids, which the rule JSON keys on; names built from colour, material and subtype;
 * no brand, notes or wear dates), clock frozen,
 * same call order every time (the matrix counts jackets across builds).
 */
import { register } from "node:module";
import { mock } from "node:test";
import { readFileSync } from "node:fs";
import type { Garment, WeatherSnap } from "../types.ts";

register(new URL("../../../scripts/ts-ext.mjs", import.meta.url), {
  parentURL: import.meta.url,
});

const { buildHouseMatrix } = await import("../stylist/matrix.ts");
const { buildReshuffleRow, buildWeek, lookbookPool } = await import("../lookbook.ts");
const { visibleDetectors } = await import("../detectors/cells.ts");
const { pickDrop } = await import("../store.ts");
const { HOUSES } = await import("../houses.ts");

export const ENGINE_NOW = Date.parse("2026-10-09T15:00:00.000Z");
export const SNAPSHOT_URL = new URL("./engine-snapshot.json", import.meta.url);
export const engineGarments = JSON.parse(
  readFileSync(new URL("./engine-garments.json", import.meta.url), "utf8"),
) as Garment[];

const plain = (x: unknown) => JSON.parse(JSON.stringify(x)) as unknown;

export function runEngine(garments: Garment[] = engineGarments): Record<string, unknown> {
  mock.timers.enable({ apis: ["Date"], now: ENGINE_NOW });
  try {
    const pool = lookbookPool(garments);
    const weather = { f: 62, label: "Mild", code: 2, measured: true } as WeatherSnap;
    const out: Record<string, unknown> = {};
    out.matrixWeekdayFall = plain(buildHouseMatrix(pool, "weekday", "fall"));
    out.matrixWeekendFall = plain(buildHouseMatrix(pool, "weekend", "fall"));
    out.matrixWeekdayWinter = plain(buildHouseMatrix(pool, "weekday", "winter"));
    out.rowWeekday = plain(buildReshuffleRow(garments, "weekday", { season: "fall", salt: 1, cap: 7 }));
    out.rowWeekend = plain(buildReshuffleRow(garments, "weekend", { season: "fall", salt: 1, cap: 8 }));
    out.rowHouse = plain(buildReshuffleRow(garments, "out", { house: HOUSES[0], season: "fall", salt: 2, cap: 8 }));
    out.week = plain(buildWeek(garments, "2026-10-09"));
    out.drop = plain(
      pickDrop(garments, weather, "weekday", undefined, undefined, undefined, undefined, undefined, { salt: 1 }, new Date(ENGINE_NOW)),
    );
    out.ways = plain(
      visibleDetectors(garments, { occasion: "weekday", season: "fall" }).map((way) => ({
        id: way.id,
        title: way.title,
        counts: way.counts,
        usual: way.usual,
        pieces: way.pieces.map((g) => g.id),
        looks: Object.fromEntries(
          Object.entries(way.looks).map(([occ, rows]) => [occ, (rows ?? []).map((row) => row.map((g) => g.id))]),
        ),
      })),
    );
    return out;
  } finally {
    mock.timers.reset();
  }
}

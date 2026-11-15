/**
 * R10 Lookbook speed. The golden must match the 2026-11-14 page on weekend,
 * weekday and out. The bench case is off unless CLOSET_BENCH=1, so CI time
 * stays put; VERIFY runs it with BASE_MS from the base rowWays sum.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Occasion } from "./types.ts";

register(new URL("../../scripts/ts-ext.mjs", import.meta.url), {
  parentURL: import.meta.url,
});

const { benchPage } = await import("./__fixtures__/lookbook-bench.ts");

const GOLDEN_URL = new URL("./__fixtures__/lookbook-golden-2026-11-14.json", import.meta.url);
const BENCH_URL = new URL("./__fixtures__/lookbook-bench.ts", import.meta.url);
const OCCASIONS = ["weekend", "weekday", "out"] as const satisfies readonly Occasion[];

type GoldenPage = { week: string[][]; rows: { id: string; title: string; looks: string[][] }[] };

describe("lookbook speed", () => {
  it("matches the 2026-11-14 golden on weekend, weekday and out", () => {
    const golden = JSON.parse(readFileSync(GOLDEN_URL, "utf8")) as Record<Occasion, GoldenPage>;
    for (const occasion of OCCASIONS) {
      const page = benchPage(occasion);
      assert.deepEqual({ week: page.week, rows: page.rows }, golden[occasion], occasion);
    }
  });

  it("rowWays is at least 20% under the base", { skip: !process.env.CLOSET_BENCH, timeout: 300_000 }, () => {
    const baseSum = Number(process.env.BASE_MS);
    const baseWeekend = Number(process.env.BASE_ROW_WEEKEND);
    const baseWeekday = Number(process.env.BASE_ROW_WEEKDAY);
    assert.ok(baseSum > 0, "CLOSET_BENCH requires BASE_MS, the base rowWays sum");
    assert.ok(baseWeekend > 0, "CLOSET_BENCH requires BASE_ROW_WEEKEND");
    assert.ok(baseWeekday > 0, "CLOSET_BENCH requires BASE_ROW_WEEKDAY");
    const times: Record<string, number> = {};
    for (const occasion of OCCASIONS) {
      const res = spawnSync(
        process.execPath,
        ["--experimental-strip-types", BENCH_URL.pathname, "time", occasion],
        { encoding: "utf8" },
      );
      assert.equal(res.status, 0, res.stderr || res.stdout);
      const matched = res.stdout.match(/"rowWays":(\d+)/);
      assert.ok(matched, res.stdout);
      times[occasion] = Number(matched[1]);
    }
    const sum = times.weekend + times.weekday + times.out;
    console.log(`lookbook-bench head rowWays ${JSON.stringify(times)} sum=${sum} baseSum=${baseSum}`);
    assert.ok(sum <= baseSum * 0.8, `rowWays sum ${sum} is not ≤ 0.8 × ${baseSum}`);
    assert.ok(times.weekend <= baseWeekend * 0.8, `weekend ${times.weekend} is not ≤ 0.8 × ${baseWeekend}`);
    assert.ok(times.weekday <= baseWeekday * 0.8, `weekday ${times.weekday} is not ≤ 0.8 × ${baseWeekday}`);
  });
});

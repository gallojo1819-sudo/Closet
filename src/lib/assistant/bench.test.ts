/**
 * Runs the scripted Closet bench on the owner's real closet and prints one summary line:
 * `closet-bench scripted: <passed>/<run> passed, <gaps> known engine gaps, <skipped> skipped,
 * snapshot pieces: <LIVE_SNAPSHOT_COUNT>`, then one line per plan row. A run scenario that
 * fails and is not a listed known engine gap fails the test with its problems; so does a listed
 * gap whose pass condition now holds.
 */
import { describe, expect, it } from "vitest";
import { LIVE_SNAPSHOT_COUNT } from "../__fixtures__/snapshot.ts";
import { reportTable, runBench, SCENARIOS, SKIPPED, summaryLine } from "./bench.ts";

const PLAN_RUN = [...Array.from({ length: 21 }, (_, i) => i + 1), 28, 29];

describe("closet-bench (scripted)", () => {
  it("numbers the scenarios as the plan's Closet-bench table does: 1-21, 28 and 29 run, 22-27 and 30 skipped", () => {
    const run = [...new Set(SCENARIOS.map((s) => s.n))];
    expect(run).toEqual(PLAN_RUN);
    expect(SKIPPED.map((s) => s.n)).toEqual([22, 23, 24, 25, 26, 27, 30]);
    for (const s of SKIPPED.filter((x) => x.n <= 27)) expect(s.reason).toBe("memory notes and approval cards: Round 3");
    expect(SKIPPED.find((s) => s.n === 30)?.reason).toBe("xAI down / dock fallback needs the server function: Round 2");
    expect(new Set([...run, ...SKIPPED.map((s) => s.n)]).size).toBe(30);
    /* Saving looks, logging wears and skipping are not tools, ever: no skip reason says so. */
    for (const s of SKIPPED) expect(s.reason).not.toMatch(/write tool|journal|\blooks?\b|\bskip/i);
    for (const s of SCENARIOS) expect(s.passWhen.length).toBeGreaterThan(0);
  });

  it("passes every run scenario on the snapshot, apart from the listed known engine gaps", async () => {
    const report = await runBench();
    console.log(summaryLine(report));
    for (const line of reportTable(report)) console.log(`  ${line}`);
    for (const r of report.failed) console.log(`  #${r.n}${r.part ? ` (${r.part})` : ""} ${r.title}: ${[...r.problems, ...r.rowProblems].join("; ")}\n    ${r.run.text}`);
    expect(report.snapshotPieces).toBe(LIVE_SNAPSHOT_COUNT);
    expect(summaryLine(report)).toBe(
      `closet-bench scripted: ${report.passed}/${report.run} passed, ${report.gaps.length} known engine gaps, ${SKIPPED.length} skipped, snapshot pieces: ${LIVE_SNAPSHOT_COUNT}`,
    );
    expect(report.run).toBe(PLAN_RUN.length);
    expect(report.failed.map((r) => `#${r.n} ${r.title}: ${[...r.problems, ...r.rowProblems].join("; ")}`)).toEqual([]);
    /* The known gaps today: jeans under the blazer on weekday (8), the fair isle offered for out (10), no shorts owned (17). */
    expect(report.gaps.map((r) => r.n)).toEqual([8, 10, 17]);
    for (const r of report.gaps) expect(r.problems).toEqual([]);
    expect(report.passed + report.gaps.length).toBe(report.run);
  });
});

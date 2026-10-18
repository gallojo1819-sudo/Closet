/**
 * Runs the scripted Closet bench on the owner's real closet and prints one summary line:
 * `closet-bench scripted: <passed>/<run> passed, <skipped> skipped, snapshot pieces: <LIVE_SNAPSHOT_COUNT>`.
 * Any failing scenario fails the test with its problems listed.
 */
import { describe, expect, it } from "vitest";
import { LIVE_SNAPSHOT_COUNT } from "../__fixtures__/snapshot.ts";
import { runBench, SCENARIOS, SKIPPED, summaryLine } from "./bench.ts";

describe("closet-bench (scripted)", () => {
  it("covers scenarios 1-21, 28 and 29 and skips 22-27 and 30 with a reason", () => {
    const run = SCENARIOS.map((s) => s.n);
    expect(run).toEqual([...Array.from({ length: 21 }, (_, i) => i + 1), 28, 29]);
    expect(SKIPPED.map((s) => s.n)).toEqual([22, 23, 24, 25, 26, 27, 30]);
    for (const s of SKIPPED) expect(s.reason).toMatch(/Round [23]/);
    expect(new Set([...run, ...SKIPPED.map((s) => s.n)]).size).toBe(30);
  });

  it("passes every run scenario on the snapshot", async () => {
    const report = await runBench();
    console.log(summaryLine(report));
    for (const r of report.results.filter((x) => !x.ok)) console.log(`  #${r.n} ${r.title}: ${r.problems.join("; ")}\n    ${r.run.text}`);
    expect(report.snapshotPieces).toBe(LIVE_SNAPSHOT_COUNT);
    expect(summaryLine(report)).toBe(`closet-bench scripted: ${report.passed}/${report.run} passed, ${SKIPPED.length} skipped, snapshot pieces: ${LIVE_SNAPSHOT_COUNT}`);
    expect(report.results.filter((r) => !r.ok).map((r) => `#${r.n} ${r.title}: ${r.problems.join("; ")}`)).toEqual([]);
    expect(report.passed).toBe(report.run);
  });
});

/**
 * Record the engine outputs engine-speed.test.ts pins (runEngine on the snapshot closet). First
 * run on the pre-speed base (58d7b8c); re-run on Oct 15 2026 for the probability round, when
 * every output became a seeded draw among rule-passing looks and the pinned values changed by
 * design; re-run on Oct 21 2026 when underHit (jackets.ts) made a plain tee or henley under a
 * structured sport coat a JKT-LAY-2 fail again (the weekend/fall matrix moved the henley from the
 * ivory double-breasted blazer to the taupe one). Run it only when the engine's outputs are
 * meant to change:
 *
 *   node --experimental-strip-types src/lib/__fixtures__/record-engine-snapshot.ts
 */
import { writeFileSync } from "node:fs";
import { runEngine, SNAPSHOT_URL } from "./engine-run.ts";

const t0 = performance.now();
const got = runEngine();
writeFileSync(SNAPSHOT_URL, `${JSON.stringify(got)}\n`);
console.log(`recorded ${Object.keys(got).join(", ")} in ${Math.round(performance.now() - t0)} ms`);

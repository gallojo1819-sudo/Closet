/** Run once on the pre-speed base (58d7b8c) to record the outputs the faster engine must keep. */
import { writeFileSync } from "node:fs";
import { runEngine, SNAPSHOT_URL } from "./engine-run.ts";

const t0 = performance.now();
const got = runEngine();
writeFileSync(SNAPSHOT_URL, `${JSON.stringify(got)}\n`);
console.log(`recorded ${Object.keys(got).join(", ")} in ${Math.round(performance.now() - t0)} ms`);

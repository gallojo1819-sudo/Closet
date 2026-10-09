/**
 * Cold/warm timings on the 142-piece fixture (engine fields only, no real names or brands). One measurement per process so module caches start cold.
 * node --experimental-strip-types src/lib/__fixtures__/bench-engine.ts matrix|row-weekday|row-weekend|week|ways
 */
import { engineGarments as garments } from "./engine-run.ts";

const { buildHouseMatrix, clearMatrixCache } = await import("../stylist/matrix.ts");
const { buildReshuffleRow, buildWeek, lookbookPool } = await import("../lookbook.ts");
const { visibleDetectors } = await import("../detectors/cells.ts");

const what = process.argv[2] ?? "matrix";
const time = (label: string, fn: () => unknown) => {
  const t0 = performance.now();
  fn();
  const heap = Math.round(process.memoryUsage().heapUsed / 1e6);
  console.log(`${what} ${label}: ${Math.round(performance.now() - t0)} ms (heap ${heap} MB)`);
};
const pool = lookbookPool(garments);
console.log(`pieces live: ${pool.length}`);
const run = () => {
  if (what === "matrix") return buildHouseMatrix(pool, "weekday", "fall");
  if (what === "row-weekday") return buildReshuffleRow(garments, "weekday", { season: "fall", salt: 1, cap: 7 });
  if (what === "row-weekend") return buildReshuffleRow(garments, "weekend", { season: "fall", salt: 1, cap: 8 });
  if (what === "ways") return visibleDetectors(garments, { occasion: "weekday", season: "fall" });
  return buildWeek(garments, "2026-10-09");
};
time("cold", run);
time("warm", run);
clearMatrixCache();
time("rebuild (memory cache cleared, helper caches warm)", run);

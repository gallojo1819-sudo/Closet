/**
 * The test closet, read from the fixture so no test carries the piece count as a number.
 *
 * engine-garments.json is the snapshot of the owner's live closet, every piece real and
 * stripped (refreshed by scripts/refresh-closet-snapshot.ts: read-only against Supabase, or
 * from an export kept outside the repo with --from-file). It is the whole test closet; the
 * hand-drafted `x_*` stand-ins that once widened it are gone.
 */
import { readFileSync } from "node:fs";
import type { Garment } from "../types.ts";

export const LIVE_SNAPSHOT_URL = new URL("./engine-garments.json", import.meta.url);

export function readFixture(url: URL): Garment[] {
  return JSON.parse(readFileSync(url, "utf8")) as Garment[];
}

/** The owner's pieces as of the last refresh. */
export const liveSnapshot: Garment[] = readFixture(LIVE_SNAPSHOT_URL);
/** What the Re-dress, header-count and stylist-notes tests call the closet: the snapshot, nothing added. */
export const testCloset: Garment[] = liveSnapshot;

export const LIVE_SNAPSHOT_COUNT = liveSnapshot.length;
export const TEST_CLOSET_COUNT = testCloset.length;

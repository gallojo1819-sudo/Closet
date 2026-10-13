/**
 * The test closet, read from the fixtures so no test carries the piece count as a number.
 *
 * engine-garments.json is the snapshot of the owner's live closet (refreshed by
 * scripts/refresh-closet-snapshot.ts, read-only against Supabase). redress-extra.json is
 * fifteen hand-drafted pieces (ids `x_*`) that are not in the account; they widen the
 * Re-dress tests and are never refreshed from the cloud.
 */
import { readFileSync } from "node:fs";
import type { Garment } from "../types.ts";

export const LIVE_SNAPSHOT_URL = new URL("./engine-garments.json", import.meta.url);
export const EXTRA_PIECES_URL = new URL("./redress-extra.json", import.meta.url);

export function readFixture(url: URL): Garment[] {
  return JSON.parse(readFileSync(url, "utf8")) as Garment[];
}

/** The owner's pieces as of the last refresh. */
export const liveSnapshot: Garment[] = readFixture(LIVE_SNAPSHOT_URL);
/** The hand-drafted extras. */
export const extraPieces: Garment[] = readFixture(EXTRA_PIECES_URL);
/** What the Re-dress, header-count and stylist-notes tests call the closet. */
export const testCloset: Garment[] = [...liveSnapshot, ...extraPieces];

export const LIVE_SNAPSHOT_COUNT = liveSnapshot.length;
export const EXTRA_PIECE_COUNT = extraPieces.length;
export const TEST_CLOSET_COUNT = testCloset.length;

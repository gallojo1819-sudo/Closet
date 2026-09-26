/**
 * Read helpers for the phase-0 tables.
 * Today, Closet, and Add still read closet_meta. Do not import this from those screens.
 */

export const LIVE_READ_SOURCE = "closet_meta" as const;

export type V2GarmentRow = {
  legacy_id: string;
  status: string;
  deleted_at: string | null;
  name: string;
  category: string;
};

/** In-closet ids from garments_v2. Deleted rows stay out. */
export function inClosetIds(rows: V2GarmentRow[]): string[] {
  return rows.filter((row) => row.status === "in_closet" && !row.deleted_at).map((row) => row.legacy_id);
}

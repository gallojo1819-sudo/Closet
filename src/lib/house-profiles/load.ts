import library from "../detectors/library.json" with { type: "json" };
import fiveFourFive from "./approved/545.json" with { type: "json" };
import cross from "./approved/_cross_chip.json" with { type: "json" };
import ald from "./approved/ald.json" with { type: "json" };
import color from "./approved/color.json" with { type: "json" };
import faloni from "./approved/faloni.json" with { type: "json" };
import italianSummer from "./approved/italiansummer.json" with { type: "json" };
import italianWinter from "./approved/italianwinter.json" with { type: "json" };
import polo from "./approved/polo.json" with { type: "json" };
import purple from "./approved/purple.json" with { type: "json" };
import rrl from "./approved/rrl.json" with { type: "json" };
import sweetStable from "./approved/sweetstable.json" with { type: "json" };

export type ApprovedProfile = typeof polo;

const ALL = [polo, purple, rrl, ald, faloni, fiveFourFive, sweetStable, italianSummer, italianWinter];

export const APPROVED = Object.fromEntries(ALL.map((p) => [p.code_house_id, p])) as Record<
  string,
  ApprovedProfile
>;

export const COLOR_PROFILE = color;
export const CROSS = cross;

export const HOUSE_BY_CODE: Record<string, string> = Object.fromEntries(
  ALL.map((p) => [p.chip_id, p.code_house_id]),
);

/** Profile for a detector id or a legacy chip id. */
export function approvedProfile(id: string): ApprovedProfile | undefined {
  const direct = APPROVED[id];
  if (direct) return direct;
  const row = library.detectors.find((d) => d.id === id || d.legacy_id === id);
  if (!row?.legacy_id) return undefined;
  return APPROVED[row.legacy_id];
}

/**
 * The proof a Lookbook test asks of a short row: is there any card left for it? Every rule is
 * pass or fail now, so a row is as full as the rules, the page cap, the one-lead-per-piece rule
 * and the row's own gates allow. A row shorter than the minimum is right only when no look
 * among the open pieces could still be its next card. This searches every combination (no
 * beam, no budget) under the full relax ladder, so a found look is a real gap and none means
 * the row is truly full. For tests only.
 */
import { forgottenIds, isOuterPiece, RELAXED_CAP, SCREEN_CAP, seasonFits, twinGroups, type Twins } from "../detectors.ts";
import { cellKit } from "../detectors/cells.ts";
import { leadPiece } from "../look-collage.ts";
import { weekLeadPiece } from "../look.ts";
import { lookFitsOccasion } from "../occasion-gate.ts";
import type { Season } from "../season.ts";
import { jacketRequired } from "../stylist/jackets.ts";
import { passesRules, relaxTiers } from "../stylist/legal.ts";
import type { Garment, Occasion } from "../types.ts";

export type PageRow = { id: string; looks: readonly (readonly Garment[])[]; relaxed?: boolean };

export type PageRoomInput = {
  closet: readonly Garment[];
  occasion: Occasion;
  season: Season;
  today: string;
  /** The week row's cards. */
  week: readonly (readonly Garment[])[];
  /** The section rows, in order. */
  rows: readonly PageRow[];
  /** Pieces listed unpairable in this scope (never a candidate). */
  stuck: ReadonlySet<string>;
  /** Pieces the rotation may show (rotationEligible). */
  eligible: ReadonlySet<string>;
};

export type RoomFound = { look: Garment[]; waived: readonly string[] } | null;

/** The proof as one line for an assertion message, or null when the row is full. */
export function roomLine(found: RoomFound): string | null {
  if (!found) return null;
  return `could still take ${found.look.map((g) => g.name).join(" / ")}${found.waived.length ? ` (waiving ${found.waived.join(", ")})` : ""}`;
}

/**
 * A look the row `rowId` could still take (null when none): its pieces open on the page (under
 * the cap: SCREEN_CAP, or RELAXED_CAP for a relaxed row unless `strictCap`), not in the row
 * already, its lead (the jacket, else the top) leading no card on the page, a jacket on a jacket
 * day, the row's gate (a forgotten piece on the forgotten row; the plain rows take any theme),
 * the occasion and season gates, and the rules under the deepest relax tier. The first look
 * found and the tier's waived ids, so the test can say what the row missed.
 */
export function roomLeft(input: PageRoomInput, rowId: string, opts: { strictCap?: boolean } = {}): RoomFound {
  const twins: Twins = twinGroups([...input.closet]);
  const key = (g: Garment) => twins.key(g);
  const row = input.rows.find((r) => r.id === rowId);
  const cap = row?.relaxed && !opts.strictCap ? RELAXED_CAP : SCREEN_CAP;
  const counts = new Map<string, number>();
  for (const look of [...input.week, ...input.rows.flatMap((r) => r.looks)]) for (const g of look) counts.set(key(g), (counts.get(key(g)) ?? 0) + 1);
  const led = new Set<string>();
  for (const look of input.week) {
    const lead = weekLeadPiece(look);
    if (lead) led.add(key(lead));
  }
  for (const r of input.rows) for (const look of r.looks) {
    const lead = leadPiece(look);
    if (lead) led.add(key(lead));
  }
  const inRow = new Set((row?.looks ?? []).flat().map(key));
  const open = (g: Garment) => input.eligible.has(g.id) && !input.stuck.has(g.id) && (counts.get(key(g)) ?? 0) < cap && !inRow.has(key(g));
  const tops = input.closet.filter((g) => (g.category === "top" || g.category === "dress") && !isOuterPiece(g) && open(g));
  const bottoms = input.closet.filter((g) => g.category === "bottom" && open(g));
  const shoes = input.closet.filter((g) => g.category === "footwear" && open(g));
  const jackets = input.closet.filter((g) => isOuterPiece(g) && open(g) && !led.has(key(g)));
  const needJacket = jacketRequired(input.occasion, input.season);
  const forgotten = rowId === "forgotten" ? forgottenIds([...input.closet], { today: input.today }) : null;
  const themed = (look: Garment[]) => !forgotten || look.some((g) => forgotten.has(g.id));
  const tiers = relaxTiers();
  const pool = [...input.closet];
  const gates = (look: Garment[]) => lookFitsOccasion(look, input.occasion, pool, undefined, { wideWeekdayTops: true }) && seasonFits(look, input.season);
  /* One rule check per look (the rows' own cache, cellKit.ruleTier), read as the lowest tier it passes under. */
  const passes = (look: Garment[]): readonly string[] | null => {
    if (!gates(look)) return null;
    const tier = cellKit.ruleTier(look, input.occasion, input.season);
    if (tier < 0) return null;
    if (tier === 0) return [];
    return passesRules(look, { house: null, occasion: input.occasion, season: input.season, pool }).failed;
  };
  void tiers;
  for (const top of tops) {
    for (const bottom of bottoms) {
      for (const shoe of shoes) {
        const core = [top, bottom, shoe];
        if (!gates(core)) continue;
        if (!needJacket && !led.has(key(top)) && themed(core)) {
          const waived = passes(core);
          if (waived) return { look: core, waived };
        }
        for (const jacket of jackets) {
          const look = [...core, jacket];
          if (!themed(look)) continue;
          const waived = passes(look);
          if (waived) return { look, waived };
        }
      }
    }
  }
  return null;
}

/** The plain-row id a section would build next, for the "no fourth row" proof. */
export const NEXT_PLAIN_ROW = "more-next";

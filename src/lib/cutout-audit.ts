/**
 * Read-only audit of stored cut-outs: which pieces hold a cut-out that never went through the
 * single-garment check (every cut-out made before Oct 16 2026), or whose verdict was no or
 * unclear. Pure: takes the parsed closet_meta export, returns counts and rows. The CLI is
 * scripts/cutout-audit.ts. Nothing here writes, fetches or touches closet.v6 / closet_meta.
 */
import { cutoutNeedsRecheck, hasCutout } from "./plate.ts";
import type { CutoutCheck, Garment } from "./types.ts";

/** The Oct 14 2026 export, kept outside the repo. The CLI takes another path as its argument. */
export const DEFAULT_EXPORT_PATH = "/workspace/closet-export/closet_meta-2026-10-14.json";

/** What closet_meta.garments holds: closet.v6 garments plus tombstone stubs. */
export type StoredPiece = Partial<Garment> & { id: string; tombstone?: boolean };

export type AuditReason = "never checked" | "verdict no" | "verdict unclear";

export type AuditRow = { id: string; name: string; reason: AuditReason; check?: CutoutCheck };

export type CutoutAudit = {
  rows: number;
  tombstones: number;
  demo: number;
  archived: number;
  /** Active pieces (not tombstone, demo or archived). */
  pieces: number;
  /** Active pieces with a cut-out apart from the phone photo. */
  withCutout: number;
  /** Cut-outs with no cutoutCheck at all. */
  neverChecked: number;
  /** Cut-outs checked, verdict no. */
  mixed: number;
  /** Cut-outs checked, verdict unclear. */
  unclear: number;
  /** Every cut-out that has not passed the check: never checked, no or unclear. */
  needs: AuditRow[];
};

function isRow(g: unknown): g is StoredPiece {
  return Boolean(g) && typeof g === "object" && typeof (g as { id?: unknown }).id === "string";
}

/**
 * The garments array from any export shape: the closet_meta rows (`[{ user_id, garments }]`),
 * one row (`{ garments }`), or the garments array itself.
 */
export function storedRows(parsed: unknown): StoredPiece[] {
  if (Array.isArray(parsed)) {
    if (parsed.every(isRow)) return parsed;
    const out: StoredPiece[] = [];
    for (const row of parsed) {
      const garments = (row as { garments?: unknown } | null)?.garments;
      if (Array.isArray(garments)) out.push(...garments.filter(isRow));
    }
    return out;
  }
  const garments = (parsed as { garments?: unknown } | null)?.garments;
  return Array.isArray(garments) ? garments.filter(isRow) : [];
}

/** The app's read: no tombstones, no demo, no archived. */
export function livePieces(rows: StoredPiece[]): StoredPiece[] {
  return rows.filter((g) => g.tombstone !== true && g.demo !== true && !g.archived);
}

function reasonOf(g: StoredPiece): AuditReason {
  if (!g.cutoutCheck) return "never checked";
  return g.cutoutCheck.one === "no" ? "verdict no" : "verdict unclear";
}

export function auditCutouts(parsed: unknown): CutoutAudit {
  const rows = storedRows(parsed);
  const live = rows.filter((g) => g.tombstone !== true);
  const account = live.filter((g) => g.demo !== true);
  const pieces = livePieces(rows);
  const covered = pieces.filter((g) => hasCutout(g));
  const needs: AuditRow[] = covered
    .filter((g) => cutoutNeedsRecheck(g))
    .map((g) => ({
      id: g.id,
      name: (g.name ?? "").trim(),
      reason: reasonOf(g),
      ...(g.cutoutCheck ? { check: g.cutoutCheck } : {}),
    }));
  return {
    rows: rows.length,
    tombstones: rows.length - live.length,
    demo: live.length - account.length,
    archived: account.length - pieces.length,
    pieces: pieces.length,
    withCutout: covered.length,
    neverChecked: needs.filter((r) => r.reason === "never checked").length,
    mixed: needs.filter((r) => r.reason === "verdict no").length,
    unclear: needs.filter((r) => r.reason === "verdict unclear").length,
    needs,
  };
}

export function formatAudit(path: string, a: CutoutAudit): string {
  const lines = [
    `cut-out audit (read-only) ${path}`,
    `stored rows: ${a.rows} (${a.tombstones} tombstones, ${a.demo} demo, ${a.archived} archived)`,
    `active pieces: ${a.pieces}`,
    `with a cut-out: ${a.withCutout}`,
    `  never went through the single-garment check: ${a.neverChecked}`,
    `  checked, verdict no (mixed): ${a.mixed}`,
    `  checked, verdict unclear: ${a.unclear}`,
    `needs re-check: ${a.needs.length}`,
  ];
  for (const r of a.needs) lines.push(`  ${r.id}  needs re-check (${r.reason})  ${r.name}`);
  return lines.join("\n");
}

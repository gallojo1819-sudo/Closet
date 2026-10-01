/** garments_v2 row fields the version guard cares about. */
export type V2VersionRow = {
  legacy_id: string;
  version: number;
  deleted_at: string | null;
  status: string;
};

export type V2Patch = {
  version?: number;
  deleted_at?: string | null;
  status?: string;
};

/**
 * A write older than the row is refused.
 * Clearing deleted_at, or putting a deleted row back in_closet, is refused
 * unless the patch version is strictly newer than the row.
 * A field update on a live row that omits version is allowed.
 */
export function v2WriteRefused(
  row: { version: number; deleted_at?: string | null },
  patch: V2Patch,
): boolean {
  if (patch.version != null && patch.version < row.version) return true;
  if (!row.deleted_at) return false;
  const clears = "deleted_at" in patch && (patch.deleted_at == null || patch.deleted_at === "");
  const backToCloset = patch.status === "in_closet";
  if (!clears && !backToCloset) return false;
  return !(patch.version != null && patch.version > row.version);
}

/**
 * Compare-and-swap. expectedVersion must match the row.
 * A refused patch leaves the row unchanged, including deleted_at.
 */
export function applyV2Write(
  row: V2VersionRow,
  patch: V2Patch & { expectedVersion?: number },
): { row: V2VersionRow; applied: boolean } {
  if (patch.expectedVersion != null && patch.expectedVersion !== row.version) {
    return { row, applied: false };
  }
  if (v2WriteRefused(row, patch)) return { row, applied: false };
  const next: V2VersionRow = { ...row };
  if ("deleted_at" in patch) next.deleted_at = patch.deleted_at ?? null;
  if (patch.status != null) next.status = patch.status;
  if (patch.version != null) next.version = patch.version;
  return { row: next, applied: true };
}

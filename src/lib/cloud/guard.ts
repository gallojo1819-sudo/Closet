/**
 * Push guard and storage put plan.
 * A write may not silently drop pieces. Opening the app uploads nothing.
 */

export const GARMENT_SHRINK_MAX = 2;
export const LOOK_SHRINK_MAX = 10;

export type ShrinkLook = { id: string; garmentIds: string[] };

export function shrinkGuard(input: {
  baseGarmentIds: string[];
  baseLookIds: string[];
  baseLooks?: ShrinkLook[];
  nextGarmentIds: string[];
  nextLookIds: string[];
  deletedGarments: string[];
  deletedLooks: string[];
}): { ok: true } | { ok: false; reason: string; garments: number; looks: number } {
  const nextG = new Set(input.nextGarmentIds);
  const nextL = new Set(input.nextLookIds);
  const deletedG = new Set(input.deletedGarments);
  const deletedL = new Set(input.deletedLooks);
  const baseLooks = new Map((input.baseLooks ?? []).map((l) => [l.id, l]));
  const garments = input.baseGarmentIds.filter((id) => !nextG.has(id) && !deletedG.has(id));
  const looks = input.baseLookIds.filter((id) => {
    if (nextL.has(id) || deletedL.has(id)) return false;
    const look = baseLooks.get(id);
    if (!look) return true;
    const left = look.garmentIds.filter((gid) => !deletedG.has(gid));
    return left.length >= 2;
  });
  if (garments.length > GARMENT_SHRINK_MAX || looks.length > LOOK_SHRINK_MAX) {
    return {
      ok: false,
      reason: `refusing push that drops ${garments.length} garments and ${looks.length} looks without an explicit delete`,
      garments: garments.length,
      looks: looks.length,
    };
  }
  return { ok: true };
}

export type PutReason = "open" | "focus" | "reroll" | "render" | "edit" | "backup";

const IDLE_PUT: ReadonlySet<PutReason> = new Set(["open", "focus", "reroll", "render"]);

/** Paths to PUT. Existing o/c/t are never included. Idle reasons put nothing. */
export function planStoragePuts(input: {
  reason: PutReason;
  userId: string;
  garments: { id: string }[];
  existing: ReadonlySet<string>;
}): string[] {
  if (IDLE_PUT.has(input.reason)) return [];
  const out: string[] = [];
  for (const g of input.garments) {
    for (const kind of ["o", "c", "t"] as const) {
      const path = `${input.userId}/${g.id}/${kind}.jpg`;
      if (input.existing.has(path)) continue;
      out.push(path);
    }
  }
  return out;
}

/** Never PUT an object that is already in the bucket, and never PUT without bytes. */
export function decideBlobPut(input: {
  alreadyUploaded: boolean;
  remoteExists: boolean;
  hasLocalBlob: boolean;
}): "skip" | "put" {
  if (input.alreadyUploaded || input.remoteExists || !input.hasLocalBlob) return "skip";
  return "put";
}

export function isAlreadyStored(error: {
  status?: number;
  statusCode?: string;
  message?: string;
}): boolean {
  if (error.status === 409 || error.statusCode === "409") return true;
  return /already exists|duplicate/i.test(error.message ?? "");
}

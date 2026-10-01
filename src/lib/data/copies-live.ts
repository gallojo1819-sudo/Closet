import { getSupabase } from "../cloud/client.ts";
import { todayISO } from "../utils.ts";
import { runCopyReconcile, type CopyIo } from "./copies.ts";
import { applyV2Write, v2WriteRefused, type V2VersionRow } from "./v2-guard.ts";
import { setV2Port, type V2LookWrite } from "./v2-port.ts";

type DbError = { message?: string } | null;

type Filter = {
  eq: (column: string, value: string | number) => Filter;
  is: (column: string, value: null) => Filter;
  select: (columns: string) => Filter;
  maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: DbError }>;
} & PromiseLike<{ data: unknown; error: DbError; count: number | null }>;

type Table = {
  select: (columns: string, options?: { count?: "exact"; head?: boolean }) => Filter;
  update: (row: Record<string, unknown>) => Filter;
  delete: () => Filter;
  insert: (row: Record<string, unknown>) => Promise<{ error: DbError }>;
};

type V2Db = {
  from: (table: "garments_v2" | "outfits_v2") => Table;
};

function db(): V2Db | null {
  const client = getSupabase();
  return client ? (client as unknown as V2Db) : null;
}

function asRow(data: Record<string, unknown> | null): V2VersionRow | null {
  if (!data || typeof data.legacy_id !== "string") return null;
  const version = typeof data.version === "number" ? data.version : 1;
  const deleted = typeof data.deleted_at === "string" ? data.deleted_at : null;
  const status = typeof data.status === "string" ? data.status : "in_closet";
  return { legacy_id: data.legacy_id, version, deleted_at: deleted, status };
}

/**
 * Set deleted_at on the garments_v2 row. Do not delete it.
 * A missing row is not inserted, and is not written into closet_meta.
 * version is bumped only when the compare-and-swap lands.
 */
export async function markGarmentDeleted(userId: string, legacyId: string, now = new Date().toISOString()): Promise<void> {
  const client = db();
  if (!client || !legacyId) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    const read = await client
      .from("garments_v2")
      .select("legacy_id, version, deleted_at, status")
      .eq("user_id", userId)
      .eq("legacy_id", legacyId)
      .maybeSingle();
    if (read.error) return;
    const row = asRow(read.data);
    if (!row || row.deleted_at) return;
    const patch = { expectedVersion: row.version, version: row.version + 1, deleted_at: now };
    if (v2WriteRefused(row, patch) || !applyV2Write(row, patch).applied) return;
    const wrote = await client
      .from("garments_v2")
      .update({ deleted_at: now, version: row.version + 1 })
      .eq("user_id", userId)
      .eq("legacy_id", legacyId)
      .eq("version", row.version)
      .select("legacy_id");
    if (wrote.error) return;
    const touched = Array.isArray(wrote.data) ? wrote.data.length : 0;
    if (touched > 0) return;
  }
}

async function upsertOutfit(userId: string, look: V2LookWrite): Promise<void> {
  const client = db();
  if (!client || !look.id) return;
  const read = await client
    .from("outfits_v2")
    .select("legacy_id, version")
    .eq("user_id", userId)
    .eq("legacy_id", look.id)
    .maybeSingle();
  if (read.error) return;
  const row = asRow(read.data);
  if (!row) {
    await client.from("outfits_v2").insert({
      user_id: userId,
      legacy_id: look.id,
      name: look.name,
      occasion: look.occasion,
      source: look.source || "manual",
      lookbook: look.lookbook,
      version: 1,
      created_at: new Date().toISOString(),
    });
    return;
  }
  const patch = { version: row.version + 1 };
  if (v2WriteRefused(row, patch)) return;
  await client
    .from("outfits_v2")
    .update({
      name: look.name,
      occasion: look.occasion,
      source: look.source || "manual",
      lookbook: look.lookbook,
      version: row.version + 1,
    })
    .eq("user_id", userId)
    .eq("legacy_id", look.id)
    .eq("version", row.version);
}

async function deleteOutfit(userId: string, legacyId: string): Promise<void> {
  const client = db();
  if (!client || !legacyId) return;
  await client.from("outfits_v2").delete().eq("user_id", userId).eq("legacy_id", legacyId);
}

async function liveCounts(userId: string): Promise<{ garments: number; looks: number } | null> {
  const client = db();
  if (!client) return null;
  const garments = await client
    .from("garments_v2")
    .select("legacy_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("deleted_at", null);
  const looks = await client
    .from("outfits_v2")
    .select("legacy_id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (garments.error || looks.error) return null;
  if (typeof garments.count !== "number" || typeof looks.count !== "number") return null;
  return { garments: garments.count, looks: looks.count };
}

/** Bind the signed-in mirror. No-ops when Supabase is not configured. */
export function bindLiveCopies(userId: string): void {
  if (!db()) {
    setV2Port(null);
    return;
  }
  setV2Port({
    onGarmentRemoved: (id) => markGarmentDeleted(userId, id),
    onLookSaved: (look) => upsertOutfit(userId, look),
    onLookRemoved: (id) => deleteOutfit(userId, id),
  });
}

export function reconcileAccountCopies(
  userId: string,
  read: Omit<CopyIo, "backfill" | "counts" | "today">,
): Promise<void> {
  return runCopyReconcile(userId, {
    ...read,
    today: todayISO(),
    backfill: async (ids) => {
      for (const id of ids) {
        try {
          await markGarmentDeleted(userId, id);
        } catch {
          /* one id must not stop the other three, and must not touch closet_meta */
        }
      }
    },
    counts: () => liveCounts(userId),
  }).then(() => undefined);
}

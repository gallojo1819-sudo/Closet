"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { CATEGORIES, type Category } from "@/lib/garments/types";

const BUCKET = "garments";

export interface GarmentEdit {
  category: Category;
  subtype: string | null;
  colors: string[];
  pattern: string | null;
  material: string | null;
  brand: string | null;
  formality: number | null;
  warmth: number | null;
  seasons: string[];
  notes: string | null;
}

type ActionResult = { ok: true } | { ok: false; error: string };

function clampRating(v: number | null): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  const r = Math.round(v);
  return r < 1 || r > 5 ? null : r;
}

function cleanStr(v: string | null): string | null {
  const t = (v ?? "").trim();
  return t.length ? t : null;
}

/** Edit every user-facing attribute of a garment. RLS scopes this to the owner. */
export async function updateGarment(
  id: string,
  edit: GarmentEdit,
): Promise<ActionResult> {
  const supabase = await createClient();
  const category: Category = CATEGORIES.includes(edit.category)
    ? edit.category
    : "other";

  const { error } = await supabase
    .from("garments")
    .update({
      category,
      subtype: cleanStr(edit.subtype),
      colors: edit.colors.map((c) => c.trim().toLowerCase()).filter(Boolean),
      pattern: cleanStr(edit.pattern) ?? "solid",
      material: cleanStr(edit.material),
      brand: cleanStr(edit.brand),
      formality: clampRating(edit.formality),
      warmth: clampRating(edit.warmth),
      seasons: edit.seasons.map((s) => s.trim().toLowerCase()).filter(Boolean),
      notes: cleanStr(edit.notes),
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/closet");
  return { ok: true };
}

/** Best-effort removal of a garment's own thumbnail (the original may be shared). */
async function removeThumb(
  supabase: Awaited<ReturnType<typeof createClient>>,
  thumbPath: string | null,
) {
  if (thumbPath) {
    await supabase.storage.from(BUCKET).remove([thumbPath]);
  }
}

/** Delete a garment (with confirm in the UI). Removes its thumbnail too. */
export async function deleteGarment(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("garments")
    .select("thumb_path")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("garments").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  await removeThumb(supabase, row?.thumb_path ?? null);
  revalidatePath("/closet");
  return { ok: true };
}

/**
 * Merge a flagged duplicate INTO the existing garment: keep the existing row,
 * delete the newly-added (flagged) row. This is an explicit, confirmed user
 * action — never automatic.
 */
export async function mergeDuplicate(newId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("garments")
    .select("thumb_path, possible_duplicate_of")
    .eq("id", newId)
    .maybeSingle();

  if (!row?.possible_duplicate_of) {
    return { ok: false, error: "No duplicate target to merge into." };
  }

  const { error } = await supabase.from("garments").delete().eq("id", newId);
  if (error) return { ok: false, error: error.message };

  await removeThumb(supabase, row.thumb_path ?? null);
  revalidatePath("/closet");
  return { ok: true };
}

/** Keep both garments: clear the duplicate flag on the new row. */
export async function keepBoth(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("garments")
    .update({ possible_duplicate_of: null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/closet");
  return { ok: true };
}

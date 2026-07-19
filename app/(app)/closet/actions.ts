"use server";

import sharp from "sharp";
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

/**
 * Best-effort removal of a garment's own generated assets (thumbnail + cutout).
 * The shared original is left in place — sibling garments from the same photo
 * reference it.
 */
async function removeAssets(
  supabase: Awaited<ReturnType<typeof createClient>>,
  paths: (string | null)[],
) {
  const real = paths.filter((p): p is string => Boolean(p));
  if (real.length) {
    await supabase.storage.from(BUCKET).remove(real);
  }
}

/** Delete a garment (with confirm in the UI). Removes its generated assets too. */
export async function deleteGarment(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: row, error: rowError } = await supabase
    .from("garments")
    .select("thumb_path, cutout_path")
    .eq("id", id)
    .maybeSingle();
  // Non-fatal (the delete still proceeds; only asset cleanup may be skipped),
  // but don't hide a lookup failure.
  if (rowError) console.error("[deleteGarment] asset-path lookup failed", rowError);

  const { error } = await supabase.from("garments").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  await removeAssets(supabase, [row?.thumb_path ?? null, row?.cutout_path ?? null]);
  revalidatePath("/closet");
  return { ok: true };
}

/**
 * Explicit, owner-initiated AI preview (Round B4). Generation is NO LONGER a
 * silent display source: this is only reached from the clearly-labeled
 * "Generate an AI preview — not a real photo" action on the detail page. It
 * enqueues a cutout_generate job (the worker badges the result image_source
 * 'cutout'); the caller drains /api/cutouts/process to run it. De-duped so we
 * don't stack queued/running jobs.
 */
export async function generateAiPreview(garmentId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  const { data: garment, error: garmentError } = await supabase
    .from("garments")
    .select("status")
    .eq("id", garmentId)
    .maybeSingle();
  if (garmentError) {
    console.error("[generateAiPreview] garment lookup failed", garmentError);
    return { ok: false, error: "Couldn't load the garment. Please try again." };
  }
  if (!garment) return { ok: false, error: "Garment not found." };
  if (garment.status === "hold") {
    return { ok: false, error: "This garment is on hold and can't be previewed." };
  }

  // Don't stack duplicate work.
  const { data: existing, error: existingError } = await supabase
    .from("processing_jobs")
    .select("id")
    .eq("garment_id", garmentId)
    .eq("kind", "cutout_generate")
    .in("status", ["queued", "running"])
    .limit(1);
  // Best-effort (worst case we enqueue a duplicate job), but don't hide it.
  if (existingError) console.error("[generateAiPreview] existing-job check failed", existingError);

  await supabase
    .from("garments")
    .update({ status: "tagged" })
    .eq("id", garmentId);

  if (!existing || existing.length === 0) {
    const { error } = await supabase.from("processing_jobs").insert({
      user_id: user.id,
      garment_id: garmentId,
      kind: "cutout_generate",
      status: "queued",
      payload: { requeued: true, ai_preview: true },
    });
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/closet");
  return { ok: true };
}

export interface ApplyCandidate {
  product_name: string;
  brand: string | null;
  retailer: string | null;
  retailer_product_id: string | null;
  size: string | null;
  product_url: string | null;
  image_url: string | null;
}

/**
 * Apply a confirmed product match to a garment (Round B4). NOTHING is
 * auto-applied — this runs only when the owner explicitly picks a candidate.
 *
 * The garment's display becomes the REAL official product image: we download it
 * server-side into {user}/products/{garment_id}.jpg and set image_source
 * 'official' + brand_verified. Any generated cutout is retired from display
 * (image_source no longer points at it) but its file is left in place. If the
 * official image can't be downloaded we apply nothing and say so — a verified
 * badge without the real image would be dishonest.
 */
export async function applyProduct(
  garmentId: string,
  candidate: ApplyCandidate,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  if (!candidate.image_url) {
    return {
      ok: false,
      error: "This match has no official image to download — pick another.",
    };
  }

  // Confirm ownership before writing (belt-and-suspenders on top of RLS).
  const { data: garment, error: garmentError } = await supabase
    .from("garments")
    .select("id")
    .eq("id", garmentId)
    .maybeSingle();
  if (garmentError) {
    console.error("[applyProduct] garment lookup failed", garmentError);
    return { ok: false, error: "Couldn't load the garment. Please try again." };
  }
  if (!garment) return { ok: false, error: "Garment not found." };

  // Download + normalize the official product image server-side.
  let jpeg: Buffer;
  try {
    const res = await fetch(candidate.image_url, { redirect: "follow" });
    if (!res.ok) throw new Error(`image fetch ${res.status}`);
    const raw = Buffer.from(await res.arrayBuffer());
    jpeg = await sharp(raw)
      .rotate()
      .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch (e) {
    console.error("[applyProduct] image download failed", e);
    return {
      ok: false,
      error: "Couldn't download that product image — try another candidate.",
    };
  }

  const productPath = `${user.id}/products/${garmentId}.jpg`;
  const upload = await supabase.storage
    .from(BUCKET)
    .upload(productPath, jpeg, { contentType: "image/jpeg", upsert: true });
  if (upload.error) {
    return { ok: false, error: "Couldn't save the product image. Please try again." };
  }

  const { error } = await supabase
    .from("garments")
    .update({
      brand: cleanStr(candidate.brand),
      product_name: cleanStr(candidate.product_name),
      retailer: cleanStr(candidate.retailer),
      retailer_product_id: cleanStr(candidate.retailer_product_id),
      size: cleanStr(candidate.size),
      product_url: cleanStr(candidate.product_url),
      product_image_path: productPath,
      brand_verified: true,
      image_source: "official",
      // An identified garment is a fully valid catalog item; lift it out of hold.
      status: "tagged",
    })
    .eq("id", garmentId);
  if (error) return { ok: false, error: error.message };

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
  const { data: row, error: rowError } = await supabase
    .from("garments")
    .select("thumb_path, cutout_path, possible_duplicate_of")
    .eq("id", newId)
    .maybeSingle();
  if (rowError) {
    console.error("[mergeDuplicate] garment lookup failed", rowError);
    return { ok: false, error: "Couldn't load the garment. Please try again." };
  }

  if (!row?.possible_duplicate_of) {
    return { ok: false, error: "No duplicate target to merge into." };
  }

  const { error } = await supabase.from("garments").delete().eq("id", newId);
  if (error) return { ok: false, error: error.message };

  await removeAssets(supabase, [row.thumb_path ?? null, row.cutout_path ?? null]);
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

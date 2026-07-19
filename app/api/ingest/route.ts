import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { runVisionInventory } from "@/lib/garments/vision";
import {
  makeThumbnail,
  pickDuplicate,
  type DedupCandidate,
} from "@/lib/garments/ingest";
import { trySegment } from "@/lib/cutouts/autosegment";
import type { VisionItem } from "@/lib/garments/types";

// sharp + the Anthropic SDK need the Node runtime; the request is always dynamic.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BUCKET = "garments";

interface IngestedGarment {
  id: string;
  category: string;
  subtype: string | null;
  status: string;
  possible_duplicate_of: string | null;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  let uprightJpeg: Buffer;
  let width: number;
  let height: number;
  let hash: string;
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    // Hash the ORIGINAL uploaded bytes so re-uploading the same file hits cache.
    hash = createHash("sha256").update(bytes).digest("hex");
    // Convert (HEIC -> JPEG) and normalize EXIF orientation up front so every
    // downstream step — vision, bbox math, crops — works on the upright image.
    uprightJpeg = await sharp(bytes).rotate().jpeg({ quality: 90 }).toBuffer();
    const meta = await sharp(uprightJpeg).metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;
  } catch {
    return NextResponse.json(
      { error: "Could not read that image." },
      { status: 422 },
    );
  }
  if (!width || !height) {
    return NextResponse.json(
      { error: "Could not read image dimensions." },
      { status: 422 },
    );
  }

  // Store the upright original in the private bucket, under the user's prefix.
  const uploadId = randomUUID();
  const originalPath = `${user.id}/originals/${uploadId}.jpg`;
  const upload = await supabase.storage
    .from(BUCKET)
    .upload(originalPath, uprightJpeg, { contentType: "image/jpeg" });
  if (upload.error) {
    return NextResponse.json(
      { error: "Upload failed. Please try again." },
      { status: 500 },
    );
  }

  // Cache lookup is scoped to this user (image_hash + user_id).
  const { data: cached } = await supabase
    .from("enrichment_cache")
    .select("raw_response")
    .eq("image_hash", hash)
    .eq("user_id", user.id)
    .maybeSingle();

  let items: VisionItem[];
  let cacheHit = false;
  if (cached?.raw_response) {
    items = cached.raw_response as VisionItem[];
    cacheHit = true;
    console.log(`[ingest] cache HIT for ${hash.slice(0, 12)} — skipping vision`);
  } else {
    try {
      items = await runVisionInventory(uprightJpeg);
    } catch (e) {
      console.error("[ingest] vision failed", e);
      return NextResponse.json(
        { error: "Vision analysis failed. Please try again." },
        { status: 502 },
      );
    }
    console.log(`[ingest] vision MISS for ${hash.slice(0, 12)} — ${items.length} item(s)`);
    // on-conflict-do-nothing: a hash collision with another user's row never throws.
    await supabase
      .from("enrichment_cache")
      .upsert(
        { image_hash: hash, user_id: user.id, raw_response: items },
        { onConflict: "image_hash", ignoreDuplicates: true },
      );
  }

  const created: IngestedGarment[] = [];
  for (const item of items) {
    const isAccessory = item.category === "accessory";
    const lowConfidence = item.confidence === "low";

    let thumb;
    try {
      thumb = await makeThumbnail(
        uprightJpeg,
        width,
        height,
        item.bbox,
        isAccessory,
      );
    } catch (e) {
      console.error("[ingest] thumbnail failed", e);
      continue; // skip this item, keep processing the rest of the photo
    }

    // small crop (non-accessory) OR low confidence => hold, not mixed into closet
    const status = lowConfidence || thumb.tooSmall ? "hold" : "tagged";

    const { data: inserted, error: insertError } = await supabase
      .from("garments")
      .insert({
        user_id: user.id,
        image_path: originalPath,
        status,
        source_bbox: item.bbox,
        category: item.category,
        subtype: item.subtype,
        colors: item.colors,
        pattern: item.pattern,
        material: item.material,
        brand: item.brand,
        formality: item.formality,
        warmth: item.warmth,
        seasons: item.seasons,
        notes: item.notes,
        unknowns: item.unknowns,
        attributes: { observed: item.observed, confidence: item.confidence },
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      console.error("[ingest] insert failed", insertError);
      continue;
    }
    const garmentId = inserted.id as string;

    // Upload the thumbnail, then record its path on the row.
    const thumbPath = `${user.id}/thumbs/${garmentId}.jpg`;
    const thumbUpload = await supabase.storage
      .from(BUCKET)
      .upload(thumbPath, thumb.buffer, { contentType: "image/jpeg" });
    if (!thumbUpload.error) {
      await supabase
        .from("garments")
        .update({ thumb_path: thumbPath })
        .eq("id", garmentId);
    }

    // Conservative duplicate flag: compare against the user's existing garments
    // of the same category (everything already in the DB, excluding this row).
    const { data: candidates } = await supabase
      .from("garments")
      .select("id, colors, subtype, created_at")
      .eq("user_id", user.id)
      .eq("category", item.category)
      .neq("id", garmentId);
    const dupOf = pickDuplicate(
      { colors: item.colors, subtype: item.subtype },
      (candidates ?? []) as DedupCandidate[],
    );
    if (dupOf) {
      await supabase
        .from("garments")
        .update({ possible_duplicate_of: dupOf })
        .eq("id", garmentId);
    }

    // Segmentation is now the default processing path (Round B4): try to strip a
    // uniform background from the real photo, inline, for tagged garments. On
    // success the garment displays its own segmented pixels; on failure it keeps
    // its honest cropped photo (image_source stays 'photo'). Generation is NO
    // longer auto-enqueued — it is an explicit, badged manual action.
    let finalStatus = status;
    if (status === "tagged") {
      const png = await trySegment(uprightJpeg, item.bbox);
      if (png) {
        const cutoutPath = `${user.id}/cutouts/${garmentId}.png`;
        const cutoutUpload = await supabase.storage
          .from(BUCKET)
          .upload(cutoutPath, png, { contentType: "image/png", upsert: true });
        if (!cutoutUpload.error) {
          await supabase
            .from("garments")
            .update({
              status: "cutout_ready",
              cutout_path: cutoutPath,
              image_source: "segmented",
            })
            .eq("id", garmentId);
          finalStatus = "cutout_ready";
        }
      }
    }

    created.push({
      id: garmentId,
      category: item.category,
      subtype: item.subtype,
      status: finalStatus,
      possible_duplicate_of: dupOf,
    });
  }

  return NextResponse.json({
    ok: true,
    cacheHit,
    count: created.length,
    garments: created,
  });
}

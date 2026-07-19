import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { trySegment } from "@/lib/cutouts/autosegment";
import type { Bbox } from "@/lib/garments/types";

// Batch re-segment for garments that never got the segmentation-first path or
// that are currently showing an AI cutout — try to recover REAL pixels from the
// original photo. A clean plain-background shot becomes image_source 'segmented'
// (replacing an old AI cutout); everything else is marked tried so it isn't
// re-scanned. Processes a small batch per call; the client drains it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BUCKET = "garments";
const BATCH = 4;

interface Row {
  id: string;
  image_path: string;
  cutout_path: string | null;
  source_bbox: Bbox | null;
  attributes: Record<string, unknown> | null;
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Candidates: garments whose display is a plain photo or an AI cutout — the two
  // sources we'd upgrade to real segmented pixels. 'official' and 'segmented' are
  // already as good or better and are left alone.
  const { data, error } = await supabase
    .from("garments")
    .select("id,image_path,cutout_path,source_bbox,attributes")
    .eq("user_id", user.id)
    .in("image_source", ["photo", "cutout"]);
  if (error) {
    // Surface — never report "0 remaining, done" when the query actually failed.
    console.error("[segment/run] garments query failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = (data ?? []) as Row[];
  const untried = rows.filter((r) => r.attributes?.resegment_tried !== true);

  const batch = untried.slice(0, BATCH);
  let segmented = 0;

  for (const r of batch) {
    const tried = { ...(r.attributes ?? {}), resegment_tried: true };
    try {
      const dl = await supabase.storage.from(BUCKET).download(r.image_path);
      if (dl.error || !dl.data) {
        await supabase.from("garments").update({ attributes: tried }).eq("id", r.id);
        continue;
      }
      const original = Buffer.from(await dl.data.arrayBuffer());
      const png = await trySegment(original, r.source_bbox);
      if (png) {
        const cutoutPath = r.cutout_path ?? `${user.id}/cutouts/${r.id}.png`;
        const up = await supabase.storage
          .from(BUCKET)
          .upload(cutoutPath, png, { contentType: "image/png", upsert: true });
        if (!up.error) {
          await supabase
            .from("garments")
            .update({
              status: "cutout_ready",
              cutout_path: cutoutPath,
              image_source: "segmented",
              attributes: tried,
            })
            .eq("id", r.id);
          segmented++;
          continue;
        }
      }
      // No clean segmentation — mark tried so we don't rescan the same original.
      await supabase.from("garments").update({ attributes: tried }).eq("id", r.id);
    } catch {
      await supabase.from("garments").update({ attributes: tried }).eq("id", r.id);
    }
  }

  const remaining = Math.max(0, untried.length - batch.length);
  return NextResponse.json({ ok: true, segmented, remaining });
}

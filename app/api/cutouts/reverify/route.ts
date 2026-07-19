import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildReferenceCrop } from "@/lib/cutouts/reference";
import { judgeFidelity } from "@/lib/cutouts/fidelity";
import { classifyThrown } from "@/lib/cutouts/errors";
import type { Bbox } from "@/lib/garments/types";

// Audit already-generated cutouts against their source and demote fabrications.
// These cutouts were produced before the fidelity gate existed and have NEVER
// been checked. Processes a small batch per call; the client drains it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

  // Unaudited = a generated cutout that's currently displayed and not yet checked.
  const { data, error } = await supabase
    .from("garments")
    .select("id,image_path,cutout_path,source_bbox,attributes")
    .eq("user_id", user.id)
    .eq("status", "cutout_ready")
    .eq("image_source", "cutout");
  if (error) {
    // Surface — never report "0 remaining, done" when the query actually failed.
    console.error("[cutouts/reverify] garments query failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = (data ?? []) as Row[];
  const unaudited = rows.filter((r) => r.attributes?.fidelity_checked !== true);

  const batch = unaudited.slice(0, BATCH);
  let demoted = 0;
  let paused: { message: string } | null = null;

  for (const r of batch) {
    try {
      const dlOrig = await supabase.storage.from(BUCKET).download(r.image_path);
      if (dlOrig.error || !dlOrig.data) continue;
      const original = Buffer.from(await dlOrig.data.arrayBuffer());
      const reference = await buildReferenceCrop(original, r.source_bbox);

      if (!r.cutout_path) continue;
      const dlCut = await supabase.storage.from(BUCKET).download(r.cutout_path);
      if (dlCut.error || !dlCut.data) continue;
      const cutout = Buffer.from(await dlCut.data.arrayBuffer());

      const fid = await judgeFidelity(reference, cutout);
      const attributes = {
        ...(r.attributes ?? {}),
        fidelity_checked: true,
        fidelity_verdict: fid.verdict,
      };

      if (fid.verdict === "fabricated" || fid.invented_elements.length > 0) {
        // Demote: keep the real photo, drop the fabricated cutout.
        await supabase
          .from("garments")
          .update({
            status: "cutout_rejected",
            image_source: "photo",
            cutout_path: null,
            attributes,
          })
          .eq("id", r.id);
        await supabase.storage.from(BUCKET).remove([r.cutout_path]);
        demoted++;
      } else {
        await supabase.from("garments").update({ attributes }).eq("id", r.id);
      }
    } catch (e) {
      const c = classifyThrown(e);
      if (c.infra) {
        paused = { message: "Re-verify paused: Claude quota/billing issue." };
        break;
      }
      // non-infra error on one garment: skip it, keep going
    }
  }

  const processedIds = new Set(batch.map((b) => b.id));
  const remaining = paused ? unaudited.length : unaudited.filter((r) => !processedIds.has(r.id)).length;

  return NextResponse.json({
    ok: true,
    demoted,
    remaining,
    paused: Boolean(paused),
    pause: paused ? { message: paused.message } : null,
  });
}

import { createClient } from "@/lib/supabase/server";
import { ClosetView, type EnrichedGarment } from "@/components/closet/closet-view";
import type { GarmentRow } from "@/lib/garments/types";

const BUCKET = "garments";
const GARMENT_COLUMNS =
  "id,status,category,subtype,colors,pattern,material,brand,formality,warmth,seasons,notes,thumb_path,cutout_path,image_source,attributes,possible_duplicate_of,created_at";

export default async function ClosetPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("garments")
    .select(GARMENT_COLUMNS)
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as (GarmentRow & {
    attributes: { fidelity_checked?: boolean } | null;
  })[];

  // Bucket is private — mint short-lived signed URLs for thumbs and (when
  // ready) cutouts.
  const paths = new Set<string>();
  for (const r of rows) {
    if (r.thumb_path) paths.add(r.thumb_path);
    if (r.status === "cutout_ready" && r.cutout_path) paths.add(r.cutout_path);
  }
  const signedByPath = new Map<string, string>();
  if (paths.size) {
    const { data: signed } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls([...paths], 60 * 60);
    signed?.forEach((s) => {
      if (s.path && s.signedUrl) signedByPath.set(s.path, s.signedUrl);
    });
  }

  const garments: EnrichedGarment[] = rows.map((r) => ({
    ...r,
    thumbUrl: r.thumb_path ? signedByPath.get(r.thumb_path) ?? null : null,
    cutoutUrl:
      r.status === "cutout_ready" && r.cutout_path
        ? signedByPath.get(r.cutout_path) ?? null
        : null,
  }));

  // Pending cutout work drives "Generate cutouts (N)".
  const { count: pending } = await supabase
    .from("processing_jobs")
    .select("id", { count: "exact", head: true })
    .eq("kind", "cutout_generate")
    .in("status", ["queued", "running"]);

  // Photo-only garments (failed/rejected) drive "Re-run as segmentation (N)".
  const rerunCount = rows.filter(
    (r) => r.status === "cutout_failed" || r.status === "cutout_rejected",
  ).length;

  // Generated cutouts never fidelity-checked drive "Re-verify existing (N)".
  const unauditedCount = rows.filter(
    (r) =>
      r.status === "cutout_ready" &&
      r.image_source === "cutout" &&
      r.attributes?.fidelity_checked !== true,
  ).length;

  // Sourcing mix so Joe can see how the closet is actually sourced.
  const sourcing = {
    segmented: rows.filter((r) => r.image_source === "segmented").length,
    cutout: rows.filter((r) => r.image_source === "cutout").length,
    photo: rows.filter((r) => r.image_source === "photo").length,
  };

  return (
    <ClosetView
      garments={garments}
      pendingCutouts={pending ?? 0}
      rerunCandidates={rerunCount}
      unauditedCutouts={unauditedCount}
      sourcing={sourcing}
    />
  );
}

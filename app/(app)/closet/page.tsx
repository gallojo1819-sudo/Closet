import { createClient } from "@/lib/supabase/server";
import { ClosetView, type EnrichedGarment } from "@/components/closet/closet-view";
import type { GarmentRow } from "@/lib/garments/types";

const BUCKET = "garments";
const GARMENT_COLUMNS =
  "id,status,category,subtype,colors,pattern,material,brand,formality,warmth,seasons,notes,thumb_path,cutout_path,image_source,attributes,possible_duplicate_of,created_at,product_name,retailer,retailer_product_id,size,product_url,product_image_path,brand_verified";

// A visible failure state — never render an empty grid when the query actually
// errored (that masked a pending migration for hours). Surfaces the real message.
function ClosetError({ message }: { message: string }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-cream px-6 text-center font-ui text-neutral-900">
      <p className="font-display text-2xl leading-tight text-neutral-800">
        Couldn’t load your closet
      </p>
      <p className="mt-3 max-w-md font-ui text-sm text-neutral-600">{message}</p>
      <p className="mt-2 max-w-md font-ui text-xs text-neutral-400">
        This is a load error, not an empty wardrobe. If it persists, a database
        migration may be pending.
      </p>
    </div>
  );
}

export default async function ClosetPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("garments")
    .select(GARMENT_COLUMNS)
    .order("created_at", { ascending: false });

  // A failed query must NOT fall through to an empty grid — surface it.
  if (error) {
    console.error("[closet] garments query failed", error);
    return <ClosetError message={error.message} />;
  }

  const rows = (data ?? []) as (GarmentRow & {
    attributes: { fidelity_checked?: boolean; resegment_tried?: boolean } | null;
  })[];

  // Bucket is private — mint short-lived signed URLs for thumbs, cutouts (when
  // ready), and official product images (when identified).
  const paths = new Set<string>();
  for (const r of rows) {
    if (r.thumb_path) paths.add(r.thumb_path);
    if (r.status === "cutout_ready" && r.cutout_path) paths.add(r.cutout_path);
    if (r.image_source === "official" && r.product_image_path) {
      paths.add(r.product_image_path);
    }
  }
  const signedByPath = new Map<string, string>();
  if (paths.size) {
    const { data: signed, error: signError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls([...paths], 60 * 60);
    // Non-fatal (garments still render with a placeholder), but a signing failure
    // must not be silent — it would otherwise look like every image is missing.
    if (signError) console.error("[closet] createSignedUrls failed", signError);
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
    officialUrl:
      r.image_source === "official" && r.product_image_path
        ? signedByPath.get(r.product_image_path) ?? null
        : null,
  }));

  // Pending cutout work drives "Resume AI previews (N)" (manual generation only).
  const { count: pending, error: pendingError } = await supabase
    .from("processing_jobs")
    .select("id", { count: "exact", head: true })
    .eq("kind", "cutout_generate")
    .in("status", ["queued", "running"]);
  if (pendingError) console.error("[closet] pending jobs count failed", pendingError);

  // Photo/AI garments not yet re-scanned drive "Find real pixels (N)".
  const resegmentCount = rows.filter(
    (r) =>
      (r.image_source === "photo" || r.image_source === "cutout") &&
      r.attributes?.resegment_tried !== true,
  ).length;

  // Generated cutouts never fidelity-checked drive "Re-verify existing (N)".
  const unauditedCount = rows.filter(
    (r) =>
      r.status === "cutout_ready" &&
      r.image_source === "cutout" &&
      r.attributes?.fidelity_checked !== true,
  ).length;

  // Sourcing mix — how the closet is actually sourced, best to worst.
  const sourcing = {
    official: rows.filter((r) => r.image_source === "official").length,
    segmented: rows.filter((r) => r.image_source === "segmented").length,
    photo: rows.filter((r) => r.image_source === "photo").length,
    cutout: rows.filter((r) => r.image_source === "cutout").length,
  };

  return (
    <ClosetView
      garments={garments}
      pendingCutouts={pending ?? 0}
      resegmentCandidates={resegmentCount}
      unauditedCutouts={unauditedCount}
      sourcing={sourcing}
    />
  );
}

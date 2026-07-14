import { createClient } from "@/lib/supabase/server";
import { ClosetView, type EnrichedGarment } from "@/components/closet/closet-view";
import type { GarmentRow } from "@/lib/garments/types";

const BUCKET = "garments";
const GARMENT_COLUMNS =
  "id,status,category,subtype,colors,pattern,material,brand,formality,warmth,seasons,notes,thumb_path,possible_duplicate_of,created_at";

export default async function ClosetPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("garments")
    .select(GARMENT_COLUMNS)
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as GarmentRow[];

  // Bucket is private — mint short-lived signed URLs for the thumbnails.
  const paths = rows
    .map((r) => r.thumb_path)
    .filter((p): p is string => Boolean(p));
  const signedByPath = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(paths, 60 * 60);
    signed?.forEach((s) => {
      if (s.path && s.signedUrl) signedByPath.set(s.path, s.signedUrl);
    });
  }

  const garments: EnrichedGarment[] = rows.map((r) => ({
    ...r,
    thumbUrl: r.thumb_path ? signedByPath.get(r.thumb_path) ?? null : null,
  }));

  return <ClosetView garments={garments} />;
}

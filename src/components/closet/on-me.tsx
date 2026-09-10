import { useState } from "react";
import { Loader2 } from "lucide-react";
import { onMePreview } from "@/lib/ai";
import { blobToDataUrl, getImage } from "@/lib/images";
import { useCloset } from "@/lib/store";
import type { Garment } from "@/lib/types";
import { sortLook } from "@/lib/look";

/**
 * On-demand "On me" preview for one look: Joe's reference photo + these exact
 * pieces. Never pre-generated, never written over a garment's cutout.
 */
export function OnMeButton({ pieces }: { pieces: Garment[] }) {
  const refPhoto = useCloset((s) => s.refPhoto);
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!refPhoto || !pieces.length) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await getImage(refPhoto);
      if (!blob) throw new Error("Reference photo is missing — set it again.");
      const refImage = await blobToDataUrl(blob);
      const list = sortLook(pieces)
        .map((g) => `${g.name} (${[g.colors.join("/"), g.subtype || g.category].filter(Boolean).join(" ")})`)
        .join(", ");
      const res = await onMePreview({ data: { refImage, pieces: list } });
      if (res.ok) setImage(res.image);
      else setError(res.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={busy || !pieces.length}
        title={refPhoto ? undefined : "Set your reference photo first — tap Fit · 5′8 reg up top."}
        onClick={() => (refPhoto ? void run() : setError("No reference photo yet. Tap Fit · 5′8 reg up top to add one."))}
        className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong disabled:opacity-40 inline-flex items-center gap-2"
      >
        {busy && <Loader2 className="size-3 animate-spin" />}
        On me
      </button>
      {error && <p className="micro text-accent">{error}</p>}
      {image && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <button
            type="button"
            className="absolute inset-0 bg-ink/40"
            aria-label="Close"
            onClick={() => setImage(null)}
          />
          <figure className="relative z-10 w-full max-w-md bg-paper border border-hairline">
            <img src={image} alt="Preview on you" className="w-full" />
            <figcaption className="micro px-3 py-2 text-ink-soft border-t border-hairline">
              Preview — the paper tiles are the garment.
            </figcaption>
          </figure>
        </div>
      )}
    </>
  );
}

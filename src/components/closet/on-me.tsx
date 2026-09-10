import { useState } from "react";
import { Loader2 } from "lucide-react";
import { onMePreview } from "@/lib/ai";
import { blobToDataUrl, getImage, resolveImage } from "@/lib/images";
import { useCloset } from "@/lib/store";
import type { Garment } from "@/lib/types";
import { sortLook } from "@/lib/look";

/** Stored src (idb key, path, or data URL) -> data URL for the edit request. */
async function asDataUrl(src: string): Promise<string | null> {
  try {
    const url = await resolveImage(src);
    if (!url) return null;
    if (url.startsWith("data:")) return url;
    const blob = await (await fetch(url)).blob();
    return blobToDataUrl(blob);
  } catch {
    return null;
  }
}

const NO_REF = "No reference photo yet. Tap Fit · 5′8 reg up top to add one.";

function useOnMe(pieces: Garment[]) {
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
      const ordered = sortLook(pieces);
      const cutouts = (
        await Promise.all(
          ordered.slice(0, 4).map((g) => asDataUrl(g.cutoutSrc || g.imageSrc)),
        )
      ).filter((c): c is string => Boolean(c));
      const list = ordered
        .map((g) => `${g.name} (${[g.colors.join("/"), g.subtype || g.category].filter(Boolean).join(" ")})`)
        .join(", ");
      const res = await onMePreview({ data: { refImage, cutouts, pieces: list } });
      if (res.ok) setImage(res.image);
      else setError(res.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed.");
    } finally {
      setBusy(false);
    }
  };

  return {
    refPhoto,
    busy,
    image,
    error,
    run,
    noRef: () => setError(NO_REF),
    clear: () => setImage(null),
  };
}

/**
 * On-demand "On me" preview for one look: Joe's reference photo + these exact
 * pieces. Never pre-generated, never written over a garment's cutout.
 */
export function OnMeButton({ pieces }: { pieces: Garment[] }) {
  const preview = useOnMe(pieces);
  return (
    <>
      <button
        type="button"
        disabled={preview.busy || !pieces.length}
        title={preview.refPhoto ? undefined : NO_REF}
        onClick={() => (preview.refPhoto ? void preview.run() : preview.noRef())}
        className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong disabled:opacity-40 inline-flex items-center gap-2"
      >
        {preview.busy && <Loader2 className="size-3 animate-spin" />}
        On me
      </button>
      {preview.error && <p className="micro text-accent">{preview.error}</p>}
      {preview.image && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <button
            type="button"
            className="absolute inset-0 bg-ink/40"
            aria-label="Close"
            onClick={preview.clear}
          />
          <figure className="relative z-10 w-full max-w-md bg-paper border border-hairline">
            <img src={preview.image} alt="Preview on you" className="w-full" />
            <figcaption className="micro px-3 py-2 text-ink-soft border-t border-hairline">
              Preview — the paper tiles are the garment.
            </figcaption>
          </figure>
        </div>
      )}
    </>
  );
}

/** Today's "On me" toggle view: the preview lives in the layout, not a modal. */
export function OnMePanel({ pieces }: { pieces: Garment[] }) {
  const preview = useOnMe(pieces);
  return (
    <div className="border border-hairline bg-paper-deep aspect-[4/5] flex flex-col">
      {preview.image ? (
        <img
          src={preview.image}
          alt="Preview on you"
          className="h-full w-full object-contain"
        />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-sm text-ink-soft max-w-xs">
            {preview.error ??
              (preview.refPhoto
                ? "One editorial frame of you in this exact look. Generated on demand — never saved over your photos."
                : NO_REF)}
          </p>
          {preview.refPhoto && (
            <button
              type="button"
              disabled={preview.busy || !pieces.length}
              onClick={() => void preview.run()}
              className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong disabled:opacity-40 inline-flex items-center gap-2"
            >
              {preview.busy && <Loader2 className="size-3 animate-spin" />}
              {preview.busy ? "Dressing you…" : "Generate preview"}
            </button>
          )}
        </div>
      )}
      <p className="micro px-3 py-2 text-ink-soft border-t border-hairline">
        Preview — the paper tiles are the garment.
      </p>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { openRefPhotoDialog } from "@/components/shell/top-bar";
import { onMePreview } from "@/lib/ai";
import {
  blobToDataUrl,
  dataUrlToBlob,
  getImage,
  imageKey,
  jpegDataUrl,
  lookOnMeKey,
  putImage,
  resolveImage,
} from "@/lib/images";
import { useCloset } from "@/lib/store";
import type { Garment, Occasion } from "@/lib/types";
import { layersForOnMe } from "@/lib/look";
import { livePool } from "@/lib/rack";
import { slotOf } from "@/lib/style";
import { tuckDressingLines } from "@/lib/tuck";

/** Dress Joe in these exact cutouts. Never writes cutoutSrc. */
export async function dressLook(
  pieces: Garment[],
  occasion?: Occasion,
): Promise<string> {
  const refPhoto = useCloset.getState().refPhoto;
  if (!refPhoto) {
    openRefPhotoDialog();
    throw new Error("No reference photo yet. Tap Fit · 5′8 reg up top to add one.");
  }
  const blob = await getImage(refPhoto);
  if (!blob) {
    openRefPhotoDialog();
    throw new Error("Reference photo is missing — set it again.");
  }
  const refImage = await jpegDataUrl(blob, 768, 0.8);
  const allowed = new Set(livePool(useCloset.getState().garments).map((g) => g.id));
  const worn = layersForOnMe(pieces.filter((g) => allowed.has(g.id)));
  const layers: { name: string; category: string; url: string }[] = [];
  for (const g of worn) {
    const cover =
      g.cutoutSrc && g.cutoutSrc !== g.imageSrc ? g.cutoutSrc : imageKey(g.id, "c");
    const raw = await asDataUrl(cover);
    if (!raw) continue;
    const url = await jpegDataUrl(raw, 512, 0.8);
    layers.push({ name: g.name, category: g.category, url });
  }
  const cutouts = layers.map((l) => l.url);
  const list = layers
    .map((l, i) => `image ${i + 2} = ${l.name} (${l.category})`)
    .join(". ");
  const only = layers.map((l) => l.name).join(", ");
  const tuck = tuckDressingLines(worn, occasion);
  const gurkha = worn.some((g) =>
    /gurkha/.test(`${g.subtype} ${g.notes} ${g.name}`.toLowerCase()),
  );
  const gurkhaLine = gurkha
    ? "NO drawstring ties at the hem. Gurkha waist. Trousers break on the shoe."
    : "";
  const res = await onMePreview({
    data: {
      refImage,
      cutouts,
      pieces: `${list}. ONLY these garments: ${only}. Nothing else.`,
      tuck: `${tuck} ${gurkhaLine}`.trim(),
    },
  });
  if (!res.ok) throw new Error(res.error);
  if (await isLegsOnlyBody(res.image)) {
    throw new Error("On you cropped to the legs — keeping the kit.");
  }
  if (await inventedExtras(res.image, worn)) {
    throw new Error("On you invented a garment that isn’t in the closet — keeping the kit.");
  }
  return res.image;
}

/** True when the top of the plate is empty paper — a feet crop, not Joe. */
export async function isLegsOnlyBody(dataUrl: string): Promise<boolean> {
  if (typeof document === "undefined") return false;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image"));
      el.src = dataUrl;
    });
    const w = 48;
    const h = 60;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, Math.max(1, Math.round(h * 0.2))).data;
    let person = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const paper = Math.abs(r - 244) < 28 && Math.abs(g - 239) < 28 && Math.abs(b - 230) < 28;
      const white = r > 232 && g > 232 && b > 228;
      if (!paper && !white) person += 1;
    }
    return n > 0 && person / n < 0.03;
  } catch {
    return false;
  }
}

/** Extra white footwear (or similar) that was not in the sent plates. */
export async function inventedExtras(dataUrl: string, worn: Garment[]): Promise<boolean> {
  if (typeof document === "undefined") return false;
  const sentWhiteShoe = worn.some((g) => {
    const shoe = slotOf(g) === "footwear";
    const blob = `${g.name} ${g.subtype} ${g.colors.join(" ")}`.toLowerCase();
    return shoe && /white|cream|ivory/.test(blob);
  });
  if (sentWhiteShoe) return false;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image"));
      el.src = dataUrl;
    });
    const w = 48;
    const h = 60;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, w, h);
    const y0 = Math.round(h * 0.78);
    const data = ctx.getImageData(0, y0, w, h - y0).data;
    let white = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const paper = Math.abs(r - 244) < 28 && Math.abs(g - 239) < 28 && Math.abs(b - 230) < 28;
      if (paper) continue;
      if (r > 220 && g > 220 && b > 210) white += 1;
    }
    return n > 0 && white / n > 0.22;
  } catch {
    return false;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      },
    );
  });
}

const inflight = new Map<string, Promise<string>>();
let dressQueue: Promise<unknown> = Promise.resolve();

function comboExtra(pieces: Garment[]): string {
  return [...pieces.map((p) => p.id)].sort().join("|");
}

/** Cache-first On you. One Imagine per look. Card and sheet share the job. */
export async function ensureLookOnMe(
  lookId: string,
  pieces: Garment[],
  ms = 45_000,
  occasion?: Occasion,
): Promise<string> {
  const extra = comboExtra(pieces);
  const writeKey = lookOnMeKey(lookId, extra);
  const exact = await getImage(writeKey);
  if (exact) return blobToDataUrl(exact);
  const pending = inflight.get(writeKey);
  if (pending) return pending;
  const job = (async () => {
    const image = await withTimeout(dressLook(pieces, occasion), ms);
    await putImage(writeKey, dataUrlToBlob(image));
    return image;
  })().finally(() => {
    inflight.delete(writeKey);
  });
  inflight.set(writeKey, job);
  return job;
}

/** Visible Lookbook cards. Concurrency 1. Kit stays until the blob lands. */
export function queueLookOnMe(
  lookId: string,
  pieces: Garment[],
  ms = 45_000,
  occasion?: Occasion,
): Promise<string | null> {
  if (!useCloset.getState().refPhoto) return Promise.resolve(null);
  const job = dressQueue.then(() =>
    ensureLookOnMe(lookId, pieces, ms, occasion).catch(() => null),
  );
  dressQueue = job.then(() => undefined);
  return job;
}

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

function useOnMe(pieces: Garment[], occasion?: Occasion) {
  const refPhoto = useCloset((s) => s.refPhoto);
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (refPhoto) return;
    setImage(null);
  }, [refPhoto]);

  const run = async () => {
    if (!refPhoto || !pieces.length) return;
    setBusy(true);
    setError(null);
    try {
      const image = await dressLook(pieces, occasion);
      if (useCloset.getState().refPhoto !== refPhoto) return;
      setImage(image);
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
        onClick={() => (preview.refPhoto ? void preview.run() : openRefPhotoDialog())}
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
              Preview drifted — paper tiles are the garment.
            </figcaption>
            <div className="flex gap-2 px-3 pb-3">
              <button
                type="button"
                disabled={preview.busy}
                onClick={() => void preview.run()}
                className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={preview.clear}
                className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong"
              >
                Use paper
              </button>
            </div>
          </figure>
        </div>
      )}
    </>
  );
}

/** Today's "On me" toggle view: the preview lives in the layout, not a modal. */
export function OnMePanel({
  pieces,
  onUsePaper,
  occasion,
}: {
  pieces: Garment[];
  onUsePaper?: () => void;
  occasion?: Occasion;
}) {
  const preview = useOnMe(pieces, occasion);
  const hydrated = useCloset((s) => s.hydrated);

  useEffect(() => {
    if (!hydrated || preview.refPhoto) return;
    openRefPhotoDialog();
  }, [hydrated, preview.refPhoto]);

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
          <button
            type="button"
            disabled={preview.busy || (Boolean(preview.refPhoto) && !pieces.length)}
            onClick={() =>
              preview.refPhoto ? void preview.run() : openRefPhotoDialog()
            }
            className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong disabled:opacity-40 inline-flex items-center gap-2"
          >
            {preview.busy && <Loader2 className="size-3 animate-spin" />}
            {preview.busy
              ? "Dressing you…"
              : preview.refPhoto
                ? "Generate preview"
                : "Set reference photo"}
          </button>
        </div>
      )}
      <p className="micro px-3 py-2 text-ink-soft border-t border-hairline">
        {preview.image
          ? "Preview drifted — paper tiles are the garment."
          : "Preview — the paper tiles are the garment."}
      </p>
      {preview.image && (
        <div className="flex gap-2 px-3 pb-3">
          <button
            type="button"
            disabled={preview.busy}
            onClick={() => void preview.run()}
            className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong disabled:opacity-40 inline-flex items-center gap-2"
          >
            {preview.busy && <Loader2 className="size-3 animate-spin" />}
            Try again
          </button>
          <button
            type="button"
            onClick={() => {
              preview.clear();
              onUsePaper?.();
            }}
            className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong"
          >
            Use paper
          </button>
        </div>
      )}
    </div>
  );
}

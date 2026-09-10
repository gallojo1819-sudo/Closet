import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ClipboardPaste, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { matteToPaper, readAsImageSrc, type MatteQuality } from "@/lib/matte";
import { tagGarment } from "@/lib/ai";
import { useCloset } from "@/lib/store";
import type { Category, ImageSource } from "@/lib/types";
import { uid } from "@/lib/utils";

const CHECKS = [
  "One item",
  "Laid flat",
  "Plain surface",
  "Even light",
  "Fill the frame",
];

type Draft = {
  id: string;
  original: string;
  cutout: string;
  quality: MatteQuality;
  reason: string;
  name: string;
  category: Category;
  subtype: string;
  colors: string;
  material: string;
  paid: string;
};

const CATS: Category[] = [
  "top",
  "bottom",
  "outerwear",
  "dress",
  "footwear",
  "accessory",
  "other",
];

export function Studio() {
  const addGarment = useCloset((s) => s.addGarment);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [savedCount, setSavedCount] = useState(0);
  const pickRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback(async (list: FileList | File[] | null) => {
    const images = [...(list ?? [])].filter((f) => f.type.startsWith("image/"));
    if (!images.length) {
      setError("Those files are not images.");
      return;
    }
    setError(null);
    setSavedCount(0);
    setBusy(true);
    const next: Draft[] = [];
    const failed: string[] = [];
    for (let i = 0; i < images.length; i++) {
      const file = images[i]!;
      setStatus(
        images.length === 1
          ? "Reading photo…"
          : `Piece ${i + 1} of ${images.length}…`,
      );
      try {
        next.push(await fileToDraft(file, setStatus));
      } catch {
        failed.push(file.name);
      }
    }
    setDrafts((cur) => [...cur, ...next]);
    setBusy(false);
    setStatus("");
    if (failed.length) {
      setError(`${failed.length} photo${failed.length === 1 ? "" : "s"} could not be read.`);
    }
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.items ?? [])]
        .filter((i) => i.type.startsWith("image/"))
        .map((i) => i.getAsFile())
        .filter((f): f is File => !!f);
      if (files.length) {
        e.preventDefault();
        void processFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [processFiles]);

  const commit = (draft: Draft) => {
    const source: ImageSource =
      draft.quality === "clean" || draft.quality === "ok" ? "segmented" : "photo";
    const paid = parseFloat(draft.paid);
    addGarment({
      name: draft.name.trim() || "Untitled piece",
      category: draft.category,
      subtype: draft.subtype,
      colors: draft.colors
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
      material: draft.material,
      brand: "",
      notes: draft.reason,
      formality: 3,
      warmth: 3,
      seasons: [],
      imageSrc: draft.original,
      cutoutSrc: draft.cutout,
      imageSource: source,
      matteQuality: draft.quality,
      ...(Number.isFinite(paid) && paid > 0
        ? { paid: Math.round(paid * 100) / 100 }
        : {}),
    });
  };

  const keepOne = (id: string) => {
    const draft = drafts.find((d) => d.id === id);
    if (!draft) return;
    commit(draft);
    setDrafts((cur) => cur.filter((d) => d.id !== id));
    setSavedCount((n) => n + 1);
  };

  const keepAll = () => {
    if (!drafts.length) return;
    const n = drafts.length;
    for (const d of drafts) commit(d);
    setDrafts([]);
    setSavedCount(n);
  };

  const dropOne = (id: string) => {
    setDrafts((cur) => cur.filter((d) => d.id !== id));
  };

  const patch = (id: string, partial: Partial<Draft>) => {
    setDrafts((cur) => cur.map((d) => (d.id === id ? { ...d, ...partial } : d)));
  };

  return (
    <div className="space-y-8">
      <section
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void processFiles(e.dataTransfer.files);
        }}
        className="border border-dashed border-hairline-strong bg-card px-6 py-12 text-center"
      >
        <p className="font-editorial text-3xl md:text-4xl tracking-tight">
          This is the garment.
        </p>
        <p className="mt-3 mx-auto max-w-md text-sm text-ink-soft leading-relaxed">
          Select a dozen from the camera roll. Each photo stays that photo.
          We only set it on paper.
        </p>
        <ul className="mt-6 flex flex-wrap justify-center gap-2">
          {CHECKS.map((c) => (
            <li key={c} className="micro border border-hairline px-2 py-1 text-ink-soft">
              {c}
            </li>
          ))}
        </ul>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Button onClick={() => pickRef.current?.click()} disabled={busy}>
            <Upload className="size-4" />
            Choose photos
          </Button>
          <Button
            variant="ghost"
            onClick={() => camRef.current?.click()}
            disabled={busy}
          >
            <Camera className="size-4" />
            Take photo
          </Button>
          <Button variant="ghost" disabled={busy} className="pointer-events-none opacity-70">
            <ClipboardPaste className="size-4" />
            Or paste
          </Button>
        </div>
        <input
          ref={pickRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void processFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={camRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            void processFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </section>

      {busy && (
        <div className="flex items-center gap-3 border border-hairline bg-card px-4 py-3 text-sm">
          <Loader2 className="size-4 animate-spin" />
          {status || "Working…"}
        </div>
      )}
      {error && (
        <p className="text-sm text-accent border border-accent/40 bg-card px-4 py-3">
          {error}
        </p>
      )}
      {savedCount > 0 && drafts.length === 0 && (
        <p className="text-sm text-success border border-success/30 bg-card px-4 py-3">
          {savedCount === 1
            ? "In the closet — your actual photo, on paper."
            : `${savedCount} pieces in the closet — your photos, on paper.`}
        </p>
      )}

      {drafts.length > 0 && (
        <section className="space-y-5 rise">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="micro text-ink-soft">Review</p>
              <p className="font-editorial text-2xl tracking-tight">
                {drafts.length} {drafts.length === 1 ? "piece" : "pieces"} on paper
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={keepAll}>Keep all</Button>
              <Button variant="ghost" onClick={() => setDrafts([])}>
                Discard
              </Button>
            </div>
          </div>
          <ul className="space-y-8">
            {drafts.map((draft) => (
              <li
                key={draft.id}
                className="border border-hairline bg-card p-4 md:p-5 space-y-4"
              >
                <div className="grid md:grid-cols-2 gap-4">
                  <figure className="border border-hairline bg-paper-deep">
                    <img
                      src={draft.original}
                      alt="Original"
                      className="w-full aspect-page object-contain"
                    />
                    <figcaption className="micro px-3 py-2 text-ink-soft">
                      Your photo
                    </figcaption>
                  </figure>
                  <figure className="border border-hairline bg-paper-deep">
                    <img
                      src={draft.cutout}
                      alt="Your photo on paper"
                      className="w-full aspect-page object-contain"
                    />
                    <figcaption className="micro px-3 py-2 text-ink-soft">
                      Your photo on paper · {draft.quality}
                    </figcaption>
                  </figure>
                </div>
                <p className="text-sm text-ink-soft">{draft.reason}</p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field
                    label="Name"
                    value={draft.name}
                    onChange={(v) => patch(draft.id, { name: v })}
                  />
                  <label className="block">
                    <span className="micro text-ink-soft">Category</span>
                    <select
                      className="mt-1 h-11 w-full border border-hairline bg-card px-3 text-sm"
                      value={draft.category}
                      onChange={(e) =>
                        patch(draft.id, { category: e.target.value as Category })
                      }
                    >
                      {CATS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Field
                    label="Subtype"
                    value={draft.subtype}
                    onChange={(v) => patch(draft.id, { subtype: v })}
                  />
                  <Field
                    label="Colors"
                    value={draft.colors}
                    onChange={(v) => patch(draft.id, { colors: v })}
                  />
                  <Field
                    label="Material"
                    value={draft.material}
                    onChange={(v) => patch(draft.id, { material: v })}
                  />
                  <label className="block">
                    <span className="micro text-ink-soft">What you paid (optional)</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      className="mt-1 h-11 w-full border border-hairline bg-card px-3 text-sm"
                      value={draft.paid}
                      onChange={(e) => patch(draft.id, { paid: e.target.value })}
                    />
                  </label>
                </div>
                <div className="flex gap-3">
                  <Button onClick={() => keepOne(draft.id)}>Keep my photo</Button>
                  <Button variant="ghost" onClick={() => dropOne(draft.id)}>
                    Drop this one
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="micro text-ink-soft">{label}</span>
      <input
        className="mt-1 h-11 w-full border border-hairline bg-card px-3 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

async function fileToDraft(
  file: File,
  setStatus: (s: string) => void,
): Promise<Draft> {
  const original = await readAsImageSrc(file);
  setStatus("Floating it on paper…");
  const matte = await matteToPaper(original);
  let name = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
  let category: Category = "other";
  let subtype = "";
  let colors = "";
  let material = "";
  setStatus("Reading the piece…");
  try {
    const thumb = await shrinkDataUrl(original, 768);
    const tag = await tagGarment({ data: { image: thumb } });
    if (tag.ok) {
      name = tag.name;
      category = tag.category;
      subtype = tag.subtype;
      colors = tag.colors.join(", ");
      material = tag.material;
    }
  } catch {
    /* tagging is optional */
  }
  return {
    id: uid("d"),
    original,
    cutout: matte.cutoutSrc,
    quality: matte.quality,
    reason: matte.reason,
    name,
    category,
    subtype,
    colors,
    material,
    paid: "",
  };
}

async function shrinkDataUrl(src: string, max: number): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("resize"));
    el.src = src;
  });
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")?.drawImage(img, 0, 0, w, h);
  return c.toDataURL("image/jpeg", 0.82);
}

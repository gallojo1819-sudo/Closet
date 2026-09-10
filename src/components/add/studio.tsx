import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ClipboardPaste, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { matteToPaper, readAsImageSrc } from "@/lib/matte";
import { tagGarment } from "@/lib/ai";
import { guessGarment, looksLikeFilename } from "@/lib/guess";
import { useCloset } from "@/lib/store";
import type { Category } from "@/lib/types";

const CHECKS = [
  "One item",
  "Laid flat",
  "Plain surface",
  "Even light",
  "Fill the frame",
];

type Saved = {
  id: string;
  name: string;
  category: Category;
  cutout: string;
};

export function Studio() {
  const addGarment = useCloset((s) => s.addGarment);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  const pickRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback(
    async (list: FileList | File[] | null) => {
      const images = [...(list ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!images.length) {
        setError("Those files are not images.");
        return;
      }
      setError(null);
      setBusy(true);
      const added: Saved[] = [];
      const failed: string[] = [];
      for (let i = 0; i < images.length; i++) {
        const file = images[i]!;
        setStatus(
          images.length === 1
            ? "Floating on paper…"
            : `Piece ${i + 1} of ${images.length}…`,
        );
        try {
          const original = await readAsImageSrc(file);
          const matte = await matteToPaper(original);
          setStatus("Naming the piece…");
          let name = "";
          let category: Category = "other";
          let subtype = "";
          let colors: string[] = [];
          let material = "";
          let fit: "slim" | "regular" | "relaxed" = "regular";
          let formality: 1 | 2 | 3 | 4 | 5 = 3;
          let warmth: 1 | 2 | 3 | 4 | 5 = 3;
          try {
            const thumb = await shrinkDataUrl(original, 768);
            const tag = await tagGarment({ data: { image: thumb } });
            if (tag.ok && !looksLikeFilename(tag.name)) {
              name = tag.name;
              category = tag.category;
              subtype = tag.subtype;
              colors = tag.colors;
              material = tag.material;
              fit = tag.fit;
              formality = tag.formality;
              warmth = tag.warmth;
            }
          } catch {
            /* fall through to guess */
          }
          if (!name || looksLikeFilename(name) || category === "other") {
            const guess = await guessGarment(matte.cutoutSrc);
            if (!name || looksLikeFilename(name)) name = guess.name;
            if (category === "other") {
              category = guess.category;
              subtype = subtype || guess.subtype;
              colors = colors.length ? colors : guess.colors;
            }
          }
          const id = addGarment({
            name,
            category,
            subtype,
            colors,
            material,
            brand: "",
            notes: matte.reason,
            formality,
            warmth,
            fit,
            seasons: [],
            imageSrc: original,
            cutoutSrc: matte.cutoutSrc,
            imageSource: matte.quality === "busy" ? "photo" : "segmented",
            matteQuality: matte.quality,
          });
          added.push({ id, name, category, cutout: matte.cutoutSrc });
        } catch {
          failed.push(file.name);
        }
      }
      setSaved((cur) => [...added, ...cur]);
      setBusy(false);
      setStatus("");
      if (failed.length) {
        setError(
          `${failed.length} photo${failed.length === 1 ? "" : "s"} could not be read.`,
        );
      }
    },
    [addGarment],
  );

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
          Drop the roll. We name them.
        </p>
        <p className="mt-3 mx-auto max-w-md text-sm text-ink-soft leading-relaxed">
          One garment per photo. We float it on paper and tag type, color, fit.
          You do not fill a form.
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
      {saved.length > 0 && (
        <section className="space-y-4">
          <p className="text-sm text-success">
            {saved.length} in the closet — your photos, named, on paper.
            Fix a name later by tapping the piece.
          </p>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {saved.map((g) => (
              <li key={g.id}>
                <div className="border border-hairline bg-paper-deep aspect-page">
                  <img
                    src={g.cutout}
                    alt={g.name}
                    className="h-full w-full object-contain p-[8%]"
                  />
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <p className="text-sm">{g.name}</p>
                  <span className="micro text-ink-soft">{g.category}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
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

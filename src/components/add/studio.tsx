import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ClipboardPaste, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { imageKey, putImage, dataUrlToBlob } from "@/lib/images";
import { matteToPaper, readAsImageSrc } from "@/lib/matte";
import { aiStatus, printGarment, tagGarment } from "@/lib/ai";
import { guessGarment, looksLikeFilename } from "@/lib/guess";
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

type Saved = {
  id: string;
  name: string;
  category: Category;
  cutout: string;
};

export function Studio() {
  const addGarment = useCloset((s) => s.addGarment);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [canPrint, setCanPrint] = useState<boolean | null>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    aiStatus()
      .then((s) => setCanPrint(s.print))
      .catch(() => setCanPrint(false));
  }, []);

  const processOne = useCallback(
    async (file: File): Promise<Saved> => {
      const raw = await readAsImageSrc(file);
      // Originals shrink to max edge 1600 before they ever touch storage.
      const original = await shrinkDataUrl(raw, 1600, 0.85);
      const matte = await matteToPaper(original);
      // The catalog print is a digital print of HIS exact piece — the flood
      // cutout stays as fallback if there's no key or the edit fails.
      let cutout = matte.cutoutSrc;
      let source: ImageSource = matte.official
        ? "official"
        : matte.quality === "busy"
          ? "photo"
          : "segmented";
      if (!matte.official && canPrint) {
        try {
          const print = await printGarment({
            data: { image: await shrinkDataUrl(original, 1024) },
          });
          if (print.ok) {
            // The edit comes back as a temporary URL — pull the pixels local
            // before tagging or storing (canvas + IDB need same-origin data).
            cutout = await shrinkDataUrl(await toLocalDataUrl(print.image), 900, 0.85);
            source = "cutout";
          }
        } catch {
          /* flood version stays */
        }
      }
      let name = "";
      let category: Category = "other";
      let subtype = "";
      let colors: string[] = [];
      let material = "";
      let fit: "slim" | "regular" | "relaxed" = "regular";
      let formality: 1 | 2 | 3 | 4 | 5 = 3;
      let warmth: 1 | 2 | 3 | 4 | 5 = 3;
      try {
        // Tag the print, not the messy original.
        const thumb = await shrinkDataUrl(cutout, 768);
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
        const guess = await guessGarment(cutout);
        if (!name || looksLikeFilename(name)) name = guess.name;
        if (category === "other") {
          category = guess.category;
          subtype = subtype || guess.subtype;
          colors = colors.length ? colors : guess.colors;
        }
      }
      const id = uid("g");
      // Pixels go to IndexedDB; persist keeps only the keys.
      await putImage(imageKey(id, "o"), dataUrlToBlob(original));
      await putImage(imageKey(id, "c"), dataUrlToBlob(cutout));
      addGarment({
        id,
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
        imageSrc: imageKey(id, "o"),
        cutoutSrc: imageKey(id, "c"),
        imageSource: source,
        matteQuality: matte.quality,
      });
      return { id, name, category, cutout };
    },
    [addGarment, canPrint],
  );

  const processFiles = useCallback(
    async (list: FileList | File[] | null) => {
      const images = [...(list ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!images.length) {
        setError("Those files are not images.");
        return;
      }
      setError(null);
      setBusy(true);
      let i = 0;
      let done = 0;
      const misses: string[] = [];
      const worker = async () => {
        while (i < images.length) {
          const file = images[i++]!;
          setProgress(`${done} / ${images.length}`);
          try {
            const piece = await processOne(file);
            done++;
            setProgress(`${done} / ${images.length} — ${piece.name}`);
            setSaved((cur) => [piece, ...cur]);
          } catch {
            done++;
            misses.push(file.name);
          }
          // Let the tab breathe between pieces.
          await new Promise((r) => setTimeout(r, 0));
        }
      };
      await Promise.all([worker(), worker()]);
      setBusy(false);
      setProgress("");
      if (misses.length) setFailed((cur) => [...misses, ...cur]);
    },
    [processOne],
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
          One garment per photo — product shot or phone photo, we can tell. Each
          one floats on paper and lands in the closet as it finishes. You do not
          fill a form.
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
          {progress || "Working…"}
        </div>
      )}
      {canPrint === false && (
        <p className="text-sm text-ink-soft border border-hairline bg-card px-4 py-3">
          No XAI_API_KEY here — pieces float on paper with the local cut instead
          of a catalog print. Set XAI_API_KEY for catalog prints.
        </p>
      )}
      {error && (
        <p className="text-sm text-accent border border-accent/40 bg-card px-4 py-3">
          {error}
        </p>
      )}
      {failed.length > 0 && (
        <p className="text-sm text-accent border border-accent/40 bg-card px-4 py-3">
          Could not read {failed.length}: {failed.slice(0, 6).join(", ")}
          {failed.length > 6 ? "…" : ""}. The rest are in the closet.
        </p>
      )}
      {saved.length > 0 && (
        <section className="space-y-4">
          <p className="text-sm text-success">
            {saved.length} in the closet — your photos, named, on paper. Each one
            saved the moment it finished.
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

async function toLocalDataUrl(src: string): Promise<string> {
  if (src.startsWith("data:")) return src;
  const blob = await (await fetch(src)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not download print"));
    r.readAsDataURL(blob);
  });
}

async function shrinkDataUrl(src: string, max: number, q = 0.82): Promise<string> {
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
  return c.toDataURL("image/jpeg", q);
}

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ClipboardPaste, Link2, Loader2, Tag, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { imageKey, putImage, dataUrlToBlob, fileFingerprint } from "@/lib/images";
import { matteToPaper, readAsImageSrc } from "@/lib/matte";
import { aiStatus, printGarment, tagGarment } from "@/lib/ai";
import { guessGarment, looksLikeFilename } from "@/lib/guess";
import {
  fetchListing,
  identifyPiece,
  searchOfficial,
  type OfficialHit,
} from "@/lib/listing";
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
  matches?: OfficialHit[];
  query?: string;
};

class PageRejected extends Error {}
class AlreadyInCloset extends Error {
  constructor() {
    super("Already in the closet.");
  }
}

function badName(name: string): boolean {
  return (
    looksLikeFilename(name) ||
    /farfetch|ssense|net-a-porter|mr\s?porter|add to bag|\bID\b/i.test(name)
  );
}

export function Studio() {
  const addGarment = useCloset((s) => s.addGarment);
  const updateGarment = useCloset((s) => s.updateGarment);
  const ensureLookbook = useCloset((s) => s.ensureLookbook);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [dupes, setDupes] = useState<string[]>([]);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [canPrint, setCanPrint] = useState<boolean | null>(null);
  const [url, setUrl] = useState("");
  const [picker, setPicker] = useState<{
    original: string;
    fallbackCover: string;
    source: ImageSource;
    name: string;
    brand: string;
    category: Category;
    hits: OfficialHit[];
    hangtag: boolean;
  } | null>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const tagRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    aiStatus()
      .then((s) => setCanPrint(s.print))
      .catch(() => setCanPrint(false));
  }, []);

  const commit = useCallback(
    async (opts: {
      id: string;
      original: string;
      cover: string;
      source: ImageSource;
      name: string;
      category: Category;
      subtype?: string;
      colors?: string[];
      material?: string;
      brand?: string;
      fit?: "slim" | "regular" | "relaxed";
      formality?: 1 | 2 | 3 | 4 | 5;
      warmth?: 1 | 2 | 3 | 4 | 5;
      notes?: string;
      productUrl?: string;
      fileHash?: string;
      quiet?: boolean;
    }): Promise<Saved> => {
      const id = opts.id;
      await putImage(imageKey(id, "o"), dataUrlToBlob(opts.original));
      await putImage(imageKey(id, "c"), dataUrlToBlob(opts.cover));
      addGarment(
        {
          id,
          name: opts.name,
          category: opts.category,
          subtype: opts.subtype ?? "",
          colors: opts.colors ?? [],
          material: opts.material ?? "",
          brand: opts.brand ?? "",
          notes: opts.notes ?? "",
          formality: opts.formality ?? 3,
          warmth: opts.warmth ?? 3,
          fit: opts.fit ?? "regular",
          seasons: [],
          imageSrc: imageKey(id, "o"),
          cutoutSrc: imageKey(id, "c"),
          imageSource: opts.source,
          matteQuality: "clean",
          productUrl: opts.productUrl,
          fileHash: opts.fileHash,
        },
        { quiet: opts.quiet },
      );
      return { id, name: opts.name, category: opts.category, cutout: opts.cover };
    },
    [addGarment],
  );

  const processOne = useCallback(
    async (file: File, known: Set<string>): Promise<Saved> => {
      const id = uid("g");
      const hash = await fileFingerprint(file);
      if (known.has(hash)) throw new AlreadyInCloset();
      known.add(hash);
      try {
      const raw = await readAsImageSrc(file);
      const original = await shrinkDataUrl(raw, 1280, 0.85);
      const matte = await matteToPaper(original);
      if (matte.kind === "page" && !canPrint) {
        throw new PageRejected();
      }
      let cutout = matte.cutoutSrc;
      let source: ImageSource =
        matte.kind === "studio"
          ? "official"
          : matte.quality === "busy"
            ? "photo"
            : "segmented";
      // Studio/official plates stay on paper. Imagine is how three shirts become one polo.
      if ((matte.kind === "phone" || matte.kind === "page") && canPrint) {
        try {
          const print = await printGarment({
            data: { image: await shrinkDataUrl(original, 1024) },
          });
          if (print.ok) {
            cutout = await shrinkDataUrl(await toLocalDataUrl(print.image), 900, 0.85);
            source = "cutout";
          }
        } catch {
          /* paper pad stays */
        }
      }
      if (matte.kind === "page" && source !== "cutout") {
        throw new PageRejected();
      }
      let name = "";
      let category: Category = "other";
      let subtype = "";
      let colors: string[] = [];
      let material = "";
      let brand = "";
      let fit: "slim" | "regular" | "relaxed" = "regular";
      let formality: 1 | 2 | 3 | 4 | 5 = 3;
      let warmth: 1 | 2 | 3 | 4 | 5 = 3;
      try {
        const thumb = await shrinkDataUrl(cutout, 768);
        const tag = await tagGarment({
          data: {
            image: thumb,
            context:
              matte.kind === "page" ? await shrinkDataUrl(original, 768) : undefined,
          },
        });
        if (tag.ok && !badName(tag.name)) {
          name = tag.name;
          category = tag.category;
          subtype = tag.subtype;
          colors = tag.colors;
          material = tag.material;
          brand = tag.brand;
          fit = tag.fit;
          formality = tag.formality;
          warmth = tag.warmth;
        }
      } catch {
        /* fall through */
      }
      if (!name || badName(name) || category === "other") {
        const guess = await guessGarment(cutout);
        if (!name || badName(name)) name = guess.name;
        if (category === "other") {
          category = guess.category;
          subtype = subtype || guess.subtype;
          colors = colors.length ? colors : guess.colors;
        }
      }
      return await commit({
        id,
        original,
        cover: cutout,
        source,
        name,
        category,
        subtype,
        colors,
        material,
        brand,
        fit,
        formality,
        warmth,
        notes: matte.reason,
        fileHash: hash,
        quiet: true,
      });
      } catch (e) {
        known.delete(hash);
        throw e;
      }
    },
    [canPrint, commit],
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
      const known = new Set(
        useCloset
          .getState()
          .garments.map((g) => g.fileHash)
          .filter((h): h is string => Boolean(h)),
      );
      let next = 0;
      let done = 0;
      const total = images.length;
      const misses: string[] = [];
      const pages: string[] = [];
      const already: string[] = [];
      const worker = async () => {
        for (;;) {
          const idx = next++;
          if (idx >= total) return;
          const file = images[idx]!;
          try {
            const piece = await processOne(file, known);
            done++;
            setProgress(`${done}/${total} — ${piece.name}`);
            setSaved((cur) => [piece, ...cur]);
          } catch (e) {
            done++;
            if (e instanceof AlreadyInCloset) {
              already.push(file.name);
              setProgress(`${done}/${total} — Already in the closet.`);
            } else if (e instanceof PageRejected) {
              pages.push(file.name);
              setProgress(`${done}/${total}`);
            } else {
              misses.push(file.name);
              setProgress(`${done}/${total}`);
            }
          }
        }
      };
      const n = Math.min(3, total);
      await Promise.all(Array.from({ length: n }, () => worker()));
      ensureLookbook();
      setBusy(false);
      setProgress("");
      const count = useCloset.getState().garments.filter((g) => !g.archived).length;
      if (count > 0) setSavedFlash(`Saved on this URL · ${count} pieces.`);
      if (misses.length) setFailed((cur) => [...misses, ...cur]);
      if (pages.length) setRejected((cur) => [...pages, ...cur]);
      if (already.length) setDupes((cur) => [...already, ...cur]);
    },
    [processOne, ensureLookbook],
  );

  const addFromUrl = async () => {
    const href = url.trim();
    if (!href) return;
    setError(null);
    setBusy(true);
    setProgress("Opening the listing…");
    try {
      const listing = await fetchListing({ data: { url: href } });
      if (!listing.ok) {
        setError(listing.error);
        return;
      }
      const original = await shrinkDataUrl(listing.image, 1600, 0.88);
      const matte = await matteToPaper(original);
      let name = listing.title;
      let category: Category = "other";
      let brand = listing.brand;
      let subtype = "";
      let colors: string[] = [];
      try {
        const tag = await tagGarment({
          data: { image: await shrinkDataUrl(matte.cutoutSrc, 768) },
        });
        if (tag.ok && !badName(tag.name)) {
          name = tag.name;
          category = tag.category;
          subtype = tag.subtype;
          colors = tag.colors;
          brand = tag.brand || brand;
        }
      } catch {
        /* listing title stays */
      }
      if (category === "other") {
        const guess = await guessGarment(matte.cutoutSrc);
        category = guess.category;
        if (badName(name)) name = guess.name;
      }
      const piece = await commit({
        id: uid("g"),
        original,
        cover: matte.cutoutSrc,
        source: "official",
        name,
        category,
        subtype,
        colors,
        brand,
        notes: `Official plate · ${listing.source}`,
        productUrl: listing.pageUrl,
      });
      setSaved((cur) => [piece, ...cur]);
      setSavedFlash(
        `Saved on this URL · ${useCloset.getState().garments.filter((g) => !g.archived).length} pieces.`,
      );
      setUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not use that link.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const processHangtag = async (file: File) => {
    setError(null);
    setBusy(true);
    setProgress("Reading the label…");
    try {
      const original = await shrinkDataUrl(await readAsImageSrc(file), 1600, 0.85);
      const idn = await identifyPiece({
        data: { image: await shrinkDataUrl(original, 1024), mode: "hangtag" },
      });
      if (!idn.ok) {
        setError(idn.error);
        return;
      }
      setProgress(`Finding ${idn.query}…`);
      const found = await searchOfficial({ data: { query: idn.query } });
      if (!found.ok || !found.hits.length) {
        setError(found.ok ? "No official listing for that label." : found.error);
        return;
      }
      setPicker({
        original,
        fallbackCover: original,
        source: "photo",
        name: idn.name,
        brand: idn.brand,
        category: idn.category,
        hits: found.hits,
        hangtag: true,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that tag.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const findOfficial = async (piece: Saved) => {
    setError(null);
    try {
      const idn = await identifyPiece({
        data: { image: await shrinkDataUrl(piece.cutout, 768), mode: "photo" },
      });
      if (!idn.ok || !idn.query) {
        setError(idn.ok ? "No official listing for that piece." : idn.error);
        return;
      }
      const found = await searchOfficial({ data: { query: idn.query } });
      if (!found.ok || !found.hits.length) {
        setError(found.ok ? "No official listing for that piece." : found.error);
        return;
      }
      setSaved((cur) =>
        cur.map((s) =>
          s.id === piece.id ? { ...s, matches: found.hits, query: idn.query } : s,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not find an official plate.");
    }
  };

  const pickOfficial = async (hit: OfficialHit, forId?: string) => {
    setBusy(true);
    setProgress("Setting the official plate…");
    try {
      const raw = await shrinkDataUrl(hit.image, 1600, 0.88);
      const matte = await matteToPaper(raw);
      if (forId) {
        await putImage(imageKey(forId, "c"), dataUrlToBlob(matte.cutoutSrc));
        updateGarment(forId, {
          cutoutSrc: imageKey(forId, "c"),
          imageSource: "official",
          name: (hit.title.split(" - ")[0] || hit.title).slice(0, 80),
          ...(hit.brand ? { brand: hit.brand } : {}),
          productUrl: hit.pageUrl,
        });
        setSaved((cur) =>
          cur.map((s) =>
            s.id === forId
              ? {
                  ...s,
                  cutout: matte.cutoutSrc,
                  name: hit.title.split(" - ")[0] || hit.title,
                  matches: undefined,
                }
              : s,
          ),
        );
      } else if (picker) {
        const piece = await commit({
          id: uid("g"),
          original: picker.hangtag ? raw : picker.original,
          cover: matte.cutoutSrc,
          source: "official",
          name: picker.name || hit.title,
          category: picker.category,
          brand: picker.brand || hit.brand,
          notes: `Official plate · ${hit.source}`,
          productUrl: hit.pageUrl,
        });
        setSaved((cur) => [piece, ...cur]);
        setPicker(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not use that plate.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text") ?? "";
      if (/^https?:\/\//i.test(text.trim()) && !e.clipboardData?.files.length) {
        e.preventDefault();
        setUrl(text.trim());
        return;
      }
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
          The brand plate, not the bedroom.
        </p>
        <p className="mt-3 mx-auto max-w-md text-sm text-ink-soft leading-relaxed">
          Paste a Farfetch or SSENSE link. Photograph the hangtag. Or drop a
          photo — we hunt the official make and you tap the one that’s yours.
        </p>
        <ul className="mt-6 flex flex-wrap justify-center gap-2">
          {CHECKS.map((c) => (
            <li key={c} className="micro border border-hairline px-2 py-1 text-ink-soft">
              {c}
            </li>
          ))}
        </ul>
        <form
          className="mt-8 flex flex-col sm:flex-row gap-2 max-w-xl mx-auto"
          onSubmit={(e) => {
            e.preventDefault();
            void addFromUrl();
          }}
        >
          <label className="flex-1 text-left">
            <span className="sr-only">Product link</span>
            <input
              type="url"
              inputMode="url"
              placeholder="https://www.farfetch.com/…"
              className="h-11 w-full border border-hairline bg-paper px-3 text-sm"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
            />
          </label>
          <Button type="submit" disabled={busy || !url.trim()}>
            <Link2 className="size-4" />
            Use listing
          </Button>
        </form>
        <div className="mt-4 flex flex-col sm:flex-row gap-3 justify-center">
          <Button onClick={() => pickRef.current?.click()} disabled={busy}>
            <Upload className="size-4" />
            Choose photos
          </Button>
          <Button variant="ghost" onClick={() => camRef.current?.click()} disabled={busy}>
            <Camera className="size-4" />
            Take photo
          </Button>
          <Button variant="ghost" onClick={() => tagRef.current?.click()} disabled={busy}>
            <Tag className="size-4" />
            Hangtag
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
        <input
          ref={tagRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void processHangtag(file);
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
          No XAI_API_KEY here — listings still work. Hangtag identify and catalog
          covers need the key.
        </p>
      )}
      {savedFlash && (
        <p className="text-sm text-ink-soft border border-hairline bg-card px-4 py-3">
          {savedFlash}
        </p>
      )}
      {error && (
        <p className="text-sm text-accent border border-accent/40 bg-card px-4 py-3">
          {error}
        </p>
      )}
      {rejected.length > 0 && (
        <p className="text-sm text-accent border border-accent/40 bg-card px-4 py-3">
          {rejected.slice(0, 6).join(", ")}
          {rejected.length > 6 ? "…" : ""} — that’s a webpage. Paste the product
          link, or right-click the clothing photo.
        </p>
      )}
      {failed.length > 0 && (
        <p className="text-sm text-accent border border-accent/40 bg-card px-4 py-3">
          Could not read {failed.length}: {failed.slice(0, 6).join(", ")}
          {failed.length > 6 ? "…" : ""}. The rest are in the closet.
        </p>
      )}
      {dupes.length > 0 && (
        <p className="text-sm text-ink-soft border border-hairline bg-card px-4 py-3">
          Already in the closet
          {dupes.length ? `: ${dupes.slice(0, 6).join(", ")}` : "."}
          {dupes.length > 6 ? "…" : ""}
        </p>
      )}

      {picker && (
        <section className="space-y-4 border border-hairline bg-card p-5">
          <p className="micro text-ink-soft">Is this yours?</p>
          <p className="font-editorial text-2xl tracking-tight">
            {picker.brand ? `${picker.brand} · ${picker.name}` : picker.name}
          </p>
          <p className="text-sm text-ink-soft">
            Official plates from the listing. Tap the one that is this piece.
            Never auto-picked.
          </p>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {picker.hits.map((hit) => (
              <li key={hit.pageUrl + hit.title}>
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => void pickOfficial(hit)}
                  disabled={busy}
                >
                  <div className="border border-hairline bg-paper-deep aspect-page">
                    <img
                      src={hit.image}
                      alt={hit.title}
                      className="h-full w-full object-contain p-[8%]"
                    />
                  </div>
                  <p className="mt-2 text-sm leading-snug">{hit.title}</p>
                  <span className="micro text-ink-soft">{hit.source}</span>
                </button>
              </li>
            ))}
          </ul>
          <Button variant="ghost" onClick={() => setPicker(null)} disabled={busy}>
            Not these
          </Button>
        </section>
      )}

      {saved.length > 0 && (
        <section className="space-y-4">
          <p className="text-sm text-success">
            {saved.length} in the closet. Official plates replace a cover when you
            tap them.
          </p>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {saved.map((g) => (
              <li key={g.id} className="space-y-2">
                <div className="border border-hairline bg-paper-deep aspect-page">
                  <img
                    src={g.cutout}
                    alt={g.name}
                    className="h-full w-full object-contain p-[8%]"
                  />
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm">{g.name}</p>
                  <span className="micro text-ink-soft">{g.category}</span>
                </div>
                {!g.matches && (
                  <button
                    type="button"
                    className="micro text-ink-soft hover:text-ink"
                    onClick={() => void findOfficial(g)}
                    disabled={busy}
                  >
                    Find official
                  </button>
                )}
                {g.matches && g.matches.length > 0 && (
                  <div className="space-y-2">
                    <p className="micro text-ink-soft">Official make — tap yours</p>
                    <div className="grid grid-cols-3 gap-1">
                      {g.matches.map((hit) => (
                        <button
                          key={hit.pageUrl + hit.title}
                          type="button"
                          className="border border-hairline bg-paper-deep aspect-page"
                          onClick={() => void pickOfficial(hit, g.id)}
                          disabled={busy}
                        >
                          <img
                            src={hit.image}
                            alt={hit.title}
                            className="h-full w-full object-contain p-1"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
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

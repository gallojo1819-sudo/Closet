import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ClipboardPaste, Images, Link2, Loader2, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { imageKey, putImage, putThumb, dataUrlToBlob, fileFingerprint } from "@/lib/images";
import {
  cameraInputProps,
  handleCameraChange,
  HEIC_ERROR,
  imageFilesFromList,
  libraryInputProps,
} from "@/lib/camera";
import {
  ADDING_NAME,
  addProgress,
  NEW_PIECE_NAME,
  readAddConcurrency,
  shrinkFile,
  withTimeout,
} from "@/lib/ingest";
import { matteToPaper, readAsImageSrc } from "@/lib/matte";
import { enqueuePrint, enqueueTag } from "@/lib/print-queue";
import { WornPicker } from "@/components/add/worn-picker";
import { classifyScan, readAiStatus, tagGarment } from "@/lib/ai";
import { guessGarment } from "@/lib/guess";
import { isFakeName } from "@/lib/rack";
import {
  collectKnownHashes,
  filenameLooksLikeSkip,
  looksLikeFace,
  padBox,
  pieceFileHash,
  type ScanKind,
  type WornBox,
} from "@/lib/scan";
import {
  fetchListing,
  identifyPiece,
  searchOfficial,
  type OfficialHit,
} from "@/lib/listing";
import { savedFlashCopy } from "@/lib/cloud/copy";
import { useCloset } from "@/lib/store";
import type { Category, ImageSource, Tuck } from "@/lib/types";
import { uid } from "@/lib/utils";
import { guessTuck } from "@/lib/tuck";

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

type WornPick = {
  id: string;
  original: string;
  hash: string;
  boxes: WornBox[];
  done: string[];
};

type RouteResult =
  | { type: "pieces"; pieces: Saved[] }
  | { type: "worn"; pick: WornPick };

class PageRejected extends Error {}
class AlreadyInCloset extends Error {
  constructor() {
    super("Already in the closet.");
  }
}
class NotClothes extends Error {
  constructor() {
    super("Not clothes.");
  }
}
class ScanEmpty extends Error {
  constructor() {
    super("Could not pull a garment.");
  }
}

function badName(name: string): boolean {
  return isFakeName(name);
}

export function Studio() {
  const addGarment = useCloset((s) => s.addGarment);
  const updateGarment = useCloset((s) => s.updateGarment);
  const removeGarment = useCloset((s) => s.removeGarment);

  const [tab, setTab] = useState<"scan" | "dump">("scan");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [dupes, setDupes] = useState<string[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [wornQueue, setWornQueue] = useState<WornPick[]>([]);
  const [extractingBox, setExtractingBox] = useState<string | null>(null);
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
    readAiStatus()
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
      tuck?: Tuck;
      quiet?: boolean;
    }): Promise<Saved> => {
      const id = opts.id;
      await putImage(imageKey(id, "o"), dataUrlToBlob(opts.original));
      await putImage(imageKey(id, "c"), dataUrlToBlob(opts.cover));
      void putThumb(id, opts.cover).catch(() => {});
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
          tuck: opts.tuck ?? guessTuck({ name: opts.name, subtype: opts.subtype ?? "", notes: opts.notes ?? "" }),
        },
        { quiet: opts.quiet },
      );
      return { id, name: opts.name, category: opts.category, cutout: opts.cover };
    },
    [addGarment],
  );

  const landMatte = useCallback(
    async (opts: {
      id: string;
      original: string;
      cover: string;
      kind: string;
      hash: string;
      notes: string;
    }): Promise<Saved> => {
      const source: ImageSource =
        opts.kind === "studio" ? "official" : opts.kind === "phone" ? "photo" : "segmented";
      await putImage(imageKey(opts.id, "o"), dataUrlToBlob(opts.original));
      await putThumb(opts.id, opts.cover).catch(() => {});
      await putImage(imageKey(opts.id, "c"), dataUrlToBlob(opts.cover)).catch(() => {});
      let name = NEW_PIECE_NAME;
      let category: Category = "other";
      let subtype = "";
      let colors: string[] = [];
      try {
        const guess = await guessGarment(opts.cover);
        if (guess.name && !isFakeName(guess.name)) {
          name = guess.name;
          category = guess.category;
          subtype = guess.subtype;
          colors = guess.colors;
        }
      } catch {
        /* New piece */
      }
      addGarment(
        {
          id: opts.id,
          name,
          category,
          subtype,
          colors,
          material: "",
          brand: "",
          notes: opts.notes,
          formality: 3,
          warmth: 3,
          seasons: [],
          imageSrc: imageKey(opts.id, "o"),
          cutoutSrc: imageKey(opts.id, "c"),
          imageSource: source,
          matteQuality: "ok",
          fileHash: opts.hash,
          tuck: guessTuck({ name, subtype, notes: opts.notes }),
        },
        { quiet: true },
      );
      enqueueTag(opts.id, opts.cover);
      enqueuePrint(opts.id, opts.original);
      return {
        id: opts.id,
        name,
        category,
        cutout: opts.cover,
      };
    },
    [addGarment],
  );

  const pullWornBox = useCallback(
    async (
      photo: string,
      hash: string,
      box: WornBox,
      index: number,
    ): Promise<Saved | null> => {
      if (looksLikeFace(box.name, box.category, box.box)) return null;
      let crop = photo;
      if (box.box) crop = await cropDataUrl(photo, padBox(box.box));
      const matte = await matteToPaper(crop);
      if (matte.kind === "page") return null;
      return landMatte({
        id: uid("g"),
        original: crop,
        cover: matte.cutoutSrc,
        kind: matte.kind,
        hash: pieceFileHash(hash, box.slot, index),
        notes: `worn · ${box.chip || box.name}`,
      });
    },
    [landMatte],
  );

  const processScanFile = useCallback(
    async (
      file: File,
      known: Set<string>,
      onPiece: (piece: Saved) => void,
      onPreview: (piece: Saved) => void,
      onDropPreview: (id: string) => void,
      fromCamera?: boolean,
    ): Promise<RouteResult & { previewId?: string }> => {
      const hash = await fileFingerprint(file);
      if (known.has(hash)) throw new AlreadyInCloset();
      known.add(hash);
      const id = uid("g");
      let saved = false;
      try {
        const shrunk = await shrinkFile(file);
        onPreview({
          id,
          name: ADDING_NAME,
          category: "other",
          cutout: shrunk.objectUrl,
        });

        const matteP = matteToPaper(shrunk.dataUrl);
        const classP = fromCamera
          ? Promise.resolve(null)
          : withTimeout(
              classifyScan({
                data: { image: await shrinkDataUrl(shrunk.dataUrl, 768) },
              }).catch(() => null),
              4000,
            );
        const [matte, classRes] = await Promise.all([matteP, classP]);

        let kind: ScanKind = "garment";
        let boxes: WornBox[] = [];
        if (classRes && "ok" in classRes && classRes.ok) {
          kind = classRes.kind;
          boxes = classRes.boxes;
        }

        if (kind === "skip" || filenameLooksLikeSkip(file.name)) {
          throw new NotClothes();
        }

        if (kind === "worn" && boxes.length >= 2) {
          return {
            type: "worn",
            pick: {
              id: uid("w"),
              original: shrunk.dataUrl,
              hash,
              boxes: boxes.filter((b) => !looksLikeFace(b.name, b.category, b.box)),
              done: [],
            },
            previewId: id,
          };
        }

        if (matte.kind === "page") throw new PageRejected();

        const piece = await landMatte({
          id,
          original: shrunk.dataUrl,
          cover: matte.cutoutSrc,
          kind: matte.kind,
          hash,
          notes: matte.reason,
        });
        saved = true;
        onPiece(piece);
        return { type: "pieces", pieces: [piece] };
      } catch (e) {
        if (!saved) {
          known.delete(hash);
          onDropPreview(id);
        }
        throw e;
      }
    },
    [landMatte],
  );

  const scanFiles = useCallback(
    async (list: FileList | File[] | null, opts?: { camera?: boolean }) => {
      const images = imageFilesFromList(list);
      if (!images.length) {
        setError("Those files are not images.");
        return;
      }
      setError(null);
      setBusy(true);
      const known = collectKnownHashes(
        useCloset.getState().garments.map((g) => g.fileHash),
      );
      let next = 0;
      let done = 0;
      const total = images.length;
      const misses: string[] = [];
      const already: string[] = [];
      const worker = async () => {
        for (;;) {
          const idx = next++;
          if (idx >= total) return;
          const file = images[idx]!;
          try {
            const routed = await processScanFile(
              file,
              known,
              (piece) => {
                setSaved((cur) => [piece, ...cur.filter((s) => s.id !== piece.id)]);
                setProgress(addProgress(idx + 1, total, piece.name));
              },
              (preview) => {
                setSaved((cur) => [preview, ...cur.filter((s) => s.id !== preview.id)]);
              },
              (dropId) => setSaved((cur) => cur.filter((s) => s.id !== dropId)),
              opts?.camera,
            );
            done++;
            if (routed.type === "worn") {
              const previewId = routed.previewId;
              if (previewId) setSaved((cur) => cur.filter((s) => s.id !== previewId));
              setWornQueue((q) => [...q, routed.pick]);
              setProgress(addProgress(done, total));
            } else {
              const last = routed.pieces.at(-1)?.name;
              setProgress(addProgress(done, total, last));
            }
          } catch (e) {
            done++;
            if (e instanceof AlreadyInCloset) {
              already.push(file.name);
              setProgress(`${done} of ${total} · Already in the closet.`);
            } else if (e instanceof NotClothes) {
              setSkipped((n) => n + 1);
              setProgress(`${done} of ${total} · Not clothes.`);
            } else if (e instanceof Error && e.message === HEIC_ERROR) {
              setError(HEIC_ERROR);
            } else if (e instanceof ScanEmpty) {
              misses.push(file.name);
              setProgress(`${done} of ${total}`);
            } else if (e instanceof PageRejected) {
              misses.push(file.name);
              setProgress(`${done} of ${total}`);
            } else {
              misses.push(file.name);
              setProgress(`${done} of ${total}`);
            }
          }
        }
      };
      const n = Math.min(readAddConcurrency(), total);
      await Promise.all(Array.from({ length: n }, () => worker()));
      const idle = () => useCloset.getState().ensureLookbook();
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(idle, { timeout: 2500 });
      } else {
        window.setTimeout(idle, 0);
      }
      setBusy(false);
      setProgress("");
      const count = useCloset.getState().garments.filter((g) => !g.archived).length;
      if (count > 0) setSavedFlash(savedFlashCopy(count));
      if (misses.length) setFailed((cur) => [...misses, ...cur]);
      if (already.length) setDupes((cur) => [...already, ...cur]);
    },
    [processScanFile],
  );

  const dismissPiece = (id: string) => {
    removeGarment(id);
    setSaved((cur) => cur.filter((s) => s.id !== id));
  };

  const tapWorn = async (box: WornBox) => {
    const pick = wornQueue[0];
    if (!pick || extractingBox) return;
    if (pick.done.includes(box.id)) return;
    setExtractingBox(box.id);
    setError(null);
    try {
      const index = pick.boxes.findIndex((b) => b.id === box.id);
      const piece = await pullWornBox(pick.original, pick.hash, box, Math.max(0, index));
      if (!piece) {
        setError("Could not pull that piece.");
        return;
      }
      setSaved((cur) => [piece, ...cur]);
      setWornQueue((q) =>
        q.map((w, i) => (i === 0 ? { ...w, done: [...w.done, box.id] } : w)),
      );
      const idle = () => useCloset.getState().ensureLookbook();
      if (typeof requestIdleCallback === "function") requestIdleCallback(idle, { timeout: 2500 });
      else window.setTimeout(idle, 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not pull that piece.");
    } finally {
      setExtractingBox(null);
    }
  };

  const finishWorn = () => {
    setWornQueue((q) => q.slice(1));
  };

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
        savedFlashCopy(useCloset.getState().garments.filter((g) => !g.archived).length),
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
        void putThumb(forId, matte.cutoutSrc).catch(() => {});
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
        void scanFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [scanFiles]);

  const worn = wornQueue[0];

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row gap-3">
        <label className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 bg-accent px-5 text-sm text-paper">
          <Camera className="size-4" />
          Take photo
          <input
            ref={camRef}
            {...cameraInputProps()}
            className="sr-only"
            onChange={(e) => {
              handleCameraChange(
                e.target.files,
                (files) => void scanFiles(files, { camera: true }),
                () => {
                  e.target.value = "";
                },
              );
            }}
          />
        </label>
        <label className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 border border-hairline bg-transparent px-5 text-sm text-ink hover:border-hairline-strong">
          <Images className="size-4" />
          Photo library
          <input
            ref={pickRef}
            {...libraryInputProps()}
            className="sr-only"
            onChange={(e) => {
              const files = e.target.files;
              e.target.value = "";
              void scanFiles(files);
            }}
          />
        </label>
      </div>

      {worn && (
        <WornPicker
          photo={worn.original}
          boxes={worn.boxes}
          busyId={extractingBox}
          doneIds={new Set(worn.done)}
          onTap={(b) => void tapWorn(b)}
          onDone={finishWorn}
        />
      )}
      <div className="flex gap-2">
        <Button
          variant={tab === "scan" ? "primary" : "ghost"}
          onClick={() => setTab("scan")}
          disabled={busy && tab !== "scan"}
        >
          Scan photos
        </Button>
        <Button
          variant={tab === "dump" ? "primary" : "ghost"}
          onClick={() => setTab("dump")}
          disabled={busy && tab !== "dump"}
        >
          One piece
        </Button>
      </div>

      {tab === "scan" && (
        <section
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void scanFiles(e.dataTransfer.files);
          }}
          className="border border-dashed border-hairline-strong bg-card px-6 py-12 text-center"
        >
          <p className="font-editorial text-3xl md:text-4xl tracking-tight">
            Scan the camera roll.
          </p>
          <p className="mt-3 mx-auto max-w-md text-sm text-ink-soft leading-relaxed">
            Shoot it on the chair, on you, or the hanger. We’ll put it on paper.
          </p>
          <p className="mt-8 text-sm text-ink-soft">Take photo or Photo library above. Or paste.</p>
        </section>
      )}

      {tab === "dump" && (
      <section
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void scanFiles(e.dataTransfer.files);
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
      )}

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
      {skipped > 0 && (
        <p className="text-sm text-ink-soft border border-hairline bg-card px-4 py-3">
          Not clothes.{skipped > 1 ? ` · ${skipped} photos.` : ""}
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
            {saved.length} in the closet. Skip a tile if it is not a piece.
          </p>
          <ul className="flex gap-4 overflow-x-auto pb-2">
            {saved.map((g) => (
              <li key={g.id} className="w-36 shrink-0 space-y-2">
                <div className="border border-hairline bg-paper-deep aspect-page">
                  <img
                    src={g.cutout}
                    alt={g.name}
                    className="h-full w-full object-contain p-[8%]"
                  />
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm leading-snug">{g.name}</p>
                  <span className="micro text-ink-soft">{g.category}</span>
                </div>
                <button
                  type="button"
                  className="micro text-ink-soft hover:text-ink"
                  onClick={() => dismissPiece(g.id)}
                >
                  Not this
                </button>
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

async function cropDataUrl(
  src: string,
  box: { x: number; y: number; w: number; h: number },
): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("crop"));
    el.src = src;
  });
  const x = Math.round(box.x * img.naturalWidth);
  const y = Math.round(box.y * img.naturalHeight);
  const w = Math.max(8, Math.round(box.w * img.naturalWidth));
  const h = Math.max(8, Math.round(box.h * img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")?.drawImage(img, x, y, w, h, 0, 0, w, h);
  return c.toDataURL("image/jpeg", 0.88);
}

const PAPER = { r: 244, g: 239, b: 230 };

/** Imagine left the page blank — do not commit an invented extra. */
async function isBlankPaper(src: string): Promise<boolean> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("blank"));
      el.src = src;
    });
    const w = 80;
    const h = 100;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const dr = Math.abs(data[i]! - PAPER.r);
      const dg = Math.abs(data[i + 1]! - PAPER.g);
      const db = Math.abs(data[i + 2]! - PAPER.b);
      if (dr + dg + db >= 28) n++;
    }
    return n < w * h * 0.04;
  } catch {
    return false;
  }
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

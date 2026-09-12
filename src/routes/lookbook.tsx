import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FlatLay } from "@/components/closet/flat-lay";
import { LookBuilder } from "@/components/closet/look-builder";
import { dressLook } from "@/components/closet/on-me";
import { aiStatus } from "@/lib/ai";
import {
  dataUrlToBlob,
  deleteImage,
  getImage,
  lookOnMeKey,
  putImage,
} from "@/lib/images";
import { lookbookPool, lookbookStats } from "@/lib/lookbook";
import { slotOf } from "@/lib/style";
import { useCloset } from "@/lib/store";
import type { Garment, Look } from "@/lib/types";
import { useImageSrc } from "@/lib/use-image";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/lookbook")({ component: LookbookPage });

type Job = () => Promise<void>;
const dressQ: Job[] = [];
let dressN = 0;
function enqueueDress(job: Job) {
  dressQ.push(job);
  pumpDress();
}
function pumpDress() {
  while (dressN < 2 && dressQ.length) {
    const job = dressQ.shift()!;
    dressN += 1;
    void job().finally(() => {
      dressN -= 1;
      pumpDress();
    });
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

function blobOf(g: Garment): string {
  return `${g.subtype} ${g.name}`.toLowerCase();
}
function isKnit(g: Garment): boolean {
  return /knit|sweater|crewneck|pullover|merino|cashmere/.test(blobOf(g));
}
function isOxfordShirt(g: Garment): boolean {
  if (isKnit(g)) return false;
  return /oxford|\bshirts?\b/.test(blobOf(g));
}
function knitWithoutShirt(pieces: Garment[]): boolean {
  const tops = pieces.filter((g) => slotOf(g) === "top" || slotOf(g) === "dress");
  return tops.some(isKnit) && !pieces.some(isOxfordShirt);
}
function suggestShirt(pieces: Garment[], closet: Garment[]): Garment | null {
  if (!knitWithoutShirt(pieces)) return null;
  const used = new Set(pieces.map((g) => g.id));
  const shirts = closet.filter(
    (g) => !used.has(g.id) && !g.archived && slotOf(g) === "top" && isOxfordShirt(g),
  );
  return (
    shirts.find((g) =>
      /white|ivory|cream/.test(`${g.name} ${g.colors.join(" ")}`.toLowerCase()),
    ) ??
    shirts[0] ??
    null
  );
}

function LookCard({
  look,
  pieces,
  extra,
  canPrint,
  refPhoto,
  closet,
  onWear,
  onLayer,
}: {
  look: Look;
  pieces: Garment[];
  extra?: string;
  canPrint: boolean;
  refPhoto: string | null;
  closet: Garment[];
  onWear: () => void;
  onLayer: (shirt: Garment) => void;
}) {
  const cacheKey = lookOnMeKey(look.id, extra);
  const cachedSrc = useImageSrc(cacheKey);
  const [frame, setFrame] = useState<string | null>(null);
  const [showMe, setShowMe] = useState(false);
  const [dressing, setDressing] = useState(false);
  const [dressError, setDressError] = useState<string | null>(null);
  const started = useRef(false);
  const rootRef = useRef<HTMLLIElement>(null);
  const layer = extra ? null : suggestShirt(pieces, closet);
  const painted = frame || cachedSrc;
  const pieceIds = pieces.map((p) => p.id).join(",");

  useEffect(() => {
    return () => {
      if (frame) URL.revokeObjectURL(frame);
    };
  }, [frame]);

  useEffect(() => {
    if (cachedSrc) setShowMe(true);
  }, [cachedSrc]);

  const paint = (dataUrl: string) => {
    const url = URL.createObjectURL(dataUrlToBlob(dataUrl));
    setFrame((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    setShowMe(true);
  };

  const fail = (e: unknown) => {
    const msg = e instanceof Error ? e.message : "Could not dress you.";
    setDressError(msg === "timeout" ? "Imagine timed out after 45s." : msg);
  };

  const runDress = (force = false) => {
    if (dressing) return;
    started.current = true;
    setDressing(true);
    setDressError(null);
    const shot = pieces;
    enqueueDress(async () => {
      try {
        if (!force) {
          const hit = await getImage(cacheKey);
          if (hit) {
            setShowMe(true);
            return;
          }
        } else {
          await deleteImage(cacheKey);
        }
        const image = await withTimeout(dressLook(shot), 45_000);
        await putImage(cacheKey, dataUrlToBlob(image));
        paint(image);
      } catch (e) {
        fail(e);
      } finally {
        setDressing(false);
      }
    });
  };

  useEffect(() => {
    started.current = false;
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || started.current) return;
        void getImage(cacheKey).then((hit) => {
          if (hit) {
            setShowMe(true);
            return;
          }
          if (!canPrint || !refPhoto) return;
          runDress(false);
        });
      },
      { rootMargin: "240px", threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPrint, refPhoto, cacheKey, pieceIds]);

  return (
    <li ref={rootRef}>
      <div className="relative border border-hairline bg-paper aspect-[4/5] overflow-hidden">
        <FlatLay pieces={pieces} className="border-0" />
        {showMe && painted && (
          <img
            src={painted}
            alt={look.name}
            className="absolute inset-0 z-10 h-full w-full object-cover bg-paper"
          />
        )}
        {dressing && (
          <div className="absolute inset-x-0 bottom-0 z-20 h-0.5 bg-hairline">
            <div className="h-full w-1/3 bg-ink animate-pulse" />
          </div>
        )}
      </div>
      <p className="mt-3">{look.name}</p>
      <p className="micro text-ink-soft">{look.occasion}</p>
      {dressError && (
        <p className="mt-1 text-sm text-accent">{dressError}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onWear}
          className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong"
        >
          Wear this
        </button>
        <button
          type="button"
          onClick={() => {
            if (painted && !dressError) setShowMe((v) => !v);
            else runDress(Boolean(dressError));
          }}
          className={cn(
            "micro border px-3 py-2",
            showMe && painted
              ? "border-ink bg-ink text-paper"
              : "border-hairline text-ink-soft hover:border-hairline-strong",
          )}
        >
          {dressing ? "Dressing you…" : "On you"}
        </button>
        {layer && (
          <button
            type="button"
            onClick={() => onLayer(layer)}
            className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong"
          >
            Layer? {layer.name}
          </button>
        )}
      </div>
    </li>
  );
}

function LookbookPage() {
  const hydrated = useCloset((s) => s.hydrated);
  const garmentsAll = useCloset((s) => s.garments);
  const looksAll = useCloset((s) => s.looks);
  const refPhoto = useCloset((s) => s.refPhoto);
  const ensureLookbook = useCloset((s) => s.ensureLookbook);
  const wearToday = useCloset((s) => s.wearToday);
  const [play, setPlay] = useState(false);
  const [canPrint, setCanPrint] = useState(false);
  const [extras, setExtras] = useState<Record<string, string>>({});

  useEffect(() => {
    aiStatus()
      .then((s) => setCanPrint(s.print))
      .catch(() => setCanPrint(false));
  }, []);

  useEffect(() => {
    if (!hydrated || garmentsAll.length === 0) return;
    ensureLookbook();
  }, [hydrated, garmentsAll, ensureLookbook]);

  const garments = useMemo(
    () => garmentsAll.filter((g) => !g.archived),
    [garmentsAll],
  );
  const byId = useMemo(() => {
    const m = new Map<string, Garment>();
    for (const g of garments) m.set(g.id, g);
    return m;
  }, [garments]);
  const book = useMemo(
    () => looksAll.filter((l) => l.lookbook).slice(0, 48),
    [looksAll],
  );
  const pool = lookbookPool(garments);
  const canBuild = ["top", "bottom", "footwear"].every((slot) =>
    pool.some((g) => slotOf(g) === slot || (slot === "top" && slotOf(g) === "dress")),
  );
  const stats = lookbookStats(book, garments);

  const piecesFor = (look: Look) => {
    const extra = extras[look.id];
    const ids = extra ? [...look.garmentIds, extra] : look.garmentIds;
    return ids.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
  };

  return (
    <div className="mx-auto max-w-6xl px-4 md:px-6 py-8 md:py-12 rise">
      <p className="micro text-ink-soft">Lookbook</p>
      <h1 className="mt-2 font-editorial text-4xl md:text-6xl tracking-tight">
        Lookbook
      </h1>
      <p className="mt-3 text-ink-soft max-w-xl">
        Best outfits from this closet, on paper. Dress you when a card is on screen.
      </p>
      {book.length > 0 && (
        <p className="mt-3 micro text-ink-soft">
          {stats.looks} looks · {stats.pieces} pieces
          {stats.everyPieceUsed ? " · every piece used." : "."}
        </p>
      )}
      <button
        type="button"
        onClick={() => setPlay((v) => !v)}
        className="mt-4 micro text-ink-soft hover:text-ink"
      >
        {play ? "Close builder" : "Make a look"}
      </button>
      {play && (
        <div className="mt-4">
          <LookBuilder onClose={() => setPlay(false)} />
        </div>
      )}

      {hydrated && garments.length === 0 ? (
        <div className="mt-10 border border-hairline bg-card px-4 py-5">
          <p className="text-sm text-ink-soft">
            Lookbook is this closet. Add pieces on Add — don’t re-upload here.
          </p>
          <Link
            to="/add"
            className="mt-4 inline-flex h-11 items-center bg-accent px-4 text-sm text-paper"
          >
            Add a piece
          </Link>
        </div>
      ) : !canBuild ? (
        <div className="mt-10 border border-hairline bg-card px-4 py-5">
          <p className="text-sm text-ink-soft">
            Need a top, a bottom, and shoes.
          </p>
          <Link
            to="/add"
            className="mt-4 inline-flex h-11 items-center bg-accent px-4 text-sm text-paper"
          >
            Add a piece
          </Link>
        </div>
      ) : (
        <ul className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {book.map((look) => {
            const pieces = piecesFor(look);
            if (pieces.length < 3) return null;
            return (
              <LookCard
                key={look.id}
                look={look}
                pieces={pieces}
                extra={extras[look.id]}
                canPrint={canPrint}
                refPhoto={refPhoto}
                closet={garments}
                onWear={() => wearToday(pieces.map((g) => g.id))}
                onLayer={(shirt) => setExtras((cur) => ({ ...cur, [look.id]: shirt.id }))}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { FlatLay } from "@/components/closet/flat-lay";
import { LookBuilder } from "@/components/closet/look-builder";
import { dressLook } from "@/components/closet/on-me";
import { openRefPhotoDialog } from "@/components/shell/top-bar";
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
    (g) =>
      !used.has(g.id) &&
      !g.archived &&
      slotOf(g) === "top" &&
      isOxfordShirt(g),
  );
  return (
    shirts.find((g) =>
      /white|ivory|cream/.test(`${g.name} ${g.colors.join(" ")}`.toLowerCase()),
    ) ??
    shirts[0] ??
    null
  );
}

function LookOnMeCard({
  look,
  pieces,
  cacheKey,
  paper,
  noKey,
  dressing,
  layer,
  onWear,
  onPaper,
  onRetry,
  onLayer,
}: {
  look: Look;
  pieces: Garment[];
  cacheKey: string;
  paper: boolean;
  noKey: boolean;
  dressing: boolean;
  layer: Garment | null;
  onWear: () => void;
  onPaper: () => void;
  onRetry: () => void;
  onLayer: () => void;
}) {
  const cached = useImageSrc(cacheKey);
  const showMe = Boolean(cached) && !paper;

  return (
    <li>
      <div className="relative border border-hairline bg-paper-deep aspect-[4/5] overflow-hidden">
        {showMe ? (
          <img
            src={cached}
            alt={look.name}
            className="h-full w-full object-contain"
          />
        ) : paper ? (
          <FlatLay pieces={pieces} className="border-0 aspect-[4/5]" />
        ) : (
          <div className="h-full w-full bg-paper-deep" />
        )}
        {!showMe && (
          <>
            <p className="absolute inset-x-0 bottom-3 micro px-2 text-ink-soft">
              {noKey
                ? "On-me needs the key."
                : paper
                  ? "Paper tiles are the garment."
                  : "Dressing you…"}
            </p>
            {dressing && !paper && (
              <div className="absolute inset-x-0 bottom-0 h-0.5 bg-hairline">
                <div className="h-full w-1/3 bg-ink animate-pulse" />
              </div>
            )}
          </>
        )}
      </div>
      <p className="mt-3">{look.name}</p>
      <p className="micro text-ink-soft">{look.occasion}</p>
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
          onClick={onRetry}
          className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong inline-flex items-center gap-2"
        >
          {dressing && <Loader2 className="size-3 animate-spin" />}
          Try again
        </button>
        <button
          type="button"
          onClick={onPaper}
          className={cn(
            "micro border px-3 py-2",
            paper
              ? "border-ink bg-ink text-paper"
              : "border-hairline text-ink-soft hover:border-hairline-strong",
          )}
        >
          Use paper
        </button>
        {layer && (
          <button
            type="button"
            onClick={onLayer}
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
  const [canPrint, setCanPrint] = useState<boolean | null>(null);
  const [paper, setPaper] = useState<Set<string>>(() => new Set());
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [extras, setExtras] = useState<Record<string, string>>({});
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const askedFit = useRef(false);

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
  const bookKey = book.map((l) => l.id).join(",");

  useEffect(() => {
    if (!hydrated || !canBuild) return;
    if (refPhoto) return;
    if (askedFit.current) return;
    askedFit.current = true;
    openRefPhotoDialog();
  }, [hydrated, canBuild, refPhoto]);

  useEffect(() => {
    if (!hydrated || !canBuild || !refPhoto || canPrint !== true) return;
    if (!book.length) return;
    let live = true;
    setTotal(book.length);
    setDone(0);
    let i = 0;
    const worker = async () => {
      for (;;) {
        const idx = i++;
        if (idx >= book.length || !live) return;
        const look = book[idx]!;
        const extra = extras[look.id];
        const key = lookOnMeKey(look.id, extra);
        const hit = await getImage(key).catch(() => null);
        if (hit) {
          setDone((n) => n + 1);
          continue;
        }
        const ids = extra ? [...look.garmentIds, extra] : look.garmentIds;
        const pieces = ids
          .map((id) => byId.get(id))
          .filter((g): g is Garment => Boolean(g));
        setBusyIds((cur) => new Set(cur).add(look.id));
        try {
          const image = await dressLook(pieces);
          if (!live) return;
          await putImage(key, dataUrlToBlob(image));
        } catch {
          /* skeleton stays until Try again */
        } finally {
          setBusyIds((cur) => {
            const next = new Set(cur);
            next.delete(look.id);
            return next;
          });
          setDone((n) => n + 1);
        }
      }
    };
    void Promise.all([worker(), worker(), worker()]);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, canBuild, refPhoto, canPrint, bookKey]);

  const piecesFor = (look: Look) => {
    const extra = extras[look.id];
    const ids = extra ? [...look.garmentIds, extra] : look.garmentIds;
    return ids.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
  };

  const retry = async (look: Look) => {
    const extra = extras[look.id];
    const key = lookOnMeKey(look.id, extra);
    setPaper((cur) => {
      const next = new Set(cur);
      next.delete(look.id);
      return next;
    });
    setBusyIds((cur) => new Set(cur).add(look.id));
    try {
      await deleteImage(key);
      const image = await dressLook(piecesFor(look));
      await putImage(key, dataUrlToBlob(image));
    } catch {
      /* stay skeleton */
    } finally {
      setBusyIds((cur) => {
        const next = new Set(cur);
        next.delete(look.id);
        return next;
      });
    }
  };

  const layerLook = async (look: Look, shirt: Garment) => {
    setExtras((cur) => ({ ...cur, [look.id]: shirt.id }));
    setPaper((cur) => {
      const next = new Set(cur);
      next.delete(look.id);
      return next;
    });
    const key = lookOnMeKey(look.id, shirt.id);
    setBusyIds((cur) => new Set(cur).add(look.id));
    try {
      const pieces = [...look.garmentIds, shirt.id]
        .map((id) => byId.get(id))
        .filter((g): g is Garment => Boolean(g));
      const image = await dressLook(pieces);
      await putImage(key, dataUrlToBlob(image));
    } catch {
      /* skeleton */
    } finally {
      setBusyIds((cur) => {
        const next = new Set(cur);
        next.delete(look.id);
        return next;
      });
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 md:px-6 py-8 md:py-12 rise">
      <p className="micro text-ink-soft">Lookbook</p>
      <h1 className="mt-2 font-editorial text-4xl md:text-6xl tracking-tight">
        Lookbook
      </h1>
      <p className="mt-3 text-ink-soft max-w-xl">
        You, in the best outfits from this closet.
      </p>
      {book.length > 0 && (
        <p className="mt-3 micro text-ink-soft">
          {stats.looks} looks · {stats.pieces} pieces
          {stats.everyPieceUsed ? " · every piece used." : "."}
        </p>
      )}
      {total > 0 && done < total && (
        <p className="mt-2 micro text-ink-soft">
          On you · {done}/{total}
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
            const extra = extras[look.id];
            const layer = extra ? null : suggestShirt(pieces, garments);
            return (
              <LookOnMeCard
                key={look.id}
                look={look}
                pieces={pieces}
                cacheKey={lookOnMeKey(look.id, extra)}
                paper={paper.has(look.id)}
                noKey={canPrint === false}
                dressing={busyIds.has(look.id)}
                layer={layer}
                onWear={() => wearToday(pieces.map((g) => g.id))}
                onPaper={() =>
                  setPaper((cur) => {
                    const next = new Set(cur);
                    next.add(look.id);
                    return next;
                  })
                }
                onRetry={() => void retry(look)}
                onLayer={() => layer && void layerLook(look, layer)}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

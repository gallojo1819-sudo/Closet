import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FlatLay } from "@/components/closet/flat-lay";
import { IdleMount } from "@/components/closet/idle-mount";
import { LookBuilder } from "@/components/closet/look-builder";
import { LookSheet } from "@/components/closet/look-sheet";
import { ensureLookOnMe } from "@/components/closet/on-me";
import { rackLine } from "@/lib/gaps";
import { lookOnMeKey } from "@/lib/images";
import { useImageSrc } from "@/lib/use-image";
import {
  comboKey,
  lookbookPool,
  lookFitsOccasion,
  lookHasColor,
} from "@/lib/lookbook";
import { slotOf } from "@/lib/style";
import { useCloset } from "@/lib/store";
import { OCCASIONS, type Garment, type Look, type Occasion } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/lookbook")({
  component: LookbookPage,
  validateSearch: (raw: Record<string, unknown>): { look?: string } => ({
    look: typeof raw.look === "string" ? raw.look : undefined,
  }),
});

function LookCardFace({
  look,
  pieces,
  onOpen,
  cardRef,
}: {
  look: Look;
  pieces: Garment[];
  onOpen: () => void;
  cardRef: (el: HTMLElement | null) => void;
}) {
  const cacheKey = lookOnMeKey(look.id);
  const cachedSrc = useImageSrc(cacheKey);
  const [dressing, setDressing] = useState(false);
  const [dressError, setDressError] = useState<string | null>(null);

  const onYou = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dressing) return;
    setDressing(true);
    setDressError(null);
    void (async () => {
      try {
        await ensureLookOnMe(look.id, pieces, 45_000, look.occasion as Occasion);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not dress you.";
        setDressError(msg === "timeout" ? "Imagine timed out after 45s." : msg);
      } finally {
        setDressing(false);
      }
    })();
  };

  return (
    <>
      <div
        ref={cardRef}
        className="relative w-full border border-hairline bg-paper aspect-[4/5] overflow-hidden"
        style={{ viewTransitionName: "none" }}
      >
        <button
          type="button"
          onClick={onOpen}
          aria-label={look.name}
          className="absolute inset-0 block"
        >
          <FlatLay pieces={pieces} className="h-full border-0 pointer-events-none" passive />
          {cachedSrc && (
            <img
              src={cachedSrc}
              alt=""
              className="on-you-glass absolute inset-0 z-10 h-full w-full object-cover bg-paper pointer-events-none"
            />
          )}
        </button>
        {!cachedSrc && (
          <button
            type="button"
            onClick={onYou}
            className="absolute bottom-2 left-2 z-20 micro border border-hairline bg-paper px-2 py-1 text-ink-soft hover:border-hairline-strong"
          >
            {dressing ? "On you…" : "On you"}
          </button>
        )}
      </div>
      {dressError && <p className="mt-1 text-sm text-accent">{dressError}</p>}
    </>
  );
}

function LookCard({
  look,
  pieces,
  highlight,
  index,
  onOpen,
  cardRef,
}: {
  look: Look;
  pieces: Garment[];
  highlight?: boolean;
  index: number;
  onOpen: () => void;
  cardRef: (el: HTMLElement | null) => void;
}) {
  const rootRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!highlight) return;
    rootRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight]);

  return (
    <li
      ref={rootRef}
      id={`look-${look.id}`}
      className={highlight ? "outline outline-1 outline-ink" : undefined}
    >
      <IdleMount
        index={index}
        always={12}
        placeholder={
          <button
            type="button"
            ref={cardRef}
            onClick={onOpen}
            aria-label={look.name}
            className="block w-full aspect-[4/5] border border-hairline bg-paper"
          />
        }
      >
        <LookCardFace look={look} pieces={pieces} onOpen={onOpen} cardRef={cardRef} />
      </IdleMount>
      <p className="mt-3">{look.name}</p>
      <p className="micro text-ink-soft">{look.occasion}</p>
    </li>
  );
}

function LookbookPage() {
  const hydrated = useCloset((s) => s.hydrated);
  const garmentsAll = useCloset((s) => s.garments);
  const looksAll = useCloset((s) => s.looks);
  const ensureLookbook = useCloset((s) => s.ensureLookbook);
  const ensureOccasionBook = useCloset((s) => s.ensureOccasionBook);
  const shuffleChapter = useCloset((s) => s.shuffleChapter);
  const resetChapter = useCloset((s) => s.resetChapter);
  const markSeen = useCloset((s) => s.markSeen);
  const wearToday = useCloset((s) => s.wearToday);
  const [play, setPlay] = useState(false);
  const [occasion, setOccasion] = useState<(typeof OCCASIONS)[number]["id"]>("weekday");
  const [color, setColor] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const cardEls = useRef(new Map<string, HTMLElement>());
  const { look: focusLook } = Route.useSearch();

  const garments = useMemo(
    () => garmentsAll.filter((g) => !g.archived),
    [garmentsAll],
  );
  const byId = useMemo(() => {
    const m = new Map<string, Garment>();
    for (const g of garments) m.set(g.id, g);
    return m;
  }, [garments]);
  const book = useMemo(() => looksAll.filter((l) => l.lookbook), [looksAll]);
  const pool = lookbookPool(garments);
  const canBuild = ["top", "bottom", "footwear"].every((slot) =>
    pool.some((g) => slotOf(g) === slot || (slot === "top" && slotOf(g) === "dress")),
  );
  const gap = useMemo(() => rackLine(garments), [garments]);
  const chapterLabel = OCCASIONS.find((o) => o.id === occasion)?.label ?? "Weekday";
  const colorChips = useMemo(() => {
    const set = new Set<string>();
    for (const g of garments) for (const c of g.colors) if (c) set.add(c.toLowerCase());
    return [...set].sort();
  }, [garments]);

  const piecesFor = (look: Look) =>
    look.garmentIds.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));

  const shown = useMemo(() => {
    return book.filter((look) => {
      const pieces = piecesFor(look);
      if (pieces.length < 3) return false;
      if (look.occasion !== occasion) return false;
      if (look.source !== "manual" && !lookFitsOccasion(pieces, occasion, pool)) {
        return false;
      }
      if (color && !lookHasColor(pieces, color)) return false;
      return true;
    });
  }, [book, occasion, color, byId, pool]);

  const highlightId = focusLook ?? null;

  useEffect(() => {
    if (focusLook) setOpenId(focusLook);
  }, [focusLook]);

  useEffect(() => {
    if (!hydrated) return;
    ensureLookbook();
  }, [hydrated, garments.length, ensureLookbook]);

  useEffect(() => {
    if (!hydrated) return;
    ensureOccasionBook(occasion);
  }, [hydrated, occasion, garments.length, ensureOccasionBook]);

  useEffect(() => {
    if (!hydrated || shown.length === 0) return;
    markSeen(
      occasion,
      shown.map((l) => comboKey(l.garmentIds)),
    );
  }, [hydrated, occasion, shown, markSeen]);

  const getOpenCard = useCallback(
    () => (openId ? cardEls.current.get(openId) ?? null : null),
    [openId],
  );

  const openLook = shown.find((l) => l.id === openId) ?? book.find((l) => l.id === openId) ?? null;
  const openPieces = openLook ? piecesFor(openLook) : [];

  return (
    <div className="mx-auto max-w-6xl px-4 md:px-6 py-8 md:py-12 rise">
      <p className="micro text-ink-soft">Lookbook</p>
      <h1 className="mt-2 font-editorial text-4xl md:text-6xl tracking-tight">
        Lookbook
      </h1>
      <p className="mt-3 text-ink-soft max-w-xl">
        {chapterLabel}. 10 looks · Shuffle · Save on the sheet.
      </p>
      {gap && (
        <p className="mt-3 text-sm text-ink-soft max-w-xl">{gap}</p>
      )}
      <div className="mt-6 flex flex-wrap gap-2">
        {OCCASIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => {
              setOccasion(o.id);
              setExhausted(false);
            }}
            className={cn(
              "micro border px-3 py-2",
              occasion === o.id
                ? "border-ink bg-ink text-paper"
                : "border-hairline text-ink-soft",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {colorChips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {colorChips.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor((cur) => (cur === c ? null : c))}
              className={cn(
                "micro border px-3 py-2",
                color === c
                  ? "border-ink bg-ink text-paper"
                  : "border-hairline text-ink-soft",
              )}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
      <button
        type="button"
        onClick={() => {
          const n = shuffleChapter(occasion);
          setExhausted(n < 3);
        }}
        className="micro text-ink-soft hover:text-ink"
      >
        Shuffle
      </button>
      <button
        type="button"
        onClick={() => setPlay((v) => !v)}
        className="micro text-ink-soft hover:text-ink"
      >
        {play ? "Close builder" : "Make a look"}
      </button>
      </div>
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
        <>
      {exhausted && (
        <div className="mt-8 border border-hairline bg-card px-4 py-5">
          <p className="text-sm text-ink-soft">
            You’ve seen this chapter. Save a look you like, or add a piece.
          </p>
          <button
            type="button"
            onClick={() => {
              resetChapter(occasion);
              setExhausted(false);
            }}
            className="mt-4 micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong"
          >
            Reset chapter
          </button>
        </div>
      )}
      {shown.length === 0 && !exhausted ? (
        <p className="mt-10 text-sm text-ink-soft">
          Save a look you like, or add a piece.
        </p>
      ) : shown.length > 0 ? (
        <ul className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {shown.map((look, i) => {
            const pieces = piecesFor(look);
            if (pieces.length < 3) return null;
            return (
              <LookCard
                key={look.id}
                look={look}
                pieces={pieces}
                index={i}
                highlight={highlightId === look.id}
                onOpen={() => setOpenId(look.id)}
                cardRef={(el) => {
                  if (el) cardEls.current.set(look.id, el);
                  else cardEls.current.delete(look.id);
                }}
              />
            );
          })}
        </ul>
      ) : null}
      {openLook && openPieces.length >= 2 && (
        <LookSheet
          look={openLook}
          pieces={openPieces}
          book={book}
          closet={garments}
          getCard={getOpenCard}
          onClose={() => setOpenId(null)}
          onWear={() => wearToday(openPieces.map((g) => g.id))}
          onOpenLook={(next) => setOpenId(next.id)}
        />
      )}
        </>
      )}
    </div>
  );
}

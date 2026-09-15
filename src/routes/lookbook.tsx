import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { IdleMount } from "@/components/closet/idle-mount";
import { LookBuilder } from "@/components/closet/look-builder";
import { LookKit } from "@/components/closet/look-kit";
import { LookSheet } from "@/components/closet/look-sheet";
import { rackLine } from "@/lib/gaps";
import { lookOnMeKey } from "@/lib/images";
import { useImageSrc } from "@/lib/use-image";
import {
  comboKey,
  enforcePieceCap,
  lookbookPool,
  lookFitsHouse,
  lookFitsOccasion,
  lookHasColor,
  stripRepeatBlazers,
} from "@/lib/lookbook";
import { lookFitsSeason, seasonFromWeather, seasonRank } from "@/lib/season";
import { paletteCss } from "@/lib/color";
import { spreadMicro, spreadTitle } from "@/lib/look";
import { livePool } from "@/lib/rack";
import { HOUSE_CHIPS, slotOf, type House } from "@/lib/style";
import { useCloset } from "@/lib/store";
import { OCCASIONS, SEASONS, type Garment, type Look, type Occasion, type Season } from "@/lib/types";
import { cn } from "@/lib/utils";

function emptyFilterCopy(
  chapter: string,
  seasonLabel: string,
  seasonChip: "auto" | Season,
  houseChip: "all" | House,
  color: string | null,
): string {
  const named = [chapter];
  const seasonName = seasonLabel.replace(/^Auto · /, "");
  if (seasonChip !== "auto") named.push(seasonName);
  if (houseChip !== "all") {
    named.push(HOUSE_CHIPS.find((h) => h.id === houseChip)?.label ?? houseChip);
  }
  if (color) named.push(color);
  let hint = "Switch Weekend.";
  if (seasonChip !== "auto") hint = `Clear ${seasonName} or switch Weekend.`;
  else if (houseChip !== "all") {
    hint = `Clear ${HOUSE_CHIPS.find((h) => h.id === houseChip)?.label ?? "house"} or switch Weekend.`;
  } else if (color) hint = `Clear ${color} or switch Weekend.`;
  return `Nothing in this closet for ${named.join(" × ")}. ${hint}`;
}

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
  const extra = comboKey(pieces.map((p) => p.id));
  const liveSrc = useImageSrc(lookOnMeKey(look.id, extra));
  const cachedSrc = liveSrc;

  return (
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
        <LookKit pieces={pieces} className="h-full pointer-events-none" />
        {cachedSrc && (
          <img
            src={cachedSrc}
            alt=""
            className="on-you-glass absolute inset-0 z-10 h-full w-full object-contain bg-paper pointer-events-none"
          />
        )}
      </button>
    </div>
  );
}

function LookCard({
  look,
  pieces,
  highlight,
  index,
  onOpen,
  cardRef,
  season,
}: {
  look: Look;
  pieces: Garment[];
  highlight?: boolean;
  index: number;
  onOpen: () => void;
  cardRef: (el: HTMLElement | null) => void;
  season: string;
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
      <p className="mt-3">{spreadTitle(pieces, look.occasion as Occasion)}</p>
      <p className="micro text-ink-soft">
        {spreadMicro(pieces, look.occasion as Occasion, season)}
      </p>
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
  const [seasonChip, setSeasonChip] = useState<"auto" | Season>("auto");
  const [houseChip, setHouseChip] = useState<"all" | House>("all");
  const [color, setColor] = useState<string | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const drop = useCloset((s) => s.drop);
  const [openId, setOpenId] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const cardEls = useRef(new Map<string, HTMLElement>());
  const { look: focusLook } = Route.useSearch();

  const garments = useMemo(() => livePool(garmentsAll), [garmentsAll]);
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
  const autoSeason = seasonFromWeather(drop?.weather?.f ?? 68);
  const season: Season = seasonChip === "auto" ? autoSeason : seasonChip;
  const seasonLabel =
    seasonChip === "auto"
      ? `Auto · ${SEASONS.find((s) => s.id === autoSeason)?.label ?? "Fall"}`
      : (SEASONS.find((s) => s.id === season)?.label ?? "Fall");
  const colorChips = useMemo(() => {
    const set = new Set<string>();
    for (const g of garments) for (const c of g.colors) if (c) set.add(c.toLowerCase());
    return [...set].sort();
  }, [garments]);

  const piecesFor = (look: Look) =>
    look.garmentIds.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));

  const shown = useMemo(() => {
    const rows = book.filter((look) => {
      const pieces = piecesFor(look);
      if (pieces.length < 2) return false;
      if (look.occasion !== occasion) return false;
      if (look.source !== "manual" && !lookFitsOccasion(pieces, occasion, pool)) {
        return false;
      }
      if (!lookFitsSeason(pieces, season)) return false;
      if (houseChip !== "all" && !lookFitsHouse(pieces, houseChip, occasion, pool)) {
        return false;
      }
      if (color && !lookHasColor(pieces, color)) return false;
      return true;
    });
    const ranked = [...rows].sort((a, b) => {
      const pa = piecesFor(a);
      const pb = piecesFor(b);
      return seasonRank(pb, season) - seasonRank(pa, season);
    });
    return enforcePieceCap(stripRepeatBlazers(ranked, garments), garments);
  }, [book, occasion, color, byId, pool, season, garments, houseChip]);

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
    const run = () =>
      ensureOccasionBook(
        occasion,
        season,
        houseChip === "all" ? undefined : houseChip,
      );
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(run);
      return () => cancelIdleCallback(id);
    }
    const t = window.setTimeout(run, 0);
    return () => window.clearTimeout(t);
  }, [hydrated, occasion, season, houseChip, garments.length, ensureOccasionBook]);

  useEffect(() => {
    if (!hydrated || shown.length === 0) return;
    markSeen(
      occasion,
      shown.map((l) => comboKey(l.garmentIds)),
      houseChip === "all" ? undefined : houseChip,
    );
  }, [hydrated, occasion, houseChip, shown, markSeen]);

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
      {hydrated && (
        <p className="mt-3 text-ink-soft max-w-xl">
          {shown.length} looks · {chapterLabel} · {seasonLabel.replace(/^Auto · /, "")}
        </p>
      )}
      {gap && (
        <p className="mt-3 text-sm text-ink-soft max-w-xl">{gap}</p>
      )}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {OCCASIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => {
              startTransition(() => {
                setOccasion(o.id);
                setExhausted(false);
              });
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
        <button
          type="button"
          onClick={() => {
            setSeasonChip("auto");
            setExhausted(false);
          }}
          className={cn(
            "micro border px-3 py-2",
            seasonChip === "auto"
              ? "border-ink bg-ink text-paper"
              : "border-hairline text-ink-soft",
          )}
        >
          Auto
        </button>
        {SEASONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              setSeasonChip(s.id);
              setExhausted(false);
            }}
            className={cn(
              "micro border px-3 py-2",
              seasonChip === s.id
                ? "border-ink bg-ink text-paper"
                : "border-hairline text-ink-soft",
            )}
          >
            {s.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setHouseChip("all");
            setExhausted(false);
          }}
          className={cn(
            "micro border px-3 py-2",
            houseChip === "all"
              ? "border-ink bg-ink text-paper"
              : "border-hairline text-ink-soft",
          )}
        >
          All
        </button>
        {HOUSE_CHIPS.map((h) => (
          <button
            key={h.id}
            type="button"
            onClick={() => {
              setHouseChip(h.id);
              setExhausted(false);
            }}
            className={cn(
              "micro border px-3 py-2",
              houseChip === h.id
                ? "border-ink bg-ink text-paper"
                : "border-hairline text-ink-soft",
            )}
          >
            {h.label}
          </button>
        ))}
        <div className="relative">
          <button
            type="button"
            onClick={() => setColorOpen((v) => !v)}
            className={cn(
              "micro border px-3 py-2",
              color
                ? "border-ink bg-ink text-paper"
                : "border-hairline text-ink-soft",
            )}
          >
            Color
          </button>
          {colorOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 flex flex-wrap gap-1 border border-hairline bg-paper p-2 shadow-sm w-48">
              <button
                type="button"
                className="micro px-2 py-1 text-ink-soft"
                onClick={() => {
                  setColor(null);
                  setColorOpen(false);
                }}
              >
                Any
              </button>
              {colorChips.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={c}
                  onClick={() => {
                    setColor((cur) => (cur === c ? null : c));
                    setColorOpen(false);
                  }}
                  className={cn(
                    "size-6 shrink-0 border",
                    color === c ? "border-ink" : "border-hairline",
                  )}
                  style={{ backgroundColor: paletteCss(c) }}
                  aria-label={c}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
      <button
        type="button"
        onClick={() => {
          const n = shuffleChapter(
            occasion,
            season,
            houseChip === "all" ? undefined : houseChip,
          );
          setExhausted(n === 0);
        }}
        className="inline-flex h-11 items-center border border-hairline px-4 text-sm text-ink hover:border-hairline-strong"
      >
        Shuffle
      </button>
      <button
        type="button"
        onClick={() => setPlay((v) => !v)}
        className="inline-flex h-11 items-center bg-accent px-4 text-sm text-paper"
      >
        {play ? "Close builder" : "Make a look"}
      </button>
      </div>
      {play && (
        <div className="mt-4">
          <LookBuilder onClose={() => setPlay(false)} />
        </div>
      )}

      {!hydrated ? null : garments.length === 0 ? (
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
            You’ve seen every honest look in this chapter.
          </p>
          <button
            type="button"
            onClick={() => {
              resetChapter(
                occasion,
                season,
                houseChip === "all" ? undefined : houseChip,
              );
              setExhausted(false);
            }}
            className="mt-4 micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong"
          >
            Reset chapter
          </button>
        </div>
      )}
      {shown.length === 0 && !canBuild ? (
        <p className="mt-10 text-sm text-ink-soft">
          Need a top, a bottom, and shoes.
        </p>
      ) : shown.length === 0 && !exhausted ? (
        <p className="mt-10 text-sm text-ink-soft">
          {emptyFilterCopy(chapterLabel, seasonLabel, seasonChip, houseChip, color)}
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
                season={season}
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

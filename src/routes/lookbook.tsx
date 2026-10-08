import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { DetectorSections } from "@/components/closet/detector-sections";
import { IdleMount } from "@/components/closet/idle-mount";
import { LookBuilder } from "@/components/closet/look-builder";
import { LookKit } from "@/components/closet/look-kit";
import { LookSheet } from "@/components/closet/look-sheet";
import { Overlay } from "@/components/closet/overlay";
import { GarmentTile } from "@/components/closet/tile";
import { rackLine } from "@/lib/gaps";
import { lookOnMeKey } from "@/lib/images";
import { useImageSrc } from "@/lib/use-image";
import {
  detectorTitle,
  renderedSectionLooks,
  visibleDetectors,
  warmCellBook,
} from "@/lib/detectors";
import {
  buildReshuffleRow,
  comboKey,
  emptyFilterCopy,
  firstWeekLooks,
  lookbookPool,
  looksForHero,
  realWeekLooks,
  unusedFromLooks,
  visibleHero,
} from "@/lib/lookbook";
import { seasonChipRow, seasonControlLabel, seasonFromWeather } from "@/lib/season";
import { paletteCss } from "@/lib/color";
import { cardTag, spreadTitle } from "@/lib/look";
import { pieceLabel } from "@/lib/piece-label";
import { useAccount } from "@/lib/cloud/account";
import { EMPTY_DEVICE_COPY } from "@/lib/cloud/copy";
import { livePool } from "@/lib/rack";
import { daysIdle, slotOf } from "@/lib/style";
import { useCloset } from "@/lib/store";
import { realWeatherF, writeStylistPage } from "@/lib/stylist-page";
import { emptyTaste } from "@/lib/taste";
import { OCCASIONS, SEASONS, type Garment, type Look, type Occasion, type Season } from "@/lib/types";
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
  named,
}: {
  look: Look;
  pieces: Garment[];
  onOpen: () => void;
  cardRef: (el: HTMLElement | null) => void;
  named: boolean;
}) {
  const extra = comboKey(pieces.map((p) => p.id));
  const cachedSrc = useImageSrc(lookOnMeKey(look.id, extra));
  const [onYou, setOnYou] = useState<"off" | "on" | "out">("off");

  return (
    <div
      ref={cardRef}
      className="look-card relative w-full border border-hairline bg-paper aspect-[4/5]"
      style={named ? { viewTransitionName: `look-${look.id}` } : undefined}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={look.name}
        className="absolute inset-0 block"
      >
        <LookKit
          layout="stack"
          pieces={pieces}
          className="h-full pointer-events-none"
          onYouSrc={cachedSrc || undefined}
          showOnYou={onYou === "on" || onYou === "out"}
          onYouLeaving={onYou === "out"}
          onYouHidden={() => setOnYou((v) => (v === "out" ? "off" : v))}
        />
      </button>
      {cachedSrc ? (
        <button
          type="button"
          aria-pressed={onYou === "on"}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOnYou((v) => {
              if (v !== "on") return "on";
              if (
                typeof window !== "undefined" &&
                window.matchMedia("(prefers-reduced-motion: reduce)").matches
              ) {
                return "off";
              }
              return "out";
            });
          }}
          className="absolute bottom-2 right-2 z-20 micro border border-hairline bg-paper px-2 py-1 text-ink"
        >
          On you
        </button>
      ) : null}
    </div>
  );
}

function pieceDots(pieces: Garment[]): { slot: string; color: string }[] {
  const slots: { slot: string; pick: (g: Garment) => boolean }[] = [
    {
      slot: "top",
      pick: (g) => {
        const s = slotOf(g);
        return s === "top" || s === "dress";
      },
    },
    { slot: "bottom", pick: (g) => slotOf(g) === "bottom" },
    { slot: "shoe", pick: (g) => slotOf(g) === "footwear" },
  ];
  const out: { slot: string; color: string }[] = [];
  for (const { slot, pick } of slots) {
    const color = pieces
      .find(pick)
      ?.colors.map((c) => c.trim())
      .find(Boolean);
    if (color) out.push({ slot, color });
  }
  return out;
}

function LookCard({
  look,
  pieces,
  highlight,
  index,
  onOpen,
  cardRef,
  season,
  wayTitle,
  occasionLabel,
  seasonLabel,
  note,
  named,
  pool,
}: {
  look: Look;
  pieces: Garment[];
  highlight?: boolean;
  index: number;
  onOpen: () => void;
  cardRef: (el: HTMLElement | null) => void;
  season: Season;
  wayTitle: string | null;
  occasionLabel: string;
  seasonLabel: string;
  note?: string | null;
  named: boolean;
  pool: Garment[];
}) {
  const dots = pieceDots(pieces);
  return (
    <li
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
            className="block w-full aspect-[4/5] border border-hairline paper-shimmer"
          />
        }
      >
        <LookCardFace
          look={look}
          pieces={pieces}
          onOpen={onOpen}
          cardRef={cardRef}
          named={named}
        />
      </IdleMount>
      <p className="mt-3">{spreadTitle(pieces, look.occasion as Occasion, "all", season)}</p>
      <p className="mt-1 text-sm leading-snug">
        {pieces.map((g) => pieceLabel(g, pool)).join(" · ")}
      </p>
      {dots.length > 0 && (
        <div className="mt-2 flex gap-1.5" aria-hidden="true">
          {dots.map((dot) => (
            <span
              key={dot.slot}
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: paletteCss(dot.color) }}
            />
          ))}
        </div>
      )}
      <p className="micro mt-2 text-ink-soft">{cardTag(wayTitle, occasionLabel, seasonLabel)}</p>
      {note && <p className="micro mt-1 text-ink-soft">{note}</p>}
    </li>
  );
}

function LookbookPage() {
  const hydrated = useCloset((s) => s.hydrated);
  const account = useAccount();
  const garmentsAll = useCloset((s) => s.garments);
  const looksAll = useCloset((s) => s.looks);
  const ensureLookbook = useCloset((s) => s.ensureLookbook);
  const wearToday = useCloset((s) => s.wearToday);
  const outfitWith = useCloset((s) => s.outfitWith);
  const [play, setPlay] = useState(false);
  const [weekPulse, setWeekPulse] = useState(0);
  const [occasion, setOccasion] = useState<(typeof OCCASIONS)[number]["id"]>("weekday");
  const [seasonChip, setSeasonChip] = useState<"auto" | Season>("auto");
  const [color, setColor] = useState<string | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const drop = useCloset((s) => s.drop);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dressed, setDressed] = useState<Look | null>(null);
  const [heroId, setHeroId] = useState<string | null>(null);
  const [heroLooks, setHeroLooks] = useState<Look[]>([]);
  const cardEls = useRef(new Map<string, HTMLElement>());
  const lastAnchor = useRef<HTMLElement | null>(null);
  const { look: focusLook } = Route.useSearch();

  const garments = useMemo(() => livePool(garmentsAll), [garmentsAll]);
  const taste = useCloset((s) => s.taste) ?? emptyTaste();
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
  const autoSeason = seasonFromWeather(drop?.weather?.f);
  const season: Season = seasonChip === "auto" ? autoSeason : seasonChip;
  /* The Auto chip always names what Auto resolves, so a tapped season never gets a twin. */
  const seasonShown = seasonControlLabel("auto", new Date(), drop?.weather?.f);
  const pageWeather = realWeatherF(drop?.weather);
  const ways = useMemo(
    () => visibleDetectors(garments, { occasion, season, color, weatherF: pageWeather }),
    [garments, occasion, season, color, pageWeather],
  );
  useEffect(() => {
    const run = () => warmCellBook(garments, season, pageWeather);
    const idle = window.requestIdleCallback;
    if (typeof idle === "function") {
      const id = idle(run);
      return () => window.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(run, 0);
    return () => window.clearTimeout(id);
  }, [garments, season, pageWeather]);
  const seasonLabel =
    seasonChip === "auto"
      ? `Auto · ${SEASONS.find((s) => s.id === autoSeason)?.label ?? "Fall"}`
      : (SEASONS.find((s) => s.id === season)?.label ?? "Fall");
  const seasonName = SEASONS.find((s) => s.id === season)?.label ?? "Fall";
  const colorChips = useMemo(() => {
    const set = new Set<string>();
    for (const g of garments) for (const c of g.colors) if (c) set.add(c.toLowerCase());
    return [...set].sort();
  }, [garments]);
  const piecesFor = (look: Look) =>
    look.garmentIds.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));

  const tasteKey = `${taste.vetoes.length}:${taste.techniques.map((t) => t.weight).join(",")}`;
  const filterKey = `${occasion}:${season}:${color ?? ""}:${garments.length}:${tasteKey}:${pageWeather ?? ""}`;
  const preview = useMemo(
    () =>
      firstWeekLooks(garments, occasion, {
        season,
        color,
        weather: drop?.weather?.measured ? drop.weather : null,
      }),
    [garments, occasion, season, color, drop?.weather],
  );
  const [ranked, setRanked] = useState<{ key: string; looks: Look[] } | null>(null);
  const [shown, setShown] = useState<{ key: string; looks: Look[] } | null>(null);
  const [salt, setSalt] = useState(1);
  useEffect(() => {
    let cancel = false;
    const timer = window.setTimeout(() => {
      const next = buildReshuffleRow(garments, occasion, {
        season,
        color,
        salt: 1,
        cap: 8,
        taste,
        weather: drop?.weather?.measured ? drop.weather : undefined,
      });
      if (!cancel) setRanked({ key: filterKey, looks: next });
    }, 0);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [filterKey, garments, occasion, season, color, taste, drop?.weather]);
  const rankedReady = ranked && ranked.key === filterKey ? ranked : null;
  const row =
    shown && shown.key === filterKey && shown.looks.length > 0
      ? shown.looks
      : rankedReady
        ? rankedReady.looks
        : preview.looks;
  const ownedIds = useMemo(() => new Set(byId.keys()), [byId]);
  const realRow = realWeekLooks(row, ownedIds);
  const noted = row.find((look) => look.needsPieces || look.gate);
  const weekReason = realRow.length
    ? null
    : noted?.gap || noted?.name || preview.reason || "Nothing in this closet is legal for this week.";
  const weekRow = realRow;
  const cards = weekRow.map((look) => ({ look, why: look.gap ?? "" }));
  const visible = cards;

  const unused = useMemo(() => unusedFromLooks(garments, looksAll), [garments, looksAll]);
  const rack = useMemo(
    () => [...garments].sort((a, b) => daysIdle(b) - daysIdle(a) || a.id.localeCompare(b.id)),
    [garments],
  );
  const hero = heroId ? byId.get(heroId) ?? null : null;
  const heroShown = useMemo(() => {
    if (!hero) return [];
    return visibleHero(hero, heroLooks, garments, {
      occasion,
      season,
      house: "all",
      color,
      min: 3,
    });
  }, [hero, heroLooks, garments, occasion, season, color]);

  const highlightId = focusLook ?? null;

  useEffect(() => {
    if (focusLook) setOpenId(focusLook);
  }, [focusLook]);

  useEffect(() => {
    if (!hydrated || garments.length === 0) return;
    const run = () => useCloset.getState().ensureLookbook();
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(run, { timeout: 2500 });
      return () => cancelIdleCallback(id);
    }
    const t = window.setTimeout(run, 0);
    return () => window.clearTimeout(t);
  }, [hydrated, garments.length, ensureLookbook]);

  const openHero = (g: Garment, el?: HTMLElement | null) => {
    if (el) lastAnchor.current = el;
    setHeroId(g.id);
    setHeroLooks(looksForHero(g, garments));
  };

  const getAnchor = useCallback(() => lastAnchor.current, []);

  const getOpenCard = useCallback(() => {
    if (lastAnchor.current) return lastAnchor.current;
    return openId ? cardEls.current.get(openId) ?? null : null;
  }, [openId]);

  const allOpenLooks = [...cards.map((c) => c.look), ...heroShown, ...book, ...looksAll];
  const openLook =
    (dressed && dressed.id === openId ? dressed : null) ??
    looksAll.find((l) => l.id === openId) ??
    allOpenLooks.find((l) => l.id === openId) ??
    null;
  const openPieces = openLook ? piecesFor(openLook) : [];
  const sectionLooks = renderedSectionLooks(ways, occasion);
  const heroCards = hero && heroShown.length > 0 && !openLook ? realWeekLooks(heroShown, ownedIds) : [];
  const screenLooks = (() => {
    const seen = new Set<string>();
    const out: { id: string; garmentIds: string[] }[] = [];
    const add = (id: string, garmentIds: readonly string[]) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push({ id, garmentIds: [...garmentIds] });
    };
    for (const look of weekRow) add(look.id, look.garmentIds);
    for (const look of sectionLooks) add(look.id, look.garmentIds);
    for (const look of heroCards) add(look.id, look.garmentIds);
    return out;
  })();
  const onScreenLookIds = screenLooks.map((look) => look.id);
  const screenKey = screenLooks.map((look) => `${look.id}=${look.garmentIds.join(",")}`).join("|");
  useEffect(() => {
    writeStylistPage({
      route: "lookbook",
      occasion,
      season,
      ...(color ? { color } : {}),
      ...(heroId ? { openGarmentId: heroId } : {}),
      onScreenLookIds,
      screenLooks,
      ...(pageWeather !== undefined ? { weatherF: pageWeather } : {}),
    });
  }, [occasion, season, color, heroId, screenKey, pageWeather, onScreenLookIds, screenLooks]);

  return (
    <div className="mx-auto max-w-6xl px-4 md:px-6 py-8 md:py-12 rise">
      <p className="micro text-ink-soft">Lookbook</p>
      <h1 className="mt-2 font-editorial text-4xl md:text-6xl tracking-tight">
        Lookbook
      </h1>
      {hydrated && (
        <>
          <p className="mt-3 text-ink-soft max-w-xl">
            {weekRow.length} looks · {chapterLabel} · {seasonLabel.replace(/^Auto · /, "")}
          </p>
          <p className="mt-1 micro text-ink-soft">{looksAll.length} saved</p>
        </>
      )}
      {gap && (
        <p className="mt-3 text-sm text-ink-soft max-w-xl">{gap}</p>
      )}
      <div className="mt-6 space-y-4">
        <div>
          <p className="micro text-ink-soft">Context</p>
          <div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center gap-2" data-chapter-row>
          {OCCASIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                startTransition(() => setOccasion(o.id));
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
        <div className="flex flex-wrap items-center gap-2" data-season-control>
          <button
            type="button"
            aria-pressed={seasonChip === "auto"}
            onClick={() => setSeasonChip("auto")}
            className={cn(
              "micro whitespace-nowrap border px-3 py-2",
              seasonChip === "auto" ? "border-ink bg-ink text-paper" : "border-hairline text-ink-soft",
            )}
          >
            {seasonShown}
          </button>
          {seasonChipRow(seasonChip, autoSeason).map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={seasonChip === s.id}
              onClick={() => setSeasonChip(s.id)}
              className={cn(
                "micro border px-3 py-2",
                seasonChip === s.id ? "border-ink bg-ink text-paper" : "border-hairline text-ink-soft",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="relative" data-color-control>
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
        </div>
      </div>
      <DetectorSections
        garments={garments}
        ways={ways}
        occasion={occasion}
        season={season}
        color={color}
      />
      <div className="mt-6 flex flex-wrap gap-3">
      <button
        type="button"
        onClick={() => {
          const nextSalt = salt + 1;
          const next = buildReshuffleRow(garments, occasion, {
            season,
            color,
            salt: nextSalt,
            cap: 8,
            excludeKeys: row.map((look) => comboKey(look.garmentIds)),
            mustInclude: unusedFromLooks(garments, looksAll).map((g) => g.id),
            taste,
            weather: drop?.weather?.measured ? drop.weather : undefined,
          });
          setSalt(nextSalt);
          if (next.length) {
            setShown({ key: filterKey, looks: next });
            setWeekPulse((x) => x + 1);
          }
        }}
        className="inline-flex h-11 items-center border border-hairline px-4 text-sm text-ink hover:border-hairline-strong"
      >
        Reshuffle
      </button>
      <button
        type="button"
        onClick={() => setPlay((v) => !v)}
        className="inline-flex h-11 items-center bg-accent px-4 text-sm text-paper"
      >
        {play ? "Close builder" : "Suggest"}
      </button>
      </div>
      {play && (
        <div className="mt-4">
          <LookBuilder
            onClose={() => setPlay(false)}
            heading="Suggest"
            occasion={occasion}
            season={season}
          />
        </div>
      )}

      {!hydrated ? null : garments.length === 0 ? (
        <div className="mt-10 border border-hairline bg-card px-4 py-5">
          <p className="text-sm text-ink-soft">
            {account.user
              ? "Lookbook is this closet. Add pieces on Add — don’t re-upload here."
              : EMPTY_DEVICE_COPY}
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
      <section className="mt-10">
        <p className="micro text-ink-soft">This week</p>
        {colorOpen && !color ? (
          <p className="mt-3 text-sm text-ink-soft">Pick a colour.</p>
        ) : visible.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft" data-week-reason>
            {weekReason ||
              emptyFilterCopy(
                chapterLabel,
                seasonLabel,
                seasonChip,
                "all",
                color,
                canBuild,
              ) ||
              "Need a top, a bottom, and shoes."}
          </p>
        ) : (
          <ul
            key={weekPulse}
            className={cn(
              "look-swipe mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-8",
              weekPulse > 0 && "week-crossfade",
            )}
          >
            {cards.map((card, i) => {
              const look = card.look;
              if (look.gate || look.needsPieces) {
                const gate = look.gate;
                return (
                  <li key={look.id} id={`look-${look.id}`}>
                    <div className="border border-hairline bg-paper px-4 py-6">
                      <p className="text-sm text-ink">{gate?.text ?? look.gap ?? look.name}</p>
                      {gate ? (
                        <button
                          type="button"
                          className="micro mt-4 border border-hairline px-3 py-2 text-ink"
                          onClick={() => {
                            const nextOcc = gate.occasion as Occasion;
                            const nextSea = gate.season as Season;
                            if (OCCASIONS.some((o) => o.id === nextOcc)) setOccasion(nextOcc);
                            if (SEASONS.some((s) => s.id === nextSea)) setSeasonChip(nextSea);
                          }}
                        >
                          {`Switch to ${gate.occasion} · ${gate.season}`}
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              }
              const pieces = piecesFor(look);
              if (pieces.length < 3) return null;
              return (
                <LookCard
                  key={look.id}
                  look={look}
                  pieces={pieces}
                  index={i}
                  season={season}
                  wayTitle={detectorTitle(pieces, { occasion, season, color, pool: garments, weatherF: pageWeather })}
                  occasionLabel={chapterLabel}
                  seasonLabel={seasonName}
                  note={card.why}
                  pool={garments}
                  named={openId === look.id}
                  highlight={highlightId === look.id}
                  onOpen={() => {
                    lastAnchor.current = cardEls.current.get(look.id) ?? null;
                    setOpenId(look.id);
                  }}
                  cardRef={(el) => {
                    if (el) cardEls.current.set(look.id, el);
                    else cardEls.current.delete(look.id);
                  }}
                />
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-12">
        {unused.length > 0 && (
          <>
            <p className="mt-2 micro text-ink-soft">Not in a look yet</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {unused.map((g) => (
                <span key={g.id} className="inline-flex items-center gap-1 border border-hairline">
                  <button
                    type="button"
                    onClick={(e) => openHero(g, e.currentTarget)}
                    className="micro px-3 py-2 text-ink hover:text-ink"
                  >
                    {pieceLabel(g, garments)}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const look = outfitWith([g.id], occasion);
                      if (!look) return;
                      setDressed(look);
                      setOpenId(look.id);
                    }}
                    className="micro border-l border-hairline px-3 py-2 text-ink-soft hover:text-ink"
                  >
                    Outfit with this
                  </button>
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="mt-12 pt-8 border-t border-hairline">
        <p className="micro text-ink-soft">The rack</p>
        <ul className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 md:gap-6">
          {rack.map((g) => (
            <li key={g.id}>
              <GarmentTile garment={g} onClick={(e) => openHero(g, e.currentTarget)} />
            </li>
          ))}
        </ul>
      </section>

      {hero && heroShown.length > 0 && !openLook && (
        <Overlay onClose={() => setHeroId(null)} getAnchor={getAnchor} zClass="z-[55]">
          <div className="p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <p className="font-editorial text-2xl tracking-tight">
                5 looks with {hero.name}
              </p>
              <button
                type="button"
                className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong"
                onClick={() =>
                  setHeroLooks(
                    looksForHero(hero, garments, {
                      seen: heroLooks.map((l) => comboKey(l.garmentIds)),
                    }),
                  )
                }
              >
                Shuffle
              </button>
            </div>
            <ul className="mt-4 grid grid-cols-2 gap-3">
              {heroShown.map((look) => {
                const pieces = piecesFor(look);
                if (pieces.length < 3) return null;
                return (
                  <li key={look.id}>
                    <button
                      type="button"
                      className="block w-full text-left"
                      onClick={() => setOpenId(look.id)}
                    >
                      <LookKit pieces={pieces} className="pointer-events-none aspect-[4/5]" />
                      <p className="mt-2 text-sm">{spreadTitle(pieces, look.occasion as Occasion, "all", season)}</p>
                      <p className="micro text-ink-soft">{look.occasion}</p>
                    </button>
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              onClick={() => setHeroId(null)}
              className="micro mt-4 text-ink-soft hover:text-ink"
            >
              Close
            </button>
          </div>
        </Overlay>
      )}
      {openLook && openPieces.length >= 2 && (
        <LookSheet
          look={openLook}
          pieces={openPieces}
          book={book}
          closet={garments}
          initialLocked={openLook.lookbook === false ? drop?.lockedIds : undefined}
          getCard={getOpenCard}
          onClose={() => setOpenId(null)}
          onWear={() => wearToday(openPieces.map((g) => g.id))}
          onOpenLook={(next) => {
            setDressed(next);
            setOpenId(next.id);
          }}
        />
      )}
        </>
      )}
    </div>
  );
}

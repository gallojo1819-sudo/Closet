import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FlatLay } from "@/components/closet/flat-lay";
import { GarmentImg } from "@/components/closet/gimg";
import { LookBuilder } from "@/components/closet/look-builder";
import { LookSheet } from "@/components/closet/look-sheet";
import { OnMePanel } from "@/components/closet/on-me";
import { Button } from "@/components/ui/button";
import { alternatives, dropNote, heroPieces, kitCells, nameLook, neglectedPiece, sortLook } from "@/lib/look";
import { pieceLabel } from "@/lib/piece-label";
import { rackCanDress, weekStripDays } from "@/lib/lookbook";
import { seasonFromWeather } from "@/lib/season";
import { useAccount } from "@/lib/cloud/account";
import { persistGate } from "@/lib/store-persist";
import { EMPTY_DEVICE_COPY } from "@/lib/cloud/copy";
import { livePool } from "@/lib/rack";
import { HOUSE_LABEL, avoidedUniformLine, daysIdle, lookHouses } from "@/lib/style";
import { emptyTaste, leftOffLine, techniqueLine } from "@/lib/taste";
import { useCloset } from "@/lib/store";
import { OCCASIONS, type Garment, type Look, type Occasion } from "@/lib/types";
import { getNycWeather } from "@/lib/weather";
import { cn, formatLongDate, lastDays, todayISO, weekdayLetter } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Today });

function Today() {
  const garmentsAll = useCloset((s) => s.garments);
  const garments = useMemo(() => livePool(garmentsAll), [garmentsAll]);
  const drop = useCloset((s) => s.drop);
  const journal = useCloset((s) => s.journal);
  const setDrop = useCloset((s) => s.setDrop);
  const rerollDrop = useCloset((s) => s.rerollDrop);
  const swapDropPiece = useCloset((s) => s.swapDropPiece);
  const toggleLock = useCloset((s) => s.toggleLock);
  const removeDropPiece = useCloset((s) => s.removeDropPiece);
  const wearToday = useCloset((s) => s.wearToday);
  const skipDrop = useCloset((s) => s.skipDrop);
  const saveLook = useCloset((s) => s.saveLook);
  const outfitWith = useCloset((s) => s.outfitWith);
  const looksAll = useCloset((s) => s.looks);
  const thisWeek = useCloset((s) => s.thisWeek);
  const taste = useCloset((s) => s.taste) ?? emptyTaste();
  const hydrated = useCloset((s) => s.hydrated);
  const account = useAccount();
  const [view, setView] = useState<"paper" | "me">("paper");
  const [play, setPlay] = useState(false);
  const [dressed, setDressed] = useState<Look | null>(null);

  const ownedCount = garments.filter((g) => !g.archived).length;

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    (async () => {
      let weather = drop?.weather;
      try {
        weather = await getNycWeather();
      } catch {
        weather = weather ?? { f: 68, label: "Fair", code: 2 };
      }
      if (cancelled) return;
      const owned = useCloset.getState().garments.filter((g) => !g.archived);
      const current = useCloset.getState().drop;
      const wasOpen = persistGate.open;
      const inMemory = (run: () => void) => {
        persistGate.open = false;
        try {
          run();
        } finally {
          persistGate.open = wasOpen;
        }
      };
      if (!owned.length) {
        if (weather && current?.weather?.f !== weather.f) {
          inMemory(() =>
            setDrop({
              date: todayISO(),
              garmentIds: [],
              worn: false,
              verdict: "pending",
              weather,
            }),
          );
        }
        return;
      }
      const wornToday =
        current &&
        current.date === todayISO() &&
        (current.worn || current.verdict === "worn");
      if (wornToday) {
        if (weather && current.weather?.f !== weather.f) {
          inMemory(() => setDrop({ ...current, weather }));
        }
        return;
      }
      inMemory(() =>
        useCloset.getState().rerollDrop(
          weather,
          current?.occasion,
          current?.garmentIds?.length ? current.garmentIds : undefined,
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, ownedCount]);

  useEffect(() => {
    if (!hydrated || ownedCount === 0) return;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      const s = useCloset.getState();
      if (s.thisWeek.length >= 3 || !rackCanDress(s.garments)) return;
      const season = seasonFromWeather(s.drop?.weather?.f ?? 68);
      s.fillThisWeek(season);
    };
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(run, { timeout: 1500 });
      return () => {
        cancelled = true;
        cancelIdleCallback(id);
      };
    }
    const t = window.setTimeout(run, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [hydrated, ownedCount]);

  const pieces = useMemo(
    () => sortLook(garments.filter((g) => drop?.garmentIds.includes(g.id))),
    [garments, drop],
  );
  const weather = drop?.weather;
  const neglected = useMemo(
    () => neglectedPiece(garments, drop?.garmentIds ?? []),
    [garments, drop],
  );
  const waiting = useMemo(
    () => garments.filter((g) => !g.archived && daysIdle(g) >= 21),
    [garments],
  );
  const sample = garments.some((g) => g.demo);
  const dropSeason = seasonFromWeather(weather?.f ?? 68);
  const avoided = useMemo(
    () =>
      drop
        ? avoidedUniformLine(journal, drop.garmentIds, garments)
        : null,
    [journal, drop, garments],
  );
  const atlasLine = useMemo(() => {
    if (!drop) return { left: null as string | null, technique: null as string | null };
    const skip = journal.find((j) => j.verdict === "skipped");
    const skipped = (skip?.garmentIds ?? [])
      .map((id) => garments.find((g) => g.id === id))
      .filter((g): g is Garment => Boolean(g));
    const next = drop.garmentIds
      .map((id) => garments.find((g) => g.id === id))
      .filter((g): g is Garment => Boolean(g));
    return {
      left: leftOffLine({ skipped, next, taste }),
      technique: techniqueLine(taste, next),
    };
  }, [journal, drop, garments, taste]);
  const today = todayISO();
  const weekCells = useMemo(
    () =>
      weekStripDays({
        days: lastDays(7, today),
        today,
        drop,
        journal,
        thisWeek,
        garments,
      }),
    [today, drop, journal, thisWeek, garments],
  );
  const shown = useMemo(() => {
    const cell = weekCells.find((c) => c.iso === today);
    const strip = cell?.look
      ? sortLook(
          cell.look.garmentIds
            .map((id) => garments.find((g) => g.id === id))
            .filter((g): g is Garment => Boolean(g)),
        )
      : [];
    return heroPieces(pieces, strip);
  }, [weekCells, today, pieces, garments]);
  const lookName = nameLook(shown);
  const note = dropNote(shown, weather, drop?.occasion, drop?.moment, undefined, dropSeason);
  const houses = lookHouses(shown, drop?.occasion ?? "weekday", dropSeason);
  const done = drop?.worn || drop?.verdict === "worn";

  const setOccasion = (occasion: Occasion) => {
    rerollDrop(weather, occasion, drop?.garmentIds);
  };

  const owned = garments.filter((g) => !g.archived);

  if (owned.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 md:px-6 py-8 md:py-16 rise">
        <p className="micro text-ink-soft">Your closet</p>
        <h1 className="mt-2 font-editorial text-4xl md:text-6xl tracking-tight">
          {formatLongDate()}
          <span className="italic text-accent"> — empty until you photograph it.</span>
        </h1>
        <p className="mt-4 text-ink-soft">
          {weather ? (
            <>
              New York · {weather.f}° · {weather.label}. The drop starts when the
              first real piece is on paper.
            </>
          ) : (
            "New York. Photograph what you own. We keep that picture."
          )}
        </p>
        {hydrated && !account.user && (
          <p className="mt-3 text-sm text-ink-soft">{EMPTY_DEVICE_COPY}</p>
        )}
        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            to="/add"
            className="inline-flex h-11 items-center bg-accent px-4 text-sm text-paper"
          >
            Photograph the first piece
          </Link>
        </div>
        <ol className="mt-12 space-y-4 text-sm text-ink-soft">
          <li>Cream sheet. One garment. Phone from above.</li>
          <li>Keep my photo — never a generated stand-in.</li>
          <li>Wear / Skip / Swap dresses from what you actually own.</li>
        </ol>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 md:px-6 py-8 md:py-12 rise">
      <p className="micro text-ink-soft">The daily drop</p>
      <h1 className="mt-2 font-editorial text-4xl md:text-6xl tracking-tight">
        {formatLongDate()}
        <span className="italic text-accent"> — one look. Wear it.</span>
      </h1>
      <p className="mt-4 text-ink-soft">
        {weather ? (
          <>
            New York · {weather.f}° · {weather.label}
            {drop?.moment ? ` · ${drop.moment}` : ""}
          </>
        ) : (
          "New York"
        )}
        {waiting.length > 0
          ? ` · ${waiting.length} sitting idle`
          : sample
            ? " · sample wardrobe until you photograph yours"
            : null}
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {OCCASIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setOccasion(o.id)}
            className={cn(
              "micro border px-3 py-2",
              drop?.occasion === o.id
                ? "border-ink bg-ink text-paper"
                : "border-hairline text-ink-soft",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>

      <ol className="mt-8 grid grid-cols-7 gap-1">
        {weekCells.map((cell) => {
          const look = cell.look;
          const resolved = look
            ? look.garmentIds
                .map((id) => garments.find((g) => g.id === id))
                .filter((g): g is Garment => Boolean(g))
            : [];
          const bands = kitCells(resolved);
          const plates = bands.length >= 2 ? bands : resolved;
          const isToday = cell.iso === today;
          return (
            <li
              key={cell.iso}
              className={cn(
                "border aspect-square flex flex-col items-center justify-center gap-1",
                isToday ? "border-ink" : "border-hairline",
              )}
            >
              <span className="micro text-ink-soft">{weekdayLetter(cell.iso)}</span>
              {plates.length >= 2 ? (
                <div className="grid grid-cols-2 size-10">
                  {plates.map((g) => (
                    <GarmentImg
                      key={g.id}
                      garment={g}
                      alt=""
                      nudge={false}
                      eager
                      className="size-5 object-contain"
                    />
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="mt-10 grid md:grid-cols-[1fr_0.95fr] gap-10 items-start">
        <div>
          {shown.length > 0 && (
            <div className="mb-3 flex gap-2">
              {(
                [
                  { id: "paper", label: "On paper" },
                  { id: "me", label: "On me" },
                ] as const
              ).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setView(v.id)}
                  className={cn(
                    "micro border px-3 py-2",
                    view === v.id
                      ? "border-ink bg-ink text-paper"
                      : "border-hairline text-ink-soft",
                  )}
                >
                  {v.label}
                </button>
              ))}
            </div>
          )}
          {view === "me" && shown.length > 0 ? (
            <OnMePanel
              pieces={shown}
              occasion={drop?.occasion}
              onUsePaper={() => setView("paper")}
            />
          ) : (
            <FlatLay pieces={shown} />
          )}
        </div>
        <div className="space-y-6">
          <div>
            <p className="micro text-ink-soft">
              {houses.map((h) => HOUSE_LABEL[h]).join(" · ") || "Today’s look"}
            </p>
            <h2 className="mt-1 font-editorial text-3xl tracking-tight">{lookName}</h2>
            <p className="mt-3 text-sm text-ink-soft leading-relaxed">{note}</p>
            {drop?.lockNote && (
              <p className="mt-2 text-sm text-ink-soft">{drop.lockNote}</p>
            )}
            {atlasLine.left && (
              <p className="mt-2 text-sm text-ink-soft">{atlasLine.left}</p>
            )}
            {atlasLine.technique && (
              <p className="mt-2 text-sm text-ink-soft">{atlasLine.technique}</p>
            )}
            {avoided && (
              <p className="mt-2 text-sm text-ink-soft">{avoided}</p>
            )}
          </div>
          <ol className="space-y-3">
            {shown.map((g) => {
              const canSwap = alternatives(garments, g, drop?.garmentIds ?? []).length > 0;
              const idle = daysIdle(g);
              const locked = (drop?.lockedIds ?? []).includes(g.id);
              return (
                <li
                  key={g.id}
                  className="flex items-center gap-3 border-b border-hairline pb-3"
                >
                  <div className="relative">
                    <GarmentImg
                      garment={g}
                      alt=""
                      nudge={false}
                      className="size-14 object-contain bg-paper-deep"
                    />
                    {locked && (
                      <span className="absolute left-0 top-0 micro bg-paper px-1 py-0.5 text-ink border border-hairline">
                        Lock
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p>{pieceLabel(g, garments)}</p>
                    <p className="micro text-ink-soft">
                      {g.subtype || g.category}
                      {idle >= 21 ? ` · sat ${idle}d` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={done}
                    onClick={() => {
                      const look = outfitWith([g.id]);
                      if (look) setDressed(look);
                    }}
                    className="micro text-ink-soft hover:text-ink disabled:opacity-30"
                  >
                    Outfit with this
                  </button>
                  <button
                    type="button"
                    disabled={done}
                    onClick={() => toggleLock(g.id)}
                    className="micro text-ink-soft hover:text-ink disabled:opacity-30"
                  >
                    {locked ? "Unlock" : "Lock"}
                  </button>
                  <button
                    type="button"
                    disabled={!canSwap || done || locked || !drop?.garmentIds?.includes(g.id)}
                    onClick={() => swapDropPiece(g.id)}
                    className="micro text-ink-soft hover:text-ink disabled:opacity-30"
                  >
                    Swap
                  </button>
                  <button
                    type="button"
                    disabled={done || shown.length <= 2 || !drop?.garmentIds?.includes(g.id)}
                    onClick={() => removeDropPiece(g.id)}
                    className="micro text-ink-soft hover:text-ink disabled:opacity-30"
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => {
                const ids = pieces.length >= 2 ? (drop?.garmentIds ?? []) : shown.map((g) => g.id);
                if (ids.length >= 2) wearToday(ids);
              }}
              disabled={done}
            >
              {done ? "Logged for today" : "Wear this"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => skipDrop()}
              disabled={done}
            >
              Skip
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                const ids = pieces.length >= 2 ? (drop?.garmentIds ?? []) : shown.map((g) => g.id);
                if (ids.length < 2) return;
                saveLook({
                  name: lookName,
                  occasion: drop?.occasion ?? "weekday",
                  garmentIds: ids,
                  source: "manual",
                  lookbook: true,
                });
              }}
            >
              Save look
            </Button>
            <Link
              to="/stylist"
              className="inline-flex h-11 items-center px-4 text-sm border border-hairline hover:border-hairline-strong"
            >
              Ask the stylist
            </Link>
          </div>
          <button
            type="button"
            onClick={() => setPlay((v) => !v)}
            className="micro text-ink-soft hover:text-ink"
          >
            {play ? "Close builder" : "Make a look"}
          </button>
          {play && <LookBuilder onClose={() => setPlay(false)} />}
          {neglected && !done && (
            <p className="text-sm text-ink-soft border border-hairline bg-card px-4 py-3">
              Still waiting:{" "}
              <span className="text-ink">{neglected.name}</span>
              {` · ${daysIdle(neglected)} days.`} Swap it in — don’t buy another.
            </p>
          )}
        </div>
      </div>
      {dressed && dressed.garmentIds.length >= 2 && (
        <LookSheet
          look={dressed}
          pieces={dressed.garmentIds
            .map((id) => garments.find((g) => g.id === id))
            .filter((g): g is Garment => Boolean(g))}
          book={looksAll}
          closet={garments}
          initialLocked={drop?.lockedIds}
          onClose={() => setDressed(null)}
          onWear={() => {
            wearToday(dressed.garmentIds);
            setDressed(null);
          }}
          onOpenLook={(next) => setDressed(next)}
        />
      )}
    </div>
  );
}

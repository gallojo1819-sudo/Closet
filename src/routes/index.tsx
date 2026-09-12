import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FitBoard } from "@/components/closet/fit";
import { FlatLay } from "@/components/closet/flat-lay";
import { GarmentImg } from "@/components/closet/gimg";
import { LookBuilder } from "@/components/closet/look-builder";
import { OnMePanel } from "@/components/closet/on-me";
import { Button } from "@/components/ui/button";
import { alternatives, dropNote, nameLook, neglectedPiece, sortLook } from "@/lib/look";
import { HOUSE_LABEL, daysIdle, lookHouses } from "@/lib/style";
import { useCloset } from "@/lib/store";
import { OCCASIONS, type Occasion } from "@/lib/types";
import { getNycWeather } from "@/lib/weather";
import { cn, formatLongDate, lastDays, todayISO, weekdayLetter } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Today });

function Today() {
  const garments = useCloset((s) => s.garments);
  const drop = useCloset((s) => s.drop);
  const journal = useCloset((s) => s.journal);
  const setDrop = useCloset((s) => s.setDrop);
  const rerollDrop = useCloset((s) => s.rerollDrop);
  const swapDropPiece = useCloset((s) => s.swapDropPiece);
  const wearToday = useCloset((s) => s.wearToday);
  const skipDrop = useCloset((s) => s.skipDrop);
  const saveLook = useCloset((s) => s.saveLook);
  const hydrated = useCloset((s) => s.hydrated);
  const [view, setView] = useState<"paper" | "fit" | "me">("paper");
  const [play, setPlay] = useState(false);

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
      if (!owned.length) {
        if (weather && current?.weather?.f !== weather.f) {
          setDrop({
            date: todayISO(),
            garmentIds: [],
            worn: false,
            verdict: "pending",
            weather,
          });
        }
        return;
      }
      if (!current || current.date !== todayISO() || current.garmentIds.length === 0) {
        useCloset.getState().rerollDrop(weather);
      } else if (weather && current.weather?.f !== weather.f) {
        setDrop({ ...current, weather });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const lookName = nameLook(pieces);
  const note = dropNote(pieces, weather, drop?.occasion, drop?.moment);
  const houses = lookHouses(pieces);
  const week = lastDays(7);
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
        {week.map((iso) => {
          const entry = journal.find((j) => j.date === iso && j.verdict === "worn");
          const first = entry
            ? garments.find((g) => g.id === entry.garmentIds[0])
            : undefined;
          const isToday = iso === todayISO();
          return (
            <li
              key={iso}
              className={cn(
                "border aspect-square flex flex-col items-center justify-center gap-1",
                isToday ? "border-ink" : "border-hairline",
              )}
            >
              <span className="micro text-ink-soft">{weekdayLetter(iso)}</span>
              {first ? (
                <GarmentImg garment={first} alt="" className="size-8 object-contain" />
              ) : (
                <span className="size-8 border border-dashed border-hairline" />
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-10 grid md:grid-cols-[1fr_0.95fr] gap-10 items-start">
        <div>
          {pieces.length > 0 && (
            <div className="mb-3 flex gap-2">
              {(
                [
                  { id: "paper", label: "On paper" },
                  { id: "fit", label: "5′8" },
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
          {view === "me" && pieces.length > 0 ? (
            <OnMePanel pieces={pieces} onUsePaper={() => setView("paper")} />
          ) : view === "fit" && pieces.length > 0 ? (
            <FitBoard pieces={pieces} />
          ) : (
            <FlatLay pieces={pieces} />
          )}
        </div>
        <div className="space-y-6">
          <div>
            <p className="micro text-ink-soft">
              {houses.map((h) => HOUSE_LABEL[h]).join(" · ") || "Today’s look"}
            </p>
            <h2 className="mt-1 font-editorial text-3xl tracking-tight">{lookName}</h2>
            <p className="mt-3 text-sm text-ink-soft leading-relaxed">{note}</p>
          </div>
          <ol className="space-y-3">
            {pieces.map((g) => {
              const canSwap = alternatives(garments, g, drop?.garmentIds ?? []).length > 0;
              const idle = daysIdle(g);
              return (
                <li
                  key={g.id}
                  className="flex items-center gap-3 border-b border-hairline pb-3"
                >
                  <GarmentImg
                    garment={g}
                    alt=""
                    className="size-14 object-contain bg-paper-deep"
                  />
                  <div className="min-w-0 flex-1">
                    <p>{g.name}</p>
                    <p className="micro text-ink-soft">
                      {g.subtype || g.category}
                      {idle >= 21 ? ` · sat ${idle}d` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!canSwap || done}
                    onClick={() => swapDropPiece(g.id)}
                    className="micro text-ink-soft hover:text-ink disabled:opacity-30"
                  >
                    Swap
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => drop && wearToday(drop.garmentIds)}
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
              onClick={() =>
                drop &&
                saveLook({
                  name: lookName,
                  occasion: drop.occasion ?? "daily",
                  garmentIds: drop.garmentIds,
                  source: "ai",
                })
              }
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
    </div>
  );
}

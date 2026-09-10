import { useEffect, useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { LookStack } from "@/components/closet/look-stack";
import { Button } from "@/components/ui/button";
import { alternatives, dropNote, nameLook, neglectedPiece, sortLook } from "@/lib/look";
import { HOUSE_LABEL, daysIdle, lookHouses } from "@/lib/style";
import { useCloset } from "@/lib/store";
import { OCCASIONS, type Occasion } from "@/lib/types";
import { getNycWeather } from "@/lib/weather";
import { cn, formatLongDate, todayISO } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Today });

function Today() {
  const garments = useCloset((s) => s.garments);
  const drop = useCloset((s) => s.drop);
  const setDrop = useCloset((s) => s.setDrop);
  const rerollDrop = useCloset((s) => s.rerollDrop);
  const swapDropPiece = useCloset((s) => s.swapDropPiece);
  const wearToday = useCloset((s) => s.wearToday);
  const saveLook = useCloset((s) => s.saveLook);
  const hydrated = useCloset((s) => s.hydrated);

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
      if (!drop || drop.date !== todayISO()) {
        useCloset.getState().rerollDrop(weather);
      } else if (weather && drop.weather?.f !== weather.f) {
        setDrop({ ...drop, weather });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  const pieces = useMemo(
    () => sortLook(garments.filter((g) => drop?.garmentIds.includes(g.id))),
    [garments, drop],
  );
  const weather = drop?.weather;
  const neglected = useMemo(
    () => neglectedPiece(garments, drop?.garmentIds ?? []),
    [garments, drop],
  );
  const sample = garments.some((g) => g.demo);
  const lookName = nameLook(pieces);
  const note = dropNote(pieces, weather, drop?.occasion, drop?.moment);
  const houses = lookHouses(pieces);

  const setOccasion = (occasion: Occasion) => {
    rerollDrop(weather, occasion);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 md:px-6 py-8 md:py-12 rise">
      <p className="micro text-ink-soft">The daily drop</p>
      <h1 className="mt-2 font-editorial text-4xl md:text-6xl tracking-tight">
        {formatLongDate()}
        <span className="italic text-accent"> — dressed from what you own.</span>
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
        {sample ? " · sample wardrobe until you photograph yours" : null}
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

      <div className="mt-10 grid md:grid-cols-[1fr_0.95fr] gap-10 items-start">
        <LookStack pieces={pieces} />
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
                  <img
                    src={g.cutoutSrc}
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
                    disabled={!canSwap}
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
              disabled={drop?.worn}
            >
              {drop?.worn ? "Logged for today" : "Wear this"}
            </Button>
            <Button variant="ghost" onClick={() => rerollDrop(weather, drop?.occasion)}>
              Reroll
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
          {neglected && (
            <p className="text-sm text-ink-soft border border-hairline bg-card px-4 py-3">
              Still waiting:{" "}
              <span className="text-ink">{neglected.name}</span>
              {` · ${daysIdle(neglected)} days off the hanger.`} Swap it in.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

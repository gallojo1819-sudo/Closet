import { useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { LookStack } from "@/components/closet/look-stack";
import { Button } from "@/components/ui/button";
import { useCloset } from "@/lib/store";
import { getNycWeather } from "@/lib/weather";
import { formatLongDate, todayISO } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Today });

function Today() {
  const garments = useCloset((s) => s.garments);
  const drop = useCloset((s) => s.drop);
  const setDrop = useCloset((s) => s.setDrop);
  const rerollDrop = useCloset((s) => s.rerollDrop);
  const wearToday = useCloset((s) => s.wearToday);
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

  const pieces = garments.filter((g) => drop?.garmentIds.includes(g.id));
  const weather = drop?.weather;

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
          </>
        ) : (
          "New York"
        )}
      </p>

      <div className="mt-10 grid md:grid-cols-[1fr_0.9fr] gap-8 items-start">
        <LookStack pieces={pieces} />
        <div className="space-y-5">
          <ol className="space-y-3">
            {pieces.map((g) => (
              <li key={g.id} className="flex items-center gap-3 border-b border-hairline pb-3">
                <img
                  src={g.cutoutSrc}
                  alt=""
                  className="size-14 object-contain bg-paper-deep"
                />
                <div>
                  <p>{g.name}</p>
                  <p className="micro text-ink-soft">{g.subtype || g.category}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => drop && wearToday(drop.garmentIds)}
              disabled={drop?.worn}
            >
              {drop?.worn ? "Logged for today" : "Wear this"}
            </Button>
            <Button variant="ghost" onClick={() => rerollDrop(weather)}>
              Reroll
            </Button>
            <Link
              to="/stylist"
              className="inline-flex h-11 items-center px-4 text-sm border border-hairline hover:border-hairline-strong"
            >
              Ask the stylist
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

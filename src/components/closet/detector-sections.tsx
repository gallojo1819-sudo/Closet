import { nearestOpen, OCCASION_ORDER, visibleDetectors, type Way } from "@/lib/detectors";
import type { Garment, Occasion, Season } from "@/lib/types";

const OCCASION_LABEL: Record<Occasion, string> = {
  weekday: "Weekday",
  out: "Out",
  weekend: "Weekend",
  travel: "Travel",
  comfy: "Comfy",
};

const NOTE = "Not enough of your pieces for this here yet.";

function chapterLooks(way: Way, occasion: Occasion): Garment[][] {
  return (way.looks[occasion] ?? []).filter((look) => look.length >= 3);
}

function Chapter({ occasion, looks }: { occasion: Occasion; looks: Garment[][] }) {
  if (looks.length < 3) return null;
  return (
    <div>
      <p className="mt-3 micro text-ink-soft">{OCCASION_LABEL[occasion]}</p>
      <div className="look-swipe">
        {looks.map((look, index) => (
          <p key={`${occasion}:${index}`} className="mt-1 text-sm text-ink-soft">
            {look.map((g) => g.name).join(" · ")}
          </p>
        ))}
      </div>
    </div>
  );
}

/** Ways this closet can dress. A chapter under three looks is not rendered. */
export function DetectorSections({
  garments,
  ways,
  occasion = "weekday",
  season = "fall",
  color = null,
  activeId = null,
}: {
  garments: Garment[];
  ways?: Way[];
  occasion?: Occasion;
  season?: Season;
  color?: string | null;
  activeId?: string | null;
}) {
  const found = ways ?? visibleDetectors(garments, { occasion, season, color });
  const usual = found.some((way) => way.usual);
  if (usual) {
    return (
      <div data-detectors className="mt-8 space-y-6">
        <section>
          <h2 className="font-editorial text-2xl tracking-tight">Your usual</h2>
          {found
            .filter((way) => way.id !== "usual")
            .map((way) => (
              <div key={way.id}>
                <h3 className="mt-4 font-editorial text-xl tracking-tight">{way.title}</h3>
                {OCCASION_ORDER.map((id) => {
                  const looks = (way.looks[id] ?? []).slice(0, 3);
                  if (!looks.length) return null;
                  return (
                    <div key={id}>
                      <p className="mt-3 micro text-ink-soft">{OCCASION_LABEL[id]}</p>
                      <div className="look-swipe">
                        {looks.map((look, index) => (
                          <p key={`${id}:${index}`} className="mt-1 text-sm text-ink-soft">
                            {look.map((g) => g.name).join(" · ")}
                          </p>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
        </section>
      </div>
    );
  }
  const focused = activeId ? found.find((way) => way.id === activeId) : undefined;
  const short = focused && (focused.counts[occasion] ?? 0) < 3 ? focused : undefined;
  const nearest = short ? nearestOpen(short.counts, occasion) : null;
  return (
    <div data-detectors className="mt-8 space-y-6">
      {short ? <p className="text-sm text-ink-soft">{NOTE}</p> : null}
      {(short ? found.filter((way) => way.id === short.id) : found).map((way) => {
        const show = short && nearest ? nearest : occasion;
        const looks = chapterLooks(way, show);
        if (!short && looks.length < 3) return null;
        return (
          <section key={way.id}>
            <h2 className="font-editorial text-2xl tracking-tight">{way.title}</h2>
            {short && nearest ? <Chapter occasion={nearest} looks={looks} /> : <Chapter occasion={occasion} looks={looks} />}
          </section>
        );
      })}
    </div>
  );
}

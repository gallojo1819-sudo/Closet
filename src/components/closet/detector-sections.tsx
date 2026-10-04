import { LookKit } from "@/components/closet/look-kit";
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

function PlateCard({ look }: { look: Garment[] }) {
  return (
    <div className="w-56 shrink-0">
      <LookKit layout="stack" pieces={look} className="pointer-events-none aspect-[4/5]" />
      <ul className="mt-2 space-y-0.5">
        {look.map((g) => (
          <li key={g.id} className="text-sm text-ink">
            {g.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Chapter({ occasion, looks }: { occasion: Occasion; looks: Garment[][] }) {
  if (looks.length < 3) return null;
  return (
    <div>
      <p className="mt-3 micro text-ink-soft">{OCCASION_LABEL[occasion]}</p>
      <div className="look-swipe mt-3 flex gap-4">
        {looks.map((look, index) => (
          <PlateCard key={`${occasion}:${index}`} look={look} />
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
  const usual = found.find((way) => way.usual);
  if (usual) {
    const looks = OCCASION_ORDER.flatMap((id) => (usual.looks[id] ?? []).slice(0, 3)).filter((look) => look.length >= 3);
    if (!looks.length) {
      return (
        <div data-detectors className="mt-8">
          <p data-usual-reason className="text-sm text-ink-soft">
            {usual.reason ?? "Nothing in this closet finishes a look."}
          </p>
        </div>
      );
    }
    return (
      <div data-detectors className="mt-8 space-y-6">
        <section>
          <h2 className="font-editorial text-2xl tracking-tight">Your usual</h2>
          <div className="look-swipe mt-3 flex gap-4">
            {looks.map((look, index) => (
              <PlateCard key={`usual:${index}`} look={look} />
            ))}
          </div>
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
        if (looks.length < 3) return null;
        return (
          <section key={way.id}>
            <h2 className="font-editorial text-2xl tracking-tight">{way.title}</h2>
            <Chapter occasion={show} looks={looks} />
          </section>
        );
      })}
    </div>
  );
}

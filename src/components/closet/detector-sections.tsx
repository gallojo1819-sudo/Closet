import { FlatLay } from "@/components/closet/flat-lay";
import { activeFirst, OCCASION_ORDER, visibleDetectors, type Way } from "@/lib/detectors";
import type { Garment, Occasion, Season } from "@/lib/types";
import { PlateRack } from "@/components/closet/plate-rack";

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

/**
 * The plate sits in its own box above the names. A stretched flex item counts as a definite
 * height, so a kit sized `h-full` straight inside the card would swallow the name list below
 * it and push the names out under the next way's heading.
 *
 * The box is 2:3, taller than Today's 4:5 paper, and it is the one that clips. The lay-down
 * inside it is inset from the sides and the top: the flat-lay places its pieces as percentages
 * of its own box (tops of the height, widths of the width), so on 4:5 the trouser hems and the
 * shoes ran past the bottom, and a fanned jacket lifts ~16px and turns, so its corner needs
 * headroom. A narrower, taller lay keeps the whole outfit inside the box at rest and fanned;
 * nothing can reach the names below. `aspect-auto` matters: an absolutely positioned box with
 * insets on every side still takes the flat-lay's own 4:5 ratio for its height, which would
 * clip exactly as before; `overflow-visible` lets a fanned corner use the inset instead of
 * being cut at the lay's edge.
 */
type OpenPlate = (pieces: Garment[], occasion: Occasion, el: HTMLElement) => void;

function PlateCard({
  look,
  occasion,
  onOpen,
}: {
  look: Garment[];
  occasion: Occasion;
  onOpen?: OpenPlate;
}) {
  return (
    <div className="w-full">
      <div className="relative aspect-[2/3] w-full overflow-hidden">
        <button
          type="button"
          onClick={(e) => onOpen?.(look, occasion, e.currentTarget)}
          aria-label={`Open ${look.map((g) => g.name).join(", ")}`}
          className="absolute inset-0 block focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ink"
        >
          <div className="absolute inset-x-[9%] top-[7%] bottom-0">
            <FlatLay pieces={look} passive className="absolute inset-0 aspect-auto overflow-visible border-0 bg-transparent" />
          </div>
        </button>
      </div>
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

function Chapter({
  title,
  occasion,
  looks,
  onOpen,
}: {
  title: string;
  occasion: Occasion;
  looks: Garment[][];
  onOpen?: OpenPlate;
}) {
  if (looks.length < 1) return null;
  return (
    <div>
      <p className="mt-3 micro text-ink-soft">{OCCASION_LABEL[occasion]}</p>
      <PlateRack label={`${title} outfits`}>
        {looks.map((look, index) => (
          <PlateCard key={`${occasion}:${index}`} look={look} occasion={occasion} onOpen={onOpen} />
        ))}
      </PlateRack>
      {looks.length < 3 ? (
        <p data-way-short className="mt-3 text-sm text-ink-soft">{`Only ${looks.length} in your closet.`}</p>
      ) : null}
    </div>
  );
}

/** Ways this closet can dress. A short way shows what it has and says so. A way with no look is not rendered. */
export function DetectorSections({
  garments,
  ways,
  occasion = "weekday",
  season = "fall",
  color = null,
  activeId = null,
  onOpen,
}: {
  garments: Garment[];
  ways?: Way[];
  occasion?: Occasion;
  season?: Season;
  color?: string | null;
  activeId?: string | null;
  onOpen?: OpenPlate;
}) {
  const found = ways ?? visibleDetectors(garments, { occasion, season, color });
  const usual = found.find((way) => way.usual);
  if (usual) {
    const looks = OCCASION_ORDER.flatMap((id) =>
      (usual.looks[id] ?? []).map((look) => ({ look, occasion: id })).slice(0, 3),
    ).filter((plate) => plate.look.length >= 3);
    if (looks.length < 3) {
      return (
        <div data-detectors className="mt-8">
          <p data-usual-reason className="text-sm text-ink-soft">
            {usual.reason || NOTE}
          </p>
        </div>
      );
    }
    return (
      <div data-detectors className="mt-8 space-y-6">
        <section>
          <h2 className="font-editorial text-2xl tracking-tight">Your usual</h2>
          <PlateRack label="Your usual outfits">
            {looks.map((plate, index) => (
              <PlateCard key={`usual:${index}`} look={plate.look} occasion={plate.occasion} onOpen={onOpen} />
            ))}
          </PlateRack>
        </section>
      </div>
    );
  }
  return (
    <div data-detectors className="mt-8 space-y-6">
      {activeFirst(found, activeId).map((way) => {
        const looks = chapterLooks(way, occasion);
        if (looks.length < 1) return null;
        return (
          <section key={way.id}>
            <h2 className="font-editorial text-2xl tracking-tight">{way.title}</h2>
            <Chapter title={way.title} occasion={occasion} looks={looks} onOpen={onOpen} />
          </section>
        );
      })}
    </div>
  );
}

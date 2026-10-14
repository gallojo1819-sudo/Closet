import { LookCollage } from "@/components/closet/look-collage";
import { sectionRows, visibleDetectors, type Way } from "@/lib/detectors";
import { ideaTitle, pieceLine } from "@/lib/look-collage";
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

/**
 * One rack card: the jacket-first collage (its own 1:1.28 box, nothing clipped, the jacket on
 * top) inside the card's single button, then CD's caption under it: a serif title and the
 * one-line piece list. The card surface (CD .card) is .plate-rack-card in styles.css.
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
      <button
        type="button"
        onClick={(e) => onOpen?.(look, occasion, e.currentTarget)}
        aria-label={`Open ${pieceLine(look).replaceAll(" · ", ", ")}`}
        className="block w-full text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-ink"
      >
        <LookCollage pieces={look} />
        <p className="mt-3 font-editorial text-[19px] leading-tight tracking-tight">{ideaTitle(look)}</p>
        <p className="mt-1 text-xs leading-snug text-ink-soft">{pieceLine(look)}</p>
      </button>
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
      <PlateRack label={`${title} outfits`} looks={looks}>
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

/**
 * Ways this closet can dress. A short way shows what it has and says so. A way with no look is
 * not rendered. The rows come from sectionRows, the same lists the Lookbook header counts.
 */
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
  const { usual, rows } = sectionRows(found, occasion, activeId);
  if (usual) {
    const looks = rows[0]?.looks ?? [];
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
          <PlateRack label="Your usual outfits" looks={looks.map((plate) => plate.look)}>
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
      {rows.map((row) => (
        <section key={row.id}>
          <h2 className="font-editorial text-2xl tracking-tight">{row.title}</h2>
          <Chapter title={row.title} occasion={occasion} looks={row.looks.map((plate) => plate.look)} onOpen={onOpen} />
        </section>
      ))}
    </div>
  );
}

import { visibleDetectors } from "@/lib/detectors";
import type { Garment } from "@/lib/types";

const OCCASION_ORDER = ["weekday", "out", "weekend", "travel", "comfy"] as const;

const OCCASION_LABEL: Record<(typeof OCCASION_ORDER)[number], string> = {
  weekday: "Weekday",
  out: "Out",
  weekend: "Weekend",
  travel: "Travel",
  comfy: "Comfy",
};

export type WayView = {
  id: string;
  title: string;
  pieces?: Garment[];
  outfits?: { occasion: string; pieces: Garment[] }[];
};

/** Ways this closet can finish. A detector with no outfit is not rendered. */
export function DetectorSections({
  garments,
  ways,
}: {
  garments: Garment[];
  ways?: WayView[];
}) {
  if (ways) {
    if (!ways.length) return null;
    return (
      <div data-detectors className="mt-8 space-y-6">
        {ways.map((way) => (
          <section key={way.id}>
            <h2 className="font-editorial text-2xl tracking-tight">{way.title}</h2>
            {OCCASION_ORDER.map((id) => {
              const looks = (way.outfits ?? []).filter((row) => row.occasion === id).slice(0, 3);
              if (!looks.length) return null;
              return (
                <div key={id}>
                  <p className="mt-3 micro text-ink-soft">{OCCASION_LABEL[id]}</p>
                  <div className="look-swipe">
                  {looks.map((look, index) => (
                    <p key={`${id}:${index}`} className="mt-1 text-sm text-ink-soft">
                      {look.pieces.map((g) => g.name).join(" · ")}
                    </p>
                  ))}
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </div>
    );
  }
  const found = visibleDetectors(garments);
  if (!found.length) return null;
  return (
    <div data-detectors className="mt-8 space-y-6">
      {found.map((way) => (
        <section key={way.id}>
          <h2 className="font-editorial text-2xl tracking-tight">{way.title}</h2>
          <p className="mt-1 text-sm text-ink-soft">{way.pieces.map((g) => g.name).join(" · ")}</p>
        </section>
      ))}
    </div>
  );
}

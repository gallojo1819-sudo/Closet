import { visibleDetectors } from "@/lib/detectors";
import type { Garment } from "@/lib/types";

/** Ways this closet can finish. A detector with no outfit is not rendered. */
export function DetectorSections({ garments }: { garments: Garment[] }) {
  const ways = visibleDetectors(garments);
  if (!ways.length) return null;
  return (
    <div data-detectors className="mt-8 space-y-6">
      {ways.map((way) => (
        <section key={way.id}>
          <h2 className="font-editorial text-2xl tracking-tight">{way.title}</h2>
          <p className="mt-1 text-sm text-ink-soft">{way.pieces.map((g) => g.name).join(" · ")}</p>
        </section>
      ))}
    </div>
  );
}

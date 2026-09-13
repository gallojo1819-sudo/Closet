import { GarmentImg } from "@/components/closet/gimg";
import { layersForOnMe } from "@/lib/look";
import type { Garment } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Equal tiles. No overlap, no magazine stack, no extra mats. */
export function LookKit({
  pieces,
  className,
}: {
  pieces: Garment[];
  className?: string;
}) {
  const cells = layersForOnMe(pieces);
  const n = cells.length;
  if (n === 0) {
    return <div className={cn("aspect-[4/5] bg-paper", className)} />;
  }
  const three = n === 3;
  return (
    <div
      className={cn(
        "grid h-full w-full aspect-[4/5] bg-paper",
        n <= 1 ? "grid-rows-1" : n === 2 ? "grid-rows-2" : "grid-cols-2 grid-rows-2",
        className,
      )}
    >
      {cells.map((g, i) => (
        <div
          key={g.id}
          className={cn(
            "min-h-0 min-w-0 flex items-center justify-center p-1",
            three && i === 2 ? "col-span-2" : null,
          )}
        >
          <GarmentImg
            garment={g}
            className="max-h-full max-w-full h-full w-full object-contain"
          />
        </div>
      ))}
    </div>
  );
}

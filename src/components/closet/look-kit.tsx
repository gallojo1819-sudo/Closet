import { GarmentImg } from "@/components/closet/gimg";
import { kitCells } from "@/lib/look";
import type { Garment } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 4 pieces: 2×2. 3 pieces: two up top, shoe spanning the second row. No empty paper mats. */
export function LookKit({
  pieces,
  className,
  thumb = true,
}: {
  pieces: Garment[];
  className?: string;
  thumb?: boolean;
}) {
  const core = kitCells(pieces);
  if (core.length === 0) {
    return <div className={cn("h-full w-full bg-paper", className)} />;
  }
  return (
    <div
      className={cn("grid h-full w-full min-h-0 bg-paper", className)}
      style={{ gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" }}
    >
      {core.map((g, i) => {
        const spanLast = core.length === 3 && i === 2;
        const spanFull = core.length === 1;
        const spanRow = core.length === 2;
        return (
          <div
            key={g.id}
            className="relative min-h-0 min-w-0 overflow-hidden"
            style={{
              gridColumn: spanLast || spanFull || (spanRow && i === 0) ? "1 / -1" : undefined,
              gridRow: spanFull ? "1 / -1" : spanRow && i === 1 ? "2 / 3" : undefined,
            }}
          >
            <GarmentImg
              garment={g}
              thumb={thumb}
              eager={!thumb}
              nudge={false}
              className="absolute inset-0 h-full w-full object-contain"
            />
          </div>
        );
      })}
    </div>
  );
}

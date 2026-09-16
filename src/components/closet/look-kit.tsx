import { FlatLay } from "@/components/closet/flat-lay";
import { GarmentImg } from "@/components/closet/gimg";
import { kitCells, spreadPieces } from "@/lib/look";
import type { Garment } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 4 pieces: 2×2. Otherwise a composed overlapping lay — never a blank quadrant. */
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
  const lay = spreadPieces(pieces);
  if (core.length === 0 && lay.length === 0) {
    return <div className={cn("h-full w-full bg-paper", className)} />;
  }
  if (core.length === 4) {
    return (
      <div
        className={cn("grid h-full w-full min-h-0 bg-paper", className)}
        style={{ gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" }}
      >
        {core.map((g) => (
          <div key={g.id} className="relative min-h-0 min-w-0 overflow-hidden">
            <GarmentImg
              garment={g}
              thumb={thumb}
              eager={!thumb}
              className="absolute inset-0 h-full w-full object-contain"
            />
          </div>
        ))}
      </div>
    );
  }
  return (
    <FlatLay
      pieces={lay}
      thumb={thumb}
      className={cn("h-full w-full border-0 bg-paper", className)}
      passive
    />
  );
}

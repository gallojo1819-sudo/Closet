import { GarmentImg } from "@/components/closet/gimg";
import { kitCells } from "@/lib/look";
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
  const cells = kitCells(pieces);
  const n = cells.length;
  if (n === 0) {
    return <div className={cn("h-full w-full bg-paper", className)} />;
  }
  const three = n === 3;
  return (
    <div
      className={cn("grid h-full w-full min-h-0 bg-paper", className)}
      style={
        n <= 2
          ? { gridTemplateRows: n === 1 ? "1fr" : "1fr 1fr" }
          : { gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" }
      }
    >
      {cells.map((g, i) => (
        <div
          key={g.id}
          className="relative min-h-0 min-w-0 overflow-hidden"
          style={three && i === 2 ? { gridColumn: "1 / -1" } : undefined}
        >
          <GarmentImg
            garment={g}
            eager
            className="absolute inset-0 h-full w-full object-contain"
          />
        </div>
      ))}
    </div>
  );
}

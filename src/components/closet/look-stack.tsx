import { GarmentImg } from "@/components/closet/gimg";
import type { Garment } from "@/lib/types";
import { cn } from "@/lib/utils";

export function LookStack({
  pieces,
  className,
}: {
  pieces: Garment[];
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-px bg-hairline border border-hairline", className)}>
      {pieces.map((g) => (
        <div key={g.id} className="bg-paper-deep aspect-page">
          <GarmentImg
            garment={g}
            className="h-full w-full object-contain p-[8%]"
          />
        </div>
      ))}
    </div>
  );
}

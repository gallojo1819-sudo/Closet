import type { Garment } from "@/lib/types";
import { daysIdle } from "@/lib/style";
import { cn } from "@/lib/utils";

export function GarmentTile({
  garment,
  onClick,
  selected,
}: {
  garment: Garment;
  onClick?: () => void;
  selected?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group text-left w-full",
        selected && "outline outline-1 outline-ink",
      )}
    >
      <div className="relative bg-paper-deep border border-hairline overflow-hidden aspect-page">
        <img
          src={garment.cutoutSrc || garment.imageSrc}
          alt={garment.name}
          className="absolute inset-0 h-full w-full object-contain p-[8%]"
        />
        {garment.demo && (
          <span className="absolute left-2 top-2 micro bg-paper px-2 py-1 text-ink-soft border border-hairline">
            Sample
          </span>
        )}
        {!garment.demo && daysIdle(garment) >= 21 && (
          <span className="absolute left-2 top-2 micro bg-paper px-2 py-1 text-ink-soft border border-hairline">
            Waiting
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <p className="text-sm leading-snug">{garment.name}</p>
        <span className="micro text-ink-soft shrink-0">{garment.category}</span>
      </div>
    </button>
  );
}

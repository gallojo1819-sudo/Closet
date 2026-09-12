import { GarmentImg } from "@/components/closet/gimg";
import type { Garment } from "@/lib/types";
import { daysIdle } from "@/lib/style";
import { cn } from "@/lib/utils";

export function GarmentTile({
  garment,
  onClick,
  selected,
  selecting,
}: {
  garment: Garment;
  onClick?: () => void;
  selected?: boolean;
  selecting?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selecting ? Boolean(selected) : undefined}
      className={cn(
        "group text-left w-full",
        selected && "outline outline-1 outline-ink",
      )}
    >
      <div
        className="relative bg-paper-deep border border-hairline overflow-hidden aspect-page transition-all duration-300 ease-[var(--ease-atelier)] group-hover:-translate-y-1.5 group-hover:shadow-[0_16px_36px_-14px_rgb(23_20_15/0.3)]"
        style={
          selected && !selecting
            ? undefined
            : { viewTransitionName: `piece-${garment.id}` }
        }
      >
        <GarmentImg
          garment={garment}
          className="absolute inset-0 h-full w-full object-contain p-[8%]"
        />
        {selecting && (
          <span
            className={cn(
              "absolute right-2 top-2 size-4 border",
              selected ? "bg-ink border-ink" : "bg-paper border-hairline",
            )}
            aria-hidden
          />
        )}
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

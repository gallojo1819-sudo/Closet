import type { MouseEvent } from "react";
import { GarmentImg } from "@/components/closet/gimg";
import { derivedCategory } from "@/lib/garment-category";
import { hasCleanCover, needsReprintTile, REPRINT_CAPTION } from "@/lib/plate";
import { useCoverByteRev } from "@/lib/use-clean-cover";
import { pieceLabel } from "@/lib/piece-label";
import { useCloset } from "@/lib/store";
import type { Garment } from "@/lib/types";
import { daysIdle } from "@/lib/style";
import { cn } from "@/lib/utils";

export function GarmentTile({
  garment,
  onClick,
  selected,
  selecting,
  eager = false,
}: {
  garment: Garment;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  selected?: boolean;
  selecting?: boolean;
  eager?: boolean;
}) {
  const pool = useCloset((s) => s.garments);
  useCoverByteRev();
  const reprint = needsReprintTile(garment);
  const paper = !hasCleanCover(garment);
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
      <div className="card-lift">
      <div
        className="relative bg-paper-deep border border-hairline overflow-hidden aspect-page"
        style={{ viewTransitionName: "none" }}
      >
        {paper ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-paper-deep px-3 text-center">
            <p className="text-sm leading-snug">{garment.name}</p>
            {reprint ? <span className="micro mt-3 underline">Reprint</span> : null}
          </div>
        ) : (
          <GarmentImg
            garment={garment}
            eager={eager}
            className="absolute inset-0 h-full w-full object-contain p-[4%]"
          />
        )}
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
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <p className="text-sm leading-snug">{pieceLabel(garment, pool)}</p>
        <span className="micro text-ink-soft shrink-0">{derivedCategory(garment)}</span>
      </div>
      {reprint && (
        <p className="mt-1 micro text-ink-soft">{REPRINT_CAPTION}</p>
      )}
    </button>
  );
}

import type { CSSProperties } from "react";
import { GarmentImg } from "@/components/closet/gimg";
import { kitCells } from "@/lib/look";
import { slotOf } from "@/lib/style";
import type { Garment } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Grid (default): 4 pieces in a 2×2; 3 pieces with the shoe across the second row.
 * Stack: Lookbook cards only. One column, each plate in its own band.
 */
export function LookKit({
  pieces,
  className,
  thumb = true,
  layout = "grid",
  onYouSrc,
  showOnYou = false,
  onYouLeaving = false,
  onYouHidden,
}: {
  pieces: Garment[];
  className?: string;
  thumb?: boolean;
  layout?: "grid" | "stack";
  /** Cached dressed photo. Not rendered until showOnYou. */
  onYouSrc?: string;
  showOnYou?: boolean;
  onYouLeaving?: boolean;
  onYouHidden?: () => void;
}) {
  const core = kitCells(pieces);
  if (core.length === 0) {
    return <div className={cn("h-full w-full bg-paper", className)} />;
  }
  if (layout === "stack") {
    return (
      <LookKitStack
        pieces={core}
        className={className}
        thumb={thumb}
        onYouSrc={onYouSrc}
        showOnYou={showOnYou}
        onYouLeaving={onYouLeaving}
        onYouHidden={onYouHidden}
      />
    );
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

const BAND_SHARE = { top: 46, jacket: 8, bottom: 34, shoe: 20 } as const;
type BandRole = keyof typeof BAND_SHARE;
const BAND_ORDER: BandRole[] = ["top", "jacket", "bottom", "shoe"];

function bandRole(g: Garment): BandRole | null {
  const slot = slotOf(g);
  if (slot === "top" || slot === "dress") return "top";
  if (slot === "outerwear") return "jacket";
  if (slot === "bottom") return "bottom";
  if (slot === "footwear") return "shoe";
  return null;
}

function LookKitStack({
  pieces,
  className,
  thumb,
  onYouSrc,
  showOnYou,
  onYouLeaving,
  onYouHidden,
}: {
  pieces: Garment[];
  className?: string;
  thumb: boolean;
  onYouSrc?: string;
  showOnYou: boolean;
  onYouLeaving: boolean;
  onYouHidden?: () => void;
}) {
  const bands = BAND_ORDER.map((role) => pieces.find((g) => bandRole(g) === role)).filter(
    (g): g is Garment => Boolean(g),
  );
  const dressed = showOnYou && onYouSrc ? onYouSrc : "";
  return (
    <div
      className={cn("look-kit-stack relative flex h-full w-full min-h-0 flex-col", className)}
      style={{ backgroundColor: "#F4EFE6" }}
      data-layout="stack"
    >
      {bands.map((g, i) => {
        const role = bandRole(g)!;
        const style = {
          flexGrow: BAND_SHARE[role],
          flexShrink: 1,
          flexBasis: 0,
          ["--band-i" as string]: String(i),
          ["--band-n" as string]: String(bands.length),
        } as CSSProperties;
        return (
          <div
            key={g.id}
            className="look-kit-band flex min-h-0 min-w-0 items-center justify-center overflow-hidden"
            data-band={role}
            data-share={BAND_SHARE[role]}
            style={style}
          >
            <div className="look-kit-rise flex h-full w-full items-center justify-center">
              <GarmentImg
                garment={g}
                thumb={thumb}
                eager={!thumb}
                nudge={false}
                className="h-full w-full object-contain"
              />
            </div>
          </div>
        );
      })}
      {dressed ? (
        <img
          src={dressed}
          alt=""
          className={cn(
            "look-on-you pointer-events-none absolute inset-0 z-10 h-full w-full object-contain",
            onYouLeaving && "is-out",
          )}
          onAnimationEnd={(e) => {
            if (e.animationName !== "look-on-you-out") return;
            onYouHidden?.();
          }}
        />
      ) : null}
    </div>
  );
}

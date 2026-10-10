import { GarmentImg } from "@/components/closet/gimg";
import { collageLayout, tileTint } from "@/lib/look-collage";
import type { Garment } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * "Rack, jacket first" collage (Creative Director's .lay). Every piece sits on its own opaque,
 * softly tinted 4:5 tile; the cutout multiplies into the tint, so there are no white boxes and
 * nothing is cropped. The jacket tile is big at the upper left and stacks above the top, which
 * sits behind it on the right; trousers lower right; shoes small at the lower left, above all.
 *
 * Hover spread (the centre rack card, or Today's paper) is CSS on --hx/--hy/--hr, fine pointers
 * only and never under reduced motion (styles.css .collage-piece).
 *
 * With onPick, each piece is a button: tap lifts it, tap again / tap the paper / Escape lets go
 * (the same contract as FlatLay, which Today relies on). Without it the collage is passive: no
 * tabIndex, no buttons, so a click bubbles to the card's own button.
 */
const HOVER: Record<string, { x: number; y: number; r: number }> = {
  outer: { x: -10, y: -6, r: -3 },
  top: { x: -4, y: -10, r: 2 },
  top2: { x: 6, y: -8, r: 3 },
  bottom: { x: 10, y: 6, r: 2 },
  shoes: { x: -8, y: 8, r: -4 },
  extra: { x: 8, y: 8, r: 3 },
};

export type CollageSize = "card" | "hero" | "today" | "deck";

export function LookCollage({
  pieces,
  size = "card",
  thumb,
  className,
  activeId = null,
  onPick,
  caption,
  lockedIds,
  onToggleLock,
  flipIds,
}: {
  pieces: Garment[];
  size?: CollageSize;
  /** Row cards default to the :t thumb; the big sizes take the :c cutout. */
  thumb?: boolean;
  className?: string;
  activeId?: string | null;
  onPick?: (id: string | null) => void;
  caption?: React.ReactNode;
  /** Lock and spin (a later step): accepted now, drawn later. */
  lockedIds?: ReadonlySet<string> | readonly string[];
  onToggleLock?: (id: string) => void;
  /** Mirror these pieces' photos (CD .flip). */
  flipIds?: ReadonlySet<string> | readonly string[];
}) {
  void lockedIds;
  void onToggleLock;
  const sharp = thumb === undefined ? size !== "card" : !thumb;
  const picking = Boolean(onPick && activeId);
  const flips = flipIds ? new Set(flipIds) : null;
  return (
    <div
      data-collage={size}
      tabIndex={onPick ? 0 : undefined}
      onClick={onPick ? () => onPick(null) : undefined}
      onKeyDown={
        onPick
          ? (e: React.KeyboardEvent) => {
              if (e.key === "Escape") onPick(null);
            }
          : undefined
      }
      className={cn("look-collage relative w-full outline-none", size !== "card" && "is-fan", picking && "has-pick", className)}
    >
      {collageLayout(pieces).map((p) => {
        if (!p.drawn) return null;
        const picked = picking && activeId === p.g.id;
        const hover = HOVER[p.slot] ?? HOVER.extra!;
        const img = (
          <GarmentImg
            garment={p.g}
            thumb={!sharp}
            eager={sharp}
            nudge={false}
            className={cn("absolute inset-0 h-full w-full", flips?.has(p.g.id) && "flip")}
          />
        );
        return (
          <div
            key={p.g.id}
            data-piece={onPick ? p.g.id : undefined}
            data-slot={p.slot}
            className={cn("collage-piece", picked && "is-picked")}
            style={{
              left: `${p.left}%`,
              top: `${p.top}%`,
              width: `${p.w}%`,
              zIndex: picked ? 50 : p.z,
              aspectRatio: p.tall ? "4 / 6" : undefined,
              ["--tint" as string]: tileTint(p.g),
              ["--hx" as string]: `${hover.x}px`,
              ["--hy" as string]: `${hover.y}px`,
              ["--hr" as string]: `${hover.r}deg`,
            }}
          >
            {onPick ? (
              <button
                type="button"
                aria-label={p.g.name}
                aria-pressed={activeId === p.g.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onPick(activeId === p.g.id ? null : p.g.id);
                }}
                className="absolute inset-0 block focus-visible:outline focus-visible:outline-1 focus-visible:outline-ink"
              >
                {img}
              </button>
            ) : (
              img
            )}
          </div>
        );
      })}
      {picking && caption ? (
        <div className="absolute inset-x-2 bottom-2 z-[60]" onClick={(e) => e.stopPropagation()}>
          {caption}
        </div>
      ) : null}
    </div>
  );
}

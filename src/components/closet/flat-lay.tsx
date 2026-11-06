import { GarmentImg } from "@/components/closet/gimg";
import { slotOf } from "@/lib/style";
import type { Garment } from "@/lib/types";
import { cn } from "@/lib/utils";

function hash(s: string): number {
  let h = 7;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/** Magazine laydown: shirt back, pant middle, shoes front. Large, overlapping. */
const STACK: Record<
  string,
  { left: number; top: number; w: number; z: number; r: number; hx: number; hy: number }
> = {
  outerwear: { left: 4, top: 2, w: 88, z: 1, r: -4, hx: -14, hy: -16 },
  top: { left: 6, top: 6, w: 82, z: 2, r: -2, hx: -16, hy: -12 },
  dress: { left: 7, top: 7, w: 80, z: 2, r: -1, hx: -14, hy: -14 },
  bottom: { left: 11, top: 28, w: 78, z: 3, r: 2, hx: 14, hy: 4 },
  footwear: { left: 18, top: 60, w: 62, z: 4, r: 5, hx: 12, hy: 16 },
  accessory: { left: 62, top: 68, w: 28, z: 5, r: 8, hx: 18, hy: 12 },
  other: { left: 16, top: 36, w: 64, z: 3, r: 0, hx: 12, hy: 12 },
};

/**
 * Untucked lay. The lead hem crosses the waistband; the shoes sit low and to
 * the left so most of the trouser box stays readable. bottom.top is 36 rather
 * than 34 so the hem overlap stays within 32% of the trouser width.
 */
const UNTUCKED = {
  top: { left: 6, top: 1, w: 58, z: 6 },
  bottom: { left: 22, top: 36, w: 72, z: 3 },
  footwear: { left: 2, top: 72, w: 40, z: 8 },
} as const;

/**
 * Piece box on the plate. "in", "none", and undefined match the tucked STACK,
 * including the per-piece jitter. "out" moves the lead top (n = 1), the first
 * bottom, and the first shoe. A top that is not the lead sits on the lead's
 * box, shifted down-right, and never larger than the lead.
 */
// The plate and its tests share this. It is not a component.
// eslint-disable-next-line react-refresh/only-export-components
export function flatLayBox(
  slot: string,
  n: number,
  jit: number,
  tuck?: "in" | "out" | "none",
): { left: number; top: number; w: number; z: number } {
  const base = STACK[slot] ?? STACK.other!;
  const shift = (n - 1) * 5;
  const placed = {
    left: base.left + shift + jit,
    top: base.top + shift * 0.6 + jit,
    w: base.w,
    z: base.z + n,
  };
  if (tuck !== "out") return placed;
  if (slot === "top" && n === 1) {
    return { left: UNTUCKED.top.left, top: UNTUCKED.top.top, w: UNTUCKED.top.w, z: UNTUCKED.top.z };
  }
  if (slot === "bottom" && n === 1) {
    return {
      left: UNTUCKED.bottom.left,
      top: UNTUCKED.bottom.top,
      w: UNTUCKED.bottom.w,
      z: UNTUCKED.bottom.z,
    };
  }
  if (slot === "footwear" && n === 1) {
    return {
      left: UNTUCKED.footwear.left,
      top: UNTUCKED.footwear.top,
      w: UNTUCKED.footwear.w,
      z: UNTUCKED.footwear.z,
    };
  }
  if (slot === "top" && n > 1) {
    const lead = UNTUCKED.top;
    return {
      left: lead.left + 4,
      top: lead.top + 3,
      w: lead.w,
      z: lead.z - 1,
    };
  }
  return placed;
}

export function FlatLay({
  pieces,
  className,
  passive,
  thumb = true,
  activeId = null,
  onPick,
  caption,
  tuck,
  leadId,
}: {
  pieces: Garment[];
  className?: string;
  passive?: boolean;
  thumb?: boolean;
  /** With onPick, each piece is a button. Tap lifts it; tap again, the paper, or Escape lets go. */
  activeId?: string | null;
  onPick?: (id: string | null) => void;
  caption?: React.ReactNode;
  /** Same decision the label uses. Omitted, "in", and "none" draw the tucked plate. */
  tuck?: "in" | "out" | "none";
  /** The lead top, when tuck is "out". */
  leadId?: string;
}) {
  const seen: Record<string, number> = {};
  const picking = Boolean(onPick && activeId);
  return (
    <div
      tabIndex={passive ? undefined : 0}
      onClick={onPick ? () => onPick(null) : undefined}
      onKeyDown={
        onPick
          ? (e: React.KeyboardEvent) => {
              if (e.key === "Escape") onPick(null);
            }
          : undefined
      }
      className={cn(
        "group relative aspect-[4/5] border border-hairline bg-paper overflow-hidden outline-none",
        picking && "has-pick",
        className,
      )}
    >
      {pieces.map((g) => {
        const slot = slotOf(g) ?? g.category;
        const n = (seen[slot] = (seen[slot] ?? 0) + 1);
        const base = STACK[slot] ?? STACK.other!;
        const h = hash(g.id);
        const jit = ((h % 1000) / 1000 - 0.5) * 3;
        const picked = picking && activeId === g.id;
        const leadHere = tuck === "out" && leadId != null && g.id === leadId && slot === "top";
        const firstHem =
          tuck === "out" && !leadHere && (slot === "bottom" || slot === "footwear") && n === 1;
        const underLead = tuck === "out" && slot === "top" && !leadHere;
        const box = flatLayBox(
          slot,
          leadHere ? 1 : underLead ? Math.max(n, 2) : n,
          jit,
          leadHere || firstHem || underLead ? "out" : tuck === "out" ? undefined : tuck,
        );
        const img = (
          <GarmentImg
            garment={g}
            thumb={thumb}
            eager={!thumb}
            nudge={false}
            className="w-full aspect-page object-contain drop-shadow-sm"
          />
        );
        return (
          <div
            key={g.id}
            data-piece={onPick ? g.id : undefined}
            className={cn("flat-piece absolute", picked && "is-picked")}
            style={{
              left: `${box.left}%`,
              top: `${box.top}%`,
              width: `${box.w}%`,
              zIndex: picked ? 50 : box.z,
              ["--rx" as string]: "0px",
              ["--ry" as string]: "0px",
              ["--rr" as string]: `${base.r + jit}deg`,
              ["--sx" as string]: `${base.hx}px`,
              ["--sy" as string]: `${base.hy}px`,
              ["--sr" as string]: `${base.r + (h % 2 ? 4 : -4)}deg`,
            }}
          >
            {onPick ? (
              <button
                type="button"
                aria-label={g.name}
                aria-pressed={activeId === g.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onPick(activeId === g.id ? null : g.id);
                }}
                className="block w-full focus-visible:outline focus-visible:outline-1 focus-visible:outline-ink"
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

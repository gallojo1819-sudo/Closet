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

export function FlatLay({
  pieces,
  className,
}: {
  pieces: Garment[];
  className?: string;
}) {
  const seen: Record<string, number> = {};
  return (
    <div
      tabIndex={0}
      className={cn(
        "group relative aspect-[4/5] border border-hairline bg-paper overflow-hidden outline-none",
        className,
      )}
    >
      {pieces.map((g) => {
        const slot = slotOf(g) ?? g.category;
        const n = (seen[slot] = (seen[slot] ?? 0) + 1);
        const base = STACK[slot] ?? STACK.other!;
        const h = hash(g.id);
        const jit = ((h % 1000) / 1000 - 0.5) * 3;
        const shift = (n - 1) * 5;
        return (
          <div
            key={g.id}
            className="flat-piece absolute"
            style={{
              left: `${base.left + shift + jit}%`,
              top: `${base.top + shift * 0.6 + jit}%`,
              width: `${base.w}%`,
              zIndex: base.z + n,
              ["--rx" as string]: "0px",
              ["--ry" as string]: "0px",
              ["--rr" as string]: `${base.r + jit}deg`,
              ["--sx" as string]: `${base.hx}px`,
              ["--sy" as string]: `${base.hy}px`,
              ["--sr" as string]: `${base.r + (h % 2 ? 4 : -4)}deg`,
            }}
          >
            <GarmentImg
              garment={g}
              className="w-full aspect-page object-contain drop-shadow-sm"
            />
          </div>
        );
      })}
    </div>
  );
}

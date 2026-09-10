import { GarmentImg } from "@/components/closet/gimg";
import type { Garment } from "@/lib/types";
import { cn } from "@/lib/utils";

function hash(s: string): number {
  let h = 7;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

type Placement = {
  left: string;
  top: string;
  width: string;
  rx: string;
  ry: string;
  rr: string;
  sx: string;
  sy: string;
  sr: string;
  z: number;
};

/** Rest = a tidy board; hover/focus = the pieces ease apart into a still-life. */
function placement(i: number, n: number, id: string): Placement {
  const h = hash(id);
  const jit = (span: number) => ((h % 1000) / 1000 - 0.5) * span;
  const cols = n <= 2 ? n : Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const col = i % cols;
  const row = Math.floor(i / cols);
  const cx = (col + 0.5) * (100 / cols);
  const cy = (row + 0.5) * (100 / rows);
  const w = Math.min(40, (100 / cols) * 0.86);
  const rr = jit(7);
  // Scatter: push outward from center, lift the rotation a touch.
  const dx = cx - 50;
  const dy = cy - 50;
  const len = Math.max(1, Math.hypot(dx, dy));
  return {
    left: `${cx - w / 2 + jit(4)}%`,
    top: `${cy - w * 0.625 + jit(4)}%`,
    width: `${w}%`,
    rx: "0%",
    ry: "0%",
    rr: `${rr}deg`,
    sx: `${(dx / len) * 26 + jit(6)}%`,
    sy: `${(dy / len) * 20 + jit(6)}%`,
    sr: `${rr + (h % 2 ? 6 : -6)}deg`,
    z: i + 1,
  };
}

export function FlatLay({
  pieces,
  className,
}: {
  pieces: Garment[];
  className?: string;
}) {
  return (
    <div
      tabIndex={0}
      className={cn(
        "group relative aspect-[4/5] border border-hairline bg-paper-deep overflow-hidden outline-none",
        className,
      )}
    >
      {pieces.map((g, i) => {
        const p = placement(i, pieces.length, g.id);
        return (
          <div
            key={g.id}
            className="flat-piece absolute"
            style={{
              left: p.left,
              top: p.top,
              width: p.width,
              zIndex: p.z,
              ["--rx" as string]: p.rx,
              ["--ry" as string]: p.ry,
              ["--rr" as string]: p.rr,
              ["--sx" as string]: p.sx,
              ["--sy" as string]: p.sy,
              ["--sr" as string]: p.sr,
            }}
          >
            <GarmentImg
              garment={g}
              className="w-full aspect-page object-contain"
            />
          </div>
        );
      })}
    </div>
  );
}

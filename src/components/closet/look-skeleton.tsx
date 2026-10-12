import { COLLAGE_GEOMETRY } from "@/lib/look-collage";
import { cn } from "@/lib/utils";

const BLOCKS: (keyof typeof COLLAGE_GEOMETRY)[] = ["outer", "top", "bottom", "shoes"];

/**
 * A loading card in the flat-lay's shape: the jacket, top, bottom and shoe tiles where the
 * collage would draw them, each shimmering (a translated gradient, no repaint), with two
 * caption bars under. Replaces the blank panel while a row is still being found.
 */
export function LookSkeleton({
  className,
  caption = true,
  index = 0,
}: {
  className?: string;
  caption?: boolean;
  /** Stagger position for the fade-in. */
  index?: number;
}) {
  return (
    <div
      aria-hidden="true"
      data-look-skeleton
      className={cn("look-enter w-full", className)}
      style={{ "--i": index } as React.CSSProperties}
    >
      <div className="look-collage relative w-full">
        {BLOCKS.map((key) => {
          const geo = COLLAGE_GEOMETRY[key];
          return (
            <div
              key={key}
              className="skeleton-block absolute aspect-[4/5]"
              style={{ left: `${geo.left}%`, top: `${geo.top}%`, width: `${geo.w}%` }}
            />
          );
        })}
      </div>
      {caption ? (
        <>
          <div className="skeleton-block mt-3 h-[18px] w-3/5" />
          <div className="skeleton-block mt-2 h-3 w-4/5" />
        </>
      ) : null}
    </div>
  );
}

/** Three skeleton cards in a rack row, for a chapter still being found. */
export function RackSkeleton({ label = "Finding your looks" }: { label?: string }) {
  return (
    <div data-rack-skeleton role="status" aria-label={label} className="rack-skeleton mt-4 flex gap-[22px] overflow-hidden">
      {[0, 1, 2].map((i) => (
        <div key={i} className="plate-rack-card rack-skeleton-card shrink-0">
          <LookSkeleton index={i} />
        </div>
      ))}
    </div>
  );
}

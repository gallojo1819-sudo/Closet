import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type SyntheticEvent } from "react";
import { nearestIndex, rackIdentity, rackPose, stepIndex, tiltFromPointer } from "@/lib/plate-rack";
import { cn } from "@/lib/utils";

/**
 * One sliding row of outfit plates: the centre one big, the ones beside it smaller, turned
 * away and faded, like flipping hangers on a rack.
 *
 * The track is a native horizontal scroller with CSS scroll-snap, so swipe, trackpad and
 * momentum are the browser's. The pose of every slide is measured from its rect on each
 * scroll frame (rAF-throttled, reads before writes) and written straight to style as
 * transform and opacity on the pose wrapper. The only React state is the centred index, and
 * it changes only when the nearest slide changes, so a flick does not re-render the row.
 *
 * Stacking is rackPose's z as z-index on the slide, but set from the centred index on that
 * re-render rather than per scroll frame: the order only changes when the centre does, and
 * every z-index write repaints the page's stacking context (measured: ~40 root repaints per
 * flick when written per frame, 6 when written per centre change), while transform and
 * opacity writes on the composited pose cost no paint at all.
 */
const PERSPECTIVE = "perspective(1200px)";
const DRAG_SLOP = 6;

const transformOf = (rotateY: string, scale: string): string => `${PERSPECTIVE} rotateY(${rotateY}deg) scale(${scale})`;

/** Server-rendered pose for slide `i` with slide 0 centred, so the first paint already reads as a rack. */
function poseStyle(offset: number): CSSProperties {
  const p = rackPose(offset);
  return { transform: transformOf(String(p.rotateY), String(p.scale)), opacity: p.opacity };
}

/** Slides are flex items, so z-index stacks them without position: relative. `offset` is whole cards from the centre. */
function slideStyle(offset: number): CSSProperties {
  return { zIndex: rackPose(offset).z };
}

function Chevron({ dir }: { dir: -1 | 1 }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={dir < 0 ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PlateRack({ label, children }: { label: string; children: ReactNode[] }) {
  // The plates come in already keyed. Keep their identity (no Children.toArray clone) so a
  // centre change re-renders the dots and arrows, not every card.
  const items = Array.isArray(children) ? children : [children];
  const n = items.length;
  const keys = items.map((child, i) => (child as { key?: string | number | null } | null)?.key ?? i);
  // Changes exactly when the plates do (an occasion switch swaps the keys): the setup effect
  // keys off it to put the new row back on card 0 and re-measure.
  const identity = rackIdentity(keys);
  const trackRef = useRef<HTMLDivElement>(null);
  const [center, setCenter] = useState(0);
  const centerRef = useRef(0);
  const frame = useRef(0);
  const reducedRef = useRef(false);
  const fineRef = useRef(false);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const swallowClick = useRef(false);
  const snapTimer = useRef(0);
  const tilt = useRef<{ el: HTMLElement; x: number; y: number } | null>(null);
  const tiltFrame = useRef(0);
  const active = Math.min(center, Math.max(0, n - 1));

  const slidesOf = (track: HTMLElement): HTMLElement[] =>
    Array.from(track.getElementsByClassName("plate-rack-slide")).filter((el): el is HTMLElement => el instanceof HTMLElement);

  /** Measure every slide against the track's centre line, then write poses. Reads first, writes after. */
  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const slides = slidesOf(track);
    const rect = track.getBoundingClientRect();
    const mid = rect.left + rect.width / 2;
    const offsets = slides.map((slide) => {
      const r = slide.getBoundingClientRect();
      return (r.left + r.width / 2 - mid) / (r.width || 1);
    });
    for (let i = 0; i < slides.length; i++) {
      const pose = slides[i]!.firstElementChild as HTMLElement | null;
      if (!pose) continue;
      const p = rackPose(offsets[i]!);
      const transform = transformOf(p.rotateY.toFixed(2), p.scale.toFixed(3));
      if (pose.style.transform !== transform) pose.style.transform = transform;
      const opacity = p.opacity.toFixed(3);
      if (pose.style.opacity !== opacity) pose.style.opacity = opacity;
    }
    const next = nearestIndex(offsets);
    if (next !== centerRef.current) {
      centerRef.current = next;
      setCenter(next);
    }
  }, []);

  const scrollToIndex = useCallback((index: number) => {
    const track = trackRef.current;
    if (!track) return;
    const slide = slidesOf(track)[index];
    if (!slide) return;
    const rect = track.getBoundingClientRect();
    const r = slide.getBoundingClientRect();
    const left = track.scrollLeft + (r.left + r.width / 2) - (rect.left + rect.width / 2);
    const reduced = reducedRef.current;
    track.scrollTo({ left, behavior: reduced ? "auto" : "smooth" });
  }, []);

  // First paint, and again whenever the plates change (occasion switch): index 0 centred, poses
  // applied with transitions off, then transitions on from the next frame.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    reducedRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    fineRef.current = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    track.classList.remove("is-ready");
    track.scrollLeft = 0;
    measure();
    const ready = requestAnimationFrame(() => track.classList.add("is-ready"));
    return () => cancelAnimationFrame(ready);
  }, [measure, identity]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onScroll = () => {
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        measure();
      });
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(track);
    return () => {
      track.removeEventListener("scroll", onScroll);
      ro.disconnect();
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
      if (tiltFrame.current) cancelAnimationFrame(tiltFrame.current);
      tiltFrame.current = 0;
      if (snapTimer.current) window.clearTimeout(snapTimer.current);
    };
  }, [measure]);

  // The click that ends a mouse drag is not a tap: eat it wherever it lands (a drag can start on
  // one slide and end on another, so it may target the track itself).
  const onTrackClickCapture = (e: SyntheticEvent) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  // A click on a side card brings it to the centre instead of opening it.
  const onSlideClickCapture = (i: number) => (e: SyntheticEvent) => {
    if (i === centerRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    scrollToIndex(i);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    scrollToIndex(stepIndex(centerRef.current, e.key === "ArrowLeft" ? -1 : 1, n));
  };

  // Mouse drag scrolls the track (touch and trackpad already do natively). Snap is off while
  // dragging, then the release glides to the nearest card and snap comes back once it lands.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    swallowClick.current = false;
    if (e.pointerType !== "mouse" || e.button !== 0 || n < 2) return;
    const track = trackRef.current;
    if (!track) return;
    drag.current = { x: e.clientX, left: track.scrollLeft, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const track = trackRef.current;
    if (!d || !track) return;
    const dx = e.clientX - d.x;
    if (!d.moved) {
      if (Math.abs(dx) < DRAG_SLOP) return;
      d.moved = true;
      track.classList.add("is-dragging");
      track.setPointerCapture(e.pointerId);
    }
    track.scrollLeft = d.left - dx;
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const track = trackRef.current;
    drag.current = null;
    if (!d || !track || !d.moved) return;
    if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
    swallowClick.current = true;
    measure();
    scrollToIndex(centerRef.current);
    const restore = () => {
      track.classList.remove("is-dragging");
      track.removeEventListener("scrollend", restore);
      if (snapTimer.current) window.clearTimeout(snapTimer.current);
      snapTimer.current = 0;
    };
    track.addEventListener("scrollend", restore);
    snapTimer.current = window.setTimeout(restore, 700);
  };

  // Hover tilt on the centre card, fine pointers only, never under reduced motion. Pointer
  // moves arrive faster than frames, so the last one is kept and applied in one rAF (one rect
  // read, two property writes per frame), the same way the scroll handler is throttled.
  const onTilt = (e: PointerEvent<HTMLDivElement>) => {
    if (!fineRef.current || reducedRef.current || drag.current?.moved) return;
    tilt.current = { el: e.currentTarget, x: e.clientX, y: e.clientY };
    if (tiltFrame.current) return;
    tiltFrame.current = requestAnimationFrame(() => {
      tiltFrame.current = 0;
      const t = tilt.current;
      if (!t) return;
      const r = t.el.getBoundingClientRect();
      const { rx, ry } = tiltFromPointer((t.x - r.left) / (r.width || 1), (t.y - r.top) / (r.height || 1));
      t.el.style.setProperty("--rx", `${rx}deg`);
      t.el.style.setProperty("--ry", `${ry}deg`);
    });
  };
  const onTiltEnd = (e: PointerEvent<HTMLDivElement>) => {
    tilt.current = null;
    if (tiltFrame.current) cancelAnimationFrame(tiltFrame.current);
    tiltFrame.current = 0;
    e.currentTarget.style.removeProperty("--rx");
    e.currentTarget.style.removeProperty("--ry");
  };

  return (
    <div className="plate-rack" role="region" aria-roledescription="carousel" aria-label={label}>
      <div className="plate-rack-stage">
        <div
          ref={trackRef}
          className="plate-rack-track"
          tabIndex={0}
          onKeyDown={onKeyDown}
          onClickCapture={onTrackClickCapture}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDragStart={(e) => e.preventDefault()}
        >
          <div className="plate-rack-row">
            {items.map((child, i) => (
              <div
                key={keys[i]}
                className={cn("plate-rack-slide", i === active && "is-center")}
                style={slideStyle(i - active)}
                data-i={i}
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${n}`}
                onClickCapture={onSlideClickCapture(i)}
                onPointerMove={i === active ? onTilt : undefined}
                onPointerLeave={i === active ? onTiltEnd : undefined}
              >
                <div className="plate-rack-pose" style={poseStyle(i)}>
                  <div className="plate-rack-card">{child}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        {n > 1 ? (
          <>
            <button
              type="button"
              className="plate-rack-arrow is-prev"
              aria-label="Previous outfit"
              disabled={active === 0}
              onClick={() => scrollToIndex(stepIndex(active, -1, n))}
            >
              <Chevron dir={-1} />
            </button>
            <button
              type="button"
              className="plate-rack-arrow is-next"
              aria-label="Next outfit"
              disabled={active === n - 1}
              onClick={() => scrollToIndex(stepIndex(active, 1, n))}
            >
              <Chevron dir={1} />
            </button>
          </>
        ) : null}
      </div>
      {n > 1 ? (
        <div className="plate-rack-dots">
          {items.map((_, i) => (
            <button
              key={i}
              type="button"
              className={cn("plate-rack-dot", i === active && "is-active")}
              aria-label={`Outfit ${i + 1} of ${n}`}
              aria-current={i === active ? "true" : undefined}
              onClick={() => scrollToIndex(i)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

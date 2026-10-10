import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type SyntheticEvent } from "react";
import { GarmentImg } from "@/components/closet/gimg";
import { collageSlots } from "@/lib/look-collage";
import {
  nearestIndex,
  RAIL_PAD,
  rackIdentity,
  rackPose,
  railTilt,
  scrubIndex,
  spotlightPose,
  stepIndex,
  SWING_REST,
  swingKick,
  swingSettled,
  swingStep,
  tiltFromPointer,
  type Swing,
} from "@/lib/plate-rack";
import type { Garment } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * One sliding row of outfit plates. Two looks on one engine:
 *
 * - The Rail (≥640px): the cards hang from hooks on a brass rail, each at a resting tilt of
 *   ±0.5°, start-aligned on a plain horizontal track. Hover lifts a card (CSS); a scroll swings
 *   the hangers a degree or two against the motion and they spring back (one --swing var on the
 *   row, rAF, off under reduced motion). No poses are written.
 * - Spotlight (<640px): the centre card 1.15×, the neighbours smaller and faded, measured from
 *   the fractional offset on every scroll frame so an incoming card grows as it is pulled. A
 *   thumbnail scrubber (the first piece of each look) replaces the dots.
 *
 * The track is a native horizontal scroller with CSS scroll-snap, so swipe, trackpad and
 * momentum are the browser's. The pose of every slide is measured from its rect on each
 * scroll frame (rAF-throttled, reads before writes) and written straight to style as
 * transform and opacity on the pose wrapper. The only React state is the centred index, and
 * it changes only when the nearest slide changes, so a flick does not re-render the row.
 * Which look is in force is a ref read from the width media query, never state: the visual
 * differences are CSS media queries, so the server markup is the same for both.
 *
 * Stacking is rackPose's z as z-index on the slide, but set from the centred index on that
 * re-render rather than per scroll frame: the order only changes when the centre does, and
 * every z-index write repaints the slides' stacking context (measured: ~40 repaints per flick
 * when written per frame, 6 when written per centre change), while transform and opacity
 * writes on the composited pose cost no paint at all. That stacking context is the track
 * (styles.css), so those 6 repaints cover one row, not the page.
 *
 * Measured and rejected (4x CPU throttle, fast flick, 15-card row): sorting the slides by a
 * 3D depth translate instead of z-index. A depth in the pose under a plain slide never sorts
 * in Chrome (the slide flattens it; the cards paint in DOM order), and the variants that do
 * sort (3D slides, or the depth on the slide inside a 3D row) double Chrome's layerization
 * and triple the long tasks. Dropping z-index from the slides altogether is worse still (15x
 * the long tasks): without a high z-index the rack's ~75 composited layers sit low in the
 * page's paint order and every later paint chunk is overlap-tested against them.
 */
const PERSPECTIVE = "perspective(1200px)";
const DRAG_SLOP = 6;
const RAIL_QUERY = "(min-width: 640px)";

const transformOf = (rotateY: string, scale: string): string => `${PERSPECTIVE} rotateY(${rotateY}deg) scale(${scale})`;

/** Server-rendered Spotlight pose for slide `i` with slide 0 centred; the rail ignores poses (CSS). */
function poseStyle(offset: number): CSSProperties {
  const p = spotlightPose(offset);
  return { transform: transformOf(String(p.rotateY), String(p.scale)), opacity: p.opacity };
}

/** Slides are flex items, so z-index stacks them without position: relative. `offset` is whole cards from the centre. */
function slideStyle(offset: number): CSSProperties {
  return { zIndex: rackPose(offset).z };
}

/** The hanger: a thin black hanger on a brass hook (CD carousel.html), static decoration. */
function Hook() {
  return (
    <svg className="plate-rack-hook" width="96" height="58" viewBox="0 0 120 72" aria-hidden="true">
      <path d="M60 26 C60 18 68 14 68 8 A8 8 0 0 0 52 8" fill="none" stroke="#9a7a44" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M60 26 L8 66 Q6 70 12 70 L108 70 Q114 70 112 66 Z" fill="none" stroke="#2b2622" strokeWidth="2.4" strokeLinejoin="round" />
    </svg>
  );
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

/** The scrubber thumb for a look: its jacket, or its top when there is no jacket. */
function scrubPiece(look: Garment[]): Garment | null {
  const slots = collageSlots(look);
  return (slots.find((p) => p.slot === "outer") ?? slots.find((p) => p.slot === "top") ?? slots[0])?.g ?? null;
}

export function PlateRack({ label, children, looks }: { label: string; children: ReactNode[]; looks?: Garment[][] }) {
  // The plates come in already keyed. Keep their identity (no Children.toArray clone) so a
  // centre change re-renders the dots and arrows, not every card.
  const items = Array.isArray(children) ? children : [children];
  const n = items.length;
  const keys = items.map((child, i) => (child as { key?: string | number | null } | null)?.key ?? i);
  // Changes exactly when the plates do (an occasion switch swaps the keys): the setup effect
  // keys off it to put the new row back on card 0 and re-measure.
  const identity = rackIdentity(keys);
  const trackRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [center, setCenter] = useState(0);
  const centerRef = useRef(0);
  const frame = useRef(0);
  const reducedRef = useRef(false);
  const fineRef = useRef(false);
  const railRef = useRef(false);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const scrub = useRef<{ el: HTMLElement; id: number } | null>(null);
  const swallowClick = useRef(false);
  const snapTimer = useRef(0);
  const tilt = useRef<{ el: HTMLElement; x: number; y: number } | null>(null);
  const tiltFrame = useRef(0);
  const lastLeft = useRef(0);
  const swing = useRef<Swing>(SWING_REST);
  const swingFrame = useRef(0);
  const active = Math.min(center, Math.max(0, n - 1));

  const slidesOf = (track: HTMLElement): HTMLElement[] =>
    Array.from(track.getElementsByClassName("plate-rack-slide")).filter((el): el is HTMLElement => el instanceof HTMLElement);

  /** The line a card rests on: the track's centre for Spotlight, the first hanger's centre for the rail. */
  const anchorOf = (rect: DOMRect, cardWidth: number): number =>
    railRef.current ? rect.left + RAIL_PAD + cardWidth / 2 : rect.left + rect.width / 2;

  /** Measure every slide against the anchor line, then write poses (Spotlight only). Reads first, writes after. */
  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const slides = slidesOf(track);
    const rect = track.getBoundingClientRect();
    const rects = slides.map((slide) => slide.getBoundingClientRect());
    const mid = anchorOf(rect, rects[0]?.width ?? 0);
    const offsets = rects.map((r) => (r.left + r.width / 2 - mid) / (r.width || 1));
    if (!railRef.current) {
      for (let i = 0; i < slides.length; i++) {
        const pose = slides[i]!.firstElementChild?.lastElementChild as HTMLElement | null;
        if (!pose) continue;
        const p = spotlightPose(offsets[i]!);
        const transform = transformOf(p.rotateY.toFixed(2), p.scale.toFixed(3));
        if (pose.style.transform !== transform) pose.style.transform = transform;
        const opacity = p.opacity.toFixed(3);
        if (pose.style.opacity !== opacity) pose.style.opacity = opacity;
      }
    }
    const next = nearestIndex(offsets);
    if (next !== centerRef.current) {
      centerRef.current = next;
      setCenter(next);
    }
  }, []);

  const scrollToIndex = useCallback((index: number, behavior?: ScrollBehavior) => {
    const track = trackRef.current;
    if (!track) return;
    const slide = slidesOf(track)[index];
    if (!slide) return;
    const rect = track.getBoundingClientRect();
    const r = slide.getBoundingClientRect();
    const left = track.scrollLeft + (r.left + r.width / 2) - anchorOf(rect, r.width);
    const reduced = reducedRef.current;
    track.scrollTo({ left, behavior: behavior ?? (reduced ? "auto" : "smooth") });
  }, []);

  // The hangers swing against a scroll and spring back: one custom property on the row, so the
  // slides' rotate (CSS) follows without a per-slide write. Never under reduced motion.
  const swingLoop = useCallback(() => {
    swingFrame.current = 0;
    const row = rowRef.current;
    if (!row) return;
    swing.current = swingStep(swing.current);
    row.style.setProperty("--swing", `${swing.current.angle.toFixed(2)}deg`);
    if (!swingSettled(swing.current)) swingFrame.current = requestAnimationFrame(swingLoop);
    else row.style.removeProperty("--swing");
  }, []);
  const kickSwing = useCallback(
    (dx: number) => {
      if (!railRef.current || reducedRef.current) return;
      swing.current = swingKick(swing.current, dx);
      if (!swingFrame.current) swingFrame.current = requestAnimationFrame(swingLoop);
    },
    [swingLoop],
  );

  // First paint, and again whenever the plates change (occasion switch): index 0 centred, poses
  // applied with transitions off, then transitions on from the next frame.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    reducedRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    fineRef.current = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    railRef.current = window.matchMedia(RAIL_QUERY).matches;
    track.classList.remove("is-ready");
    lastLeft.current = 0;
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
        const left = track.scrollLeft;
        kickSwing(left - lastLeft.current);
        lastLeft.current = left;
        measure();
      });
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(track);
    // Crossing 640px swaps the look: forget the Spotlight poses, then measure for the new one.
    const mq = window.matchMedia(RAIL_QUERY);
    const onMode = () => {
      railRef.current = mq.matches;
      for (const slide of slidesOf(track)) {
        const pose = slide.firstElementChild?.lastElementChild as HTMLElement | null;
        pose?.style.removeProperty("transform");
        pose?.style.removeProperty("opacity");
      }
      measure();
    };
    mq.addEventListener("change", onMode);
    return () => {
      track.removeEventListener("scroll", onScroll);
      ro.disconnect();
      mq.removeEventListener("change", onMode);
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
      if (tiltFrame.current) cancelAnimationFrame(tiltFrame.current);
      tiltFrame.current = 0;
      if (swingFrame.current) cancelAnimationFrame(swingFrame.current);
      swingFrame.current = 0;
      if (snapTimer.current) window.clearTimeout(snapTimer.current);
    };
  }, [measure, kickSwing]);

  // The click that ends a mouse drag is not a tap: eat it wherever it lands (a drag can start on
  // one slide and end on another, so it may target the track itself).
  const onTrackClickCapture = (e: SyntheticEvent) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  // Spotlight: a click on a side card brings it to the centre instead of opening it. On the
  // rail every card is in reach, so a click opens it.
  const onSlideClickCapture = (i: number) => (e: SyntheticEvent) => {
    if (railRef.current || i === centerRef.current) return;
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

  // Scrubber drag: the pointer's place along the strip is the look to jump to.
  const onScrubDown = (e: PointerEvent<HTMLDivElement>) => {
    scrub.current = { el: e.currentTarget, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onScrubMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = scrub.current;
    if (!s) return;
    const r = s.el.getBoundingClientRect();
    const i = scrubIndex((e.clientX - r.left) / (r.width || 1), n);
    if (i !== centerRef.current) scrollToIndex(i, "auto");
  };
  const onScrubUp = (e: PointerEvent<HTMLDivElement>) => {
    const s = scrub.current;
    scrub.current = null;
    if (s && s.el.hasPointerCapture(e.pointerId)) s.el.releasePointerCapture(e.pointerId);
  };

  // Hover tilt on the Spotlight centre card, fine pointers only, never under reduced motion.
  // Pointer moves arrive faster than frames, so the last one is kept and applied in one rAF
  // (one rect read, two property writes per frame), the same way the scroll handler is throttled.
  // The rail's hover is a CSS lift instead.
  const onTilt = (e: PointerEvent<HTMLDivElement>) => {
    if (railRef.current || !fineRef.current || reducedRef.current || drag.current?.moved) return;
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

  const thumbs = looks && looks.length === n ? looks.map(scrubPiece) : null;

  return (
    <div className="plate-rack" role="region" aria-roledescription="carousel" aria-label={label}>
      <div className="plate-rack-stage">
        <div className="plate-rack-rail" aria-hidden="true">
          <i className="plate-rack-bracket is-left" />
          <i className="plate-rack-bracket is-right" />
        </div>
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
          <div ref={rowRef} className="plate-rack-row">
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
                <div className="plate-rack-hang" style={{ ["--tilt" as string]: `${railTilt(i)}deg` }}>
                  <Hook />
                  <div className="plate-rack-pose" style={poseStyle(i)}>
                    <div className="plate-rack-card">
                      <span className="plate-rack-tag" aria-hidden="true">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      {child}
                    </div>
                  </div>
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
        <div
          className="plate-rack-scrub"
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
        >
          {items.map((_, i) => (
            <button
              key={i}
              type="button"
              className={cn("plate-rack-thumb", i === active && "is-active")}
              aria-label={`Outfit ${i + 1} of ${n}`}
              aria-current={i === active ? "true" : undefined}
              onClick={() => scrollToIndex(i)}
            >
              {thumbs?.[i] ? <GarmentImg garment={thumbs[i]!} nudge={false} className="h-full w-full" /> : null}
            </button>
          ))}
          <i className="plate-rack-progress" style={{ width: `${((active + 1) / n) * 100}%` }} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Lookbook rack geometry. Pure numbers in, pure numbers out, so the carousel's scroll loop
 * stays a measure-then-write pass with nothing to unit test in the DOM.
 *
 * `offset` is (card centre − viewport centre) / card width, signed: 0 is the centre card,
 * +1 the next hanger to the right, −1 the one to the left.
 */
export type RackPose = { scale: number; rotateY: number; opacity: number; z: number };

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** 0 instead of -0 so poses compare and serialise cleanly. */
const zero = (n: number): number => (Object.is(n, -0) ? 0 : n);

/**
 * Side cards fade by opacity only: a `filter` on a moving card re-rasters it every frame,
 * which is what janked the first version under CPU throttle.
 */
export function rackPose(offset: number): RackPose {
  const a = Math.min(Math.abs(offset), 2.5);
  const near = Math.min(a, 2);
  return {
    scale: 1 - 0.16 * near,
    rotateY: zero(-clamp(offset, -2, 2) * 14),
    opacity: a >= 2.5 ? 0 : 1 - 0.28 * near,
    z: 100 - Math.round(a * 10),
  };
}

/**
 * One string that changes exactly when the row's plates do (their React keys, index for an
 * unkeyed one), so the rack can reset to card 0 and re-measure on an occasion switch.
 */
export function rackIdentity(keys: readonly (string | number | null | undefined)[]): string {
  return keys.map((k, i) => (k === null || k === undefined ? `#${i}` : String(k))).join("\u001f");
}

/** Index of the card nearest the centre line; ties go to the lower index; no cards → 0. */
export function nearestIndex(offsets: number[]): number {
  let best = 0;
  let bestAbs = Infinity;
  for (let i = 0; i < offsets.length; i++) {
    const abs = Math.abs(offsets[i] ?? Infinity);
    if (abs < bestAbs) {
      bestAbs = abs;
      best = i;
    }
  }
  return best;
}

/** One hanger left or right, never past the ends. */
export function stepIndex(i: number, dir: -1 | 1, n: number): number {
  if (n <= 0) return 0;
  return clamp(i + dir, 0, n - 1);
}

/* ---- The Rail (desktop, ≥640px) ---- */

/** Left inset of the first hanger on the rail; the track's anchor line is this plus half a card. */
export const RAIL_PAD = 8;

const REST_TILTS = [-0.5, 0.4, -0.3, 0.5, -0.4, 0.3];

/** Resting tilt of hanger `i`, within ±0.5°, repeating so neighbours never lean the same way. */
export function railTilt(i: number): number {
  return REST_TILTS[((Math.round(i) % REST_TILTS.length) + REST_TILTS.length) % REST_TILTS.length]!;
}

export type Swing = { angle: number; velocity: number };
export const SWING_MAX = 2;
export const SWING_REST: Swing = { angle: 0, velocity: 0 };

/** A scroll of `dx` px this frame pushes the hangers 1–2° against the motion. */
export function swingKick(swing: Swing, dx: number): Swing {
  if (!dx) return swing;
  const push = clamp(-dx * 0.06, -SWING_MAX, SWING_MAX);
  return { angle: clamp(swing.angle + push * 0.5, -SWING_MAX, SWING_MAX), velocity: swing.velocity + push * 0.25 };
}

/** One rAF step of the spring back to upright (stiffness 0.14, damping 0.8). */
export function swingStep(swing: Swing): Swing {
  const velocity = (swing.velocity - swing.angle * 0.14) * 0.8;
  const angle = swing.angle + velocity;
  return swingSettled({ angle, velocity }) ? SWING_REST : { angle: zero(angle), velocity: zero(velocity) };
}

export function swingSettled(swing: Swing): boolean {
  return Math.abs(swing.angle) < 0.02 && Math.abs(swing.velocity) < 0.02;
}

/* ---- Spotlight (phone, <640px) ---- */

/**
 * Spotlight pose: the centre card 1.15× in full colour, the neighbours about 0.88× at ~60%,
 * the next ones ~0.76× and fading, with a slight turn. Continuous in the fractional offset,
 * so an incoming card grows as it is pulled. Opacity, never a filter (see rackPose).
 */
export function spotlightPose(offset: number): RackPose {
  const a = Math.min(Math.abs(offset), 2.5);
  const scale = a < 1 ? 1.15 - 0.27 * a : Math.max(0.62, 0.88 - 0.12 * (a - 1));
  const opacity = a < 1 ? 1 - 0.4 * a : Math.max(0.3, 0.6 - 0.2 * (a - 1));
  return {
    scale: Math.round(scale * 1000) / 1000,
    rotateY: zero(-clamp(offset, -2, 2) * 6),
    opacity: a >= 2.5 ? 0 : Math.round(opacity * 1000) / 1000,
    z: 100 - Math.round(a * 10),
  };
}

/** Scrubber: a pointer at `fraction` (0..1) of the strip jumps to this look. */
export function scrubIndex(fraction: number, n: number): number {
  if (n <= 0) return 0;
  return clamp(Math.floor(clamp(fraction, 0, 1) * n), 0, n - 1);
}

/** Pointer position in 0..1 of the card → a small tilt toward the cursor, in degrees to 0.1. */
export function tiltFromPointer(px: number, py: number): { rx: number; ry: number } {
  const round = (n: number): number => zero(Math.round(n * 10) / 10);
  return {
    rx: round(-(clamp(py, 0, 1) - 0.5) * 10),
    ry: round((clamp(px, 0, 1) - 0.5) * 12),
  };
}

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

/** Pointer position in 0..1 of the card → a small tilt toward the cursor, in degrees to 0.1. */
export function tiltFromPointer(px: number, py: number): { rx: number; ry: number } {
  const round = (n: number): number => zero(Math.round(n * 10) / 10);
  return {
    rx: round(-(clamp(py, 0, 1) - 0.5) * 10),
    ry: round((clamp(px, 0, 1) - 0.5) * 12),
  };
}

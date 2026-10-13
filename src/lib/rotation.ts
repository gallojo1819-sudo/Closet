/**
 * Redress rotation: every in-season piece gets a turn before anything repeats. The Lookbook
 * rows, the week row and Re-dress all draw from one queue of piece ids ordered by
 * least-recently-shown. A page leads with the front of the queue; what it shows goes to the
 * back. Lists never shrink: when the unseen looks run out a page is filled from the back of the
 * queue (fillRow in ideas.ts), so every tap is a full page. Coverage counts the pieces shown
 * since the last reset; once every eligible piece has appeared (pieces that can never pair are
 * set aside, see weekRotationRow in ideas.ts), or a whole page adds no new piece, the cycle
 * resets: the looks seen so far may come back and the least-recently-shown pieces lead again,
 * so the rotation never stalls at nothing new. Look-alike pieces (twinKey in ideas.ts: the
 * same colour, material and kind, as four pairs of white leather sneakers) are capped and
 * ranked as one piece there; the queue itself holds ids. The state is per session, client-side
 * (sessionStorage or memory); nothing here writes to the store or the database. Pure: no React,
 * no DOM, relative imports only.
 */

export const ROTATION_KEY = "closet.rotation.v1";

export type Rotation = {
  v: 1;
  /** Piece ids, front = next to show. Pieces not yet listed rank before all of these. */
  queue: string[];
  /** Pieces shown since the last reset. */
  shown: string[];
  /** Keys (rotationLookKey) of looks shown since the last reset. */
  looks: string[];
  /** Resets so far: every eligible piece has had a turn this many times. */
  passes: number;
  /** Advances in a row that showed no new piece. Two (a whole page) stall the cycle. */
  idle: number;
  /** The last page recorded (its look keys joined): recording it again changes nothing. */
  last: string;
};

/** Advances in a row (a page is two: the week row, then the rows) with nothing new before a reset. */
export const STALL_ADVANCES = 2;

export function emptyRotation(): Rotation {
  return { v: 1, queue: [], shown: [], looks: [], passes: 0, idle: 0, last: "" };
}

/** Sorted ids joined: the same key as comboKey in lookbook.ts, without importing it. */
export function rotationLookKey(ids: readonly string[]): string {
  return [...ids].sort().join("|");
}

/** Lower is sooner. A piece the queue has never seen comes first (-1), then queue order. */
export function rotationRank(r: Rotation): (id: string) => number {
  const at = new Map<string, number>();
  r.queue.forEach((id, i) => at.set(id, i));
  return (id) => at.get(id) ?? -1;
}

export function seenLook(r: Rotation, ids: readonly string[]): boolean {
  if (!r.looks.length) return false;
  return r.looks.includes(rotationLookKey(ids));
}

export type AdvanceInput = {
  /** The looks the page showed, in page order (week row first, then each row). */
  page: readonly (readonly string[])[];
  /** Every live piece id: ids outside this set leave the queue. */
  closet: readonly string[];
  /** Pieces coverage waits for in this scope: in season, in a dressable slot, not vetoed. */
  eligible: readonly string[];
  /** Eligible pieces that can never pair here; coverage does not wait for them. */
  stuck?: ReadonlySet<string>;
  /**
   * Look-alike key per piece id (twinKey in ideas.ts): a piece counts as shown once any piece
   * with its key has been, so four pairs of one sneaker are one turn of the cycle. Ids without
   * a key stand alone.
   */
  alike?: ReadonlyMap<string, string>;
};

export type Advance = { next: Rotation; reset: boolean; newPieces: number; remaining: string[] };

/**
 * Record a page: shown pieces go to the back of the queue (in page order), the looks join the
 * seen set, and when nothing eligible is left unshown the cycle resets. Recording the page just
 * recorded again changes nothing. Any other page moves its pieces to the back even when none
 * of them is new, so the next page leads with something else rather than repeat it. A whole
 * page (STALL_ADVANCES advances) with no new piece while eligible pieces remain means the rest
 * cannot be reached under the caps: the cycle resets rather than stall.
 */
export function advanceRotation(r: Rotation, input: AdvanceInput): Advance {
  const closet = new Set(input.closet);
  const shownNow: string[] = [];
  const seenNow = new Set<string>();
  const keys: string[] = [];
  for (const look of input.page) {
    keys.push(rotationLookKey(look));
    for (const id of look) {
      if (seenNow.has(id) || !closet.has(id)) continue;
      seenNow.add(id);
      shownNow.push(id);
    }
  }
  const shownBefore = new Set(r.shown);
  const looksBefore = new Set(r.looks);
  const newPieces = shownNow.filter((id) => !shownBefore.has(id)).length;
  const keyOf = (id: string) => input.alike?.get(id) ?? id;
  const remainingOf = (shown: ReadonlySet<string>) => {
    const keys = new Set<string>();
    for (const id of shown) keys.add(keyOf(id));
    return input.eligible.filter((id) => closet.has(id) && !keys.has(keyOf(id)) && !input.stuck?.has(id));
  };
  const last = keys.join("/");
  if (last === r.last) {
    const same = r.queue.every((id) => closet.has(id)) && input.closet.every((id) => r.queue.includes(id));
    const next = same ? r : { ...r, queue: pruneQueue(r.queue, closet, input.closet) };
    return { next, reset: false, newPieces: 0, remaining: remainingOf(shownBefore) };
  }
  const queue = [...pruneQueue(r.queue, closet, input.closet).filter((id) => !seenNow.has(id)), ...shownNow];
  const shown = [...r.shown.filter((id) => closet.has(id)), ...shownNow.filter((id) => !shownBefore.has(id))];
  const looks = [...r.looks, ...keys.filter((key) => !looksBefore.has(key))];
  const remaining = remainingOf(new Set(shown));
  const idle = newPieces === 0 ? r.idle + 1 : 0;
  const stalled = idle >= STALL_ADVANCES && remaining.length > 0;
  if (remaining.length === 0 || stalled) {
    return {
      next: { v: 1, queue, shown: [], looks: [], passes: r.passes + 1, idle: 0, last },
      reset: true,
      newPieces,
      remaining: stalled ? remaining : [],
    };
  }
  return { next: { v: 1, queue, shown, looks, passes: r.passes, idle, last }, reset: false, newPieces, remaining };
}

/** Known ids in their order, minus what left the closet; new ids go to the front. */
function pruneQueue(queue: readonly string[], closet: ReadonlySet<string>, all: readonly string[]): string[] {
  const kept = queue.filter((id) => closet.has(id));
  const known = new Set(kept);
  const fresh = all.filter((id) => !known.has(id));
  return [...fresh, ...kept];
}

/** Parse what a session store holds. Anything odd is an empty rotation. */
export function readRotation(raw: string | null | undefined): Rotation {
  if (!raw) return emptyRotation();
  try {
    const got = JSON.parse(raw) as Partial<Rotation> | null;
    if (!got || got.v !== 1) return emptyRotation();
    const ids = (list: unknown): string[] =>
      Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
    return {
      v: 1,
      queue: ids(got.queue),
      shown: ids(got.shown),
      looks: ids(got.looks),
      passes: typeof got.passes === "number" && Number.isFinite(got.passes) ? got.passes : 0,
      idle: typeof got.idle === "number" && Number.isFinite(got.idle) ? got.idle : 0,
      last: typeof got.last === "string" ? got.last : "",
    };
  } catch {
    return emptyRotation();
  }
}

export function writeRotation(r: Rotation): string {
  return JSON.stringify(r);
}

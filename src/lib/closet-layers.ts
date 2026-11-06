/**
 * The closet piece → list → look stack, with no React.
 * One pop removes only the top layer. Close-all clears the stack.
 */

export type Layer = "piece" | "list" | "look";

export type ClosetLayerState = {
  /** Piece sheet. Null when that sheet is closed. */
  openId: string | null;
  /** "N looks with this" list is open. */
  listOpen: boolean;
  /** A look sheet is open. */
  lookOpen: boolean;
  /**
   * The open look was chosen from the list.
   * False for "Outfit with this", which has no list underneath.
   */
  lookFromList: boolean;
};

export function topLayer(state: ClosetLayerState): Layer | null {
  if (state.lookOpen) return "look";
  if (state.listOpen) return "list";
  if (state.openId) return "piece";
  return null;
}

/** The state with exactly the top layer removed. */
export function popOne(state: ClosetLayerState): ClosetLayerState {
  const top = topLayer(state);
  switch (top) {
    case "look":
      /* From the list, the list remains. From Outfit with this, the piece
         remains only when it is still open; that path closes the piece first. */
      return { ...state, lookOpen: false, lookFromList: false };
    case "list":
      return { ...state, listOpen: false };
    case "piece":
      return { ...state, openId: null };
    case null:
      return state;
    default: {
      const unreachable: never = top;
      return unreachable;
    }
  }
}

export function closeAll(state: ClosetLayerState): ClosetLayerState {
  void state;
  return { openId: null, listOpen: false, lookOpen: false, lookFromList: false };
}

/**
 * History entries this stack pushed. An outfit-path look pushes none,
 * so Back and Close do not leave a stale /closet entry.
 */
export function pushedDepth(state: ClosetLayerState): number {
  let n = 0;
  if (state.openId) n += 1;
  if (state.listOpen) n += 1;
  if (state.lookOpen && state.lookFromList) n += 1;
  return n;
}

export type EscTarget = "outline" | Layer | "select" | "none";

/** Outline, then one closet layer, then select mode. */
export function escTarget(input: {
  outlineOpen: boolean;
  selecting: boolean;
  layers: ClosetLayerState;
}): EscTarget {
  if (input.outlineOpen) return "outline";
  const top = topLayer(input.layers);
  if (top) return top;
  if (input.selecting) return "select";
  return "none";
}

/** "← Back to 5 looks". One look stays singular. Never a hardcoded 5. */
export function backToLooksLabel(n: number): string {
  return `← Back to ${n} ${n === 1 ? "look" : "looks"}`;
}

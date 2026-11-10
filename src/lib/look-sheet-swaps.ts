/**
 * The open look sheet's swap handle. The dock offers structured swaps here.
 * If the sheet has unmounted, nothing is applied and the session draft is not written.
 */
import type { LookAskSwap } from "./look-swap.ts";

export type LookSheetSwapHandle = {
  apply: (swaps: readonly LookAskSwap[]) => void;
};

let handle: LookSheetSwapHandle | null = null;

export function registerLookSheetSwaps(next: LookSheetSwapHandle): () => void {
  handle = next;
  return () => {
    if (handle === next) handle = null;
  };
}

export function lookSheetSwapsMounted(): boolean {
  return handle !== null;
}

/** Apply through the mounted sheet. False when the sheet is gone: the caller writes nothing. */
export function offerLookSwaps(swaps: readonly LookAskSwap[]): boolean {
  if (!handle) return false;
  handle.apply(swaps);
  return true;
}

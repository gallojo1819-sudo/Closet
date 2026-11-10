/**
 * Opens the stylist dock from a look sheet or a route. No React, no auth, no model.
 * A focus look lives here only until the dock takes it. Nothing is written to storage.
 */
import type { Occasion } from "./types.ts";

export const LOOK_ASK_HINT = "What would make this better?";

export type StylistOpenOptions = {
  lookIds?: string[];
  occasion?: Occasion;
  promptHint?: string;
};

export type FocusRequest = {
  nonce: number;
  lookIds: string[];
  occasion?: Occasion;
  hint: string;
};

const listeners = new Set<() => void>();
let focusNonce = 0;
let pending: FocusRequest | null = null;

export function subscribeStylistPanel(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Open the dock. With two or more ids, that look is the focus and the hint auto-sends once. */
export function openStylistPanel(opts?: StylistOpenOptions): void {
  const ids = (opts?.lookIds ?? []).filter((id) => typeof id === "string" && id.length > 0);
  if (ids.length >= 2) {
    focusNonce += 1;
    pending = {
      nonce: focusNonce,
      lookIds: ids,
      ...(opts?.occasion ? { occasion: opts.occasion } : {}),
      hint: opts?.promptHint?.trim() || LOOK_ASK_HINT,
    };
  }
  for (const fn of listeners) fn();
}

/** The dock takes the focus request once. A later open without ids does not repeat it. */
export function takePendingFocus(): FocusRequest | null {
  const req = pending;
  pending = null;
  return req;
}

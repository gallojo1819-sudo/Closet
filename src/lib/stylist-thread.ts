import type { Occasion } from "./types.ts";

/** What an answer may become, once the user taps Save. Asking does not write it. */
export type StylistDraft = {
  name: string;
  occasion: Occasion;
  garmentIds: string[];
};

/**
 * A question leaves looks and Today untouched.
 * The draft stays in the thread until Save.
 */
export function recordStylistQuestion<T extends { looks: readonly unknown[]; drop: unknown }>(
  state: T,
  _question: string,
): { looks: number; drop: T["drop"] } {
  return { looks: state.looks.length, drop: state.drop };
}

/** Save is the only write. Source is ai, and nothing already saved is removed. */
export function stylistLookToSave(draft: StylistDraft): {
  name: string;
  occasion: Occasion;
  garmentIds: string[];
  source: "ai";
  lookbook: false;
} {
  return {
    name: draft.name,
    occasion: draft.occasion,
    garmentIds: draft.garmentIds,
    source: "ai",
    lookbook: false,
  };
}

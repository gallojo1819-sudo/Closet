import type { Occasion, StylistMessage } from "./types.ts";

/** What an answer may become, once the user taps Save. Asking does not write it. */
export type StylistDraft = {
  name: string;
  occasion: Occasion;
  garmentIds: string[];
};

/** The draft lives on the message, so a reload still has Save and Wear. */
export function draftFromMessage(message: StylistMessage): StylistDraft | null {
  if (message.role !== "stylist") return null;
  if (!message.draftName || !message.draftOccasion || !message.garmentIds?.length) return null;
  return {
    name: message.draftName,
    occasion: message.draftOccasion,
    garmentIds: message.garmentIds,
  };
}

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

/**
 * Asking must leave the look count and Today where they were.
 * An explicit Save or Wear during the request is left alone.
 * Returns the snapshot to put back, or null when nothing changed.
 */
export function restoreIfAskWrote<L, D>(
  staged: { looks: number; drop: D },
  snap: { looks: L; drop: D },
  now: { looks: readonly unknown[]; drop: D },
  explicitWrite: boolean,
): { looks: L; drop: D } | null {
  if (explicitWrite) return null;
  if (now.looks.length === staged.looks && now.drop === staged.drop) return null;
  return snap;
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

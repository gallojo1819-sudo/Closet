import type { DailyDrop, Garment, Look, StylistMessage, WearEntry } from "./types.ts";

export type PersistedCloset = {
  garments: Garment[];
  looks: Look[];
  journal: WearEntry[];
  avoid: Record<string, number>;
  drop: DailyDrop | null;
  refPhoto: string | null;
  messages: StylistMessage[];
};

export type ClosetSnapshot = PersistedCloset & { hydrated: boolean };

/** No localStorage writes until rehydrate finishes — empty first tick must not clobber closet.v6. */
export const persistGate = { open: false };

export function mergeClosetPersist<T extends ClosetSnapshot>(
  persisted: unknown,
  current: T,
): T {
  const p = (persisted ?? {}) as Partial<PersistedCloset>;
  const stored = Array.isArray(p.garments) ? p.garments : [];
  // Never replace a non-empty closet with [].
  if (current.garments.length > 0 && stored.length === 0) return current;
  if (stored.length === 0) return current;
  return {
    ...current,
    garments: stored,
    looks: Array.isArray(p.looks) ? p.looks : current.looks,
    journal: Array.isArray(p.journal) ? p.journal : current.journal,
    avoid: p.avoid && typeof p.avoid === "object" ? p.avoid : current.avoid,
    drop: "drop" in p ? (p.drop ?? null) : current.drop,
    refPhoto: "refPhoto" in p ? (p.refPhoto ?? null) : current.refPhoto,
    messages: Array.isArray(p.messages) ? p.messages : current.messages,
  };
}

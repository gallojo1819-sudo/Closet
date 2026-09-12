import type { DailyDrop, Garment, Look, StylistMessage, WearEntry } from "./types.ts";

export type PersistedCloset = {
  garments: Garment[];
  looks: Look[];
  journal: WearEntry[];
  avoid: Record<string, number>;
  drop: DailyDrop | null;
  refPhoto: string | null;
  /** Compressed JPEG data URL so idb:me:ref can be rebuilt if IDB is cleared. */
  refPhotoBackup: string | null;
  messages: StylistMessage[];
};

export type ClosetSnapshot = PersistedCloset & { hydrated: boolean };

/** No localStorage writes until rehydrate finishes — empty first tick must not clobber closet.v6. */
export const persistGate = { open: false };

export function openPersistGate() {
  persistGate.open = true;
}

export function packPersist(state: PersistedCloset): string {
  return JSON.stringify({ state, version: 0 });
}

export function unpackPersist(raw: string | null): PersistedCloset | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { state?: PersistedCloset } | PersistedCloset;
    const state = "state" in parsed && parsed.state ? parsed.state : (parsed as PersistedCloset);
    if (!state || !Array.isArray(state.garments)) return null;
    return state;
  } catch {
    return null;
  }
}

export function persistHasGarments(raw: string | null): boolean {
  const state = unpackPersist(raw);
  return Boolean(state && state.garments.length > 0);
}

export function mergeClosetPersist<T extends ClosetSnapshot>(
  persisted: unknown,
  current: T,
): T {
  const p = (persisted ?? {}) as Partial<PersistedCloset>;
  const stored = Array.isArray(p.garments) ? p.garments : [];
  const refPhoto = "refPhoto" in p ? (p.refPhoto ?? null) : current.refPhoto;
  const refPhotoBackup =
    "refPhotoBackup" in p ? (p.refPhotoBackup ?? null) : current.refPhotoBackup;
  // Never replace a non-empty closet with []. Always keep Joe's photo.
  if (current.garments.length > 0 && stored.length === 0) {
    return { ...current, refPhoto, refPhotoBackup };
  }
  if (stored.length === 0) {
    return { ...current, refPhoto, refPhotoBackup };
  }
  return {
    ...current,
    garments: stored,
    looks: Array.isArray(p.looks) ? p.looks : current.looks,
    journal: Array.isArray(p.journal) ? p.journal : current.journal,
    avoid: p.avoid && typeof p.avoid === "object" ? p.avoid : current.avoid,
    drop: "drop" in p ? (p.drop ?? null) : current.drop,
    refPhoto,
    refPhotoBackup,
    messages: Array.isArray(p.messages) ? p.messages : current.messages,
  };
}

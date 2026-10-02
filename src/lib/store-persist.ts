import { readTombstones } from "./cloud/tombstone.ts";
import { scrubRack } from "./rack.ts";
import { normalizeTaste, type TasteMemory } from "./taste.ts";
import type { DailyDrop, Garment, Look, Occasion, StylistMessage, WearEntry } from "./types.ts";

export type SeenLooks = Record<string, string[]>;

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
  /** Combo keys (sorted garmentIds joined by |) already shown, per chapter. */
  seenLooks?: SeenLooks;
  /** Account memory. Absent on an old closet.v6 until this phone learns. */
  taste?: TasteMemory;
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

/** Synchronous closet.v6 read for the first paint. Does not fetch. */
export function readClosetSeed(raw: string | null, dead: readonly string[] = []): PersistedCloset | null {
  const state = unpackPersist(raw);
  if (!state || state.garments.length === 0) return null;
  if (dead.length === 0) return state;
  const drop = new Set(dead);
  return { ...state, garments: state.garments.filter((g) => !drop.has(g.id)) };
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
  const dead = new Set(readTombstones());
  const keptStored = stored.filter((g) => !dead.has(g.id));
  const keptCurrent = current.garments.filter((g) => !dead.has(g.id));
  // Never replace a non-empty closet with []. Always keep Joe's photo.
  if (keptCurrent.length > 0 && keptStored.length === 0) {
    return { ...current, garments: keptCurrent, refPhoto, refPhotoBackup };
  }
  if (keptStored.length === 0) {
    return { ...current, refPhoto, refPhotoBackup };
  }
  const storedIds = new Set(keptStored.map((g) => g.id));
  const added = keptCurrent.filter((g) => !storedIds.has(g.id));
  const mixed = {
    ...current,
    garments: added.length > 0 ? [...keptStored, ...added] : keptStored,
    looks: Array.isArray(p.looks) ? p.looks : current.looks,
    journal: Array.isArray(p.journal) ? p.journal : current.journal,
    avoid: p.avoid && typeof p.avoid === "object" ? p.avoid : current.avoid,
    drop: "drop" in p ? (p.drop ?? null) : current.drop,
    refPhoto,
    refPhotoBackup,
    messages: Array.isArray(p.messages) ? p.messages : current.messages,
    taste: p.taste && typeof p.taste === "object" ? normalizeTaste(p.taste) : current.taste,
    seenLooks:
      p.seenLooks && typeof p.seenLooks === "object" && !Array.isArray(p.seenLooks)
        ? p.seenLooks
        : current.seenLooks,
  };
  const { purgedIds: _purged, ...clean } = scrubRack(mixed);
  void _purged;
  return clean as T;
}

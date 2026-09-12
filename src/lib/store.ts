import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import {
  clearClosetMeta,
  dataUrlToBlob,
  deleteImage,
  getClosetMeta,
  getImage,
  isIdbKey,
  putClosetMeta,
  putImage,
  refImageKey,
} from "./images";
import { SEED_GARMENTS, SEED_LOOKS } from "./seed";
import { buildLookbook, mergeLookbook } from "./lookbook";
import {
  mergeClosetPersist,
  openPersistGate,
  packPersist,
  persistGate,
  persistHasGarments,
  unpackPersist,
  type PersistedCloset,
} from "./store-persist";
import { daysIdle, defaultOccasion, momentOfDay, pickLook, slotOf } from "./style";
import type { DailyDrop, Garment, Look, Occasion, StylistMessage, WearEntry, WeatherSnap } from "./types";
import { todayISO, uid } from "./utils";

export { mergeClosetPersist, openPersistGate, persistGate };
export type { PersistedCloset };

type ClosetState = {
  garments: Garment[];
  looks: Look[];
  messages: StylistMessage[];
  drop: DailyDrop | null;
  journal: WearEntry[];
  avoid: Record<string, number>;
  hydrated: boolean;
  /** IDB key for Joe's full-body reference photo ("On me"), metadata only. */
  refPhoto: string | null;
  /** Compressed JPEG data URL backup of the body photo. */
  refPhotoBackup: string | null;
  addGarment: (
    g: Omit<Garment, "id" | "createdAt" | "archived" | "wornOn" | "demo"> & { id?: string },
    opts?: { quiet?: boolean },
  ) => string;
  updateGarment: (id: string, patch: Partial<Garment>) => void;
  removeGarment: (id: string) => void;
  wearToday: (ids: string[]) => void;
  skipDrop: () => void;
  saveLook: (look: Omit<Look, "id" | "createdAt">) => string;
  removeLook: (id: string) => void;
  setDrop: (drop: DailyDrop) => void;
  rerollDrop: (
    weather?: WeatherSnap,
    occasion?: Occasion,
    previousIds?: string[],
  ) => void;
  swapDropPiece: (id: string) => void;
  pushMessage: (m: Omit<StylistMessage, "id" | "createdAt">) => void;
  setRefPhoto: (key: string | null, backup?: string | null) => void;
  restoreRefPhoto: () => Promise<void>;
  restoreFromIdbMeta: () => Promise<void>;
  ensureLookbook: (salt?: number) => void;
  loadSample: () => void;
  emptyCloset: () => void;
  importCloset: (payload: {
    garments: Garment[];
    looks: Look[];
    journal: WearEntry[];
    avoid: Record<string, number>;
    drop: DailyDrop | null;
  }) => void;
};

function pickDrop(
  garments: Garment[],
  weather?: WeatherSnap,
  occasion?: Occasion,
  avoid?: Record<string, number>,
  recentWorn?: string[],
  previousIds?: string[],
): string[] {
  return pickLook(garments, {
    weather,
    occasion: occasion ?? defaultOccasion(),
    moment: momentOfDay(),
    avoid,
    recentWorn,
    previousIds,
  });
}

const guardedStorage: StateStorage = {
  getItem: async (name) => {
    let raw: string | null = null;
    if (typeof localStorage !== "undefined") {
      try {
        raw = localStorage.getItem(name);
      } catch {
        raw = null;
      }
    }
    if (persistHasGarments(raw)) {
      openPersistGate();
      return raw;
    }
    try {
      const meta = await getClosetMeta();
      if (meta && Array.isArray(meta.garments) && meta.garments.length > 0) {
        const packed = packPersist(meta as PersistedCloset);
        if (typeof localStorage !== "undefined") {
          try {
            localStorage.setItem(name, packed);
          } catch {
            /* quota */
          }
        }
        openPersistGate();
        return packed;
      }
    } catch {
      /* IDB unavailable */
    }
    openPersistGate();
    return raw;
  },
  setItem: (name, value) => {
    if (!persistGate.open) return;
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(name, value);
      } catch {
        /* quota / private mode */
      }
    }
    const state = unpackPersist(value);
    if (state && state.garments.length > 0) {
      void putClosetMeta(state).catch(() => {});
    }
  },
  removeItem: (name) => {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.removeItem(name);
    } catch {
      /* */
    }
  },
};

export const useCloset = create<ClosetState>()(
  persist(
    (set, get) => ({
      garments: [],
      looks: [],
      messages: [],
      drop: null,
      journal: [],
      avoid: {},
      hydrated: false,
      refPhoto: null,
      refPhotoBackup: null,
      addGarment: (input, opts) => {
        const id = input.id ?? uid("g");
        const garment: Garment = {
          ...input,
          id,
          demo: false,
          archived: false,
          wornOn: [],
          createdAt: new Date().toISOString(),
        };
        set((s) => {
          const replacingDemo = s.garments.some((g) => g.demo);
          const wasEmpty = s.garments.filter((g) => !g.archived && !g.demo).length === 0;
          const rest = replacingDemo ? s.garments.filter((g) => !g.demo) : s.garments;
          const garments = [garment, ...rest];
          const allowed = new Set(garments.map((g) => g.id));
          return {
            garments,
            looks: replacingDemo
              ? s.looks.filter((l) => l.garmentIds.every((gid) => allowed.has(gid)))
              : s.looks,
            drop: replacingDemo || wasEmpty ? null : s.drop,
            journal: replacingDemo ? [] : s.journal,
            avoid: replacingDemo ? {} : s.avoid,
          };
        });
        if (!opts?.quiet) get().ensureLookbook();
        return id;
      },
      updateGarment: (id, patch) => {
        set((s) => ({
          garments: s.garments.map((g) => (g.id === id ? { ...g, ...patch } : g)),
        }));
        get().ensureLookbook();
      },
      removeGarment: (id) => {
        const g = get().garments.find((x) => x.id === id);
        for (const src of [g?.imageSrc, g?.cutoutSrc]) {
          if (isIdbKey(src)) void deleteImage(src).catch(() => {});
        }
        set((s) => ({
          garments: s.garments.filter((g) => g.id !== id),
          looks: s.looks.map((l) => ({
            ...l,
            garmentIds: l.garmentIds.filter((gid) => gid !== id),
          })),
          drop: s.drop
            ? {
                ...s.drop,
                garmentIds: s.drop.garmentIds.filter((gid) => gid !== id),
              }
            : s.drop,
        }));
        get().ensureLookbook();
      },
      wearToday: (ids) => {
        const day = todayISO();
        const drop = get().drop;
        set((s) => {
          const avoid = { ...s.avoid };
          for (const id of ids) delete avoid[id];
          const entry: WearEntry = {
            date: day,
            garmentIds: ids,
            verdict: "worn",
            occasion: drop?.occasion,
          };
          return {
            garments: s.garments.map((g) =>
              ids.includes(g.id) && !g.wornOn.includes(day)
                ? { ...g, wornOn: [...g.wornOn, day] }
                : g,
            ),
            drop: s.drop ? { ...s.drop, worn: true, verdict: "worn" } : s.drop,
            journal: [entry, ...s.journal.filter((j) => j.date !== day)].slice(0, 60),
            avoid,
          };
        });
      },
      skipDrop: () => {
        const drop = get().drop;
        if (!drop || drop.worn) return;
        const skipped = drop.garmentIds;
        const avoid = { ...get().avoid };
        for (const id of skipped) avoid[id] = (avoid[id] ?? 0) + 1;
        const entry: WearEntry = {
          date: todayISO(),
          garmentIds: skipped,
          verdict: "skipped",
          occasion: drop.occasion,
        };
        set({
          avoid,
          journal: [entry, ...get().journal.filter((j) => j.date !== todayISO())].slice(0, 60),
        });
        // previousIds is this reroll only — avoid stays capped, not an exile.
        get().rerollDrop(drop.weather, drop.occasion, skipped);
      },
      saveLook: (look) => {
        const id = uid("l");
        set((s) => ({
          looks: [{ ...look, id, createdAt: new Date().toISOString() }, ...s.looks],
        }));
        return id;
      },
      removeLook: (id) => set((s) => ({ looks: s.looks.filter((l) => l.id !== id) })),
      setDrop: (drop) => set({ drop }),
      rerollDrop: (weather, occasion, previousIds) => {
        const occ = occasion ?? get().drop?.occasion ?? defaultOccasion();
        const moment = momentOfDay();
        const lastWorn = get().journal.find((j) => j.verdict === "worn")?.garmentIds;
        const ids = pickDrop(
          get().garments,
          weather ?? get().drop?.weather,
          occ,
          get().avoid,
          lastWorn,
          previousIds,
        );
        set({
          drop: {
            date: todayISO(),
            garmentIds: ids,
            worn: false,
            verdict: "pending",
            weather: weather ?? get().drop?.weather,
            occasion: occ,
            moment,
          },
        });
      },
      swapDropPiece: (id) => {
        const drop = get().drop;
        if (!drop) return;
        const current = get().garments.find((g) => g.id === id);
        if (!current) return;
        const used = new Set(drop.garmentIds);
        const slot = slotOf(current) ?? current.category;
        const pool = get()
          .garments.filter(
            (g) =>
              !g.archived &&
              (!g.demo || current.demo) &&
              (slotOf(g) ?? g.category) === slot &&
              !used.has(g.id),
          )
          .sort((a, b) => daysIdle(b) - daysIdle(a));
        const next = pool[0];
        if (!next) return;
        set({
          avoid: { ...get().avoid, [id]: (get().avoid[id] ?? 0) + 1 },
          drop: {
            ...drop,
            worn: false,
            verdict: "pending",
            garmentIds: drop.garmentIds.map((gid) => (gid === id ? next.id : gid)),
          },
        });
      },
      pushMessage: (m) =>
        set((s) => ({
          messages: [
            ...s.messages,
            { ...m, id: uid("m"), createdAt: new Date().toISOString() },
          ],
        })),
      ensureLookbook: (salt) => {
        const s = get();
        if (!s.hydrated) return;
        if (s.garments.length === 0) return;
        const book = buildLookbook(s.garments, undefined, salt ?? 0);
        const next = mergeLookbook(s.looks, book);
        const key = (looks: Look[]) =>
          looks.map((l) => `${l.lookbook ? "b" : "k"}:${l.id}`).join("|");
        if (key(s.looks) === key(next)) return;
        set({ looks: next });
      },
      setRefPhoto: (key, backup) => {
        if (key === null) {
          const prev = get().refPhoto;
          if (prev && isIdbKey(prev)) void deleteImage(prev).catch(() => {});
          set({ refPhoto: null, refPhotoBackup: null });
          return;
        }
        set({
          refPhoto: key,
          ...(backup !== undefined ? { refPhotoBackup: backup } : {}),
        });
      },
      restoreFromIdbMeta: async () => {
        if (get().garments.length > 0) return;
        const meta = await getClosetMeta();
        if (!meta || !Array.isArray(meta.garments) || meta.garments.length === 0) return;
        set({
          garments: meta.garments as Garment[],
          looks: Array.isArray(meta.looks) ? (meta.looks as Look[]) : get().looks,
          journal: Array.isArray(meta.journal) ? (meta.journal as WearEntry[]) : get().journal,
          avoid:
            meta.avoid && typeof meta.avoid === "object"
              ? (meta.avoid as Record<string, number>)
              : get().avoid,
          drop: "drop" in meta ? ((meta.drop as DailyDrop | null) ?? null) : get().drop,
          refPhoto:
            typeof meta.refPhoto === "string" || meta.refPhoto === null
              ? (meta.refPhoto as string | null)
              : get().refPhoto,
          refPhotoBackup:
            typeof meta.refPhotoBackup === "string" || meta.refPhotoBackup === null
              ? (meta.refPhotoBackup as string | null)
              : get().refPhotoBackup,
          messages: Array.isArray(meta.messages)
            ? (meta.messages as StylistMessage[])
            : get().messages,
        });
      },
      restoreRefPhoto: async () => {
        const s = get();
        const key = s.refPhoto && isIdbKey(s.refPhoto) ? s.refPhoto : refImageKey();
        try {
          const existing = await getImage(key);
          if (existing) {
            if (s.refPhoto !== key) set({ refPhoto: key });
            return;
          }
        } catch {
          /* fall through to backup */
        }
        const backup = s.refPhotoBackup;
        if (!backup || !backup.startsWith("data:")) return;
        try {
          await putImage(refImageKey(), dataUrlToBlob(backup));
          set({ refPhoto: refImageKey() });
        } catch {
          /* IDB still unavailable */
        }
      },
      loadSample: () => {
        set({
          garments: SEED_GARMENTS,
          looks: SEED_LOOKS,
          messages: [],
          drop: null,
          journal: [],
          avoid: {},
        });
        get().ensureLookbook();
      },
      emptyCloset: () => {
        set({
          garments: [],
          looks: [],
          messages: [],
          drop: null,
          journal: [],
          avoid: {},
        });
        void clearClosetMeta().catch(() => {});
        // Joe's body photo stays. Only Fit → Remove deletes it.
      },
      importCloset: (payload) => {
        set({
          garments: payload.garments,
          looks: payload.looks,
          journal: payload.journal,
          avoid: payload.avoid,
          drop: payload.drop,
        });
        get().ensureLookbook();
      },
    }),
    {
      name: "closet.v6",
      skipHydration: true,
      storage: createJSONStorage(() => guardedStorage),
      partialize: (s): PersistedCloset => ({
        garments: s.garments,
        looks: s.looks,
        journal: s.journal,
        avoid: s.avoid,
        drop: s.drop,
        refPhoto: s.refPhoto,
        refPhotoBackup: s.refPhotoBackup,
        messages: s.messages,
      }),
      merge: (persisted, current) => mergeClosetPersist(persisted, current),
      onRehydrateStorage: () => (_state, error) => {
        if (error) console.error("[closet] rehydrate failed", error);
        openPersistGate();
      },
    },
  ),
);

export { pickDrop };

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import {
  clearClosetMeta,
  dataUrlToBlob,
  deleteImage,
  getClosetMeta,
  getImage,
  imageKey,
  isIdbKey,
  putClosetMeta,
  putImage,
  refImageKey,
  resolveImage,
} from "./images";
import { SEED_GARMENTS, SEED_LOOKS } from "./seed";
import {
  applyShuffle,
  buildChapter,
  capChapterLooks,
  CHAPTER_CAP,
  comboKey,
  enforcePieceCap,
  fillOccasionLooks,
  lookFitsHouse,
  seenKey,
  stripRepeatBlazers,
} from "./lookbook";
import { isFakeName, nameFromPixels, scrubRack } from "./rack";
import { lookFitsSeason } from "./season";
import { preferPixels, sampleCover } from "./color";
import {
  mergeClosetPersist,
  openPersistGate,
  packPersist,
  persistGate,
  persistHasGarments,
  unpackPersist,
  type PersistedCloset,
  type SeenLooks,
} from "./store-persist";
import {
  daysIdle,
  defaultOccasion,
  momentOfDay,
  pickLook,
  slotOf,
  weekUniformKeys,
  type House,
} from "./style";
import { mapOccasion, OCCASIONS, type DailyDrop, type Garment, type Look, type Occasion, type Season, type StylistMessage, type WearEntry, type WeatherSnap } from "./types";
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
  /** Combo keys shown in Lookbook, per chapter. closet.v6 extra. */
  seenLooks: SeenLooks;
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
  removeDropPiece: (id: string) => void;
  toggleLock: (id: string) => void;
  pushMessage: (m: Omit<StylistMessage, "id" | "createdAt">) => void;
  setRefPhoto: (key: string | null, backup?: string | null) => void;
  restoreRefPhoto: () => Promise<void>;
  restoreFromIdbMeta: () => Promise<void>;
  purgeDemoRack: () => void;
  retitleFakeNames: () => Promise<void>;
  ensureLookbook: (salt?: number) => void;
  ensureOccasionBook: (occasion: Occasion, season?: Season, house?: House) => void;
  shuffleChapter: (occasion: Occasion, season?: Season, house?: House) => number;
  resetChapter: (occasion: Occasion, season?: Season, house?: House) => void;
  markSeen: (occasion: Occasion, keys: string[], house?: House) => void;
  keepLook: (id: string, patch?: { garmentIds?: string[]; name?: string }) => void;
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
  lockedIds?: string[],
  repeatPairs?: Set<string>,
): string[] {
  return pickLook(garments, {
    weather,
    occasion: occasion ?? defaultOccasion(),
    moment: momentOfDay(),
    avoid,
    recentWorn,
    previousIds,
    lockedIds,
    repeatPairs,
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
      seenLooks: {},
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
      },
      removeGarment: (id) => {
        const g = get().garments.find((x) => x.id === id);
        for (const src of [g?.imageSrc, g?.cutoutSrc, g ? imageKey(g.id, "t") : ""]) {
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
        const locked = new Set(drop.lockedIds ?? []);
        for (const id of skipped) {
          if (!locked.has(id)) avoid[id] = (avoid[id] ?? 0) + 1;
        }
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
        get().rerollDrop(
          drop.weather,
          drop.occasion,
          skipped.filter((id) => !locked.has(id)),
        );
      },
      saveLook: (look) => {
        const id = uid("l");
        const occasion = mapOccasion(look.occasion);
        set((s) => ({
          looks: [
            {
              ...look,
              id,
              occasion,
              source: "manual",
              lookbook: true,
              createdAt: new Date().toISOString(),
            },
            ...s.looks,
          ],
        }));
        return id;
      },
      keepLook: (id, patch) => {
        set((s) => ({
          looks: s.looks.map((l) =>
            l.id === id
              ? {
                  ...l,
                  source: "manual" as const,
                  lookbook: true,
                  occasion: mapOccasion(l.occasion),
                  ...(patch?.garmentIds ? { garmentIds: patch.garmentIds } : {}),
                  ...(patch?.name ? { name: patch.name } : {}),
                }
              : l,
          ),
        }));
      },
      removeLook: (id) => set((s) => ({ looks: s.looks.filter((l) => l.id !== id) })),
      setDrop: (drop) => set({ drop }),
      rerollDrop: (weather, occasion, previousIds) => {
        const prev = get().drop;
        const occ = mapOccasion(occasion ?? prev?.occasion ?? defaultOccasion());
        const moment = momentOfDay();
        const lastWorn = get().journal.find((j) => j.verdict === "worn")?.garmentIds;
        const sameDay = prev?.date === todayISO();
        const lockedIds = sameDay ? (prev?.lockedIds ?? []) : [];
        const repeats = weekUniformKeys(get().journal, get().garments);
        const ids = pickDrop(
          get().garments,
          weather ?? prev?.weather,
          occ,
          get().avoid,
          lastWorn,
          previousIds,
          lockedIds,
          repeats,
        );
        let lockNote: string | null = null;
        if (lockedIds.length && previousIds?.length) {
          const unlockedPrev = previousIds.filter((id) => !lockedIds.includes(id));
          const unlockedNext = ids.filter((id) => !lockedIds.includes(id));
          const moved = unlockedPrev.some((id) => !unlockedNext.includes(id));
          if (moved) {
            const names = lockedIds
              .map((id) => get().garments.find((g) => g.id === id)?.name)
              .filter((n): n is string => Boolean(n));
            if (names.length) {
              lockNote = `Locked: ${names.join(", ")} — rest of the look moved.`;
            }
          }
        }
        set({
          drop: {
            date: todayISO(),
            garmentIds: ids,
            worn: false,
            verdict: "pending",
            weather: weather ?? prev?.weather,
            occasion: occ,
            moment,
            lockedIds,
            lockNote,
          },
        });
      },
      toggleLock: (id) => {
        const drop = get().drop;
        if (!drop || !drop.garmentIds.includes(id)) return;
        const locked = new Set(drop.lockedIds ?? []);
        if (locked.has(id)) locked.delete(id);
        else locked.add(id);
        set({
          drop: { ...drop, lockedIds: [...locked], lockNote: drop.lockNote ?? null },
        });
      },
      removeDropPiece: (id) => {
        const drop = get().drop;
        if (!drop) return;
        if (drop.garmentIds.length <= 2) return;
        if (!drop.garmentIds.includes(id)) return;
        const locked = (drop.lockedIds ?? []).filter((x) => x !== id);
        set({
          drop: {
            ...drop,
            garmentIds: drop.garmentIds.filter((gid) => gid !== id),
            lockedIds: locked,
          },
        });
      },
      swapDropPiece: (id) => {
        const drop = get().drop;
        if (!drop) return;
        if ((drop.lockedIds ?? []).includes(id)) return;
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
      ensureLookbook: () => {
        const s = get();
        if (!s.hydrated) return;
        if (s.garments.length === 0) return;
        let looks = enforcePieceCap(
          stripRepeatBlazers(capChapterLooks(s.looks), s.garments),
          s.garments,
        );
        const seenLooks: SeenLooks = { ...s.seenLooks };
        for (const { id: occ } of OCCASIONS) {
          const chapter = looks.filter((l) => mapOccasion(l.occasion) === occ);
          const auto = chapter.filter((l) => l.lookbook && l.source !== "manual");
          if (auto.length >= CHAPTER_CAP) continue;
          const exclude = new Set([
            ...(seenLooks[occ] ?? []),
            ...chapter.map((l) => comboKey(l.garmentIds)),
          ]);
          const usedCount = new Map<string, number>();
          for (const l of chapter) {
            for (const id of l.garmentIds) usedCount.set(id, (usedCount.get(id) ?? 0) + 1);
          }
          const extra = buildChapter(s.garments, occ, {
            exclude,
            cap: CHAPTER_CAP - auto.length,
            usedCount,
          });
          looks = [...looks, ...extra];
          if (extra.length) {
            seenLooks[occ] = [
              ...new Set([
                ...(seenLooks[occ] ?? []),
                ...extra.map((l) => comboKey(l.garmentIds)),
              ]),
            ];
          }
        }
        const key = (list: Look[]) =>
          list.map((l) => `${l.lookbook ? "b" : "k"}:${l.id}:${l.occasion}`).join("|");
        if (key(s.looks) === key(looks)) return;
        set({ looks, seenLooks });
      },
      ensureOccasionBook: (occasion, season, house) => {
        const s = get();
        if (!s.hydrated) return;
        const occ = mapOccasion(occasion);
        const trimmed = enforcePieceCap(
          stripRepeatBlazers(s.looks, s.garments),
          s.garments,
        );
        const byId = new Map(s.garments.map((g) => [g.id, g]));
        const fitting = trimmed.filter((l) => {
          if (!l.lookbook || mapOccasion(l.occasion) !== occ) return false;
          const pieces = l.garmentIds
            .map((id) => byId.get(id))
            .filter((g): g is Garment => Boolean(g));
          if (pieces.length < 3) return false;
          if (house && !lookFitsHouse(pieces, house, occ, s.garments)) return false;
          return true;
        });
        if (fitting.length >= CHAPTER_CAP) {
          if (trimmed.length !== s.looks.length) set({ looks: trimmed });
          return;
        }
        const bucket = seenKey(occ, house);
        let extra = fillOccasionLooks(
          s.garments,
          trimmed,
          occ,
          Math.max(3, CHAPTER_CAP),
          new Set(s.seenLooks[bucket] ?? []),
          undefined,
          house,
        );
        if (fitting.length + extra.length < 3 && house) {
          extra = [
            ...extra,
            ...fillOccasionLooks(
              s.garments,
              [...trimmed, ...extra],
              occ,
              3,
              new Set(s.seenLooks[bucket] ?? []),
            ),
          ];
        }
        if (!extra.length) {
          if (trimmed.length !== s.looks.length) set({ looks: trimmed });
          return;
        }
        set({
          looks: [...trimmed, ...extra],
          seenLooks: {
            ...s.seenLooks,
            [bucket]: [
              ...new Set([
                ...(s.seenLooks[bucket] ?? []),
                ...extra.map((l) => comboKey(l.garmentIds)),
              ]),
            ],
          },
        });
      },
      shuffleChapter: (occasion, season, house) => {
        const s = get();
        const occ = mapOccasion(occasion);
        const bucket = seenKey(occ, house);
        let next = applyShuffle(
          s.garments,
          s.looks,
          occ,
          s.seenLooks[bucket] ?? [],
          undefined,
          undefined,
          house,
        );
        if (next.added.length === 0) {
          next = applyShuffle(s.garments, s.looks, occ, [], undefined, undefined, house);
        }
        set({
          looks: next.looks,
          seenLooks: { ...s.seenLooks, [bucket]: next.seen },
        });
        return next.added.length;
      },
      resetChapter: (occasion, season, house) => {
        const s = get();
        const occ = mapOccasion(occasion);
        const bucket = seenKey(occ, house);
        const next = applyShuffle(s.garments, s.looks, occ, [], undefined, season, house);
        set({
          looks: next.looks,
          seenLooks: { ...s.seenLooks, [bucket]: next.seen },
        });
      },
      markSeen: (occasion, keys, house) => {
        const occ = mapOccasion(occasion);
        const bucket = seenKey(occ, house);
        set((s) => {
          const prev = s.seenLooks[bucket] ?? [];
          const merged = [...new Set([...prev, ...keys])];
          if (merged.length === prev.length) return s;
          return { seenLooks: { ...s.seenLooks, [bucket]: merged } };
        });
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
      purgeDemoRack: () => {
        const s = get();
        const next = scrubRack(s);
        for (const id of next.purgedIds) {
          for (const kind of ["o", "c", "t"] as const) {
            void deleteImage(imageKey(id, kind)).catch(() => {});
          }
        }
        const { purgedIds, ...rest } = next;
        void purgedIds;
        if (
          rest.garments.length !== s.garments.length ||
          rest.looks.length !== s.looks.length
        ) {
          set(rest);
        }
      },
      retitleFakeNames: async () => {
        const list = get().garments;
        for (const g of list) {
          if (g.demo === true || !isFakeName(g.name)) continue;
          let colors = g.colors;
          try {
            const src = g.cutoutSrc || g.imageSrc;
            const url = await resolveImage(src);
            if (url) {
              const sampled = await sampleCover(url);
              colors = preferPixels(sampled, g.colors);
            }
          } catch {
            /* pixels optional */
          }
          const name = nameFromPixels(g, colors);
          if (name && name !== g.name) {
            get().updateGarment(g.id, {
              name,
              colors: colors.length ? colors : g.colors,
            });
          }
        }
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
          seenLooks:
            meta.seenLooks && typeof meta.seenLooks === "object"
              ? (meta.seenLooks as SeenLooks)
              : get().seenLooks,
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
        get().purgeDemoRack();
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
          seenLooks: {},
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
          seenLooks: {},
        });
        void clearClosetMeta().catch(() => {});
        // Joe's body photo stays. Only Fit → Remove deletes it.
      },
      importCloset: (payload) => {
        const next = scrubRack({
          garments: payload.garments,
          looks: payload.looks,
          journal: payload.journal,
          drop: payload.drop,
        });
        const { purgedIds, ...rest } = next;
        void purgedIds;
        set({
          garments: rest.garments,
          looks: rest.looks,
          journal: rest.journal,
          avoid: payload.avoid,
          drop: rest.drop,
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
        seenLooks: s.seenLooks,
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

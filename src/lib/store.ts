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
  buildReshuffleRow,
  buildWeek,
  CHAPTER_CAP,
  comboKey,
  rackCanDress,
  enforcePieceCap,
  fillOccasionLooks,
  lookbookIsFrozen,
  lookCountMap,
  mergeWeekLooks,
  mondayISO,
  seenKey,
  stripRepeatBlazers,
} from "./lookbook";
import { isFakeName, nameFromPixels, scrubRack } from "./rack";
import { preferPixels, sampleCover } from "./color";
import {
  mergeClosetPersist,
  openPersistGate,
  packPersist,
  persistGate,
  persistHasGarments,
  readClosetSeed,
  unpackPersist,
  type PersistedCloset,
  type SeenLooks,
} from "./store-persist";
import {
  coreComboKey,
  defaultOccasion,
  lastWornDays,
  isMulePiece,
  momentOfDay,
  pickLook,
  slotOf,
  todayOccasion,
  weekUniformKeys,
  type House,
} from "./style";
import { isLinenCampPiece, seasonFromWeather } from "./season";
import { isLegal, missingJacketOnly } from "./stylist/legal";
import { jacketRequired } from "./stylist/jackets";
import { mapOccasion, type DailyDrop, type Garment, type Look, type Occasion, type Season, type StylistMessage, type WearEntry, type WeatherSnap } from "./types";
import { isAccountSignedIn } from "./cloud/account";
import { forgetCoverSha } from "./cloud/blobs";
import { noteRefPhotoEdit, noteUserEdit } from "./cloud/edit";
import { addLookTombstone, addTombstone, readTombstones } from "./cloud/tombstone";
import { allowSampleRack } from "./cloud/home";
import { EMPTY_ACCOUNT_CONFIRM } from "./cloud/copy";
import { dressThisPiece } from "./dress";
import { notifyGarmentRemoved, notifyLookRemoved, notifyLookSaved } from "./data/v2-port";
import {
  emptyTaste,
  learnFromLock,
  learnFromSkip,
  logWear,
  normalizeTaste,
  type TasteMemory,
} from "./taste";
import { todayISO, uid } from "./utils";

export { mergeClosetPersist, openPersistGate, persistGate };
export type { PersistedCloset };

type ClosetState = {
  garments: Garment[];
  looks: Look[];
  messages: StylistMessage[];
  /** Learned on this account. Empty until the closet earns it. */
  taste: TasteMemory;
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
  updateGarment: (id: string, patch: Partial<Garment>, opts?: { quiet?: boolean }) => void;
  removeGarment: (id: string) => void;
  wearToday: (ids: string[]) => void;
  skipDrop: () => void;
  saveLook: (look: Omit<Look, "id" | "createdAt">) => string;
  removeLook: (id: string) => void;
  setDrop: (drop: DailyDrop) => void;
  /** True when a new look was written. Never writes an empty drop. */
  rerollDrop: (
    weather?: WeatherSnap,
    occasion?: Occasion,
    previousIds?: string[],
  ) => boolean;
  swapDropPiece: (id: string) => void;
  removeDropPiece: (id: string) => void;
  toggleLock: (id: string) => void;
  pushMessage: (m: Omit<StylistMessage, "id" | "createdAt">) => string;
  stampMessage: (id: string, patch: Partial<Pick<StylistMessage, "lookId" | "text" | "garmentIds" | "draftName" | "draftOccasion" | "technique">>) => void;
  setTaste: (taste: TasteMemory) => void;
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
  outfitWith: (lockedIds: string[], occasion?: Occasion, house?: House) => Look | null;
  thisWeek: Look[];
  skipCount: number;
  reshuffleCount: number;
  reshuffleWeek: (house?: House, occasion?: Occasion, season?: Season) => number;
  /** Memory-only weekday row for the Today strip. Does not touch looks or closet.v6. */
  fillThisWeek: (season?: Season) => number;
  loadSample: () => void;
  emptyCloset: (opts?: { sample?: boolean }) => void;
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
  extra?: {
    salt?: number;
    usedCount?: Map<string, number>;
    excludeKeys?: string[];
    skip?: boolean;
    taste?: TasteMemory;
  },
  now: Date = new Date(),
): string[] {
  const occ = occasion ?? defaultOccasion(now);
  /* A measured reading only. A missing reading stays missing; pickLook's 68 is for scoring. */
  const tempF = weather?.measured ? weather.f : undefined;
  const season = seasonFromWeather(weather?.f, now);
  const cold = season === "fall" || season === "winter";
  const ctx = { occasion: occ, season, ...(tempF !== undefined ? { weatherF: tempF } : {}) };
  const needJacket = jacketRequired(occ, season, tempF);
  return pickLook(garments, {
    weather,
    occasion: occ,
    moment: momentOfDay(now),
    requireOuter: needJacket,
    avoid,
    recentWorn,
    previousIds,
    lockedIds,
    repeatPairs,
    salt: extra?.salt ?? 1,
    usedCount: extra?.usedCount,
    excludeKeys: extra?.excludeKeys,
    minSlotChange: extra?.skip ? 2 : 0,
    requireSilhouetteChange: Boolean(extra?.skip),
    taste: extra?.taste,
    legalCombo: (pieces) => {
      if (
        cold &&
        pieces.some(
          (g) =>
            isMulePiece(g) ||
            isLinenCampPiece(g) ||
            ((g.seasons?.length ?? 0) > 0 && g.seasons.every((s) => s === "summer")),
        )
      ) {
        return false;
      }
      if (isLegal(pieces, ctx)) return true;
      /* A bare core whose only hard miss is the jacket still gets one. Same pattern as the matrix. */
      return needJacket && !pieces.some((g) => slotOf(g) === "outerwear") && missingJacketOnly(pieces, ctx);
    },
  });
}

/** Marks a drop the user set on this device. Stamped only while the persist gate is open. */
function stampDrop<T extends DailyDrop>(drop: T): T {
  return persistGate.open ? { ...drop, setAt: new Date().toISOString() } : drop;
}

function liveCount(ids: readonly string[], garments: Garment[]): number {
  return ids.filter((id) => garments.some((g) => g.id === id && !g.archived)).length;
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

function bootCloset(): PersistedCloset | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return readClosetSeed(localStorage.getItem("closet.v6"), readTombstones());
  } catch {
    return null;
  }
}

export const useCloset = create<ClosetState>()(
  persist(
    (set, get) => {
      const seed = bootCloset();
      return {
      garments: seed?.garments ?? [],
      looks: seed?.looks ?? [],
      messages: seed?.messages ?? [],
      taste: seed?.taste ? normalizeTaste(seed.taste) : emptyTaste(),
      drop: seed?.drop ?? null,
      journal: seed?.journal ?? [],
      avoid: seed?.avoid ?? {},
      hydrated: false,
      refPhoto: seed?.refPhoto ?? null,
      refPhotoBackup: seed?.refPhotoBackup ?? null,
      seenLooks: seed?.seenLooks ?? {},
      thisWeek: [],
      skipCount: 0,
      reshuffleCount: 0,
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
        noteUserEdit();
        return id;
      },
      updateGarment: (id, patch, opts) => {
        if ("cutoutSrc" in patch) forgetCoverSha(id);
        set((s) => ({
          garments: s.garments.map((g) => (g.id === id ? { ...g, ...patch } : g)),
        }));
        if (!opts?.quiet) noteUserEdit();
      },
      removeGarment: (id) => {
        const g = get().garments.find((x) => x.id === id);
        for (const src of [g?.imageSrc, g?.cutoutSrc, g ? imageKey(g.id, "t") : ""]) {
          if (isIdbKey(src)) void deleteImage(src).catch(() => {});
        }
        addTombstone(id);
        const strip = (ids: string[]) => ids.filter((gid) => gid !== id);
        set((s) => ({
          garments: s.garments.filter((g) => g.id !== id),
          looks: s.looks
            .map((l) => ({ ...l, garmentIds: strip(l.garmentIds) }))
            .filter((l) => l.garmentIds.length >= 2),
          thisWeek: s.thisWeek
            .map((l) => ({ ...l, garmentIds: strip(l.garmentIds) }))
            .filter((l) => l.garmentIds.length >= 2),
          journal: s.journal
            .map((j) => ({ ...j, garmentIds: strip(j.garmentIds) }))
            .filter((j) => j.garmentIds.length > 0),
          avoid: Object.fromEntries(Object.entries(s.avoid).filter(([gid]) => gid !== id)),
          drop: s.drop
            ? (() => {
                const garmentIds = strip(s.drop.garmentIds);
                const lockedIds = strip(s.drop.lockedIds ?? []);
                if (garmentIds.length < 2) return null;
                return { ...s.drop, garmentIds, lockedIds };
              })()
            : s.drop,
        }));
        noteUserEdit();
        notifyGarmentRemoved(id);
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
            drop: s.drop ? stampDrop({ ...s.drop, worn: true, verdict: "worn" }) : s.drop,
            journal: [entry, ...s.journal.filter((j) => j.date !== day)].slice(0, 60),
            avoid,
            taste: logWear(s.taste ?? emptyTaste(), s.garments, ids, Date.now()),
          };
        });
        noteUserEdit();
      },
      skipDrop: () => {
        const drop = get().drop;
        if (drop?.worn) return;
        if (!drop || drop.date !== todayISO() || liveCount(drop.garmentIds, get().garments) < 2) {
          /* Nothing real to skip. Make today's drop; log no skip. */
          get().rerollDrop(drop?.weather, todayOccasion(drop));
          noteUserEdit();
          return;
        }
        const before = {
          avoid: get().avoid,
          journal: get().journal,
          skipCount: get().skipCount,
          taste: get().taste,
        };
        try {
          const skipped = drop.garmentIds;
          const avoid = { ...before.avoid };
          const locked = new Set(drop.lockedIds ?? []);
          for (const id of skipped) {
            if (!locked.has(id)) avoid[id] = (avoid[id] ?? 0) + 1;
          }
          const entry: WearEntry = {
            date: todayISO(),
            garmentIds: skipped,
            verdict: "skipped",
            occasion: todayOccasion(drop),
          };
          set({
            avoid,
            journal: [entry, ...before.journal.filter((j) => j.date !== todayISO())].slice(0, 60),
            skipCount: before.skipCount + 1,
            taste: learnFromSkip(before.taste ?? emptyTaste(), skipped, get().garments, Date.now()),
          });
          const wrote = get().rerollDrop(drop.weather, todayOccasion(drop), skipped);
          if (!wrote) {
            /* The look stays, and its lockNote says so. No skip was taken. */
            set(before);
            return;
          }
          noteUserEdit();
        } catch {
          set({
            ...before,
            drop: stampDrop({
              ...get().drop!,
              lockNote: "Couldn't reshuffle — try again.",
            }),
          });
        }
      },
      saveLook: (look) => {
        const id = uid("l");
        const occasion = mapOccasion(look.occasion);
        const saved = {
          ...look,
          id,
          occasion,
          source: look.source ?? "manual",
          lookbook: look.lookbook ?? true,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ looks: [saved, ...s.looks] }));
        noteUserEdit();
        notifyLookSaved({
          id: saved.id,
          name: saved.name,
          occasion: saved.occasion,
          source: saved.source,
          lookbook: saved.lookbook ?? true,
          garmentIds: saved.garmentIds,
        });
        return id;
      },
      outfitWith: (lockedIds, occasion, house) => {
        const s = get();
        const dressed = dressThisPiece({
          lockedIds,
          garments: s.garments,
          looks: s.looks,
          occasion: occasion ?? s.drop?.occasion ?? "out",
          weather: s.drop?.weather,
          journal: s.journal,
          house,
          taste: s.taste,
        });
        if (!dressed) return null;
        const star =
          dressed.pieces.find((g) => dressed.lockedIds.includes(g.id)) ??
          dressed.pieces[0]!;
        const key = comboKey(dressed.garmentIds).replace(/\|/g, "_");
        return {
          id: `draft_${key}`,
          name: `${star.name} · ${dressed.occasion}`,
          occasion: dressed.occasion,
          garmentIds: dressed.garmentIds,
          source: "ai",
          lookbook: false,
          createdAt: new Date().toISOString(),
        };
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
        noteUserEdit();
      },
      removeLook: (id) => {
        addLookTombstone(id);
        set((s) => ({ looks: s.looks.filter((l) => l.id !== id) }));
        noteUserEdit();
        notifyLookRemoved(id);
      },
      setDrop: (drop) => set({ drop: stampDrop(drop) }),
      rerollDrop: (weather, occasion, previousIds) => {
        const prev = get().drop;
        const occ = mapOccasion(
          occasion ?? (prev?.date === todayISO() ? prev?.occasion : undefined) ?? defaultOccasion(),
        );
        const moment = momentOfDay();
        const lastWorn = get().journal.find((j) => j.verdict === "worn")?.garmentIds;
        const sameDay = prev?.date === todayISO();
        const lockedIds = sameDay ? (prev?.lockedIds ?? []) : [];
        const repeats = weekUniformKeys(get().journal, get().garments);
        const weekKeys = get()
          .thisWeek.slice(0, 6)
          .map((l) => comboKey(l.garmentIds));
        const wornKeys = get()
          .journal.filter((j) => j.verdict === "worn")
          .slice(0, 7)
          .map((j) => comboKey(j.garmentIds));
        const skipKeys = get()
          .journal.filter((j) => j.verdict === "skipped")
          .slice(0, 7)
          .map((j) => comboKey(j.garmentIds));
        const currentKey = prev?.garmentIds?.length ? comboKey(prev.garmentIds) : "";
        const currentCore = prev?.garmentIds?.length
          ? coreComboKey(prev.garmentIds, get().garments)
          : "";
        const skip = Boolean(previousIds?.length);
        const salt = skip ? get().skipCount || 1 : get().reshuffleCount || 1;
        const ids = pickDrop(
          get().garments,
          weather ?? prev?.weather,
          occ,
          get().avoid,
          lastWorn,
          previousIds,
          lockedIds,
          repeats,
          {
            salt,
            usedCount: lookCountMap(get().looks),
            excludeKeys: [...weekKeys, ...wornKeys, ...skipKeys, currentKey, currentCore].filter(
              Boolean,
            ),
            skip,
            taste: get().taste,
          },
        );
        const picked = ids
          .map((id) => get().garments.find((g) => g.id === id))
          .filter((g): g is Garment => Boolean(g));
        const hasCore =
          picked.some((g) => slotOf(g) === "top" || slotOf(g) === "dress") &&
          picked.some((g) => slotOf(g) === "bottom") &&
          picked.some((g) => slotOf(g) === "footwear");
        if (!hasCore) {
          /* Nothing legal. Never save an empty drop. Today's sound look stays, on the asked occasion. */
          if (prev && sameDay && liveCount(prev.garmentIds, get().garments) >= 2) {
            set({
              drop: stampDrop({
                ...prev,
                occasion: occ,
                weather: weather ?? prev.weather,
                lockNote: "No other look fits right now. This one stays.",
              }),
            });
          }
          return false;
        }
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
          drop: stampDrop({
            date: todayISO(),
            garmentIds: ids,
            worn: false,
            verdict: "pending",
            weather: weather ?? prev?.weather,
            occasion: occ,
            moment,
            lockedIds,
            lockNote,
          }),
        });
        return true;
      },
      toggleLock: (id) => {
        const drop = get().drop;
        if (!drop || !drop.garmentIds.includes(id)) return;
        const locked = new Set(drop.lockedIds ?? []);
        const locking = !locked.has(id);
        if (locking) locked.add(id);
        else locked.delete(id);
        const piece = get().garments.find((g) => g.id === id);
        const taste =
          locking && piece
            ? learnFromLock(get().taste ?? emptyTaste(), piece, drop.garmentIds, get().garments, Date.now())
            : get().taste;
        set({
          drop: stampDrop({ ...drop, lockedIds: [...locked], lockNote: drop.lockNote ?? null }),
          taste,
        });
        noteUserEdit();
      },
      removeDropPiece: (id) => {
        const drop = get().drop;
        if (!drop) return;
        if (drop.garmentIds.length <= 2) return;
        if (!drop.garmentIds.includes(id)) return;
        const locked = (drop.lockedIds ?? []).filter((x) => x !== id);
        set({
          drop: stampDrop({
            ...drop,
            garmentIds: drop.garmentIds.filter((gid) => gid !== id),
            lockedIds: locked,
          }),
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
          .sort((a, b) => (lastWornDays(b) ?? Number.POSITIVE_INFINITY) - (lastWornDays(a) ?? Number.POSITIVE_INFINITY));
        const next = pool[0];
        if (!next) return;
        set({
          avoid: { ...get().avoid, [id]: (get().avoid[id] ?? 0) + 1 },
          drop: stampDrop({
            ...drop,
            worn: false,
            verdict: "pending",
            garmentIds: drop.garmentIds.map((gid) => (gid === id ? next.id : gid)),
          }),
        });
        noteUserEdit();
      },
      pushMessage: (m) => {
        const id = uid("m");
        set((s) => ({
          messages: [...s.messages, { ...m, id, createdAt: new Date().toISOString() }],
        }));
        return id;
      },
      setTaste: (taste) => {
        const next = normalizeTaste(taste);
        if (JSON.stringify(next) === JSON.stringify(get().taste)) return;
        set({ taste: next });
        noteUserEdit();
      },
      stampMessage: (id, patch) => {
        set((s) => ({
          messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
        }));
      },
      fillThisWeek: (season) => {
        const s = get();
        if (s.thisWeek.length >= 3) return s.thisWeek.length;
        if (!rackCanDress(s.garments)) return 0;
        try {
          const before = s.looks.length;
          const row = buildReshuffleRow(s.garments, "weekday", {
            season,
            weather: s.drop?.weather,
            salt: s.reshuffleCount,
            cap: 7,
            taste: s.taste,
          });
          if (get().looks.length !== before) return s.thisWeek.length;
          set({ thisWeek: row });
          return row.length;
        } catch {
          return 0;
        }
      },
      reshuffleWeek: (house, occasion, season) => {
        const s = get();
        if (!s.hydrated || s.garments.length === 0) return 0;
        try {
          const n = s.reshuffleCount + 1;
          const occ = mapOccasion(occasion ?? s.drop?.occasion ?? "weekday");
          const excludeKeys = s.thisWeek.map((l) => comboKey(l.garmentIds));
          const row = buildReshuffleRow(s.garments, occ, {
            house,
            season,
            excludeKeys,
            usedCount: lookCountMap(s.looks),
            replacing: s.thisWeek,
            salt: n,
            taste: s.taste,
          });
          set({ thisWeek: row, reshuffleCount: n });
          return row.length;
        } catch {
          return 0;
        }
      },
      ensureLookbook: () => {
        const s = get();
        if (!s.hydrated) return;
        if (s.garments.length === 0) return;
        if (lookbookIsFrozen(s.looks)) return;
        const monday = mondayISO();
        const weekN = s.looks.filter((l) => l.id.startsWith(`week_${monday}_`)).length;
        if (weekN >= 7) return;
        const week = buildWeek(s.garments, undefined, {
          excludeKeys: s.looks.filter((l) => l.id.startsWith("week_")).map((l) => comboKey(l.garmentIds)),
          usedCount: lookCountMap(s.looks),
        });
        set({ looks: mergeWeekLooks(s.looks, week) });
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
        noteRefPhotoEdit();
        if (key === null) {
          const prev = get().refPhoto;
          if (prev && isIdbKey(prev)) void deleteImage(prev).catch(() => {});
          set({ refPhoto: null, refPhotoBackup: null });
          noteUserEdit();
          return;
        }
        set({
          refPhoto: key,
          ...(backup !== undefined ? { refPhotoBackup: backup } : {}),
        });
        noteUserEdit();
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
            get().updateGarment(
              g.id,
              {
                name,
                colors: colors.length ? colors : g.colors,
              },
              { quiet: true },
            );
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
          taste: meta.taste ? normalizeTaste(meta.taste) : get().taste,
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
        if (!allowSampleRack(isAccountSignedIn())) return;
        set({
          garments: SEED_GARMENTS,
          looks: SEED_LOOKS,
          messages: [],
          taste: emptyTaste(),
          drop: null,
          journal: [],
          avoid: {},
          seenLooks: {},
          thisWeek: [],
          skipCount: 0,
          reshuffleCount: 0,
        });
        get().ensureLookbook();
      },
      emptyCloset: (opts) => {
        if (!opts?.sample && typeof window !== "undefined" && isAccountSignedIn()) {
          if (!window.confirm(EMPTY_ACCOUNT_CONFIRM)) return;
        }
        const wipingAccount = !opts?.sample && isAccountSignedIn();
        if (wipingAccount) {
          for (const g of get().garments) addTombstone(g.id);
          for (const l of get().looks) addLookTombstone(l.id);
        }
        set({
          garments: [],
          looks: [],
          messages: [],
          taste: emptyTaste(),
          drop: null,
          journal: [],
          avoid: {},
          seenLooks: {},
          thisWeek: [],
          skipCount: 0,
          reshuffleCount: 0,
        });
        if (wipingAccount) noteUserEdit();
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
    };
    },
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
        taste: s.taste,
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

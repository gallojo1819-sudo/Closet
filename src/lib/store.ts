import { create } from "zustand";
import { persist } from "zustand/middleware";
import { SEED_GARMENTS, SEED_LOOKS } from "./seed";
import { daysIdle, defaultOccasion, momentOfDay, pickLook } from "./style";
import type { DailyDrop, Garment, Look, Occasion, StylistMessage, WearEntry, WeatherSnap } from "./types";
import { todayISO, uid } from "./utils";

type ClosetState = {
  garments: Garment[];
  looks: Look[];
  messages: StylistMessage[];
  drop: DailyDrop | null;
  journal: WearEntry[];
  avoid: Record<string, number>;
  hydrated: boolean;
  addGarment: (g: Omit<Garment, "id" | "createdAt" | "archived" | "wornOn" | "demo">) => string;
  updateGarment: (id: string, patch: Partial<Garment>) => void;
  removeGarment: (id: string) => void;
  wearToday: (ids: string[]) => void;
  skipDrop: () => void;
  saveLook: (look: Omit<Look, "id" | "createdAt">) => string;
  removeLook: (id: string) => void;
  setDrop: (drop: DailyDrop) => void;
  rerollDrop: (weather?: WeatherSnap, occasion?: Occasion) => void;
  swapDropPiece: (id: string) => void;
  pushMessage: (m: Omit<StylistMessage, "id" | "createdAt">) => void;
  loadSample: () => void;
  emptyCloset: () => void;
};

function pickDrop(
  garments: Garment[],
  weather?: WeatherSnap,
  occasion?: Occasion,
  avoid?: Record<string, number>,
  recentWorn?: string[],
): string[] {
  return pickLook(garments, {
    weather,
    occasion: occasion ?? defaultOccasion(),
    moment: momentOfDay(),
    avoid,
    recentWorn,
  });
}

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
      addGarment: (input) => {
        const id = uid("g");
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
        return id;
      },
      updateGarment: (id, patch) =>
        set((s) => ({
          garments: s.garments.map((g) => (g.id === id ? { ...g, ...patch } : g)),
        })),
      removeGarment: (id) =>
        set((s) => ({
          garments: s.garments.filter((g) => g.id !== id),
          looks: s.looks.map((l) => ({
            ...l,
            garmentIds: l.garmentIds.filter((gid) => gid !== id),
          })),
        })),
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
        const avoid = { ...get().avoid };
        for (const id of drop.garmentIds) avoid[id] = (avoid[id] ?? 0) + 1;
        const entry: WearEntry = {
          date: todayISO(),
          garmentIds: drop.garmentIds,
          verdict: "skipped",
          occasion: drop.occasion,
        };
        set({
          avoid,
          journal: [entry, ...get().journal.filter((j) => j.date !== todayISO())].slice(0, 60),
        });
        get().rerollDrop(drop.weather, drop.occasion);
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
      rerollDrop: (weather, occasion) => {
        const occ = occasion ?? get().drop?.occasion ?? defaultOccasion();
        const moment = momentOfDay();
        const lastWorn = get().journal.find((j) => j.verdict === "worn")?.garmentIds;
        const ids = pickDrop(
          get().garments,
          weather ?? get().drop?.weather,
          occ,
          get().avoid,
          lastWorn,
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
        const pool = get()
          .garments.filter(
            (g) =>
              !g.archived &&
              g.category === current.category &&
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
      loadSample: () =>
        set({
          garments: SEED_GARMENTS,
          looks: SEED_LOOKS,
          messages: [],
          drop: null,
          journal: [],
          avoid: {},
        }),
      emptyCloset: () =>
        set({
          garments: [],
          looks: [],
          messages: [],
          drop: null,
          journal: [],
          avoid: {},
        }),
    }),
    {
      name: "closet.v6",
      skipHydration: true,
    },
  ),
);

export { pickDrop };

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { SEED_GARMENTS, SEED_LOOKS } from "./seed";
import { daysIdle, defaultOccasion, momentOfDay, pickLook } from "./style";
import type { DailyDrop, Garment, Look, Occasion, StylistMessage, WeatherSnap } from "./types";
import { todayISO, uid } from "./utils";

type ClosetState = {
  garments: Garment[];
  looks: Look[];
  messages: StylistMessage[];
  drop: DailyDrop | null;
  hydrated: boolean;
  addGarment: (g: Omit<Garment, "id" | "createdAt" | "archived" | "wornOn" | "demo">) => string;
  updateGarment: (id: string, patch: Partial<Garment>) => void;
  removeGarment: (id: string) => void;
  wearToday: (ids: string[]) => void;
  saveLook: (look: Omit<Look, "id" | "createdAt">) => string;
  removeLook: (id: string) => void;
  setDrop: (drop: DailyDrop) => void;
  rerollDrop: (weather?: WeatherSnap, occasion?: Occasion) => void;
  swapDropPiece: (id: string) => void;
  pushMessage: (m: Omit<StylistMessage, "id" | "createdAt">) => void;
  resetDemo: () => void;
};

function pickDrop(
  garments: Garment[],
  weather?: WeatherSnap,
  occasion?: Occasion,
): string[] {
  return pickLook(garments, {
    weather,
    occasion: occasion ?? defaultOccasion(),
    moment: momentOfDay(),
  });
}

export const useCloset = create<ClosetState>()(
  persist(
    (set, get) => ({
      garments: SEED_GARMENTS,
      looks: SEED_LOOKS,
      messages: [],
      drop: null,
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
          const rest = replacingDemo ? s.garments.filter((g) => !g.demo) : s.garments;
          const garments = [garment, ...rest];
          const allowed = new Set(garments.map((g) => g.id));
          return {
            garments,
            looks: replacingDemo
              ? s.looks.filter((l) => l.garmentIds.every((gid) => allowed.has(gid)))
              : s.looks,
            drop: replacingDemo ? null : s.drop,
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
        set((s) => ({
          garments: s.garments.map((g) =>
            ids.includes(g.id) && !g.wornOn.includes(day)
              ? { ...g, wornOn: [...g.wornOn, day] }
              : g,
          ),
          drop: s.drop ? { ...s.drop, worn: true } : s.drop,
        }));
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
        const ids = pickDrop(get().garments, weather ?? get().drop?.weather, occ);
        set({
          drop: {
            date: todayISO(),
            garmentIds: ids,
            worn: false,
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
          drop: {
            ...drop,
            worn: false,
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
      resetDemo: () =>
        set({
          garments: SEED_GARMENTS,
          looks: SEED_LOOKS,
          messages: [],
          drop: null,
        }),
    }),
    {
      name: "closet.v4",
      skipHydration: true,
    },
  ),
);

export { pickDrop };

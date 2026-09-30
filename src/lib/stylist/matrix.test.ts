import { describe, expect, it } from "vitest";
import { HOUSES, type House } from "../houses.ts";
import { kitCells } from "../look.ts";
import { buildReshuffleRow } from "../lookbook.ts";
import type { Garment, Look } from "../types.ts";
import { buildHouseMatrix, clearMatrixCache } from "./matrix.ts";
import { isLegal } from "./legal.ts";
import { rep4Same } from "./row.ts";
import platesFile from "./__tests__/fixtures/plates-2026-09-30.json" with { type: "json" };

const DELETED = ["g_37e5eqjwgd3d", "g_c6qdv5c3gkor", "g_x0ro1mg2gu0a"];

type Raw = {
  id: string;
  name?: string | null;
  category?: string;
  subtype?: string;
  material?: string;
  colors?: string[];
  brand?: string;
  fit?: string | null;
  warmth?: number;
  archived?: boolean;
  tombstone?: boolean;
};

function garment(p: Raw): Garment {
  const warmth = Math.min(5, Math.max(1, p.warmth ?? 3)) as Garment["warmth"];
  const fit = p.fit === "slim" || p.fit === "relaxed" || p.fit === "regular" ? p.fit : "regular";
  return {
    id: p.id,
    name: p.name ?? "",
    category: (p.category ?? "top") as Garment["category"],
    subtype: p.subtype ?? "",
    colors: p.colors ?? [],
    material: p.material ?? "",
    brand: p.brand ?? "",
    notes: "",
    formality: 3,
    warmth,
    seasons: [],
    imageSrc: "",
    cutoutSrc: "",
    imageSource: "photo",
    matteQuality: "ok",
    demo: false,
    wornOn: [],
    fit,
    archived: Boolean(p.archived || p.tombstone),
    createdAt: "2026-09-30T00:00:00.000Z",
  };
}

const RACK = (platesFile.plates as Raw[])
  .filter((p) => p.id && !p.tombstone && !p.archived && !DELETED.includes(p.id))
  .map(garment);

const CONTEXTS = [
  ["weekday", "fall"],
  ["out", "fall"],
  ["weekend", "fall"],
  ["weekday", "winter"],
  ["weekend", "summer"],
] as const;

const OFF = new Set([
  "sweetStable|weekday|fall",
  "sweetStable|out|fall",
  "sweetStable|weekend|summer",
  "sweetStable|weekday|winter",
  "italianSummer|weekday|winter",
  "italianWinter|weekend|summer",
]);

function core(look: { top: string; bottom: string; shoe: string }) {
  return `${look.top}|${look.bottom}|${look.shoe}`;
}

function idsOf(look: Look): string[] {
  return look.garmentIds;
}

describe("fixture matrix", () => {
  it("open cells have 3 legal cards, gates stay gates, seasons and colour differ", () => {
    clearMatrixCache();
    const by = new Map(RACK.map((g) => [g.id, g]));
    const matrices = CONTEXTS.map(([occ, season]) => ({
      occ,
      season,
      matrix: buildHouseMatrix(RACK, occ, season),
    }));
    let outfits = 0;
    let gates = 0;
    for (const { occ, season, matrix } of matrices) {
      for (const house of HOUSES) {
        const cell = matrix.houses[house]!;
        const key = `${house}|${occ}|${season}`;
        if (OFF.has(key)) {
          expect(cell.gate, key).toBeTruthy();
          gates += 1;
          continue;
        }
        expect(cell.gate, key).toBeNull();
        expect(cell.looks, key).toHaveLength(3);
        outfits += cell.looks.length;
        for (const look of cell.looks) {
          const pieces = [look.top, look.bottom, look.shoe, look.outer]
            .filter((id): id is string => Boolean(id))
            .map((id) => by.get(id))
            .filter((g): g is Garment => Boolean(g));
          expect(isLegal(pieces, { house: house as House, occasion: occ, season }), key).toBe(true);
          expect(DELETED.some((id) => pieces.some((g) => g.id === id))).toBe(false);
          const bands = kitCells(pieces);
          const slots = pieces.filter((g) => ["top", "bottom", "footwear", "outerwear", "dress"].includes(g.category));
          expect(bands.length).toBeGreaterThanOrEqual(3);
          expect(bands.length).toBeLessThanOrEqual(slots.length);
        }
      }
      const allCores = matrix.all.slice(0, 3).map(core).join("||");
      for (const house of HOUSES) {
        const cell = matrix.houses[house]!;
        if (cell.gate || cell.looks.length < 3) continue;
        expect(cell.looks.map(core).join("||"), house).not.toBe(allCores);
      }
    }
    expect(outfits).toBe(117);
    expect(gates).toBe(6);

    const fall = matrices.find((m) => m.occ === "weekday" && m.season === "fall")!.matrix;
    const winter = matrices.find((m) => m.occ === "weekday" && m.season === "winter")!.matrix;
    const summer = matrices.find((m) => m.occ === "weekend" && m.season === "summer")!.matrix;
    const weekend = matrices.find((m) => m.occ === "weekend" && m.season === "fall")!.matrix;
    const out = matrices.find((m) => m.occ === "out" && m.season === "fall")!.matrix;
    for (const house of HOUSES) {
      const a = fall.houses[house]!;
      const b = winter.houses[house]!;
      if (!a.gate && !b.gate) expect(rep4Same(a.looks, b.looks), `${house} fall/winter`).toBe(false);
      const w = weekend.houses[house]!;
      const s = summer.houses[house]!;
      if (!w.gate && !s.gate) expect(rep4Same(w.looks, s.looks), `${house} fall/summer`).toBe(false);
      const o = out.houses[house]!;
      if (!w.gate && !o.gate) {
        expect(w.looks.map(core).join("||"), `${house} weekend/out`).not.toBe(o.looks.map(core).join("||"));
      }
    }

    for (const [occ, season] of CONTEXTS) {
      const colorRow = buildReshuffleRow(RACK, occ, { color: "brown", season, cap: 3 });
      const allRow = buildReshuffleRow(RACK, occ, { season, cap: 3 });
      const colorKey = colorRow.map((l) => idsOf(l).slice().sort().join("|")).join("||");
      const allKey = allRow.map((l) => idsOf(l).slice().sort().join("|")).join("||");
      expect(colorKey.length).toBeGreaterThan(0);
      expect(colorKey).not.toBe(allKey);
      for (const house of HOUSES) {
        const row = buildReshuffleRow(RACK, occ, { house, season, cap: 3 });
        if (row[0]?.gate) continue;
        const key = row
          .filter((l) => l.garmentIds.length >= 3)
          .map((l) => idsOf(l).slice().sort().join("|"))
          .join("||");
        expect(colorKey, `${house} ${occ} ${season}`).not.toBe(key);
      }
    }
  });
});

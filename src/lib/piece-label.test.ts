/**
 * Piece labels on the snapshot closet. Two distinct pieces never share a label: pieces stored
 * under one name get a suffix unique within that same-name group (a colour the name does not
 * say, then material, subtype, fit), else a stable ordinal. The four white leather sneakers
 * get four labels. Maker text is never a label. The stored name, its pattern words with it,
 * is kept whole. nameFromPixels names only what the pixels and the record give evidence for:
 * an "other" with no subtype and no sampled colour keeps its stored name, never "Cream knit".
 */
import { describe, expect, it } from "vitest";
import { pieceLabel } from "./piece-label.ts";
import { isFakeName, nameFromPixels, patternWord } from "./rack.ts";
import type { Garment } from "./types.ts";
import { liveSnapshot } from "./__fixtures__/snapshot.ts";

const CLOSET: Garment[] = liveSnapshot;
const SNEAKERS = CLOSET.filter((g) => g.name.trim().toLowerCase() === "white leather sneakers");
const PATTERN = /\b(striped?|plaid|pinstripe|gingham|herringbone|check)\b/i;

function piece(partial: Pick<Garment, "id" | "name"> & Partial<Garment>): Garment {
  return {
    category: "top",
    subtype: "",
    colors: [],
    material: "",
    brand: "",
    notes: "",
    formality: 3,
    warmth: 3,
    seasons: [],
    imageSrc: "",
    cutoutSrc: "",
    imageSource: "photo",
    matteQuality: "ok",
    demo: false,
    archived: false,
    wornOn: [],
    createdAt: "2026-01-01T12:00:00.000Z",
    ...partial,
  };
}

describe("pieceLabel over the whole snapshot", () => {
  it("no two distinct live pieces share a label", () => {
    const live = CLOSET.filter((g) => !g.archived);
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const g of live) {
      const label = pieceLabel(g, live);
      const other = seen.get(label);
      if (other) clashes.push(`${label}: ${other} and ${g.id}`);
      seen.set(label, g.id);
    }
    expect(clashes).toEqual([]);
    expect(seen.size).toBe(live.length);
  });

  it("the white leather sneakers (three or more stored) get distinct labels that keep the name", () => {
    expect(SNEAKERS.length).toBeGreaterThanOrEqual(3);
    const labels = SNEAKERS.map((g) => pieceLabel(g, CLOSET));
    expect(new Set(labels).size).toBe(SNEAKERS.length);
    for (const label of labels) expect(label.toLowerCase().startsWith("white leather sneakers")).toBe(true);
    /* The two pairs tagged white and blue were both "· blue": a shared token is no suffix now. */
    expect(labels.filter((label) => /· blue$/.test(label)).length).toBe(0);
    expect(labels.filter((label) => /· 2$/.test(label)).length).toBe(1);
  });

  it("a piece alone with its name keeps the plain name", () => {
    const alone = CLOSET.filter((g) => CLOSET.filter((o) => o.name.trim().toLowerCase() === g.name.trim().toLowerCase()).length === 1);
    expect(alone.length).toBeGreaterThan(0);
    for (const g of alone) expect(pieceLabel(g, CLOSET)).toBe(g.name);
  });

  it("the stored name is kept whole: pattern words survive in every label", () => {
    const patterned = CLOSET.filter((g) => PATTERN.test(g.name));
    expect(patterned.length).toBeGreaterThan(0);
    for (const g of patterned) {
      const label = pieceLabel(g, CLOSET);
      expect(label.startsWith(g.name)).toBe(true);
      expect(PATTERN.test(label)).toBe(true);
    }
  });

  it("maker text is never a label, even when it is the only field that differs", () => {
    const a = piece({ id: "a", name: "Navy oxford", brand: "Some Maker", colors: ["navy"], material: "cotton" });
    const b = piece({ id: "b", name: "Navy oxford", brand: "Other Maker", colors: ["navy"], material: "cotton", createdAt: "2026-02-01T12:00:00.000Z" });
    const labels = [pieceLabel(a, [a, b]), pieceLabel(b, [a, b])];
    expect(new Set(labels).size).toBe(2);
    for (const label of labels) expect(/maker/i.test(label)).toBe(false);
    expect(labels).toEqual(["Navy oxford", "Navy oxford · 2"]);
  });

  it("a unique colour beats the ordinal; the ordinal is stable by createdAt then id", () => {
    const x = piece({ id: "x", name: "Light blue jeans", colors: ["light blue"], material: "denim", createdAt: "2026-03-01T00:00:00.000Z" });
    const y = piece({ id: "y", name: "Light blue jeans", colors: ["light blue"], material: "denim", fit: "relaxed", createdAt: "2026-01-01T00:00:00.000Z" });
    const z = piece({ id: "z", name: "Light blue jeans", colors: ["light blue", "white"], material: "denim", createdAt: "2026-02-01T00:00:00.000Z" });
    const pool = [x, y, z];
    expect(pieceLabel(y, pool)).toBe("Light blue jeans · relaxed");
    expect(pieceLabel(z, pool)).toBe("Light blue jeans · white");
    expect(pieceLabel(x, pool)).toBe("Light blue jeans");
    expect(new Set(pool.map((g) => pieceLabel(g, pool))).size).toBe(3);
  });
});

describe("nameFromPixels names only what there is evidence for", () => {
  it("an evidence-free other keeps its stored placeholder, never Cream knit", () => {
    for (const stored of ["New piece", "other", ""]) {
      const name = nameFromPixels({ category: "other", subtype: "", name: stored }, []);
      expect(name).toBe(stored);
      expect(/cream knit/i.test(name)).toBe(false);
    }
    /* The snapshot's two placeholders: category other, no subtype, no colours. */
    const placeholders = CLOSET.filter((g) => g.category === "other" && !g.subtype && g.colors.length === 0);
    expect(placeholders.length).toBeGreaterThanOrEqual(2);
    for (const g of placeholders) expect(nameFromPixels(g, g.colors)).toBe(g.name);
  });

  it("a sampled colour on an other with no kind names a piece, still flagged for naming, pattern kept", () => {
    const name = nameFromPixels({ category: "other", subtype: "", name: "New piece", notes: "striped, bought in June" }, ["navy"]);
    expect(name).toBe("Navy striped piece");
    expect(isFakeName(name)).toBe(true);
    expect(nameFromPixels({ category: "other", subtype: "", name: "New piece" }, ["navy"])).toBe("Navy piece");
  });

  it("a real category still gets its kind, and the varsity rule stands", () => {
    expect(nameFromPixels({ category: "top", subtype: "", name: "IMG_0001.jpg" }, ["cream"])).toBe("Cream top");
    expect(nameFromPixels({ category: "outerwear", subtype: "jacket", name: "Khaki piece" }, ["cream", "navy"])).toBe("Cream varsity");
    expect(patternWord("brown blue plaid shirt")).toBe("plaid");
    expect(patternWord("navy oxford")).toBeNull();
  });
});

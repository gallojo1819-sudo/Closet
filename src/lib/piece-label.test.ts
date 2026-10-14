/**
 * Piece labels on the snapshot closet. Display only: nothing writes a stored name. The shown
 * name is the stored name unless it is one the app cannot trust (a placeholder, a bare category
 * word, a filename, the old renamer's default "Cream knit" on a piece with no cream tagged);
 * then it is built from the record's fields. Two distinct pieces never share a label: pieces
 * showing one name get a suffix unique within that same-name group, a real word (a colour the
 * name does not say, the material, the subtype, the fit, the pattern), else the tagged
 * formality or warmth, else the day added, and only when every field is the same an ordinal.
 * The ordinal cases on this closet are listed (ORDINAL_ALLOWED) with their reason. Maker text
 * is never a label. The stored name, its pattern words with it, is kept whole. nameFromPixels
 * names only what the pixels and the record give evidence for.
 */
import { describe, expect, it } from "vitest";
import { displayName, isUntrustedName, labelIsOrdinal, nameFromFields, pieceLabel } from "./piece-label.ts";
import { isFakeName, nameFromPixels, patternWord } from "./rack.ts";
import type { Garment } from "./types.ts";
import { liveSnapshot } from "./__fixtures__/snapshot.ts";

const CLOSET: Garment[] = liveSnapshot;
const LIVE = CLOSET.filter((g) => !g.archived);
const SNEAKERS = CLOSET.filter((g) => g.name.trim().toLowerCase() === "white leather sneakers");
const PATTERN = /\b(striped?|plaid|pinstripe|gingham|herringbone|check)\b/i;
const ORDINAL_RE = /· \d+$/;

/**
 * Where the label layer has nothing but an ordinal, on this closet. Every field it reads
 * (name, colours, material, subtype, fit, pattern, formality, warmth, the day added) is the
 * same across the pair; the export strips createdAt to one date, so "added" cannot tell them
 * apart here (live, the two placeholders were added on different days and get "added <day>").
 */
const ORDINAL_ALLOWED: Record<string, string> = {
  "white leather sneakers": "two pairs tagged white and blue, leather, sneakers, regular, formality 2, warmth 2: the record holds no word that differs",
  "unnamed piece": "the two placeholders (category other, no subtype, no colours, no material) differ in nothing the record holds",
};

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
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const g of LIVE) {
      const label = pieceLabel(g, LIVE);
      const other = seen.get(label);
      if (other) clashes.push(`${label}: ${other} and ${g.id}`);
      seen.set(label, g.id);
    }
    expect(clashes).toEqual([]);
    expect(seen.size).toBe(LIVE.length);
  });

  it("every same-name duplicate differs from its group by a real word, never an ordinal alone, except the listed pairs", () => {
    const groups = new Map<string, Garment[]>();
    for (const g of LIVE) {
      const key = displayName(g).toLowerCase();
      groups.set(key, [...(groups.get(key) ?? []), g]);
    }
    const ordinal: string[] = [];
    for (const [key, members] of groups) {
      if (members.length < 2) continue;
      const labels = members.map((g) => pieceLabel(g, LIVE));
      expect(new Set(labels).size, key).toBe(members.length);
      for (const [i, g] of members.entries()) {
        const label = labels[i]!;
        if (ORDINAL_RE.test(label)) {
          expect(labelIsOrdinal(g, LIVE)).toBe(true);
          ordinal.push(key);
          continue;
        }
        expect(labelIsOrdinal(g, LIVE), label).toBe(false);
        /* The suffix, when there is one, is a word from the record, not a number. */
        const suffix = label.slice(displayName(g).length);
        if (suffix) expect(suffix, label).toMatch(/^ · [a-z][a-z -]*(?: \d{1,2})?$/);
      }
    }
    const allowed = Object.keys(ORDINAL_ALLOWED);
    expect([...new Set(ordinal)].sort()).toEqual(allowed.sort());
    /* One ordinal per allowed pair: the other member keeps the plain name. */
    for (const key of allowed) expect(ordinal.filter((k) => k === key).length, key).toBe(1);
  });

  it("the live examples: Black hoodie and Cream trousers differ by a real word, not '· 2'", () => {
    const hoodies = LIVE.filter((g) => g.name.toLowerCase() === "black hoodie");
    const trousers = LIVE.filter((g) => g.name.toLowerCase() === "cream trousers");
    expect(hoodies.length).toBe(2);
    expect(trousers.length).toBe(2);
    for (const group of [hoodies, trousers]) {
      const labels = group.map((g) => pieceLabel(g, LIVE));
      expect(new Set(labels).size).toBe(2);
      for (const label of labels) expect(label).not.toMatch(ORDINAL_RE);
      for (const label of labels) expect(label).toMatch(/^(Black hoodie|Cream trousers) · (lounge|casual|smart|dressy|formal)$/i);
    }
  });

  it("the white leather sneakers (four stored) get four labels that keep the name; one ordinal only", () => {
    expect(SNEAKERS.length).toBe(4);
    const labels = SNEAKERS.map((g) => pieceLabel(g, CLOSET));
    expect(new Set(labels).size).toBe(SNEAKERS.length);
    for (const label of labels) expect(label.toLowerCase().startsWith("white leather sneakers")).toBe(true);
    expect(labels.filter((label) => /· blue$/.test(label)).length).toBe(0);
    expect(labels.filter((label) => ORDINAL_RE.test(label)).length).toBe(1);
    expect(labels).toContain("white leather sneakers · navy");
    expect(labels).toContain("white leather sneakers · green");
  });

  it("a piece alone with a trusted name keeps the plain name", () => {
    const alone = LIVE.filter((g) => !isUntrustedName(g) && LIVE.filter((o) => displayName(o).toLowerCase() === g.name.trim().toLowerCase()).length === 1);
    expect(alone.length).toBeGreaterThan(0);
    for (const g of alone) expect(pieceLabel(g, LIVE)).toBe(g.name);
  });

  it("the stored name is kept whole: pattern words survive in every label", () => {
    const patterned = LIVE.filter((g) => PATTERN.test(g.name));
    expect(patterned.length).toBeGreaterThan(0);
    for (const g of patterned) {
      const label = pieceLabel(g, LIVE);
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
    /* Nothing but the day added differs: a real, visible word before any ordinal. */
    expect(labels).toEqual(["Navy oxford · added Jan 1", "Navy oxford · added Feb 1"]);
  });

  it("a unique colour beats the fit; the fit beats the tagged attributes; the ordinal is stable by createdAt then id", () => {
    const x = piece({ id: "x", name: "Light blue jeans", colors: ["light blue"], material: "denim", createdAt: "2026-03-01T00:00:00.000Z" });
    const y = piece({ id: "y", name: "Light blue jeans", colors: ["light blue"], material: "denim", fit: "relaxed", createdAt: "2026-01-01T00:00:00.000Z" });
    const z = piece({ id: "z", name: "Light blue jeans", colors: ["light blue", "white"], material: "denim", createdAt: "2026-02-01T00:00:00.000Z" });
    const pool = [x, y, z];
    expect(pieceLabel(y, pool)).toBe("Light blue jeans · relaxed");
    expect(pieceLabel(z, pool)).toBe("Light blue jeans · white");
    expect(pieceLabel(x, pool)).toBe("Light blue jeans");
    expect(new Set(pool.map((g) => pieceLabel(g, pool))).size).toBe(3);
    const same = ["p", "q", "r"].map((id) => piece({ id, name: "Grey tee", colors: ["grey"], material: "cotton", subtype: "t-shirt" }));
    expect(same.map((g) => pieceLabel(g, same))).toEqual(["Grey tee", "Grey tee · 2", "Grey tee · 3"]);
    expect(labelIsOrdinal(same[1]!, same)).toBe(true);
  });
});

describe("a stored name the app cannot trust is set aside at display time", () => {
  it("a stored 'Cream knit' with no cream tagged (the old renamer's default) is relabeled from its fields; a real one stands", () => {
    const corrupted = piece({ id: "ck1", name: "Cream knit", category: "other", subtype: "", colors: [], material: "", createdAt: "2026-10-10T12:00:00.000Z" });
    const twin = piece({ id: "ck2", name: "Cream knit", category: "other", subtype: "", colors: [], material: "", createdAt: "2026-10-11T12:00:00.000Z" });
    expect(isUntrustedName(corrupted)).toBe(true);
    expect(displayName(corrupted)).toBe("Unnamed piece");
    expect(isFakeName(displayName(corrupted)), "still flagged for the owner to name").toBe(true);
    /* The two live placeholders: told apart by the day they were added, not an ordinal. */
    const pool = [corrupted, twin, ...LIVE];
    expect(pieceLabel(corrupted, pool)).toBe("Unnamed piece · added Oct 10");
    expect(pieceLabel(twin, pool)).toBe("Unnamed piece · added Oct 11");
    for (const g of pool) expect(pieceLabel(g, pool)).not.toMatch(/cream knit/i);
    /* With real fields the label says what the record says: colour, material, kind. */
    const tagged = piece({ id: "ck3", name: "Cream knit", category: "top", subtype: "", colors: ["navy"], material: "wool" });
    expect(displayName(tagged)).toBe("Navy wool top");
    const knit = piece({ id: "ck4", name: "Cream knit", category: "top", subtype: "sweater", colors: ["cream"], material: "wool" });
    expect(isUntrustedName(knit)).toBe(false);
    expect(displayName(knit)).toBe("Cream knit");
  });

  it("placeholders, bare category words and filenames are untrusted; the snapshot's two 'other' pieces are relabeled", () => {
    for (const name of ["New piece", "other", "top", "Shoes", "trousers", "IMG_0001.jpg", "", "Navy piece"]) {
      expect(isUntrustedName({ name, colors: [] }), name).toBe(true);
    }
    for (const name of ["navy oxford", "brown blue plaid shirt", "cream pleated trousers", "Cream knit polo"]) {
      expect(isUntrustedName({ name, colors: [] }), name).toBe(false);
    }
    const placeholders = LIVE.filter((g) => isUntrustedName(g));
    expect(placeholders.map((g) => g.name)).toEqual(["other", "other"]);
    for (const g of placeholders) expect(displayName(g)).toBe("Unnamed piece");
    expect(new Set(placeholders.map((g) => pieceLabel(g, LIVE))).size).toBe(2);
  });

  it("nameFromFields keeps the pattern word and the material, never a brand", () => {
    const g = piece({ id: "nf", name: "New piece", category: "top", subtype: "shirt", colors: ["blue"], material: "cotton", notes: "gingham, from a market", brand: "Some Maker" });
    expect(nameFromFields(g)).toBe("Blue gingham cotton shirt");
    expect(nameFromFields(piece({ id: "nf2", name: "other", category: "footwear", subtype: "", colors: [], material: "suede" }))).toBe("Suede shoes");
    expect(nameFromFields(piece({ id: "nf3", name: "other", category: "outerwear", subtype: "", colors: [] }))).toBe("Unnamed jacket");
  });
});

describe("nameFromPixels names only what there is evidence for", () => {
  it("an evidence-free other keeps its stored placeholder, never Cream knit", () => {
    for (const stored of ["New piece", "other", ""]) {
      const name = nameFromPixels({ category: "other", subtype: "", name: stored }, []);
      expect(name).toBe(stored);
      expect(/cream knit/i.test(name)).toBe(false);
    }
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

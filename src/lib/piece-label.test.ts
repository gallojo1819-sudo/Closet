/**
 * Piece labels on the snapshot closet. Display only: nothing writes a stored name. The shown
 * name is the stored name unless it is one the app cannot trust (a placeholder, a bare category
 * word, a filename, the old renamer's default "Cream knit" on a piece with no cream tagged);
 * then it is built from the record's fields. Two distinct pieces never share a label: pieces
 * showing one name get a suffix unique within that same-name group, a real word (a colour the
 * name does not say, the material, the subtype, the fit, the pattern), else the tagged
 * formality or warmth, else when the piece was added in Eastern time (the day, then the minute
 * when the day is shared, then the second), else the id. No label ever ends in a bare number.
 * The fixture keeps the stored createdAt, so the pairs that differ in nothing else (two white
 * leather sneakers added four minutes apart, two placeholders added eight minutes apart) read
 * their added time here as they do live. Maker text is never a label. The stored name, its
 * pattern words with it, is kept whole. nameFromPixels names only what the pixels and the
 * record give evidence for.
 */
import { describe, expect, it } from "vitest";
import { displayName, isUntrustedName, nameFromFields, pieceLabel } from "./piece-label.ts";
import { isFakeName, nameFromPixels, patternWord } from "./rack.ts";
import type { Garment } from "./types.ts";
import { liveSnapshot } from "./__fixtures__/snapshot.ts";

const CLOSET: Garment[] = liveSnapshot;
const LIVE = CLOSET.filter((g) => !g.archived);
const SNEAKERS = CLOSET.filter((g) => g.name.trim().toLowerCase() === "white leather sneakers");
const PATTERN = /\b(striped?|plaid|pinstripe|gingham|herringbone|check)\b/i;
/** A bare number at the end of a label: the old ordinal fallback, now never produced. */
const ORDINAL_RE = / · \d+$/;
/** A suffix is a word from the record (lowercase, may carry a day number) or an added time in Eastern time. */
const WORD_SUFFIX = /^ · [a-z][a-z -]*(?: \d{1,2})?$/;
const ADDED_RE = /^ · added [A-Z][a-z]{2} \d{1,2}(?:, \d{1,2}:\d{2}(?::\d{2})? [AP]M)?$/;
const ID_SUFFIX = /^ · g_[a-z0-9]+$/;

/**
 * The pieces that differ in nothing the record holds but when they were added (and the maker,
 * never a label): two white leather sneakers added Sep 12 2026 four minutes apart, two
 * placeholders added Oct 10 2026 eight minutes apart. Their labels read the added time, to
 * the minute, in Eastern time.
 */
const ADDED_TIME_LABELS: Record<string, string> = {
  g_2wf48xbqlgcv: "white leather sneakers · added Sep 12, 5:07 PM",
  g_01xaga54r12h: "white leather sneakers · added Sep 12, 5:11 PM",
  g_okvtcabq289s: "Unnamed piece · added Oct 10, 10:11 AM",
  g_c5tgp57bcuub: "Unnamed piece · added Oct 10, 10:19 AM",
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

  it("every piece in the snapshot: no label ends in a bare number, every label is unique, every suffix is a real word", () => {
    expect(LIVE.length).toBe(liveSnapshot.length);
    expect(LIVE.length).toBeGreaterThan(100);
    const labels = new Map<string, string>();
    for (const g of liveSnapshot) {
      const label = pieceLabel(g, LIVE);
      expect(label, g.id).not.toMatch(ORDINAL_RE);
      expect(label, g.id).not.toMatch(/\d+$/);
      expect(label.startsWith(displayName(g)), g.id).toBe(true);
      const suffix = label.slice(displayName(g).length);
      if (suffix) expect(WORD_SUFFIX.test(suffix) || ADDED_RE.test(suffix), label).toBe(true);
      expect(ID_SUFFIX.test(suffix), label).toBe(false);
      if (!g.archived) {
        expect(labels.get(label), `${label}: ${labels.get(label)} and ${g.id}`).toBeUndefined();
        labels.set(label, g.id);
      }
    }
    expect(labels.size).toBe(LIVE.length);
  });

  it("the pairs that differ only by when they were added read the added time in Eastern time, never the maker or a number", () => {
    const byId = new Map(LIVE.map((g) => [g.id, g]));
    for (const [id, expected] of Object.entries(ADDED_TIME_LABELS)) {
      const g = byId.get(id);
      expect(g, id).toBeDefined();
      expect(pieceLabel(g!, LIVE)).toBe(expected);
    }
    /* Each pair shares its day, so the day alone would not have told them apart. */
    for (const [a, b] of [
      ["g_2wf48xbqlgcv", "g_01xaga54r12h"],
      ["g_okvtcabq289s", "g_c5tgp57bcuub"],
    ] as const) {
      expect(byId.get(a)!.createdAt.slice(0, 10)).toBe(byId.get(b)!.createdAt.slice(0, 10));
      expect(byId.get(a)!.createdAt).not.toBe(byId.get(b)!.createdAt);
    }
  });

  it("every same-name duplicate differs from its group by a real word or its added time", () => {
    const groups = new Map<string, Garment[]>();
    for (const g of LIVE) {
      const key = displayName(g).toLowerCase();
      groups.set(key, [...(groups.get(key) ?? []), g]);
    }
    let dupes = 0;
    for (const [key, members] of groups) {
      if (members.length < 2) continue;
      dupes += 1;
      const labels = members.map((g) => pieceLabel(g, LIVE));
      expect(new Set(labels).size, key).toBe(members.length);
      for (const label of labels) expect(label, key).not.toMatch(ORDINAL_RE);
    }
    expect(dupes).toBeGreaterThan(0);
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

  it("the white leather sneakers (four stored) get four labels that keep the name; the alike pair by added time", () => {
    expect(SNEAKERS.length).toBe(4);
    const labels = SNEAKERS.map((g) => pieceLabel(g, CLOSET));
    expect(new Set(labels).size).toBe(SNEAKERS.length);
    for (const label of labels) expect(label.toLowerCase().startsWith("white leather sneakers")).toBe(true);
    expect(labels.filter((label) => /· blue$/.test(label)).length).toBe(0);
    expect(labels.filter((label) => ORDINAL_RE.test(label)).length).toBe(0);
    expect(labels).toContain("white leather sneakers · navy");
    expect(labels).toContain("white leather sneakers · green");
    expect(labels).toContain(ADDED_TIME_LABELS.g_2wf48xbqlgcv);
    expect(labels).toContain(ADDED_TIME_LABELS.g_01xaga54r12h);
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

  it("a unique colour beats the fit; the fit beats the tagged attributes; pieces alike in every field and added in the same second carry their id", () => {
    const x = piece({ id: "x", name: "Light blue jeans", colors: ["light blue"], material: "denim", createdAt: "2026-03-01T00:00:00.000Z" });
    const y = piece({ id: "y", name: "Light blue jeans", colors: ["light blue"], material: "denim", fit: "relaxed", createdAt: "2026-01-01T00:00:00.000Z" });
    const z = piece({ id: "z", name: "Light blue jeans", colors: ["light blue", "white"], material: "denim", createdAt: "2026-02-01T00:00:00.000Z" });
    const pool = [x, y, z];
    expect(pieceLabel(y, pool)).toBe("Light blue jeans · relaxed");
    expect(pieceLabel(z, pool)).toBe("Light blue jeans · white");
    expect(pieceLabel(x, pool)).toBe("Light blue jeans");
    expect(new Set(pool.map((g) => pieceLabel(g, pool))).size).toBe(3);
    const same = ["p", "q", "r"].map((id) => piece({ id, name: "Grey tee", colors: ["grey"], material: "cotton", subtype: "t-shirt" }));
    expect(same.map((g) => pieceLabel(g, same))).toEqual(["Grey tee · p", "Grey tee · q", "Grey tee · r"]);
    for (const g of same) expect(pieceLabel(g, same)).not.toMatch(ORDINAL_RE);
  });

  it("the added time, in Eastern time, escalates only as far as it must: day, minute, second", () => {
    const at = (id: string, createdAt: string) => piece({ id, name: "Grey tee", colors: ["grey"], material: "cotton", subtype: "t-shirt", createdAt });
    const days = [at("d1", "2026-09-12T21:07:55.269Z"), at("d2", "2026-09-13T21:07:55.269Z")];
    expect(days.map((g) => pieceLabel(g, days))).toEqual(["Grey tee · added Sep 12", "Grey tee · added Sep 13"]);
    /* 21:07 UTC on Sep 12 is 5:07 PM in New York; the day is read there too (03:30 UTC is still the evening before). */
    const minutes = [at("m1", "2026-09-12T21:07:55.269Z"), at("m2", "2026-09-12T21:11:36.725Z"), at("m3", "2026-09-13T03:30:00.000Z")];
    expect(minutes.map((g) => pieceLabel(g, minutes))).toEqual([
      "Grey tee · added Sep 12, 5:07 PM",
      "Grey tee · added Sep 12, 5:11 PM",
      "Grey tee · added Sep 12, 11:30 PM",
    ]);
    const seconds = [at("s1", "2026-09-12T21:07:55.269Z"), at("s2", "2026-09-12T21:07:12.000Z")];
    expect(seconds.map((g) => pieceLabel(g, seconds))).toEqual(["Grey tee · added Sep 12, 5:07:55 PM", "Grey tee · added Sep 12, 5:07:12 PM"]);
    /* A date that does not parse: nothing to read, so the id tells them apart. */
    const broken = [at("b1", "soon"), at("b2", "soon")];
    expect(broken.map((g) => pieceLabel(g, broken))).toEqual(["Grey tee · b1", "Grey tee · b2"]);
  });
});

describe("a stored name the app cannot trust is set aside at display time", () => {
  it("a stored 'Cream knit' with no cream tagged (the old renamer's default) is relabeled from its fields; a real one stands", () => {
    const corrupted = piece({ id: "ck1", name: "Cream knit", category: "other", subtype: "", colors: [], material: "", createdAt: "2026-10-10T12:00:00.000Z" });
    const twin = piece({ id: "ck2", name: "Cream knit", category: "other", subtype: "", colors: [], material: "", createdAt: "2026-10-11T12:00:00.000Z" });
    expect(isUntrustedName(corrupted)).toBe(true);
    expect(displayName(corrupted)).toBe("Unnamed piece");
    expect(isFakeName(displayName(corrupted)), "still flagged for the owner to name").toBe(true);
    /* Beside the two live placeholders (both added Oct 10): the day alone tells the Oct 11 twin apart, the Oct 10 one needs the minute. */
    const pool = [corrupted, twin, ...LIVE];
    expect(pieceLabel(corrupted, pool)).toBe("Unnamed piece · added Oct 10, 8:00 AM");
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

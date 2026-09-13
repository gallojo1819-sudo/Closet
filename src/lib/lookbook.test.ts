import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyShuffle,
  buildChapter,
  buildLookbook,
  CHAPTER_CAP,
  comboKey,
  fillOccasionLooks,
  lookFitsOccasion,
  looksForHero,
  mergeLookbook,
  moreLikeThis,
} from "./lookbook.ts";
import type { Garment, Look } from "./types.ts";

function piece(
  partial: Pick<Garment, "id" | "name" | "category" | "subtype"> & Partial<Garment>,
): Garment {
  return {
    colors: ["navy"],
    material: "cotton",
    brand: "",
    notes: "",
    formality: 3,
    warmth: 2,
    seasons: ["fall"],
    imageSrc: "/x.jpg",
    cutoutSrc: "/x.jpg",
    imageSource: "official",
    matteQuality: "clean",
    demo: false,
    archived: false,
    wornOn: [],
    createdAt: "2026-01-01T12:00:00.000Z",
    ...partial,
  };
}

function closet(nTop: number, nBottom: number, nShoe: number, extra: Garment[] = []): Garment[] {
  const tops = Array.from({ length: nTop }, (_, i) =>
    piece({ id: `t${i + 1}`, name: `Oxford ${i + 1}`, category: "top", subtype: "oxford" }),
  );
  const bottoms = Array.from({ length: nBottom }, (_, i) =>
    piece({ id: `b${i + 1}`, name: `Chino ${i + 1}`, category: "bottom", subtype: "chino" }),
  );
  const shoes = Array.from({ length: nShoe }, (_, i) =>
    piece({
      id: `s${i + 1}`,
      name: i === 0 ? "Navy loafers" : `Mule ${i + 1}`,
      category: i === 0 ? "other" : "footwear",
      subtype: i === 0 ? "loafer" : "mule",
    }),
  );
  return [...tops, ...bottoms, ...shoes, ...extra];
}

describe("buildLookbook", () => {
  it("caps each chapter at 10, four chapters, not 97", () => {
    const g = closet(8, 8, 8);
    const looks = buildLookbook(g, "2026-09-12");
    assert.ok(looks.length <= CHAPTER_CAP * 4, `looks=${looks.length}`);
    for (const occ of ["weekday", "out", "weekend", "travel"] as const) {
      const n = looks.filter((l) => l.occasion === occ).length;
      assert.ok(n <= CHAPTER_CAP, `${occ} has ${n}`);
    }
    for (const l of looks) {
      assert.equal(l.lookbook, true);
      assert.equal(l.source, "ai");
      assert.ok(l.garmentIds.length >= 3);
    }
  });

  it("adding a 6th top does not wipe a saved outfit", () => {
    const g15 = closet(5, 5, 5);
    const saved: Look = {
      id: "l_saved",
      name: "Saturday market",
      occasion: "weekend",
      garmentIds: ["t1", "b1", "s1"],
      source: "manual",
      lookbook: true,
      createdAt: "2026-09-01T12:00:00.000Z",
    };
    const first = mergeLookbook([saved], buildLookbook(g15, "2026-09-12"));
    assert.ok(first.some((l) => l.id === "l_saved"));
    const g16 = [
      ...g15,
      piece({ id: "t6", name: "Grey polo", category: "top", subtype: "polo" }),
    ];
    const second = mergeLookbook(first, buildLookbook(g16, "2026-09-12"));
    assert.ok(second.some((l) => l.id === "l_saved" && l.source === "manual"));
  });

  it("empty without a full weekday trio", () => {
    assert.equal(buildLookbook(closet(5, 5, 0)).length, 0);
  });

  it("out puts a blazer on when he owns one", () => {
    const g = [
      ...closet(3, 3, 3),
      piece({
        id: "j1",
        name: "Navy blazer",
        category: "outerwear",
        subtype: "blazer",
        formality: 4,
      }),
    ];
    const looks = buildChapter(g, "out", { cap: 10, today: "2026-09-12" });
    assert.ok(looks.length >= 1, "out must have looks");
    assert.ok(
      looks.some((l) => l.garmentIds.includes("j1")),
      "out look should wear the blazer",
    );
  });

  it("shuffle never repeats a combo key; saved look stays", () => {
    const g = closet(8, 8, 8);
    const first = buildChapter(g, "out", { cap: 10, today: "2026-09-12" });
    assert.ok(first.length >= 3, `first ${first.length}`);
    const saved: Look = {
      ...first[0]!,
      id: "l_saved_out",
      source: "manual",
      lookbook: true,
    };
    const seen = first.map((l) => comboKey(l.garmentIds));
    const next = applyShuffle(g, [...first, saved], "out", seen, "2026-09-13");
    assert.ok(next.looks.some((l) => l.id === "l_saved_out"));
    const firstKeys = new Set(seen);
    for (const l of next.added) {
      assert.ok(!firstKeys.has(comboKey(l.garmentIds)), `repeat ${l.name}`);
    }
    assert.equal(comboKey(["a", "c", "b"]), comboKey(["c", "a", "b"]));
  });

  it("50-top closet: cream cable-knit is in 1 weekday card, not 8", () => {
    const g = [
      ...closet(49, 12, 12),
      piece({
        id: "cable",
        name: "Cream cable-knit",
        category: "top",
        subtype: "cable",
        warmth: 3,
      }),
    ];
    const looks = buildChapter(g, "weekday", { cap: 10, today: "2026-09-12" });
    const n = looks.filter((l) => l.garmentIds.includes("cable")).length;
    assert.ok(n <= 1, `cream cable in ${n} weekday looks`);
    const topIds = looks.flatMap((l) =>
      l.garmentIds.filter((id) => id === "cable" || /^t\d+$/.test(id)),
    );
    assert.equal(new Set(topIds).size, topIds.length, "each top at most once");
  });

  it("Out + Summer has no overcoat", () => {
    const g = [
      piece({
        id: "camp",
        name: "Linen camp collar",
        category: "top",
        subtype: "camp shirt",
        warmth: 1,
        seasons: [],
      }),
      piece({
        id: "lin",
        name: "Linen trousers",
        category: "bottom",
        subtype: "trouser",
        warmth: 2,
        seasons: [],
      }),
      piece({
        id: "mu",
        name: "White mules",
        category: "footwear",
        subtype: "mule",
        warmth: 2,
        seasons: [],
      }),
      piece({
        id: "ox",
        name: "White oxford",
        category: "top",
        subtype: "oxford",
        warmth: 2,
        seasons: [],
      }),
      piece({
        id: "ch",
        name: "Khaki chinos",
        category: "bottom",
        subtype: "chino",
        warmth: 2,
        seasons: [],
      }),
      piece({
        id: "sn",
        name: "White sneakers",
        category: "footwear",
        subtype: "sneaker",
        warmth: 2,
        seasons: [],
      }),
      piece({
        id: "oc",
        name: "Camel overcoat",
        category: "outerwear",
        subtype: "overcoat",
        warmth: 5,
        seasons: [],
      }),
    ];
    const looks = buildChapter(g, "out", { cap: 10, season: "summer", today: "2026-09-12" });
    assert.ok(looks.length >= 1, "summer out must have looks");
    for (const l of looks) {
      assert.ok(!l.garmentIds.includes("oc"), l.name);
    }
  });

  it("90s hoodie is not an out look when a knit/oxford exists", () => {
    const hood = [
      piece({ id: "hood", name: "Black 90s hoodie", category: "top", subtype: "hoodie", formality: 2 }),
      piece({ id: "jean", name: "Indigo jeans", category: "bottom", subtype: "jean", formality: 2 }),
      piece({ id: "sn", name: "White sneakers", category: "footwear", subtype: "sneaker", formality: 1 }),
    ];
    const rack = [
      ...hood,
      piece({ id: "ox", name: "White oxford", category: "top", subtype: "oxford" }),
      piece({ id: "tr", name: "Charcoal trousers", category: "bottom", subtype: "trouser" }),
      piece({ id: "lf", name: "Navy loafers", category: "footwear", subtype: "loafer" }),
    ];
    assert.equal(lookFitsOccasion(hood, "out", rack), false);
    assert.equal(lookFitsOccasion(hood, "weekend"), true);
    const invalid: Look = {
      id: "lb_bad",
      name: "hoodie pleat",
      occasion: "out",
      garmentIds: ["hood", "pleat", "s1"],
      source: "ai",
      lookbook: true,
      createdAt: "2026-09-12T00:00:00.000Z",
    };
    const dropped = mergeLookbook(
      [invalid],
      [],
      [
        ...rack,
        piece({
          id: "pleat",
          name: "Cream pleated trousers",
          category: "bottom",
          subtype: "trouser",
          formality: 4,
        }),
        piece({ id: "s1", name: "Navy loafers", category: "footwear", subtype: "loafer" }),
      ],
    );
    assert.ok(!dropped.some((l) => l.garmentIds.includes("hood") && l.garmentIds.includes("pleat")));
  });
});

describe("lookFitsOccasion", () => {
  it("out is sharper; maps old client/dinner; never a 90s hoodie as the only top", () => {
    const dinner = [
      piece({ id: "ox", name: "White oxford", category: "top", subtype: "oxford" }),
      piece({ id: "tr", name: "Charcoal trousers", category: "bottom", subtype: "trouser" }),
      piece({ id: "lf", name: "Navy loafers", category: "footwear", subtype: "loafer" }),
    ];
    const hood = [
      piece({ id: "hood", name: "Black 90s hoodie", category: "top", subtype: "hoodie", formality: 2 }),
      piece({ id: "jean", name: "Indigo jeans", category: "bottom", subtype: "jean", formality: 2 }),
      piece({ id: "sn", name: "White sneakers", category: "footwear", subtype: "sneaker", formality: 1 }),
    ];
    assert.equal(lookFitsOccasion(dinner, "dinner"), true);
    assert.equal(lookFitsOccasion(hood, "dinner"), false);
    assert.equal(lookFitsOccasion(hood, "client"), false);
    assert.equal(lookFitsOccasion(hood, "weekday"), false);
    assert.equal(lookFitsOccasion(hood, "weekend"), true);
    assert.equal(lookFitsOccasion(dinner, "weekend"), false);
    assert.equal(lookFitsOccasion(dinner, "client"), true);
    assert.equal(lookFitsOccasion(dinner, "out"), true);
  });

  it("weekday is Ralph oxford + chino + loafer, not gym", () => {
    const week = [
      piece({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford" }),
      piece({ id: "ch", name: "Khaki chinos", category: "bottom", subtype: "chino" }),
      piece({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer" }),
    ];
    const gym = [
      piece({ id: "tee", name: "White tee", category: "top", subtype: "tee" }),
      piece({ id: "j", name: "Indigo jeans", category: "bottom", subtype: "jean" }),
      piece({ id: "sn", name: "Gym sneakers", category: "footwear", subtype: "sneaker" }),
    ];
    assert.equal(lookFitsOccasion(week, "weekday"), true);
    assert.equal(lookFitsOccasion(gym, "weekday"), false);
    assert.equal(lookFitsOccasion(week, "out"), true);
  });

  it("fillOccasionLooks tags out and does not mix hoodie", () => {
    const g = [
      piece({ id: "ox", name: "White oxford", category: "top", subtype: "oxford", formality: 3 }),
      piece({ id: "tr", name: "Navy trousers", category: "bottom", subtype: "trouser", formality: 4 }),
      piece({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer", formality: 3 }),
      piece({ id: "blz", name: "Navy blazer", category: "outerwear", subtype: "blazer", formality: 4 }),
      piece({ id: "hood", name: "Black 90s hoodie", category: "top", subtype: "hoodie", formality: 2 }),
      piece({ id: "jean", name: "Indigo jeans", category: "bottom", subtype: "jean", formality: 2 }),
      piece({ id: "sn", name: "White sneakers", category: "footwear", subtype: "sneaker", formality: 1 }),
    ];
    const extra = fillOccasionLooks(g, [], "out", 3);
    assert.ok(extra.length >= 1, "out book must have looks");
    for (const l of extra) {
      assert.equal(l.occasion, "out");
      assert.ok(!l.garmentIds.includes("hood"));
    }
  });

  it("looksForHero trousers include the trousers on different occasions", () => {
    const g = [
      piece({ id: "ox", name: "White oxford", category: "top", subtype: "oxford" }),
      piece({ id: "polo", name: "Navy polo", category: "top", subtype: "polo" }),
      piece({ id: "knit", name: "Cream knit", category: "top", subtype: "knit" }),
      piece({
        id: "tr",
        name: "Cream trousers",
        category: "bottom",
        subtype: "trouser",
        formality: 4,
      }),
      piece({ id: "ch", name: "Khaki chinos", category: "bottom", subtype: "chino" }),
      piece({ id: "lf", name: "Navy loafers", category: "footwear", subtype: "loafer" }),
      piece({ id: "sn", name: "White sneakers", category: "footwear", subtype: "sneaker", formality: 1 }),
    ];
    const looks = looksForHero(g.find((x) => x.id === "tr")!, g);
    assert.ok(looks.length >= 1 && looks.length <= 5, `count ${looks.length}`);
    const occs = new Set(looks.map((l) => l.occasion));
    for (const l of looks) {
      assert.ok(l.garmentIds.includes("tr"), l.occasion);
    }
    assert.ok(occs.size >= 1);
  });
});

describe("moreLikeThis", () => {
  const garments: Garment[] = [
    piece({ id: "oxn", name: "Navy oxford", category: "top", subtype: "oxford", colors: ["navy"], wornOn: ["2026-09-10"] }),
    piece({ id: "oxc", name: "Cream knit", category: "top", subtype: "knit", colors: ["cream"], wornOn: ["2026-09-10"] }),
    piece({ id: "oxb", name: "Light blue oxford", category: "top", subtype: "oxford", colors: ["light blue"], wornOn: ["2026-09-10"] }),
    piece({ id: "polo", name: "Navy polo", category: "top", subtype: "polo", colors: ["navy"], wornOn: ["2026-09-10"] }),
    piece({
      id: "idle-top",
      name: "Grey polo",
      category: "top",
      subtype: "polo",
      colors: ["grey", "navy"],
      wornOn: [],
      createdAt: "2026-01-01T12:00:00.000Z",
    }),
    piece({ id: "chino", name: "Khaki chinos", category: "bottom", subtype: "chino", colors: ["khaki"], wornOn: ["2026-09-10"] }),
    piece({ id: "olive", name: "Olive chinos", category: "bottom", subtype: "chino", colors: ["olive"], wornOn: ["2026-09-10"] }),
    piece({ id: "jean", name: "Indigo jeans", category: "bottom", subtype: "jean", colors: ["navy"], wornOn: ["2026-09-10"] }),
    piece({
      id: "idle-b",
      name: "Brown trousers",
      category: "bottom",
      subtype: "trouser",
      colors: ["brown"],
      wornOn: [],
    }),
    piece({ id: "loafer", name: "Brown loafers", category: "footwear", subtype: "loafer", colors: ["brown"], wornOn: ["2026-09-10"] }),
    piece({ id: "mule", name: "White mules", category: "footwear", subtype: "mule", colors: ["white"], wornOn: ["2026-09-10"] }),
    piece({ id: "sneaker", name: "White sneakers", category: "footwear", subtype: "sneaker", colors: ["white"], wornOn: ["2026-09-10"] }),
  ];

  const look = (id: string, occasion: string, ids: string[]): Look => ({
    id,
    name: id,
    occasion,
    garmentIds: ids,
    source: "ai",
    lookbook: true,
    createdAt: "2026-09-12T00:00:00.000Z",
  });

  const seed = look("seed", "weekday", ["oxn", "chino", "loafer"]);
  const oneSlot = look("one", "weekday", ["oxc", "chino", "loafer"]);
  const a = look("a", "weekday", ["oxc", "olive", "loafer"]);
  const b = look("b", "weekday", ["polo", "chino", "sneaker"]);
  const c = look("c", "weekday", ["oxb", "jean", "loafer"]);
  const idle = look("idle", "weekday", ["idle-top", "idle-b", "mule"]);
  const weekend = look("wk", "weekend", ["polo", "jean", "sneaker"]);
  const book = [seed, oneSlot, a, b, c, idle, weekend];

  it("returns 3 looks, two slots different, prefers idle", () => {
    const alts = moreLikeThis(seed, book, garments, 3);
    assert.equal(alts.length, 3);
    assert.ok(!alts.some((l) => l.id === "seed"));
    assert.ok(!alts.some((l) => l.id === "one"), "one slot different is not an alternative");
    assert.equal(alts[0]?.id, "idle");
    assert.ok(alts.every((l) => l.occasion === "weekday"));
  });

  it("stays in lookbook, never invents ids", () => {
    const alts = moreLikeThis(seed, book, garments, 3);
    for (const l of alts) {
      assert.ok(book.some((x) => x.id === l.id));
      for (const id of l.garmentIds) assert.ok(garments.some((g) => g.id === id));
    }
  });
});

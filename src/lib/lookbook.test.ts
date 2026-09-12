import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildLookbook, mergeLookbook, lookbookStats, moreLikeThis } from "./lookbook.ts";
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
  it("5×5×5 yields ~15–30 looks, every id used, not 125", () => {
    const g = closet(5, 5, 5);
    const looks = buildLookbook(g, "2026-09-12");
    assert.ok(looks.length >= 5 && looks.length <= 96, `looks=${looks.length}`);
    assert.ok(looks.length < 125);
    const ids = new Set(g.map((x) => x.id));
    const used = new Set(looks.flatMap((l) => l.garmentIds));
    for (const id of ids) assert.ok(used.has(id), `missing ${id}`);
    const stats = lookbookStats(looks, g);
    assert.equal(stats.total, 15);
    assert.equal(stats.used, 15);
    assert.equal(stats.everyPieceUsed, true);
    for (const l of looks) {
      assert.equal(l.lookbook, true);
      assert.equal(l.source, "ai");
      assert.ok(l.garmentIds.length >= 3);
    }
  });

  it("adding a 6th top includes it without wiping a saved outfit", () => {
    const g15 = closet(5, 5, 5);
    const saved: Look = {
      id: "l_saved",
      name: "Saturday market",
      occasion: "weekend",
      garmentIds: ["t1", "b1", "s1"],
      source: "manual",
      createdAt: "2026-09-01T12:00:00.000Z",
    };
    const first = mergeLookbook([saved], buildLookbook(g15, "2026-09-12"));
    assert.ok(first.some((l) => l.id === "l_saved"));
    const g16 = [
      ...g15,
      piece({ id: "t6", name: "Grey polo", category: "top", subtype: "polo" }),
    ];
    const second = mergeLookbook(
      first,
      buildLookbook(g16, "2026-09-12"),
    );
    assert.ok(second.some((l) => l.id === "l_saved" && l.source === "manual"));
    const book = second.filter((l) => l.lookbook);
    assert.ok(
      book.some((l) => l.garmentIds.includes("t6")),
      "new top must appear in lookbook",
    );
  });

  it("empty without a full weekday trio", () => {
    assert.equal(buildLookbook(closet(5, 5, 0)).length, 0);
  });

  it("covers jackets and other-tagged loafers in cover(1)", () => {
    const g = [
      ...closet(3, 3, 3),
      piece({
        id: "j1",
        name: "Navy blazer",
        category: "other",
        subtype: "",
      }),
      piece({
        id: "j2",
        name: "Camel overcoat",
        category: "other",
        subtype: "coat",
      }),
    ];
    const looks = buildLookbook(g, "2026-09-12");
    const used = new Set(looks.flatMap((l) => l.garmentIds));
    assert.ok(used.has("j1"), "blazer tagged other must appear");
    assert.ok(used.has("j2"), "overcoat tagged other must appear");
    assert.ok(used.has("s1"), "loafer tagged other must appear");
    const stats = lookbookStats(looks, g);
    assert.equal(stats.unusedNames.length, 0);
  });

  it("force pass covers more tops than PARTNER_K heroes", () => {
    const g = [
      ...closet(8, 3, 3),
      piece({
        id: "card",
        name: "Cream cable-knit cardigan",
        category: "other",
        subtype: "",
      }),
      piece({
        id: "mules",
        name: "White mules",
        category: "other",
        subtype: "",
      }),
    ];
    const looks = buildLookbook(g, "2026-09-12");
    const used = new Set(looks.flatMap((l) => l.garmentIds));
    assert.ok(used.has("card"), "cardigan must appear");
    assert.ok(used.has("mules"), "white mules must appear");
    for (let i = 1; i <= 8; i++) assert.ok(used.has(`t${i}`), `top t${i}`);
    const stats = lookbookStats(looks, g);
    assert.equal(stats.unusedNames.length, 0);
  });

  it("90s hoodie only with jean/sneaker, never cream pleated + loafer", () => {
    const g = [
      ...closet(2, 2, 2),
      piece({
        id: "hood",
        name: "Black 90s hoodie",
        category: "outerwear",
        subtype: "hoodie",
        formality: 2,
      }),
      piece({
        id: "pleat",
        name: "Cream pleated trousers",
        category: "bottom",
        subtype: "trouser",
        formality: 4,
      }),
      piece({
        id: "jean",
        name: "Indigo jeans",
        category: "bottom",
        subtype: "jean",
        formality: 2,
      }),
      piece({
        id: "sn",
        name: "White sneakers",
        category: "footwear",
        subtype: "sneaker",
        formality: 1,
      }),
      piece({
        id: "fair",
        name: "Cream fair isle",
        category: "top",
        subtype: "knit",
      }),
      piece({
        id: "camp",
        name: "Linen camp collar",
        category: "top",
        subtype: "shirt",
        warmth: 1,
      }),
    ];
    const looks = buildLookbook(g, "2026-09-12");
    const hoodLooks = looks.filter((l) => l.garmentIds.includes("hood"));
    assert.ok(hoodLooks.length >= 1, "hoodie must still appear on weekend/jean");
    for (const l of hoodLooks) {
      assert.equal(l.occasion, "weekend");
      assert.ok(!l.garmentIds.includes("pleat"), `hoodie on pleats: ${l.name}`);
      assert.ok(!l.garmentIds.includes("s1"), `hoodie on loafers: ${l.name}`);
      assert.ok(!l.garmentIds.includes("fair"), `hoodie on fair isle: ${l.name}`);
      assert.ok(!l.garmentIds.includes("camp"), `hoodie on camp collar: ${l.name}`);
      assert.ok(
        l.garmentIds.includes("jean") || l.garmentIds.some((id) => /^b\d+$/.test(id)),
        `hoodie without jean/chino: ${l.name}`,
      );
      assert.ok(l.garmentIds.includes("sn"), `hoodie without sneaker: ${l.name}`);
    }
    for (const l of looks.filter((x) => x.garmentIds.includes("fair"))) {
      assert.ok(!l.garmentIds.includes("hood"), `fair isle look has 90s hoodie: ${l.name}`);
    }
    for (const l of looks.filter((x) => x.garmentIds.includes("camp"))) {
      assert.ok(!l.garmentIds.includes("hood"), `camp look has hoodie: ${l.name}`);
    }
    const invalid = looks.filter(
      (l) =>
        l.lookbook &&
        l.garmentIds.includes("hood") &&
        (l.garmentIds.includes("pleat") || l.garmentIds.includes("s1")),
    );
    const dropped = mergeLookbook(invalid, looks, g);
    assert.ok(!dropped.some((l) => l.garmentIds.includes("hood") && l.garmentIds.includes("pleat")));
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

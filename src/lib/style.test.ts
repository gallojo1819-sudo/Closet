import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { houseMixPenalty, pickLook, slotOf } from "./style.ts";
import type { Garment } from "./types.ts";

function piece(
  partial: Pick<Garment, "id" | "name" | "category" | "subtype"> &
    Partial<Garment>,
): Garment {
  return {
    colors: ["olive"],
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

const opts = {
  occasion: "weekday" as const,
  moment: "day" as const,
  weather: { f: 68, label: "Fair", code: 2 },
};

describe("slotOf", () => {
  it("a loafer tagged bottom is still footwear, never pants", () => {
    assert.equal(
      slotOf(piece({ id: "x", name: "Navy loafers", category: "bottom", subtype: "loafer" })),
      "footwear",
    );
    assert.equal(
      slotOf(piece({ id: "x", name: "Brown suede mules", category: "other", subtype: "" })),
      "footwear",
    );
    assert.equal(
      slotOf(piece({ id: "x", name: "Olive chinos", category: "bottom", subtype: "chino" })),
      "bottom",
    );
    assert.equal(
      slotOf(piece({ id: "x", name: "Boot cut jeans", category: "other", subtype: "jean" })),
      "bottom",
    );
    assert.equal(
      slotOf(piece({ id: "x", name: "Black 90s hoodie", category: "outerwear", subtype: "hoodie" })),
      "top",
    );
    assert.equal(
      slotOf(piece({ id: "x", name: "Flag sweatshirt", category: "top", subtype: "sweatshirt" })),
      "top",
    );
    assert.equal(
      slotOf(piece({ id: "x", name: "Navy bomber", category: "outerwear", subtype: "bomber" })),
      "outerwear",
    );
  });
});

describe("pickLook", () => {
  const tops = [1, 2, 3, 4, 5].map((n) =>
    piece({ id: `t${n}`, name: `Shirt ${n}`, category: "top", subtype: "oxford" }),
  );
  const bottoms = [1, 2, 3, 4, 5].map((n) =>
    piece({ id: `b${n}`, name: `Chino ${n}`, category: "bottom", subtype: "chino" }),
  );
  const shoes = [
    piece({ id: "s1", name: "Navy loafers", category: "other", subtype: "loafer" }),
    piece({ id: "s2", name: "White sneakers", category: "footwear", subtype: "sneaker" }),
    piece({ id: "s3", name: "Brown mules", category: "footwear", subtype: "mule" }),
    piece({ id: "s4", name: "Black boots", category: "footwear", subtype: "boot" }),
    piece({
      id: "s5",
      name: "Tan loafer",
      category: "bottom",
      subtype: "loafer",
    }),
  ];
  const closet = [...tops, ...bottoms, ...shoes];

  it("sees all 15 eligible ids, not just 3 tagged perfectly", () => {
    const seen = new Set<string>();
    let prev: string[] = [];
    for (let i = 0; i < 40; i++) {
      const ids = pickLook(closet, { ...opts, previousIds: prev });
      assert.equal(ids.length, 3, `look ${i} should be top+bottom+footwear`);
      for (const id of ids) seen.add(id);
      prev = ids;
    }
    assert.equal(seen.size, 15, `eligible ids seen: ${[...seen].join(",")}`);
  });

  it("skip 3 times yields three different triples, sharing at most one with the last", () => {
    const looks: string[][] = [];
    let prev: string[] = [];
    for (let i = 0; i < 3; i++) {
      const ids = pickLook(closet, { ...opts, previousIds: prev });
      looks.push(ids);
      if (prev.length) {
        const share = ids.filter((id) => prev.includes(id)).length;
        assert.ok(share <= 1, `skip ${i} shared ${share}: ${ids} vs ${prev}`);
      }
      prev = ids;
    }
    const keys = looks.map((ids) => [...ids].sort().join(","));
    assert.equal(new Set(keys).size, 3, `triples: ${keys.join(" | ")}`);
  });

  it("loafers are never selected as the bottom", () => {
    for (let i = 0; i < 20; i++) {
      const ids = pickLook(closet, opts);
      const pieces = ids.map((id) => closet.find((g) => g.id === id)!);
      const bottom = pieces.find((g) => slotOf(g) === "bottom");
      assert.ok(bottom, "weekday look needs a bottom");
      assert.equal(slotOf(bottom), "bottom");
      assert.doesNotMatch(
        `${bottom.subtype} ${bottom.name}`,
        /loafer|mule|sneaker|boot|shoe/i,
      );
      const feet = pieces.filter((g) => slotOf(g) === "footwear");
      for (const s of feet) {
        assert.equal(slotOf(s), "footwear");
      }
    }
  });

  it("dinner prefers trousers and loafers over jeans and sneakers", () => {
    const mix = [
      piece({ id: "tee", name: "Striped shirt", category: "top", subtype: "shirt", formality: 3 }),
      piece({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford", formality: 3 }),
      piece({ id: "jeans", name: "Cream jeans", category: "bottom", subtype: "jean", formality: 2 }),
      piece({ id: "tr", name: "Navy trousers", category: "bottom", subtype: "trouser", formality: 4 }),
      piece({ id: "sn", name: "White sneakers", category: "footwear", subtype: "sneaker", formality: 1 }),
      piece({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer", formality: 3 }),
    ];
    const prev = ["tee", "jeans", "sn"];
    for (let i = 0; i < 12; i++) {
      const ids = pickLook(mix, {
        occasion: "dinner",
        moment: "day",
        weather: opts.weather,
        previousIds: prev,
      });
      assert.ok(ids.includes("tr"), `bottom should be trousers: ${ids.join(",")}`);
      assert.ok(ids.includes("lf"), `shoes should be loafers: ${ids.join(",")}`);
      assert.ok(!ids.includes("jeans"), `dinner kept jeans: ${ids.join(",")}`);
    }
  });

  it("does not put a loafer on the legs when it is the only 'bottom' tag", () => {
    const tiny = [
      piece({ id: "t", name: "Olive shirt", category: "top", subtype: "shirt" }),
      piece({
        id: "fake",
        name: "Navy loafers",
        category: "bottom",
        subtype: "loafer",
      }),
    ];
    const ids = pickLook(tiny, opts);
    assert.ok(ids.includes("t"));
    assert.ok(ids.includes("fake"));
    assert.equal(slotOf(tiny[1]!), "footwear");
    assert.equal(ids.length, 2, "no real bottom — omit that slot");
  });

  it("does not mix a 90s hoodie with pleated trousers and loafers", () => {
    const mix = [
      piece({
        id: "hood",
        name: "Black 90s hoodie",
        category: "outerwear",
        subtype: "hoodie",
        formality: 2,
      }),
      piece({
        id: "ox",
        name: "White oxford",
        category: "top",
        subtype: "oxford",
        formality: 3,
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
        id: "lf",
        name: "Navy loafers",
        category: "footwear",
        subtype: "loafer",
        formality: 3,
      }),
      piece({
        id: "sn",
        name: "White sneakers",
        category: "footwear",
        subtype: "sneaker",
        formality: 1,
      }),
    ];
    const clash = houseMixPenalty([
      mix[0]!,
      mix[2]!,
      mix[4]!,
    ]);
    assert.ok(clash < -8, `penalty ${clash}`);
    const cool = {
      occasion: "weekday" as const,
      moment: "day" as const,
      weather: { f: 50, label: "Cool", code: 3 },
    };
    for (let i = 0; i < 16; i++) {
      const ids = pickLook(mix, cool);
      const hasHood = ids.includes("hood");
      const hasPleat = ids.includes("pleat");
      const hasLf = ids.includes("lf");
      assert.ok(
        !(hasHood && hasPleat && hasLf),
        `hoodie + pleat + loafer: ${ids.join(",")}`,
      );
    }
  });
});

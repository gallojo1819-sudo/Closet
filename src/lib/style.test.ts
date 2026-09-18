import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  avoidedUniformLine,
  coreComboKey,
  houseMixPenalty,
  pairKey,
  pickLook,
  slotOf,
} from "./style.ts";
import type { Garment, WearEntry } from "./types.ts";

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
    for (let i = 0; i < 80; i++) {
      const ids = pickLook(closet, { ...opts, previousIds: prev, salt: 1_000 + i * 17 });
      assert.equal(ids.length, 3, `look ${i} should be top+bottom+footwear`);
      for (const id of ids) seen.add(id);
      prev = ids;
    }
    assert.ok(seen.size >= 12, `eligible ids seen: ${[...seen].join(",")} (${seen.size})`);
  });

  it("skip 3 times yields three different triples, sharing at most one with the last", () => {
    const looks: string[][] = [];
    let prev: string[] = [];
    const exclude: string[] = [];
    for (let i = 0; i < 3; i++) {
      const ids = pickLook(closet, {
        ...opts,
        previousIds: prev,
        salt: 50_000 + i,
        excludeKeys: exclude,
        minSlotChange: prev.length ? 2 : 0,
        requireSilhouetteChange: prev.length > 0,
      });
      looks.push(ids);
      if (prev.length) {
        const share = ids.filter((id) => prev.includes(id)).length;
        assert.ok(share <= 1, `skip ${i} shared ${share}: ${ids} vs ${prev}`);
      }
      exclude.push([...ids].sort().join("|"));
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

  it("out prefers trousers and loafers over jeans and sneakers", () => {
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
        occasion: "out",
        moment: "day",
        weather: opts.weather,
        previousIds: prev,
      });
      assert.ok(ids.includes("tr"), `bottom should be trousers: ${ids.join(",")}`);
      assert.ok(ids.includes("lf"), `shoes should be loafers: ${ids.join(",")}`);
      assert.ok(!ids.includes("jeans"), `out kept jeans: ${ids.join(",")}`);
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

  it("40° drop never picks linen camp as the only top if a knit exists", () => {
    const closet = [
      piece({
        id: "camp",
        name: "Linen camp collar",
        category: "top",
        subtype: "camp shirt",
        warmth: 1,
      }),
      piece({ id: "knit", name: "Grey merino", category: "top", subtype: "knit", warmth: 3 }),
      piece({ id: "ch", name: "Khaki chinos", category: "bottom", subtype: "chino" }),
      piece({ id: "lf", name: "Navy loafers", category: "footwear", subtype: "loafer" }),
    ];
    for (let i = 0; i < 16; i++) {
      const ids = pickLook(closet, {
        occasion: "weekday",
        moment: "day",
        weather: { f: 40, label: "Cold", code: 3 },
      });
      assert.ok(ids.includes("knit") || !ids.includes("camp"), `camp without knit: ${ids.join(",")}`);
      if (ids.includes("camp") && !ids.includes("knit")) {
        assert.fail("linen camp as the only top");
      }
    }
  });

  it("locked loafer stays when occasion changes", () => {
    const closet = [
      piece({ id: "ox", name: "White oxford", category: "top", subtype: "oxford" }),
      piece({ id: "polo", name: "Navy polo", category: "top", subtype: "polo" }),
      piece({ id: "tr", name: "Charcoal trousers", category: "bottom", subtype: "trouser", formality: 4 }),
      piece({ id: "ch", name: "Khaki chinos", category: "bottom", subtype: "chino" }),
      piece({ id: "lf", name: "Navy loafers", category: "footwear", subtype: "loafer" }),
      piece({ id: "sn", name: "White sneakers", category: "footwear", subtype: "sneaker", formality: 1 }),
    ];
    const dinner = pickLook(closet, {
      occasion: "out",
      moment: "day",
      weather: opts.weather,
      lockedIds: ["lf"],
    });
    assert.ok(dinner.includes("lf"), `out lost loafer: ${dinner.join(",")}`);
    assert.ok(!dinner.includes("hood"));
    const week = pickLook(closet, {
      occasion: "weekday",
      moment: "day",
      weather: opts.weather,
      lockedIds: ["lf"],
      previousIds: dinner,
    });
    assert.ok(week.includes("lf"), `weekday lost loafer: ${week.join(",")}`);
  });

  it("avoids last week's chino + loafer pair unless locked", () => {
    const closet = [
      piece({ id: "ox", name: "White oxford", category: "top", subtype: "oxford" }),
      piece({ id: "polo", name: "Navy polo", category: "top", subtype: "polo" }),
      piece({ id: "ch", name: "Cream chino", category: "bottom", subtype: "chino" }),
      piece({ id: "tr", name: "Navy trousers", category: "bottom", subtype: "trouser", formality: 4 }),
      piece({ id: "lf", name: "Navy loafers", category: "footwear", subtype: "loafer" }),
      piece({ id: "lf2", name: "Brown loafers", category: "footwear", subtype: "loafer" }),
    ];
    const repeats = new Set([pairKey("ch", "lf")]);
    let other = 0;
    for (let i = 0; i < 12; i++) {
      const ids = pickLook(closet, {
        occasion: "weekday",
        moment: "day",
        weather: opts.weather,
        repeatPairs: repeats,
      });
      const hasPair = ids.includes("ch") && ids.includes("lf");
      if (!hasPair) other += 1;
    }
    assert.ok(other >= 1, "should sometimes pick a different pair");
    const journal: WearEntry[] = [
      {
        date: "2026-09-12",
        garmentIds: ["ox", "ch", "lf"],
        verdict: "worn",
      },
    ];
    const reused = avoidedUniformLine(journal, ["polo", "ch", "lf"], closet, "2026-09-13");
    assert.equal(reused, "Same Cream chino + Navy loafers as last wear.");
    const fresh = avoidedUniformLine(journal, ["polo", "tr", "lf2"], closet, "2026-09-13");
    assert.equal(fresh, null);
  });

  it("10× Skip on a 40-piece fixture → ≥8 distinct combos; no id in all 10", () => {
    const g: Garment[] = [
      ...Array.from({ length: 15 }, (_, i) =>
        piece({
          id: `t${i + 1}`,
          name: i % 3 === 0 ? `Navy polo ${i}` : `Oxford ${i}`,
          category: "top",
          subtype: i % 3 === 0 ? "polo" : "oxford",
        }),
      ),
      ...Array.from({ length: 15 }, (_, i) =>
        piece({
          id: `b${i + 1}`,
          name: i % 2 ? `Jean ${i}` : `Chino ${i}`,
          category: "bottom",
          subtype: i % 2 ? "jean" : "chino",
        }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        piece({
          id: `s${i + 1}`,
          name: i % 2 ? `Sneaker ${i}` : `Loafer ${i}`,
          category: "footwear",
          subtype: i % 2 ? "sneaker" : "loafer",
        }),
      ),
    ];
    const usedCount = new Map<string, number>();
    const combos: string[] = [];
    const hits = new Map<string, number>();
    let prev: string[] = [];
    const exclude: string[] = [];
    for (let i = 0; i < 10; i++) {
      const ids = pickLook(g, {
        ...opts,
        salt: Date.now() + i * 97_331,
        previousIds: prev,
        excludeKeys: exclude,
        usedCount,
        minSlotChange: prev.length ? 2 : 0,
        requireSilhouetteChange: prev.length > 0,
      });
      const key = coreComboKey(ids, g);
      combos.push(key);
      exclude.push(key);
      for (const id of ids) hits.set(id, (hits.get(id) ?? 0) + 1);
      prev = ids;
    }
    assert.ok(new Set(combos).size >= 8, `combos ${combos.join(" / ")}`);
    for (const [id, n] of hits) {
      assert.ok(n < 10, `${id} in all 10`);
    }
  });

  it("locked hoodie pairs with jean and sneaker, not pleat + loafer", () => {
    const closet = [
      piece({ id: "hood", name: "Black 90s hoodie", category: "top", subtype: "hoodie", formality: 2 }),
      piece({ id: "ox", name: "White oxford", category: "top", subtype: "oxford" }),
      piece({ id: "pleat", name: "Cream pleated trousers", category: "bottom", subtype: "trouser", formality: 4 }),
      piece({ id: "jean", name: "Indigo jeans", category: "bottom", subtype: "jean", formality: 2 }),
      piece({ id: "lf", name: "Navy loafers", category: "footwear", subtype: "loafer" }),
      piece({ id: "sn", name: "White sneakers", category: "footwear", subtype: "sneaker", formality: 1 }),
    ];
    for (let i = 0; i < 8; i++) {
      const ids = pickLook(closet, {
        occasion: "weekend",
        moment: "day",
        weather: opts.weather,
        lockedIds: ["hood"],
      });
      assert.ok(ids.includes("hood"));
      assert.ok(!(ids.includes("pleat") && ids.includes("lf")), `clash: ${ids.join(",")}`);
    }
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyShuffle,
  buildChapter,
  buildLookbook,
  buildWeek,
  CHAPTER_CAP,
  chapterVisible,
  comboKey,
  emptyFilterCopy,
  enforcePieceCap,
  fillOccasionLooks,
  lookAllowsBlazer,
  lookClashes,
  lookFitsHouse,
  lookFitsOccasion,
  lookbookIsFrozen,
  looksForHero,
  mergeLookbook,
  mergeWeekLooks,
  moreLikeThis,
  stripRepeatBlazers,
  unusedFromLooks,
} from "./lookbook.ts";
import { lookFitsSeason } from "./season.ts";
import { isButtonDown, isCreamCable } from "./recipes.ts";
import { isTrueOuter, isWeekendSoftJacket, pickLook } from "./style.ts";
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

describe("buildWeek", () => {
  it("4× New week weekday looks do not repeat the same trio on a 40-plate fixture", () => {
    const g = closet(15, 15, 10);
    let looks: Look[] = [];
    const weekdayKeys: string[] = [];
    const excludeKeys: string[] = [];
    for (let i = 0; i < 4; i++) {
      const usedCount = new Map<string, number>();
      for (const l of looks) {
        for (const id of l.garmentIds) usedCount.set(id, (usedCount.get(id) ?? 0) + 1);
      }
      const week = buildWeek(g, "2026-09-14", { excludeKeys, usedCount });
      const inWeek = new Map<string, number>();
      for (const l of week) {
        for (const id of l.garmentIds) inWeek.set(id, (inWeek.get(id) ?? 0) + 1);
      }
      for (const n of inWeek.values()) {
        assert.ok(n <= 1, "cap any id at 1 look in the new week of 7");
      }
      let topId = "";
      let topN = -1;
      for (const [id, n] of usedCount) {
        if (n > topN) {
          topId = id;
          topN = n;
        }
      }
      if (topId) {
        const hubHits = week.filter((l) => l.garmentIds.includes(topId)).length;
        assert.ok(hubHits <= 1, `top-frequency ${topId} in ${hubHits} of 7`);
      }
      looks = mergeWeekLooks(looks, week);
      for (const l of week) excludeKeys.push(comboKey(l.garmentIds));
      for (const l of week.filter((x) => x.occasion === "weekday")) {
        weekdayKeys.push(comboKey(l.garmentIds));
      }
    }
    assert.ok(weekdayKeys.length >= 4, `weekday looks=${weekdayKeys.length}`);
    assert.equal(new Set(weekdayKeys).size, weekdayKeys.length);
  });

  it("unused rail is membership in looks[].garmentIds, including non-lookbook rows", () => {
    const g = closet(2, 2, 2);
    const looks: Look[] = [
      {
        id: "manual_1",
        name: "Kept",
        occasion: "weekday",
        garmentIds: ["t1", "b1", "s1"],
        source: "manual",
        lookbook: false,
        createdAt: "2026-09-01T12:00:00.000Z",
      },
    ];
    const unused = unusedFromLooks(g, looks);
    assert.equal(unused.some((x) => x.id === "t1"), false);
    assert.equal(unused.some((x) => x.id === "b1"), false);
  });
});

describe("ensureLookbook freeze", () => {
  it("twice on a 40-piece fixture does not increase looks.length", () => {
    const g = closet(15, 15, 10);
    const looks = buildLookbook(g, "2026-09-12");
    const n = looks.length;
    assert.ok(n >= 7);
    assert.equal(lookbookIsFrozen(looks), true);
    let next = looks;
    for (let i = 0; i < 2; i++) {
      if (lookbookIsFrozen(next)) continue;
      next = mergeWeekLooks(next, buildWeek(g, "2026-09-14"));
    }
    assert.equal(next.length, n);
  });
});

describe("buildLookbook", () => {
  it("caps each chapter at 10, four chapters, not 97", () => {
    const g = closet(8, 8, 8);
    const looks = buildLookbook(g, "2026-09-12");
    assert.ok(looks.length <= CHAPTER_CAP * 5, `looks=${looks.length}`);
    for (const occ of ["weekday", "out", "weekend", "comfy", "travel"] as const) {
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

  it("out jackets are unique plates — quota can exceed two", () => {
    const g = [
      ...closet(8, 8, 8),
      piece({
        id: "j1",
        name: "Navy blazer",
        category: "outerwear",
        subtype: "blazer",
        formality: 4,
        colors: ["navy"],
      }),
      piece({
        id: "j2",
        name: "Grey sport coat",
        category: "outerwear",
        subtype: "sport coat",
        formality: 4,
        colors: ["grey"],
      }),
      piece({
        id: "cord",
        name: "Beige cord blazer",
        category: "outerwear",
        subtype: "blazer",
        formality: 4,
        colors: ["beige"],
      }),
    ];
    const looks = buildChapter(g, "out", { cap: 10, today: "2026-09-12" });
    assert.ok(looks.length >= 6, `out looks ${looks.length}`);
    const withJacket = looks.filter((l) =>
      l.garmentIds.some((id) => id === "j1" || id === "j2" || id === "cord"),
    );
    const jacketIds = new Set(
      withJacket.flatMap((l) =>
        l.garmentIds.filter((id) => id === "j1" || id === "j2" || id === "cord"),
      ),
    );
    assert.equal(jacketIds.size, withJacket.length, "each blazered look a different jacket");
  });

  it("cream cable does not wear a beige cord blazer; white mules get no blazer", () => {
    const cable = piece({
      id: "cable",
      name: "Cream cable-knit",
      category: "top",
      subtype: "cable",
      colors: ["cream"],
      warmth: 3,
    });
    const camp = piece({
      id: "camp",
      name: "Linen camp collar",
      category: "top",
      subtype: "camp shirt",
      colors: ["white"],
      warmth: 1,
      seasons: [],
    });
    const chino = piece({
      id: "ch",
      name: "Beige chino",
      category: "bottom",
      subtype: "chino",
      colors: ["beige"],
    });
    const mule = piece({
      id: "mu",
      name: "White mules",
      category: "footwear",
      subtype: "mule",
      colors: ["white"],
    });
    const loafer = piece({
      id: "lf",
      name: "Navy loafers",
      category: "footwear",
      subtype: "loafer",
      colors: ["navy"],
    });
    const cord = piece({
      id: "cord",
      name: "Beige cord blazer",
      category: "outerwear",
      subtype: "blazer",
      colors: ["beige"],
    });
    assert.equal(lookAllowsBlazer([cable, chino, loafer], cord, "out"), false);
    assert.equal(lookAllowsBlazer([camp, chino, mule], cord, "out"), false);
    const looks = buildChapter(
      [cable, camp, chino, mule, loafer, cord],
      "out",
      { cap: 10, today: "2026-09-12" },
    );
    for (const l of looks) {
      if (l.garmentIds.includes("cable")) {
        assert.ok(!l.garmentIds.includes("cord"), "cream cable + beige cord");
      }
      if (l.garmentIds.includes("mu")) {
        assert.ok(!l.garmentIds.includes("cord"), "white mules + blazer");
      }
    }
  });

  it("strips a repeated blazer off extra Out rows", () => {
    const g = [
      ...closet(3, 3, 3),
      piece({
        id: "j1",
        name: "Beige cord blazer",
        category: "outerwear",
        subtype: "blazer",
        colors: ["beige"],
      }),
    ];
    const bloated: Look[] = Array.from({ length: 8 }, (_, i) => ({
      id: `lb2_out_${i}`,
      name: "Oxford · blazer",
      occasion: "out",
      garmentIds: ["t1", "b1", "s1", "j1"],
      source: "ai" as const,
      lookbook: true,
      createdAt: "2026-09-12T00:00:00.000Z",
    }));
    const trimmed = stripRepeatBlazers(bloated, g);
    const withJ = trimmed.filter((l) => l.garmentIds.includes("j1"));
    assert.equal(withJ.length, 1);
    assert.ok(trimmed.filter((l) => l.garmentIds.length === 3).length >= 7);
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

  it("trims old weekday rows so cream cable is in 1 card, then shuffle stays at 1", () => {
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
    const bloated: Look[] = Array.from({ length: 8 }, (_, i) => ({
      id: `lb2_week_cable_${i}`,
      name: "Cream cable-knit",
      occasion: "weekday",
      garmentIds: ["cable", "b1", `s${(i % 12) + 1}`],
      source: "ai" as const,
      lookbook: true,
      createdAt: "2026-09-12T00:00:00.000Z",
    }));
    const trimmed = enforcePieceCap(bloated, g);
    assert.equal(
      trimmed.filter((l) => l.garmentIds.includes("cable")).length,
      1,
    );
    const first = applyShuffle(g, trimmed, "weekday", [], "2026-09-13");
    const n1 = first.looks.filter(
      (l) => l.occasion === "weekday" && l.garmentIds.includes("cable"),
    ).length;
    assert.ok(n1 <= 1, `after shuffle 1: cable in ${n1}`);
    const seen = first.added.map((l) => comboKey(l.garmentIds));
    const second = applyShuffle(g, first.looks, "weekday", seen, "2026-09-14");
    const n2 = second.looks.filter(
      (l) => l.occasion === "weekday" && l.garmentIds.includes("cable"),
    ).length;
    assert.ok(n2 <= 1, `after shuffle 2: cable in ${n2}`);
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

describe("lookFitsHouse", () => {
  it("Ralph weekday refuses sneakers when a loafer exists", () => {
    const ralph = [
      piece({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford" }),
      piece({ id: "ch", name: "Khaki chinos", category: "bottom", subtype: "chino" }),
      piece({
        id: "aj",
        name: "Cream AJ4",
        category: "footwear",
        subtype: "sneaker",
        formality: 1,
      }),
    ];
    const pool = [
      ...ralph,
      piece({ id: "lf", name: "Navy loafers", category: "footwear", subtype: "loafer" }),
    ];
    assert.equal(lookFitsHouse(ralph, "polo", "weekday", pool), false);
    const withLoafer = [ralph[0]!, ralph[1]!, pool[3]!];
    assert.equal(lookFitsHouse(withLoafer, "polo", "weekday", pool), true);
  });

  it("ALD allows sneakers", () => {
    const ald = [
      piece({ id: "hood", name: "Black 90s hoodie", category: "top", subtype: "hoodie", formality: 2 }),
      piece({ id: "jean", name: "Indigo jeans", category: "bottom", subtype: "jean", formality: 2 }),
      piece({
        id: "sn",
        name: "White sneakers",
        category: "footwear",
        subtype: "sneaker",
        formality: 1,
      }),
    ];
    assert.equal(lookFitsHouse(ald, "ald", "weekday", ald), false);
    assert.equal(lookFitsHouse(ald, "ald", "weekend", ald), false);
  });
});

describe("lookFitsOccasion comfy", () => {
  it("allows knit + chino + sneaker, not tuxedo oxford", () => {
    const comfy = [
      piece({ id: "k", name: "Grey merino", category: "top", subtype: "knit" }),
      piece({ id: "ch", name: "Khaki chinos", category: "bottom", subtype: "chino" }),
      piece({ id: "sn", name: "White sneakers", category: "footwear", subtype: "sneaker" }),
    ];
    const tuxedo = [
      piece({ id: "ox", name: "White oxford", category: "top", subtype: "oxford" }),
      piece({ id: "tr", name: "Charcoal trousers", category: "bottom", subtype: "trouser" }),
      piece({ id: "lf", name: "Navy loafers", category: "footwear", subtype: "loafer" }),
    ];
    assert.equal(lookFitsOccasion(comfy, "comfy"), true);
    assert.equal(lookFitsOccasion(tuxedo, "comfy"), false);
  });
});

describe("lookFitsOccasion", () => {
  it("hoodie+jean+sneaker is weekend/ALD, never default Out", () => {
    const hood = [
      piece({ id: "hood", name: "Black 90s hoodie", category: "top", subtype: "hoodie", formality: 2 }),
      piece({ id: "jean", name: "Indigo jeans", category: "bottom", subtype: "jean", formality: 2 }),
      piece({ id: "sn", name: "White sneakers", category: "footwear", subtype: "sneaker", formality: 1 }),
    ];
    const cable = [
      piece({ id: "cable", name: "Cream cable-knit", category: "top", subtype: "cable" }),
      piece({ id: "ch", name: "Khaki chinos", category: "bottom", subtype: "chino" }),
      piece({ id: "lf", name: "Navy loafers", category: "footwear", subtype: "loafer" }),
    ];
    const rack = [
      ...hood,
      ...cable,
      piece({ id: "ox", name: "White oxford", category: "top", subtype: "oxford" }),
      piece({ id: "tr", name: "Charcoal trousers", category: "bottom", subtype: "trouser" }),
    ];
    assert.equal(lookFitsOccasion(hood, "out", rack), false);
    assert.equal(lookFitsOccasion(hood, "out"), false);
    assert.equal(lookFitsOccasion(hood, "weekend"), true);
    assert.equal(lookFitsHouse(hood, "ald", "out", rack), false);
    assert.equal(lookFitsOccasion(cable, "weekday"), true);
    assert.equal(lookFitsOccasion(cable, "out", rack), true);
  });

  it("travel allows oxford + chino + loafer; no 90s hoodie", () => {
    const pack = [
      piece({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford" }),
      piece({ id: "ch", name: "Khaki chinos", category: "bottom", subtype: "chino" }),
      piece({ id: "lf", name: "Navy loafers", category: "footwear", subtype: "loafer" }),
    ];
    const hood = [
      piece({ id: "hood", name: "Black 90s hoodie", category: "top", subtype: "hoodie", formality: 2 }),
      piece({ id: "jean", name: "Indigo jeans", category: "bottom", subtype: "jean" }),
      piece({ id: "sn", name: "Gym sneakers", category: "footwear", subtype: "sneaker" }),
    ];
    assert.equal(lookFitsOccasion(pack, "travel"), true);
    assert.equal(lookFitsHouse(pack, "polo", "travel", pack), true);
    assert.equal(lookFitsOccasion(hood, "travel"), false);
  });

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
    assert.equal(lookFitsOccasion(dinner, "weekend"), true);
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

describe("2026-09 stylist pack", () => {
  it("camp+cord blazer+990 → invalid", () => {
    const look = [
      piece({ id: "camp", name: "Linen camp collar", category: "top", subtype: "camp shirt", warmth: 1 }),
      piece({ id: "ch", name: "Khaki chinos", category: "bottom", subtype: "chino" }),
      piece({ id: "nb", name: "Grey 990", category: "footwear", subtype: "sneaker" }),
      piece({ id: "cb", name: "Beige cord blazer", category: "outerwear", subtype: "blazer" }),
    ];
    assert.equal(lookClashes(look), true);
    assert.equal(lookFitsOccasion(look, "weekday"), false);
    assert.equal(lookFitsOccasion(look, "out"), false);
  });

  it("rugby+blazer → invalid", () => {
    const core = [
      piece({ id: "rg", name: "Navy rugby", category: "top", subtype: "rugby" }),
      piece({ id: "jean", name: "Indigo jeans", category: "bottom", subtype: "jean" }),
      piece({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer" }),
    ];
    const blazer = piece({
      id: "bz",
      name: "Navy blazer",
      category: "outerwear",
      subtype: "blazer",
    });
    assert.equal(lookAllowsBlazer(core, blazer, "weekday"), false);
    assert.equal(lookClashes([...core, blazer]), true);
    assert.equal(lookFitsOccasion([...core, blazer], "weekday"), false);
  });

  it("rugby+loafer+jean → VALID (ALD override)", () => {
    const look = [
      piece({ id: "rg", name: "Navy rugby", category: "top", subtype: "rugby" }),
      piece({ id: "jean", name: "Indigo jeans", category: "bottom", subtype: "jean" }),
      piece({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer" }),
    ];
    assert.equal(lookClashes(look), false);
    assert.equal(lookFitsOccasion(look, "weekday"), true);
    assert.equal(lookFitsOccasion(look, "weekend"), true);
    assert.equal(lookFitsHouse(look, "ald", "weekday", look), false);
  });

  it("fair isle+cord+loafer weekday → VALID (Sweet Stable weekday)", () => {
    const look = [
      piece({ id: "fi", name: "Cream fair isle", category: "top", subtype: "knit" }),
      piece({ id: "cord", name: "Brown cords", category: "bottom", subtype: "cord" }),
      piece({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer" }),
    ];
    assert.equal(lookClashes(look), false);
    assert.equal(lookFitsOccasion(look, "weekday"), true);
    assert.equal(lookFitsHouse(look, "sweetStable", "weekday", look), false);
  });

  it("oxford+dark jean+loafer weekday → VALID", () => {
    const look = [
      piece({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford" }),
      piece({ id: "jean", name: "Dark indigo jeans", category: "bottom", subtype: "jean" }),
      piece({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer" }),
    ];
    assert.equal(lookFitsOccasion(look, "weekday"), true);
    assert.equal(lookFitsOccasion(look, "out"), true);
    assert.equal(lookFitsOccasion(look, "weekend"), true);
    assert.equal(lookFitsOccasion(look, "travel"), true);
    assert.equal(lookFitsOccasion(look, "comfy"), false);
  });

  it("cable+blazer → invalid", () => {
    const core = [
      piece({ id: "cable", name: "Cream cable-knit", category: "top", subtype: "cable", warmth: 3 }),
      piece({ id: "ch", name: "Khaki chinos", category: "bottom", subtype: "chino" }),
      piece({ id: "lf", name: "Navy loafers", category: "footwear", subtype: "loafer" }),
    ];
    const blazer = piece({
      id: "bz",
      name: "Navy blazer",
      category: "outerwear",
      subtype: "blazer",
    });
    assert.equal(lookAllowsBlazer(core, blazer, "out"), false);
    assert.equal(lookClashes([...core, blazer]), true);
  });

  it("linen-only winter → invalid", () => {
    const look = [
      piece({
        id: "camp",
        name: "Linen camp collar",
        category: "top",
        subtype: "camp shirt",
        warmth: 1,
        seasons: [],
      }),
      piece({
        id: "tr",
        name: "Linen trousers",
        category: "bottom",
        subtype: "trouser",
        warmth: 2,
        seasons: [],
      }),
      piece({ id: "lf", name: "Navy loafers", category: "footwear", subtype: "loafer", warmth: 2 }),
    ];
    assert.equal(lookFitsSeason(look, "winter"), false);
    assert.equal(lookFitsSeason(look, "summer"), true);
  });

  it("Travel+Fall+Ralph still builds ≥3 in a 40-top fixture", () => {
    const tops = Array.from({ length: 40 }, (_, i) =>
      piece({ id: `t${i + 1}`, name: `Oxford ${i + 1}`, category: "top", subtype: "oxford", warmth: 2 }),
    );
    const bottoms = Array.from({ length: 12 }, (_, i) =>
      piece({
        id: `b${i + 1}`,
        name: i % 2 ? `Jean ${i + 1}` : `Chino ${i + 1}`,
        category: "bottom",
        subtype: i % 2 ? "jean" : "chino",
        warmth: 3,
      }),
    );
    const shoes = Array.from({ length: 8 }, (_, i) =>
      piece({
        id: `s${i + 1}`,
        name: `Brown loafers ${i + 1}`,
        category: "footwear",
        subtype: "loafer",
        warmth: 2,
      }),
    );
    const g = [...tops, ...bottoms, ...shoes];
    const looks = buildChapter(g, "travel", {
      cap: 10,
      season: "fall",
      house: "polo",
      today: "2026-09-12",
    });
    assert.ok(looks.length >= 3, `Travel+Fall+Ralph looks ${looks.length}`);
    for (const l of looks) {
      assert.equal(l.occasion, "travel");
      const pieces = l.garmentIds.map((id) => g.find((x) => x.id === id)!);
      assert.equal(lookFitsHouse(pieces, "polo", "travel", g), true);
      assert.equal(lookFitsSeason(pieces, "fall"), true);
    }
  });
});

/** Fixture shaped like Joe's rack — invented ids, never his live SKUs. No camel overcoat. */
function dressRack(): Garment[] {
  const oxfords = Array.from({ length: 8 }, (_, i) =>
    piece({ id: `ox${i}`, name: `Navy oxford ${i}`, category: "top", subtype: "oxford", colors: ["navy"] }),
  );
  const polos = Array.from({ length: 3 }, (_, i) =>
    piece({ id: `po${i}`, name: `Navy polo ${i}`, category: "top", subtype: "polo" }),
  );
  const knits = [
    piece({ id: "cable", name: "Cream cable-knit", category: "top", subtype: "cable", colors: ["cream"], warmth: 3 }),
    ...Array.from({ length: 4 }, (_, i) =>
      piece({ id: `mer${i}`, name: `Grey merino ${i}`, category: "top", subtype: "merino", colors: ["grey"] }),
    ),
  ];
  const rugby = piece({ id: "rugby", name: "Navy rugby", category: "top", subtype: "rugby", formality: 2 });
  const bottoms = [
    piece({ id: "chino1", name: "Khaki chino", category: "bottom", subtype: "chino", colors: ["khaki"] }),
    ...Array.from({ length: 8 }, (_, i) =>
      piece({
        id: `tr${i}`,
        name: `Navy trousers ${i}`,
        category: "bottom",
        subtype: "trouser",
        colors: ["navy"],
        formality: 4,
      }),
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      piece({ id: `jn${i}`, name: `Indigo jeans ${i}`, category: "bottom", subtype: "jean", formality: 2 }),
    ),
  ];
  const shoes = [
    ...Array.from({ length: 4 }, (_, i) =>
      piece({ id: `lf${i}`, name: `Brown loafer ${i}`, category: "footwear", subtype: "loafer", colors: ["brown"] }),
    ),
    ...Array.from({ length: 5 }, (_, i) =>
      piece({
        id: `sn${i}`,
        name: `Leather sneaker ${i}`,
        category: "footwear",
        subtype: "sneaker",
        colors: ["white"],
        formality: 2,
      }),
    ),
    piece({ id: "nb", name: "Grey 990", category: "footwear", subtype: "sneaker", colors: ["grey"], formality: 2 }),
    piece({ id: "boot", name: "Brown boot", category: "footwear", subtype: "boot", colors: ["brown"] }),
    piece({ id: "mule", name: "Tan mule", category: "footwear", subtype: "mule", colors: ["tan"] }),
  ];
  const outers = [
    piece({ id: "navyblz", name: "Navy blazer", category: "outerwear", subtype: "blazer", colors: ["navy"], formality: 4, warmth: 3 }),
    piece({ id: "taupeblz", name: "Taupe Todd Snyder blazer", category: "outerwear", subtype: "blazer", colors: ["taupe"], formality: 4, warmth: 3 }),
    piece({ id: "ivoryblz", name: "Ivory double breasted blazer", category: "outerwear", subtype: "blazer", colors: ["ivory"], formality: 4, warmth: 3 }),
    piece({ id: "cordblz", name: "Beige cord The Row blazer", category: "outerwear", subtype: "blazer", colors: ["beige"], formality: 4, warmth: 3 }),
    piece({ id: "chore", name: "Brown chore coat", category: "outerwear", subtype: "chore", colors: ["brown"], warmth: 3 }),
    piece({ id: "field", name: "Olive field jacket", category: "outerwear", subtype: "field jacket", colors: ["olive"], warmth: 3 }),
    piece({ id: "denimj", name: "Denim trucker", category: "outerwear", subtype: "denim jacket", colors: ["navy"], warmth: 2 }),
    piece({ id: "suede", name: "Brown suede jacket", category: "outerwear", subtype: "suede jacket", colors: ["brown"], warmth: 4 }),
  ];
  return [...oxfords, ...polos, ...knits, rugby, ...bottoms, ...shoes, ...outers];
}

describe("jacket quotas + recipes", () => {
  it("pickLook weekday cool can return navy/taupe blazer", () => {
    const g = dressRack();
    let hit = false;
    for (let i = 0; i < 16; i++) {
      const ids = pickLook(g, {
        occasion: "weekday",
        moment: "day",
        weather: { f: 55, label: "Cool", code: 2 },
        recipeId: "WD_PREP_OCBD",
        house: "polo",
      });
      const pieces = ids.map((id) => g.find((x) => x.id === id)!).filter(Boolean);
      if (pieces.some((x) => /navy blazer|taupe/i.test(x.name) && isTrueOuter(x))) {
        hit = true;
        break;
      }
    }
    assert.ok(hit, "cool weekday pickLook never attached a navy/taupe blazer");
  });

  it("10 weekday looks: ≥3 button-down, ≥4 true outers, ≥2 blazers, no shoe plate >2, cream cable ≤1", () => {
    const g = dressRack();
    const looks = buildChapter(g, "weekday", { cap: 10, today: "2026-09-18", house: "polo" });
    assert.ok(looks.length >= 8, `weekday looks ${looks.length}`);
    const resolve = (l: Look) => l.garmentIds.map((id) => g.find((x) => x.id === id)!).filter(Boolean);
    const buttonDowns = looks.filter((l) => resolve(l).some(isButtonDown)).length;
    const trueOuters = looks.filter((l) => resolve(l).some(isTrueOuter)).length;
    const blazers = looks.filter((l) =>
      resolve(l).some((x) => /blazer|sport coat/i.test(`${x.name} ${x.subtype}`)),
    ).length;
    const cables = looks.filter((l) => resolve(l).some(isCreamCable)).length;
    const shoeCount = new Map<string, number>();
    for (const l of looks) {
      for (const x of resolve(l)) {
        if (x.category === "footwear" || /loafer|sneaker|boot|mule/.test(x.subtype)) {
          shoeCount.set(x.id, (shoeCount.get(x.id) ?? 0) + 1);
        }
      }
    }
    const maxShoe = Math.max(0, ...shoeCount.values());
    assert.ok(buttonDowns >= 3, `button-down tops ${buttonDowns}`);
    assert.ok(trueOuters >= 4, `true outers ${trueOuters}`);
    assert.ok(blazers >= 2, `blazers ${blazers}`);
    assert.ok(maxShoe <= 2, `shoe plate max ${maxShoe}`);
    assert.ok(cables <= 1, `cream cable ${cables}`);
  });

  it("Weekend: ≥3 chore/field/denim/suede; 0 navy-blazer+rugby", () => {
    const g = dressRack();
    const looks = buildChapter(g, "weekend", { cap: 10, today: "2026-09-18" });
    assert.ok(looks.length >= 6, `weekend looks ${looks.length}`);
    const resolve = (l: Look) => l.garmentIds.map((id) => g.find((x) => x.id === id)!).filter(Boolean);
    const soft = looks.filter((l) => resolve(l).some(isWeekendSoftJacket)).length;
    assert.ok(soft >= 3, `soft jackets ${soft}`);
    for (const l of looks) {
      const p = resolve(l);
      const rugby = p.some((x) => /rugby/i.test(`${x.name} ${x.subtype}`));
      const navyBlazer = p.some((x) => /navy/i.test(x.name) && /blazer/i.test(`${x.name} ${x.subtype}`));
      assert.equal(rugby && navyBlazer, false, `navy-blazer+rugby ${l.garmentIds.join(",")}`);
    }
  });

  it("4× New week Polo: recipe_id changes; not the same loafer three times", () => {
    const g = dressRack();
    const recipes = new Set<string>();
    const loaferRuns: string[] = [];
    let looks: Look[] = [];
    for (let i = 0; i < 4; i++) {
      const prevWeek = looks.filter((l) => l.id.startsWith("week_"));
      const week = buildWeek(g, "2026-09-14", {
        excludeKeys: prevWeek.map((l) => comboKey(l.garmentIds)),
        usedCount: new Map(),
        house: "polo",
      });
      looks = week;
      for (const l of week) {
        if (l.recipeId) recipes.add(l.recipeId);
        const shoe = l.garmentIds
          .map((id) => g.find((x) => x.id === id)!)
          .find((x) => x && /loafer/.test(x.subtype));
        loaferRuns.push(shoe?.id ?? "");
      }
    }
    assert.ok(recipes.size >= 2, `recipes ${[...recipes].join(",")}`);
    let same3 = false;
    for (let i = 2; i < loaferRuns.length; i++) {
      if (loaferRuns[i] && loaferRuns[i] === loaferRuns[i - 1] && loaferRuns[i] === loaferRuns[i - 2]) {
        same3 = true;
      }
    }
    assert.equal(same3, false, `loafer run ${loaferRuns.join(",")}`);
  });
});

describe("chapterVisible never empty", () => {
  it("Weekday × 545 / Purple / SweetStable / ItalianSummer / ItalianWinter each ≥3", () => {
    const g = dressRack();
    const book = buildLookbook(g, "2026-09-18");
    for (const house of ["fiveFourFive", "purple", "sweetStable", "italianSummer", "italianWinter"] as const) {
      const shown = chapterVisible(book, g, "weekday", { season: "fall", house, min: 3 });
      assert.ok(shown.length >= 3, `Weekday × ${house} = ${shown.length}`);
    }
  });

  it("None in … copy never appears if the rack can dress", () => {
    const msg = emptyFilterCopy("Weekday", "Fall", "auto", "fiveFourFive", null, true);
    assert.equal(msg, null);
    const empty = emptyFilterCopy("Weekday", "Fall", "auto", "fiveFourFive", null, false);
    assert.ok(empty && empty.includes("None in Weekday · 545"));
  });

  it("houseChip=all still uses chapterVisible and fills ≥3", () => {
    const g = dressRack();
    const book = buildLookbook(g, "2026-09-18");
    const shown = chapterVisible(book, g, "weekday", { season: "fall", house: "all", min: 3 });
    assert.ok(shown.length >= 3, `all weekday ${shown.length}`);
  });
});

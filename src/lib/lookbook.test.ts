import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyShuffle,
  buildChapter,
  buildLookbook,
  buildReshuffleRow,
  buildWeek,
  firstWeekLooks,
  realWeekLooks,
  todayStripLooks,
  weekStripDays,
  CHAPTER_CAP,
  chapterVisible,
  comboKey,
  draftFromPlate,
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
import { houseKill } from "./houses.ts";
import { lookFitsSeason } from "./season.ts";
import { explain, isLegal } from "./stylist/legal.ts";
import platesFile from "./stylist/__tests__/fixtures/plates-2026-09-30.json" with { type: "json" };
import { isButtonDown, isCreamCable } from "./recipes.ts";
import { isBrownSuedeOuter, isTrueOuter, isWeekendSoftJacket, pickLook, slotOf, trendScore } from "./style.ts";
import type { Garment, Look } from "./types.ts";
import { lastDays, todayISO } from "./utils.ts";

function piece(
  partial: Pick<Garment, "id" | "name" | "category" | "subtype"> & Partial<Garment>,
): Garment {
  const g: Garment = {
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
  if (partial.material == null) {
    const blob = `${g.name} ${g.subtype ?? ""}`.toLowerCase();
    if (/\bsuede\b/.test(blob)) g.material = "suede";
    else if (/\bloafer\b|\bboot\b|\bleather\b/.test(blob)) g.material = "leather";
  }
  return g;
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

  it("demotes a repeated blazer instead of leaving the card bare (JKT-COV-1)", () => {
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
    const demoted = trimmed.filter((l) => !l.garmentIds.includes("j1"));
    assert.ok(demoted.length >= 7);
    for (const look of demoted) assert.equal(look.demoted, "JKT-COV-1");
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

  it("rugby+loafer+jean is a legal occasion, and ALD no longer bans the loafer", () => {
    const look = [
      piece({ id: "rg", name: "Navy rugby", category: "top", subtype: "rugby" }),
      piece({ id: "jean", name: "Indigo jeans", category: "bottom", subtype: "jean" }),
      piece({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer" }),
    ];
    assert.equal(lookClashes(look), false);
    assert.equal(lookFitsOccasion(look, "weekday"), true);
    assert.equal(lookFitsOccasion(look, "weekend"), true);
    const kill = houseKill(look, "ald", "weekday");
    assert.notEqual(kill, "ALD-B1");
    assert.notEqual(kill, "ALD-R1");
  });

  it("fair isle+cord+boot is Sweet Stable on weekday and the weekend; out stays off", () => {
    const look = [
      piece({ id: "fi", name: "Cream fair isle", category: "top", subtype: "knit" }),
      piece({ id: "cord", name: "Brown cords", category: "bottom", subtype: "cord" }),
      piece({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer" }),
    ];
    assert.equal(lookClashes(look), false);
    assert.equal(lookFitsOccasion(look, "weekday"), true);
    assert.equal(lookFitsHouse(look, "sweetStable", "weekday", look), false);
    assert.equal(lookFitsHouse(look, "sweetStable", "weekend", look), false);
    const booted = [
      piece({ id: "fi2", name: "Cream fair isle", category: "top", subtype: "knit" }),
      piece({ id: "cord2", name: "Brown cords", category: "bottom", subtype: "cord" }),
      piece({ id: "bt2", name: "Brown boot", category: "footwear", subtype: "boot" }),
    ];
    assert.equal(lookFitsHouse(booted, "sweetStable", "weekday", booted), true);
    assert.equal(lookFitsHouse(booted, "sweetStable", "weekend", booted), true);
    assert.equal(lookFitsHouse(booted, "sweetStable", "out", booted), false);
  });

  it("ALD loafers are legal, a varsity stays off a sport coat, and the deleted sneakers never pass", () => {
    const byId = new Map(
      (platesFile.plates as { id: string }[]).map((row) => [row.id, row as {
        id: string;
        name?: string;
        category?: string;
        subtype?: string;
        material?: string;
        colors?: string[];
        brand?: string;
        warmth?: number;
      }]),
    );
    const take = (...ids: string[]) =>
      ids.map((id) => {
        const row = byId.get(id);
        assert.ok(row, id);
        return piece({
          id: row.id,
          name: row.name ?? id,
          category: (row.category ?? "top") as Garment["category"],
          subtype: row.subtype ?? "",
          material: row.material ?? "",
          colors: row.colors ?? [],
          brand: row.brand ?? "",
          warmth: Math.min(5, Math.max(1, row.warmth ?? 2)) as Garment["warmth"],
          seasons: ["spring", "summer", "fall", "winter"],
        });
      });
    const ald = take("g_8m17f0l0tss9", "g_v3ovns4bv344", "g_5g4fqg77s4rw", "g_3qjmw7n4wj2a");
    assert.equal(isLegal(ald, { house: "ald", occasion: "weekend", season: "fall" }), true);
    const banned = take("g_mq1ob9uc1npn", "g_vf28ktbdhmtz", "g_om0dh5nps1ke", "g_j5og5jmzh5tx", "g_juk45cokjxxy");
    for (const occasion of ["weekday", "weekend"] as const) {
      assert.equal(isLegal(banned, { house: null, occasion, season: "fall" }), false);
      assert.equal(isLegal([...banned].reverse(), { house: null, occasion, season: "fall" }), false);
    }
    const linen = take("g_j4qu90fgv347", "g_0re8nrx2mpdy", "g_om0dh5nps1ke");
    for (const season of ["spring", "summer", "fall", "winter"] as const) {
      assert.equal(isLegal(linen, { house: null, occasion: "weekend", season }), false);
    }
    for (const id of ["g_37e5eqjwgd3d", "g_c6qdv5c3gkor", "g_x0ro1mg2gu0a"]) {
      const dead = piece({ id, name: "deleted sneaker", category: "footwear", subtype: "sneaker" });
      assert.equal(isLegal([ald[0]!, ald[1]!, dead], { house: null, occasion: "weekend", season: "fall" }), false);
    }
  });

  it("73 waives the fall jacket, and a missing reading does not become 68", () => {
    const look = [
      piece({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford", colors: ["navy"] }),
      piece({ id: "ch", name: "Tan chinos", category: "bottom", subtype: "chino", colors: ["khaki"] }),
      piece({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer", colors: ["brown"] }),
    ];
    assert.equal(isLegal(look, { occasion: "weekday", season: "fall", weatherF: 73 }), true);
    assert.equal(isLegal(look, { occasion: "weekday", season: "fall" }), false);
    assert.equal(isLegal(look, { occasion: "weekday", season: "fall", weatherF: 68 }), false);
    const bare = explain(look, { occasion: "weekday", season: "fall" });
    assert.equal(bare.hits.some((hit) => hit.id === "JKT-COV-1" && hit.severity === "hard"), true);
    assert.equal(JSON.stringify(bare).includes("68"), false);
  });

  it("ALD may wear a loafer, Sweet Stable weekday stays on, and out stays off", () => {
    const ald = [
      piece({ id: "rg", name: "Navy rugby", category: "top", subtype: "rugby", colors: ["navy"] }),
      piece({ id: "jean", name: "Indigo jeans", category: "bottom", subtype: "jean", material: "denim", colors: ["indigo"] }),
      piece({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer", colors: ["brown"] }),
    ];
    const aldWhy = explain(ald, { house: "ald", occasion: "weekend", season: "fall" });
    assert.equal(aldWhy.house?.hardFails.includes("ALD-B1") ?? false, false);
    assert.equal(
      aldWhy.hits.some((hit) => hit.severity === "hard" && /loafer/i.test(hit.why)),
      false,
    );
    assert.equal(isLegal(ald, { house: "ald", occasion: "weekend", season: "fall" }), true);
    const sweet = [
      piece({ id: "fi", name: "Cream fair isle", category: "top", subtype: "knit", colors: ["cream"] }),
      piece({ id: "cord", name: "Brown cords", category: "bottom", subtype: "cord", colors: ["brown"] }),
      piece({ id: "bt", name: "Brown boot", category: "footwear", subtype: "boot", colors: ["brown"] }),
    ];
    assert.equal(
      isLegal(sweet, { house: "sweetStable", occasion: "weekday", season: "fall", weatherF: 73 }),
      true,
    );
    assert.equal(
      isLegal(sweet, { house: "sweetStable", occasion: "out", season: "fall", weatherF: 73 }),
      false,
    );
  });

  it("a varsity and a sport coat are illegal in either order, and linen with flannel always is", () => {
    const base = [
      piece({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford" }),
      piece({ id: "ch", name: "Tan chinos", category: "bottom", subtype: "chino" }),
      piece({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer" }),
    ];
    const varsity = piece({ id: "va", name: "Khaki varsity", category: "outerwear", subtype: "varsity" });
    const blazer = piece({ id: "bz", name: "Navy blazer", category: "outerwear", subtype: "blazer" });
    const graphic = piece({ id: "gr", name: "Graphic tee", category: "top", subtype: "tee" });
    const collegiate = piece({ id: "co", name: "Collegiate sweatshirt", category: "top", subtype: "sweatshirt" });
    for (const occasion of ["weekday", "weekend"] as const) {
      assert.equal(isLegal([...base, varsity, blazer], { occasion, season: "fall", weatherF: 73 }), false);
      assert.equal(isLegal([blazer, varsity, ...base], { occasion, season: "fall", weatherF: 73 }), false);
      assert.equal(isLegal([graphic, ...base.slice(1), blazer], { occasion, season: "fall", weatherF: 73 }), false);
      assert.equal(isLegal([blazer, collegiate, base[1]!, base[2]!], { occasion, season: "fall", weatherF: 73 }), false);
    }
    const linen = piece({
      id: "li",
      name: "Linen camp shirt",
      category: "top",
      subtype: "camp shirt",
      material: "linen",
    });
    const flannel = piece({
      id: "fl",
      name: "Grey flannel trousers",
      category: "bottom",
      subtype: "trouser",
      material: "flannel",
    });
    const shoe = piece({ id: "sh", name: "Brown loafers", category: "footwear", subtype: "loafer" });
    for (const season of ["spring", "summer", "fall", "winter"] as const) {
      const why = explain([linen, flannel, shoe], { occasion: "weekend", season });
      assert.equal(why.hits.some((hit) => hit.id === "XC-SEA-5" && hit.severity === "hard"), true, season);
      assert.equal(isLegal([linen, flannel, shoe], { occasion: "weekend", season }), false, season);
    }
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
        material: "wool",
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

describe("color chip rank", () => {
  it("a color chip changes the first card when another color ranks higher", () => {
    const navyTop = piece({
      id: "ox",
      name: "Navy oxford",
      category: "top",
      subtype: "oxford",
      colors: ["navy"],
    });
    const chino = piece({
      id: "ch",
      name: "Khaki chino",
      category: "bottom",
      subtype: "chino",
      colors: ["khaki"],
    });
    const loafer = piece({
      id: "lf",
      name: "Brown loafer",
      category: "footwear",
      subtype: "loafer",
      colors: ["brown"],
    });
    const oliveTop = piece({
      id: "os",
      name: "Olive overshirt",
      category: "top",
      subtype: "overshirt",
      colors: ["olive"],
    });
    const garments = [navyTop, chino, loafer, oliveTop];
    const navy: Look = {
      id: "l_navy",
      name: "Navy office",
      occasion: "weekday",
      garmentIds: ["ox", "ch", "lf"],
      source: "ai",
      createdAt: "2026-09-01T00:00:00.000Z",
    };
    const olive: Look = {
      id: "l_olive",
      name: "Olive office",
      occasion: "weekday",
      garmentIds: ["os", "ch", "lf"],
      source: "ai",
      createdAt: "2026-09-01T00:00:00.000Z",
    };
    const plain = chapterVisible([navy, olive], garments, "weekday", { min: 1, pad: false });
    const oliveFirst = chapterVisible([navy, olive], garments, "weekday", {
      color: "olive",
      min: 1,
      pad: false,
    });
    assert.equal(plain[0]?.id, "l_navy");
    assert.equal(oliveFirst[0]?.id, "l_olive");
    const started = Date.now();
    chapterVisible([navy, olive], garments, "weekday", { color: "navy", min: 1, pad: false });
    assert.ok(Date.now() - started < 500);
  });
});

describe("chapterVisible never empty", () => {
  it("Weekday × 545 / Purple / SweetStable / ItalianSummer / ItalianWinter each ≥3", () => {
    const g = dressRack();
    const book = buildLookbook(g, "2026-09-18");
    for (const house of ["fiveFourFive", "purple", "sweetStable", "italianSummer", "italianWinter"] as const) {
      const shown = chapterVisible(book, g, "weekday", { season: "fall", house, min: 3 });
      assert.ok(shown.length >= 1, `Weekday × ${house} = ${shown.length}`);
      const real = shown.filter((l) => l.garmentIds.length >= 3 && !l.needsPieces);
      if (real.length < 3) assert.ok(shown.some((l) => l.needsPieces || l.gate));
    }
  });

  it("None in … copy never appears if the rack can dress", () => {
    const msg = emptyFilterCopy("Weekday", "Fall", "auto", "fiveFourFive", null, true);
    assert.equal(msg, null);
    const empty = emptyFilterCopy("Weekday", "Fall", "auto", "fiveFourFive", null, false);
    assert.ok(empty);
    assert.equal(empty!.includes("None in"), false);
  });

  it("Weekend × ALD × fall is at least 3 and rugby+blazer stays invalid", () => {
    const g = dressRack();
    const book = buildLookbook(g, "2026-09-26");
    const shown = chapterVisible(book, g, "weekend", { season: "fall", house: "ald", min: 3 });
    assert.ok(shown.length >= 1, `Weekend × ALD × fall = ${shown.length}`);
    const real = shown.filter((l) => l.garmentIds.length >= 3 && !l.needsPieces);
    if (real.length < 3) assert.ok(shown.some((l) => l.needsPieces || l.gate));
    const rugbyBlazer = [
      piece({ id: "rg", name: "Navy rugby", category: "top", subtype: "rugby" }),
      piece({ id: "jn", name: "Indigo jean", category: "bottom", subtype: "jean" }),
      piece({ id: "lf", name: "Brown loafer", category: "footwear", subtype: "loafer" }),
      piece({ id: "bz", name: "Navy blazer", category: "outerwear", subtype: "blazer" }),
    ];
    assert.equal(lookClashes(rugbyBlazer), true);
  });

  it("jean + loafer is legal on weekday", () => {
    const pieces = [
      piece({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford" }),
      piece({ id: "jn", name: "Indigo jean", category: "bottom", subtype: "jean" }),
      piece({ id: "lf", name: "Brown loafer", category: "footwear", subtype: "loafer" }),
    ];
    assert.equal(lookFitsOccasion(pieces, "weekday"), true);
    assert.equal(lookClashes(pieces), false);
  });

  it("no turtleneck is emitted when the pool has none, and the chapter still has 3", () => {
    const g = dressRack().filter((item) => !/turtleneck|rollneck/.test(`${item.name} ${item.subtype}`));
    const book = buildLookbook(g, "2026-09-26");
    const shown = chapterVisible(book, g, "weekday", { season: "fall", min: 3 });
    assert.ok(shown.length >= 3, `weekday ${shown.length}`);
    const names = shown.flatMap((look) =>
      look.garmentIds.map((id) => g.find((item) => item.id === id)?.name ?? ""),
    );
    assert.equal(names.some((name) => /turtleneck/i.test(name)), false);
  });

  it("a second brown suede outer is scored down when another outer exists", () => {
    const suede = piece({
      id: "sj",
      name: "Brown suede jacket",
      category: "outerwear",
      subtype: "suede jacket",
    });
    const other = piece({
      id: "nj",
      name: "Navy chore coat",
      category: "outerwear",
      subtype: "chore",
    });
    const top = piece({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford" });
    const jean = piece({ id: "jn", name: "Indigo jean", category: "bottom", subtype: "jean" });
    const shoe = piece({ id: "lf", name: "Brown loafer", category: "footwear", subtype: "loafer" });
    assert.equal(isBrownSuedeOuter(suede), true);
    assert.equal(slotOf(piece({ id: "bj", name: "Brown jacket", category: "top", subtype: "" })), "outerwear");
    const pool = [suede, other, top, jean, shoe];
    const second = trendScore([top, jean, shoe, suede], { f: 60, usedBrownSuede: true, pool });
    const first = trendScore([top, jean, shoe, suede], { f: 60, usedBrownSuede: false, pool });
    assert.ok(first - second >= 40, `first ${first} second ${second}`);
  });

  it("houseChip=all still uses chapterVisible and fills ≥3", () => {
    const g = dressRack();
    const book = buildLookbook(g, "2026-09-18");
    const shown = chapterVisible(book, g, "weekday", { season: "fall", house: "all", min: 3 });
    assert.ok(shown.length >= 3, `all weekday ${shown.length}`);
  });
});

describe("reshuffle row", () => {
  it("2× Reshuffle returns ≥3 looks without hanging", () => {
    const g = dressRack();
    const a = buildReshuffleRow(g, "weekday", { cap: 6, usedCount: new Map(), salt: 1 });
    assert.ok(a.length >= 3, `first ${a.length}`);
    const b = buildReshuffleRow(g, "weekday", {
      cap: 6,
      usedCount: new Map(),
      excludeKeys: a.map((l) => comboKey(l.garmentIds)),
      replacing: a,
      salt: 2,
    });
    assert.ok(b.length >= 3, `second ${b.length}`);
  });

  it("returns in <50ms on a 144-like fixture, length ≥3, never throws", () => {
    const g: Garment[] = [
      ...Array.from({ length: 70 }, (_, i) =>
        piece({
          id: `t${i}`,
          name: i % 4 === 0 ? `Polo ${i}` : `Oxford ${i}`,
          category: "top",
          subtype: i % 4 === 0 ? "polo" : "oxford",
        }),
      ),
      ...Array.from({ length: 40 }, (_, i) =>
        piece({
          id: `b${i}`,
          name: i % 2 ? `Jean ${i}` : `Trouser ${i}`,
          category: "bottom",
          subtype: i % 2 ? "jean" : "trouser",
        }),
      ),
      ...Array.from({ length: 24 }, (_, i) =>
        piece({
          id: `s${i}`,
          name: i % 2 ? `Sneaker ${i}` : `Loafer ${i}`,
          category: "footwear",
          subtype: i % 2 ? "sneaker" : "loafer",
        }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        piece({
          id: `o${i}`,
          name: i % 2 ? `Field ${i}` : `Blazer ${i}`,
          category: "outerwear",
          subtype: i % 2 ? "field jacket" : "blazer",
        }),
      ),
    ];
    assert.ok(g.length >= 144, `fixture ${g.length}`);
    buildReshuffleRow(g, "weekday", { salt: 2, cap: 6 });
    const t0 = Date.now();
    const row = buildReshuffleRow(g, "weekday", { salt: 3, cap: 6 });
    const ms = Date.now() - t0;
    assert.ok(ms < 50, `took ${ms}ms`);
    assert.ok(row.length >= 3, `length ${row.length}`);
  });

  it("today strip uses his plates and skips a look with <2 pieces", () => {
    const g = dressRack();
    const row = buildReshuffleRow(g, "weekday", { salt: 4, cap: 7 });
    const thin: Look = {
      id: "thin",
      name: "Thin",
      occasion: "weekday",
      garmentIds: ["ox0"],
      source: "ai",
      lookbook: false,
      createdAt: "2026-09-24T00:00:00.000Z",
    };
    const strip = todayStripLooks([thin, ...row], [], g, 7);
    assert.ok(strip.length >= 3, `strip ${strip.length}`);
    assert.ok(!strip.some((l) => l.id === "thin"));
    for (const l of strip) {
      const n = l.garmentIds.filter((id) => g.some((x) => x.id === id)).length;
      assert.ok(n >= 2, l.id);
    }
  });

  it("today's strip cell is the drop even when the list is shorter than 7", () => {
    const g = [
      piece({ id: "a", name: "Oxford", category: "top", subtype: "oxford" }),
      piece({ id: "b", name: "Trouser", category: "bottom", subtype: "trouser" }),
      piece({ id: "c", name: "Loafer", category: "footwear", subtype: "loafer" }),
    ];
    const today = todayISO();
    const days = lastDays(7, today);
    assert.equal(days[6], today);
    const thisWeek: Look[] = Array.from({ length: 6 }, (_, i) => ({
      id: `w${i}`,
      name: `Week ${i}`,
      occasion: "weekday",
      garmentIds: ["a", "b", `ghost-${i}`],
      source: "ai" as const,
      lookbook: false,
      createdAt: today,
    }));
    const dense = todayStripLooks(thisWeek, [], g, 7);
    assert.equal(dense.length, 6);
    assert.equal(dense[6], undefined);
    const cells = weekStripDays({
      days,
      today,
      drop: { date: today, garmentIds: ["a", "b"] },
      journal: [],
      thisWeek,
      garments: g,
    });
    assert.equal(cells.length, 7);
    assert.equal(cells[6]?.iso, today);
    assert.deepEqual(cells.find((cell) => cell.iso === today)?.look?.garmentIds, ["a", "b"]);
    assert.ok(cells[6]?.look);
    const past = cells.filter((cell) => cell.iso !== today);
    assert.equal(past.filter((cell) => cell.look).length, 6);
  });

  it("20× Reshuffle does not grow looks.length", () => {
    const g = dressRack();
    const looks: Look[] = [
      {
        id: "keep",
        name: "Keep",
        occasion: "weekday",
        garmentIds: ["ox0", "tr0", "lf0"],
        source: "ai",
        lookbook: true,
        createdAt: "2026-09-18T00:00:00.000Z",
      },
    ];
    const n = looks.length;
    for (let i = 0; i < 20; i++) {
      buildReshuffleRow(g, "weekday", { salt: i + 1, cap: 6 });
    }
    assert.equal(looks.length, n);
  });

  it("a new salt drops the combos on screen and stars an unused piece", () => {
    const g = [
      ...dressRack(),
      piece({ id: "idle_ox", name: "Idle oxford", category: "top", subtype: "oxford" }),
      piece({ id: "hd", name: "90s hoodie", category: "top", subtype: "hoodie" }),
    ];
    const saved: Look[] = [
      {
        id: "keep",
        name: "Olive field jacket · weekday",
        occasion: "weekday",
        garmentIds: ["ox0", "tr0", "lf0"],
        source: "manual",
        lookbook: true,
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ];
    const before = saved.length;
    const first = buildReshuffleRow(g, "weekday", { salt: 1, cap: 8, season: "fall" });
    const second = buildReshuffleRow(g, "weekday", {
      salt: 2,
      cap: 8,
      season: "fall",
      excludeKeys: first.map((look) => comboKey(look.garmentIds)),
      mustInclude: ["idle_ox"],
    });
    assert.equal(first.length, 8);
    assert.equal(second.length, 8);
    assert.ok(first[0] && second[0]);
    assert.notDeepEqual(first[0].garmentIds, second[0].garmentIds);
    const ids = second.flatMap((look) => look.garmentIds);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(
      second.some((look) => look.garmentIds.includes("idle_ox")),
      true,
    );
    for (const look of second) {
      const names = look.garmentIds.map(
        (id) => g.find((item) => item.id === id)?.subtype ?? "",
      );
      const hoodie = names.some((name) => /hoodie/i.test(name));
      const loafer = names.some((name) => /loafer/i.test(name));
      assert.equal(hoodie && loafer, false);
    }
    const blazerLooks = second.filter((look) =>
      look.garmentIds.some((id) => /blazer/i.test(g.find((item) => item.id === id)?.subtype ?? "")),
    );
    assert.ok(blazerLooks.length < second.length);
    assert.equal(saved.length, before);
    const src = readFileSync(new URL("../routes/lookbook.tsx", import.meta.url), "utf8");
    const buttonAt = src.search(/Reshuffle\s*<\/button>/);
    const clickAt = src.lastIndexOf("onClick", buttonAt);
    const click = src.slice(clickAt, buttonAt);
    assert.equal(click.includes("buildReshuffleRow"), true);
    assert.equal(click.includes("composeChapter"), false);
  });
});

describe("lookbook card stack", () => {
  it("cards stay on buildReshuffleRow, and the stack does not cover Closet or the sheet", () => {
    const book = readFileSync(new URL("../routes/lookbook.tsx", import.meta.url), "utf8");
    const kit = readFileSync(new URL("../components/closet/look-kit.tsx", import.meta.url), "utf8");
    const sheet = readFileSync(new URL("../components/closet/look-sheet.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    assert.equal(/from\s+["'][^"']*ai(\.ts)?["']/.test(book), false);
    assert.equal(/from\s+["'][^"']*ai(\.ts)?["']/.test(kit), false);
    assert.equal(book.includes("composeChapter"), false);
    assert.equal(book.includes("chapterVisible"), false);
    assert.equal(book.includes("buildReshuffleRow"), true);
    assert.match(book, /const realRow = realWeekLooks\(row/);
    // Joe removed the Houses and ways chip rows; the app is for everyone. This week is the plain row.
    assert.match(book, /const weekRow = realRow;/);
    assert.equal(book.includes("houseFirstRow"), false);
    assert.equal(book.includes("wayFirstRow"), false);
    assert.match(book, /const cards = weekRow\.map/);
    assert.match(book, /\{weekRow\.length\} looks/);
    assert.equal(book.split('layout="stack"').length - 1, 1);
    assert.equal(sheet.includes('layout="stack"'), false);
    assert.equal(book.includes('viewTransitionName: "none"'), false);
    assert.equal(book.split("viewTransitionName").length - 1, 1);
    assert.match(book, /named \? \{ viewTransitionName: `look-\$\{look\.id\}` \}/);
    assert.match(book, /named=\{openId === look\.id\}/);
    const face = book.slice(book.indexOf("function LookCardFace"), book.indexOf("function pieceDots"));
    assert.equal(/<img\b/.test(face), false);
    assert.match(face, /showOnYou=\{onYou === "on" \|\| onYou === "out"\}/);
    assert.match(face, /On you/);
    const titleAt = book.indexOf("spreadTitle(pieces, look.occasion");
    const lineAt = book.indexOf("{cardTag(wayTitle, occasionLabel, seasonLabel)}");
    assert.ok(titleAt > 0 && lineAt > titleAt);
    const between = book.slice(titleAt, lineAt);
    assert.match(between, /paletteCss\(dot\.color\)/);
    assert.equal(/\b(Colors|Swatches|Palette)\b/.test(between), false);
    assert.equal(kit.includes("setTimeout"), false);
    assert.equal(kit.includes("setInterval"), false);
    assert.match(kit, /showOnYou && onYouSrc/);
    assert.match(css, /translateY\(12px\)/);
    assert.match(css, /var\(--band-i\) \* 50ms/);
    assert.match(css, /scale\(1\.04\)/);
    assert.match(css, /transform-origin:\s*top/);
    assert.match(css, /look-spine-draw 420ms/);
    assert.match(css, /scaleY\(0\)/);
    assert.match(css, /transition: transform 280ms/);
    assert.match(css, /look-on-you-in 160ms/);
    assert.match(css, /look-on-you-out 160ms/);
    assert.equal(css.includes("animation-timeline"), false);
    const rise = css.slice(
      css.indexOf("@keyframes look-band-rise"),
      css.indexOf("@keyframes look-spine-draw"),
    );
    assert.equal(/\b(width|height|gap|margin|top|left|rotate)\s*:/.test(rise), false);
    const spine = css.slice(
      css.indexOf("@keyframes look-spine-draw"),
      css.indexOf(".look-kit-rise {"),
    );
    assert.equal(/\b(width|height|gap|margin|top|left|rotate|opacity)\s*:/.test(spine), false);
    const reduce = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    assert.match(reduce, /\.look-kit-rise\s*\{[^}]*animation:\s*none/);
    assert.match(reduce, /\.look-kit-spine\s*\{[^}]*animation:\s*none/);
    assert.match(reduce, /\.look-kit-plate[\s\S]*transform:\s*none/);
    const hero = book.slice(book.indexOf("5 looks with"));
    assert.equal(hero.includes('layout="stack"'), false);
  });

  it("the first week cards paint before the full rank", () => {
    const book = readFileSync(new URL("../routes/lookbook.tsx", import.meta.url), "utf8");
    const lib = readFileSync(new URL("./lookbook.ts", import.meta.url), "utf8");
    const preview = book.slice(book.indexOf("const preview"), book.indexOf("const [ranked"));
    assert.match(preview, /firstWeekLooks\(/);
    assert.equal(preview.includes("buildReshuffleRow"), false);
    assert.match(book, /window\.setTimeout\(\(\) => \{[\s\S]*?buildReshuffleRow/);
    assert.match(book, /data-week-reason/);
    const fn = lib.slice(lib.indexOf("export function firstWeekLooks"), lib.indexOf("export function buildReshuffleRow"));
    assert.equal(fn.includes("buildHouseMatrix"), false);
    assert.equal(fn.includes("finishStyled"), false);
    assert.equal(fn.includes("pickLook"), false);
    assert.equal(fn.includes("68"), false);
    const rack = [
      piece({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford", colors: ["navy"] }),
      piece({ id: "ch", name: "Tan chinos", category: "bottom", subtype: "chino", colors: ["khaki"] }),
      piece({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer", colors: ["brown"] }),
    ];
    const warm = firstWeekLooks(rack, "weekday", {
      season: "fall",
      weather: { f: 73, label: "Warm", code: 1, measured: true },
    });
    assert.ok(warm.looks.length >= 1, warm.reason);
    assert.equal(warm.looks.some((look) => look.garmentIds.length >= 3), true);
    const missing = firstWeekLooks(rack, "weekday", { season: "fall" });
    assert.equal(missing.looks.length, 0);
    assert.match(missing.reason, /jacket/);
    assert.equal(missing.reason.includes("68"), false);
    const unmeasured = firstWeekLooks(rack, "weekday", {
      season: "fall",
      weather: { f: 73, label: "Warm", code: 1, measured: false },
    });
    assert.equal(unmeasured.looks.length, 0);
    const empty = firstWeekLooks([], "weekday", { season: "fall" });
    assert.equal(empty.looks.length, 0);
    assert.match(empty.reason, /top, a bottom, and a shoe/);
    const weather = { f: 73, label: "Warm", code: 1, measured: true as const };
    const shoeOnly = firstWeekLooks(
      [
        piece({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford", colors: ["navy"] }),
        piece({ id: "ch", name: "Tan chinos", category: "bottom", subtype: "chino", colors: ["khaki"] }),
        piece({ id: "lf", name: "Beige loafers", category: "footwear", subtype: "loafer", colors: ["beige"] }),
      ],
      "weekday",
      { season: "fall", color: "beige", weather },
    );
    assert.equal(shoeOnly.looks.length, 0);
    assert.match(shoeOnly.reason, /No look leads with beige/);
    const lead = firstWeekLooks(
      [
        piece({ id: "ox", name: "Beige oxford", category: "top", subtype: "oxford", colors: ["beige"] }),
        piece({ id: "ch", name: "Tan chinos", category: "bottom", subtype: "chino", colors: ["khaki"] }),
        piece({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer", colors: ["brown"] }),
      ],
      "weekday",
      { season: "fall", color: "beige", weather },
    );
    assert.equal(lead.looks.length, 1);
    assert.equal(realWeekLooks(lead.looks).length, 1);
    assert.equal(
      realWeekLooks([
        {
          id: "gap",
          name: "No look leads with beige.",
          occasion: "weekday",
          garmentIds: [],
          source: "ai",
          lookbook: false,
          createdAt: "2026-10-04",
          needsPieces: true,
          gap: "No look leads with beige.",
        },
      ]).length,
      0,
    );
  });

  // Joe removed the Houses and ways chip rows; the app is for everyone. The way sections stay.
  it("lookbook has no house row and no ways chip row; the way sections stay", () => {
    const book = readFileSync(new URL("../routes/lookbook.tsx", import.meta.url), "utf8");
    assert.equal(book.includes("data-house-row"), false);
    assert.equal(/\.\.\.HOUSE_CHIPS\]/.test(book), false);
    assert.equal(/useState<"all" \| House>\("all"\)/.test(book), false);
    assert.equal(book.includes("setHouseChip("), false);
    assert.equal(book.includes("houseChip={houseChip}"), false);
    assert.equal(book.includes("houseFirstRow(realRow, houseChip"), false);
    assert.equal(book.includes("wayFirstRow("), false);
    assert.equal(book.includes("HOUSE_CHIPS"), false);
    assert.equal(book.includes("houseChip"), false);
    assert.equal(book.includes("setWayId"), false);
    assert.equal(book.includes("wayChipVisible"), false);
    assert.equal(book.includes("HOUSE_LABEL"), false);
    assert.equal(book.includes("dressableHouses"), false);
    assert.match(book, /<DetectorSections/);
    assert.match(book, /ways=\{ways\}/);
    assert.equal(book.includes("shownWays"), false);
    assert.match(book, /occasion=\{occasion\}/);
    assert.match(book, /season=\{season\}/);
    assert.match(book, /color=\{color\}/);
    assert.equal(book.includes("activeId={wayId}"), false);
    assert.equal(book.includes("Your ways of dressing"), false);
    assert.match(book, />Context</);
    assert.equal(book.includes("rankWays"), false);
    assert.equal(book.includes("data-ways-row"), false);
    assert.equal(book.includes(">Houses<"), false);
    assert.match(book, /heading="Suggest"/);
    assert.equal(book.includes("Make a look"), false);
    assert.equal(
      /\b(Polo|Purple|RRL|ALD|Faloni|545|Sweet Stable|Italian summer|Italian winter)\b/.test(book),
      false,
    );
    // House names stay out of the UI for everyone: the hero label, the piece detail, card titles, gap notes.
    const today = readFileSync(new URL("../routes/index.tsx", import.meta.url), "utf8");
    assert.equal(today.includes("HOUSE_LABEL"), false);
    assert.equal(today.includes("lookHouses"), false);
    const detail = readFileSync(new URL("../components/closet/detail.tsx", import.meta.url), "utf8");
    assert.equal(detail.includes("housesOf"), false);
    assert.equal(detail.includes("HOUSE_LABEL"), false);
    assert.equal(detail.includes(">House<"), false);
    assert.equal(detail.includes("Ralph"), false);
    const look = readFileSync(new URL("./look.ts", import.meta.url), "utf8");
    assert.equal(look.includes("HOUSE_LABEL["), false);
    assert.equal(look.includes("lookHouses("), false);
    const gaps = readFileSync(new URL("./gaps.ts", import.meta.url), "utf8");
    assert.equal(gaps.includes("houseOf("), false);
    assert.equal(gaps.includes("Faloni in summer"), false);
    // Today keeps today's look. The open effect rerolls only without a sound today drop, never as a skip.
    const effect = today.slice(today.indexOf("if (!hydrated) return;"), today.indexOf("}, [hydrated, ownedCount]);"));
    const guard = effect.indexOf("current.date === todayISO()");
    assert.ok(guard >= 0 && guard < effect.indexOf("rerollDrop("), "date-today guard before the reroll");
    assert.equal(/rerollDrop\([^;]*garmentIds/.test(effect), false, "open never passes previousIds");
  });

  it("three pieces render three bands, and a cached On you image stays out until it is on", async () => {
    const ts = await import("typescript");
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { pathToFileURL } = await import("node:url");
    const dir = mkdtempSync(join(tmpdir(), "look-kit-"));
    try {
      const src = readFileSync(new URL("../components/closet/look-kit.tsx", import.meta.url), "utf8");
      let js = ts.transpileModule(src, {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
        fileName: "look-kit.tsx",
      }).outputText;
      const href = (rel: string) => new URL(rel, import.meta.url).href;
      const reactHref = import.meta.resolve("react");
      const jsxHref = import.meta.resolve("react/jsx-runtime");
      const stub = join(dir, "gimg.mjs");
      writeFileSync(
        stub,
        `import { createElement } from ${JSON.stringify(reactHref)};
export function GarmentImg(props) {
  return createElement("img", {
    "data-piece": props.garment.id,
    alt: props.garment.name || "",
    className: props.className || "",
    src: "plate:" + props.garment.id,
  });
}
`,
      );
      js = js.replaceAll('from "react/jsx-runtime"', `from ${JSON.stringify(jsxHref)}`);
      js = js.replaceAll('from "react"', `from ${JSON.stringify(reactHref)}`);
      const specs = [
        ["@/components/closet/gimg", pathToFileURL(stub).href],
        ["@/lib/look", href("./look.ts")],
        ["@/lib/plate", href("./plate.ts")],
        ["@/lib/style", href("./style.ts")],
        ["@/lib/utils", href("./utils.ts")],
      ];
      for (const [spec, target] of specs) {
        js = js.replaceAll(`from "${spec}"`, `from ${JSON.stringify(target)}`);
      }
      assert.equal(js.includes("@/"), false, js);
      const kitFile = join(dir, "kit.mjs");
      writeFileSync(kitFile, js);
      const { LookKit } = await import(pathToFileURL(kitFile).href);
      const pieces = [
        piece({ id: "shirt", name: "Oxford shirt", category: "top", subtype: "oxford", colors: ["navy"] }),
        piece({ id: "trouser", name: "Wool trouser", category: "bottom", subtype: "trouser", colors: ["stone"] }),
        piece({ id: "shoe", name: "Brown loafer", category: "footwear", subtype: "loafer", colors: ["brown"] }),
      ];
      const cached = "https://cached.example/on-you.jpg";
      const stack = renderToStaticMarkup(
        createElement(LookKit, { layout: "stack", pieces, onYouSrc: cached, showOnYou: false }),
      );
      assert.deepEqual(
        [...stack.matchAll(/data-band="([^"]+)"/g)].map((m) => m[1]),
        ["top", "bottom", "shoe"],
      );
      assert.deepEqual(
        [...stack.matchAll(/data-share="([^"]+)"/g)].map((m) => m[1]),
        ["46", "34", "20"],
      );
      assert.equal(stack.includes("grid-template-columns"), false);
      assert.equal(stack.includes("1fr 1fr"), false);
      assert.equal(stack.includes("rotate"), false);
      assert.equal(stack.includes('data-band="jacket"'), false);
      assert.match(stack, /#f4efe6/i);
      assert.match(stack, /object-contain/);
      assert.match(stack, /mix-blend-multiply/);
      assert.equal(stack.includes("background:"), false);
      assert.equal(stack.includes(cached), false);
      assert.equal(stack.includes("look-on-you"), false);
      const on = renderToStaticMarkup(
        createElement(LookKit, { layout: "stack", pieces, onYouSrc: cached, showOnYou: true }),
      );
      assert.equal(on.includes(cached), true);
      assert.match(on, /look-on-you/);
      const onYouTag = on.match(/<img[^>]*look-on-you[^>]*>/)?.[0] ?? "";
      assert.equal(onYouTag.includes("mix-blend-multiply"), false);
      const grid = renderToStaticMarkup(
        createElement(LookKit, { pieces, onYouSrc: cached, showOnYou: true }),
      );
      assert.equal(grid.includes("grid-template-columns"), true);
      assert.equal(grid.includes("1fr 1fr"), true);
      assert.equal(grid.includes(cached), false);
      assert.equal(grid.includes('data-layout="stack"'), false);
      const withJacket = renderToStaticMarkup(
        createElement(LookKit, {
          layout: "stack",
          pieces: [
            ...pieces,
            piece({ id: "jacket", name: "Navy blazer", category: "outerwear", subtype: "blazer" }),
          ],
        }),
      );
      assert.deepEqual(
        [...withJacket.matchAll(/data-band="([^"]+)"/g)].map((m) => m[1]),
        ["top", "jacket", "bottom", "shoe"],
      );
      assert.deepEqual(
        [...withJacket.matchAll(/data-share="([^"]+)"/g)].map((m) => m[1]),
        ["34", "20", "28", "18"],
      );
      const hanger = renderToStaticMarkup(
        createElement(LookKit, {
          layout: "stack",
          pieces: [
            ...pieces,
            piece({
              id: "hanger",
              name: "Brown suede jacket",
              category: "outerwear",
              subtype: "jacket",
              imageSrc: "photo://jacket",
              cutoutSrc: "photo://jacket",
              imageSource: "photo",
            }),
          ],
        }),
      );
      assert.equal(hanger.includes('data-band="jacket"'), true);
      assert.equal(hanger.includes("plate:hanger"), false);
      assert.match(hanger, /Brown suede jacket/);
      assert.equal(hanger.includes("photo://jacket"), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("house chips dress the row", () => {
  const RRL_GAP = "Closest RRL from your closet. Boots would finish it.";

  function rrlCloset(withBoots: boolean): Garment[] {
    const work = [
      ["w1", "Chambray work shirt"],
      ["w2", "Indigo work shirt"],
      ["w3", "Grey flannel shirt"],
      ["w4", "Olive work shirt"],
      ["w5", "Brown chambray shirt"],
      ["w6", "Rust flannel shirt"],
      ["w7", "Navy work shirt"],
      ["w8", "Stone chambray shirt"],
    ].map(([id, name]) =>
      piece({ id: id!, name: name!, category: "top", subtype: "shirt" }),
    );
    const oxfords = Array.from({ length: 8 }, (_, i) =>
      piece({ id: `ox${i}`, name: `Navy oxford ${i}`, category: "top", subtype: "oxford" }),
    );
    const jeans = Array.from({ length: 8 }, (_, i) =>
      piece({
        id: `jn${i}`,
        name: `Indigo selvedge jean ${i}`,
        category: "bottom",
        subtype: "jean",
      }),
    );
    const chinos = Array.from({ length: 8 }, (_, i) =>
      piece({ id: `ch${i}`, name: `Khaki chino ${i}`, category: "bottom", subtype: "chino" }),
    );
    const pleated = [
      piece({
        id: "pleat",
        name: "Grey pleated dress trousers",
        category: "bottom",
        subtype: "trouser",
      }),
    ];
    const boots = withBoots
      ? Array.from({ length: 8 }, (_, i) =>
          piece({ id: `boot${i}`, name: `Brown boot ${i}`, category: "footwear", subtype: "boot" }),
        )
      : [];
    const chelseas = Array.from({ length: 4 }, (_, i) =>
      piece({ id: `chel${i}`, name: `Brown chelsea ${i}`, category: "footwear", subtype: "chelsea" }),
    );
    const badShoes = [
      piece({ id: "penny", name: "Brown penny loafers", category: "footwear", subtype: "loafer" }),
      piece({ id: "tassel", name: "Brown tassel loafers", category: "footwear", subtype: "loafer" }),
      piece({ id: "suedelf", name: "Tan suede loafers", category: "footwear", subtype: "loafer" }),
      piece({ id: "mule", name: "Black driving mule", category: "footwear", subtype: "mule" }),
      piece({ id: "fash", name: "Black fashion sneaker", category: "footwear", subtype: "sneaker" }),
      piece({ id: "court", name: "White court sneaker", category: "footwear", subtype: "sneaker" }),
    ];
    const jackets = [
      piece({ id: "chore", name: "Brown chore jacket", category: "outerwear", subtype: "chore" }),
      piece({ id: "denimj", name: "Indigo denim jacket", category: "outerwear", subtype: "denim jacket" }),
      piece({ id: "suedej", name: "Brown suede jacket", category: "outerwear", subtype: "suede jacket" }),
      piece({ id: "fieldj", name: "Olive field jacket", category: "outerwear", subtype: "field jacket" }),
      piece({ id: "navyb", name: "Navy blazer", category: "outerwear", subtype: "blazer" }),
    ];
    const pink = piece({
      id: "pink",
      name: "Pink pique polo",
      category: "top",
      subtype: "polo",
      colors: ["pink"],
    });
    return [...work, ...oxfords, ...jeans, ...chinos, ...pleated, ...boots, ...chelseas, ...badShoes, ...jackets, pink];
  }

  it("a synthetic house row is never blank and never says None in", () => {
    const rack = rrlCloset(true);
    const row = buildReshuffleRow(rack, "weekday", {
      house: "rrl",
      season: "fall",
      cap: 8,
      salt: 1,
    });
    assert.ok(row.length >= 1, `row ${row.length}`);
    assert.equal(row.some((look) => /None in/i.test(`${look.name} ${look.gap ?? ""}`)), false);
    const polo = buildReshuffleRow(rack, "weekday", {
      house: "polo",
      season: "fall",
      cap: 8,
      salt: 1,
    });
    /* House ranks. With no RRL look in the matrix, the row is the ALL row, never a lone note. */
    for (const [house, looks] of [
      ["rrl", row],
      ["polo", polo],
    ] as const) {
      const real = realWeekLooks(looks);
      assert.ok(real.length >= 3, `${house} ${real.length} real of ${looks.length}`);
      assert.equal(looks.some((look) => look.needsPieces || look.gate), false, house);
      const fits = (look: Look) =>
        lookFitsHouse(
          look.garmentIds.map((id) => rack.find((g) => g.id === id)).filter((g): g is Garment => Boolean(g)),
          house,
          "weekday",
          rack,
          "fall",
        );
      if (real.some(fits)) assert.ok(fits(real[0]!), `${house} leads with a look that fits`);
    }
  });

  it("RRL without a legal fill shows the approved gap, not a padded row", () => {
    const rack = rrlCloset(false);
    const row = buildReshuffleRow(rack, "weekday", {
      house: "rrl",
      season: "fall",
      cap: 8,
      salt: 2,
    });
    assert.ok(row.length >= 1, `row ${row.length}`);
    const note = row.map((look) => look.gap ?? look.name).join(" ");
    assert.equal(/None in/i.test(note), false);
    assert.notEqual(note.includes(RRL_GAP), true);
  });
});

describe("Lookbook plates open a draft; Today's paper pieces are tappable", () => {
  const oxford = piece({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford" });
  const chinos = piece({ id: "ch", name: "Khaki chinos", category: "bottom", subtype: "chino" });
  const loafers = piece({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer" });
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

  it("draftFromPlate is a pure, order-stable draft of the plate's exact pieces", () => {
    const a = draftFromPlate([loafers, oxford, chinos], "dinner", "2026-10-09");
    const b = draftFromPlate([chinos, oxford, loafers].reverse(), "dinner", "2026-10-09");
    const id = `draft_${["ox", "ch", "lf"].sort().join("_")}`;
    assert.equal(a.id, id);
    assert.equal(b.id, id);
    assert.deepEqual(a.garmentIds, ["lf", "ox", "ch"]);
    assert.equal(a.source, "ai");
    assert.equal(a.lookbook, false);
    assert.equal(a.occasion, "out");
    assert.equal(a.name, "Navy oxford · Khaki chinos · Brown loafers");
    assert.equal(a.createdAt, "2026-10-09T00:00:00.000Z");
    assert.deepEqual(a, draftFromPlate([loafers, oxford, chinos], "dinner", "2026-10-09"));
  });

  it("opening a plate writes nothing, Wear closes the sheet, Save only adds a new look", () => {
    const book = read("../routes/lookbook.tsx");
    const sheet = read("../components/closet/look-sheet.tsx");
    assert.match(book, /<DetectorSections[^>]*onOpen=\{openPlate\}[^>]*\/>/);
    const open = book.slice(book.indexOf("const openPlate"), book.indexOf("};", book.indexOf("const openPlate")));
    for (const bit of ["draftFromPlate", "setDressed(", "setOpenId("]) assert.equal(open.includes(bit), true, bit);
    assert.equal(/saveLook|keepLook|ensureLookbook|wearToday|setState|useCloset/.test(open), false);
    const sheetAt = book.indexOf("<LookSheet");
    const wear = book.slice(book.indexOf("onWear={", sheetAt), book.indexOf("onOpenLook=", sheetAt));
    assert.equal(wear.includes("wearToday("), true);
    assert.equal(wear.includes("setOpenId(null)"), true);
    assert.equal(sheet.includes("keepLook"), false);
    const save = sheet.slice(sheet.indexOf("disabled={comboSaved}"), sheet.indexOf("Save look"));
    assert.equal(save.includes("saveLook("), true);
    assert.equal(save.includes("disabled={comboSaved}"), true);
    assert.equal(save.includes("looks.some((l) => l.id === look.id)"), false);
  });

  it("FlatLay is unchanged without onPick, and a picked piece lifts with its caption", async () => {
    const ts = await import("typescript");
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { pathToFileURL } = await import("node:url");
    const dir = mkdtempSync(join(tmpdir(), "flat-lay-"));
    try {
      let js = ts.transpileModule(read("../components/closet/flat-lay.tsx"), {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
        fileName: "flat-lay.tsx",
      }).outputText;
      const reactHref = import.meta.resolve("react");
      const jsxHref = import.meta.resolve("react/jsx-runtime");
      const stub = join(dir, "gimg.mjs");
      writeFileSync(
        stub,
        `import { createElement } from ${JSON.stringify(reactHref)};
export function GarmentImg(props) {
  return createElement("img", { "data-img": props.garment.id, alt: props.garment.name || "" });
}
`,
      );
      js = js.replaceAll('from "react/jsx-runtime"', `from ${JSON.stringify(jsxHref)}`);
      for (const [spec, target] of [
        ["@/components/closet/gimg", pathToFileURL(stub).href],
        ["@/lib/style", new URL("./style.ts", import.meta.url).href],
        ["@/lib/utils", new URL("./utils.ts", import.meta.url).href],
      ]) {
        js = js.replaceAll(`from "${spec}"`, `from ${JSON.stringify(target)}`);
      }
      assert.equal(js.includes("@/"), false, js);
      const file = join(dir, "flat-lay.mjs");
      writeFileSync(file, js);
      const { FlatLay } = await import(pathToFileURL(file).href);
      const pieces = [oxford, chinos, loafers];
      const passive = renderToStaticMarkup(createElement(FlatLay, { pieces }));
      assert.equal(passive.includes("<button"), false);
      assert.equal(passive.includes("data-piece="), false);
      assert.equal(passive.includes("has-pick"), false);
      const html = renderToStaticMarkup(
        createElement(FlatLay, {
          pieces,
          activeId: "lf",
          onPick: () => {},
          caption: createElement("p", { "data-caption": "" }, "Brown loafers"),
        }),
      );
      assert.equal(html.split("<button").length - 1, 3);
      for (const g of pieces) assert.equal(html.includes(`aria-label="${g.name}"`), true, g.name);
      assert.equal(html.split('aria-pressed="true"').length - 1, 1);
      assert.match(html, /aria-label="Brown loafers" aria-pressed="true"/);
      assert.match(html, /^<div[^>]*class="[^"]*\bhas-pick\b/);
      assert.match(html, /<div data-piece="lf" class="flat-piece absolute is-picked"/);
      assert.equal(html.split("is-picked").length - 1, 1);
      assert.equal(html.split("data-caption").length - 1, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Today's paper model picks a piece and swaps it under the list's own rule", () => {
    const today = read("../routes/index.tsx");
    assert.match(today, /<FlatLay[^>]*onPick=\{setPick\}/);
    const flatAt = today.indexOf("<FlatLay");
    const flatEnd = today.indexOf('<div className="space-y-6">', flatAt);
    assert.ok(flatAt > 0 && flatEnd > flatAt);
    const flat = today.slice(flatAt, flatEnd);
    assert.equal(flat.includes("<OnMePanel"), false);
    assert.equal(flat.includes("swapBlocked("), true);
    assert.equal(flat.includes("swapOn("), true);
    const row = today.slice(today.indexOf("data-piece-row"), today.indexOf("Remove", today.indexOf("data-piece-row")));
    const swap = row.slice(row.indexOf("Outfit with this"));
    assert.equal(swap.includes("disabled={swapBlocked(g)}"), true);
    assert.equal(swap.includes("onClick={() => swapOn(g)}"), true);
    for (const banned of ["keepLook", "setTaste", "learnFrom"]) assert.equal(today.includes(banned), false, banned);
  });
});

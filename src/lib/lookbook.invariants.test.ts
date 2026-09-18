import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildLookbook,
  buildWeek,
  chapterExhausted,
  chapterVisible,
  coverUnused,
  lookAllowsBlazer,
  lookClashes,
  lookFitsHouse,
  lookFitsOccasion,
  lookbookStats,
  looksForHero,
  unusedFromLooks,
} from "./lookbook.ts";
import { lookFitsSeason } from "./season.ts";
import { HOUSE_CHIPS, leadHouse, slotOf } from "./style.ts";
import { OCCASIONS, SEASONS, type Garment } from "./types.ts";

function plate(
  partial: Pick<Garment, "id" | "name" | "category" | "subtype"> & Partial<Garment>,
): Garment {
  return {
    colors: ["navy"],
    material: "cotton",
    brand: "",
    notes: "",
    formality: 3,
    warmth: 3,
    seasons: ["fall", "spring"],
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

function many(
  n: number,
  kind: string,
  category: Garment["category"],
  subtype: string,
  extra?: Partial<Garment>,
): Garment[] {
  return Array.from({ length: n }, (_, i) =>
    plate({
      id: `${subtype}-${i + 1}`,
      name: `${kind} ${i + 1}`,
      category,
      subtype,
      ...extra,
    }),
  );
}

/** ≥40 real-shaped plates. No demo. */
const FIXTURE: Garment[] = [
  ...many(8, "Navy oxford", "top", "oxford", { colors: ["navy"], warmth: 2 }),
  plate({
    id: "ox-lb",
    name: "Light blue oxford",
    category: "top",
    subtype: "oxford",
    colors: ["light blue"],
    warmth: 2,
  }),
  plate({
    id: "ox-white",
    name: "White oxford",
    category: "top",
    subtype: "oxford",
    colors: ["white"],
    warmth: 2,
  }),
  ...many(4, "Navy polo", "top", "polo", { colors: ["navy"] }),
  ...many(3, "Navy rugby", "top", "rugby", { colors: ["navy"], formality: 2 }),
  ...many(3, "Linen camp", "top", "camp shirt", { colors: ["white"], warmth: 1, seasons: ["summer"] }),
  ...many(3, "Cream fair isle", "top", "knit", { colors: ["cream"], warmth: 3 }),
  ...many(3, "Cream cable", "top", "cable", { colors: ["cream"], warmth: 3 }),
  ...many(5, "Khaki chino", "bottom", "chino", { colors: ["khaki"], category: "bottom" }),
  ...many(3, "Charcoal trouser", "bottom", "trouser", {
    colors: ["charcoal"],
    category: "bottom",
    formality: 4,
  }),
  plate({
    id: "tr-lb",
    name: "Light blue trousers",
    category: "bottom",
    subtype: "trouser",
    colors: ["light blue"],
    formality: 4,
  }),
  ...many(4, "Indigo jean", "bottom", "jean", { colors: ["navy"], category: "bottom", formality: 2 }),
  ...many(3, "Brown cord", "bottom", "cord", { colors: ["brown"], category: "bottom" }),
  ...many(4, "Brown loafer", "footwear", "loafer", { colors: ["brown"], category: "footwear" }),
  plate({
    id: "lf-navy",
    name: "Navy loafers",
    category: "footwear",
    subtype: "loafer",
    colors: ["navy"],
  }),
  ...many(3, "White sneaker", "footwear", "sneaker", {
    colors: ["white"],
    category: "footwear",
    formality: 1,
  }),
  ...many(3, "Brown boot", "footwear", "boot", { colors: ["brown"], category: "footwear" }),
  plate({
    id: "blazer-navy",
    name: "Navy blazer",
    category: "outerwear",
    subtype: "blazer",
    colors: ["navy"],
    formality: 4,
  }),
  plate({
    id: "coat-camel",
    name: "Camel overcoat",
    category: "outerwear",
    subtype: "overcoat",
    colors: ["camel"],
    warmth: 5,
    seasons: ["winter"],
  }),
];

const RALPH_WEEKEND = [
  FIXTURE.find((g) => g.id === "ox-lb")!,
  FIXTURE.find((g) => g.id === "tr-lb")!,
  FIXTURE.find((g) => g.id === "lf-navy")!,
];

describe("lookbook invariants", () => {
  it("INVARIANT 1 — oxford+light-blue-trouser+navy-loafer is a LEGAL Ralph weekend", () => {
    assert.equal(leadHouse(RALPH_WEEKEND), "polo");
    assert.equal(lookFitsOccasion(RALPH_WEEKEND, "weekend"), true);
    assert.equal(lookClashes(RALPH_WEEKEND), false);
  });

  it("INVARIANT 1 — NEVER 0 for every occasion × season × house", () => {
    assert.ok(FIXTURE.length >= 40, `fixture ${FIXTURE.length}`);
    assert.ok(FIXTURE.every((g) => g.demo !== true));
    const book = coverUnused(FIXTURE, buildLookbook(FIXTURE, "2026-09-12"));
    const houses = [...HOUSE_CHIPS.map((h) => h.id), "all"] as const;
    for (const occ of OCCASIONS) {
      for (const season of SEASONS) {
        for (const house of houses) {
          const shown = chapterVisible(book, FIXTURE, occ.id, {
            season: season.id,
            house,
            min: 3,
          });
          assert.ok(
            shown.length >= 3,
            `${occ.id} × ${season.id} × ${house} = ${shown.length}`,
          );
        }
      }
    }
    const weekendPoloFall = chapterVisible(book, FIXTURE, "weekend", {
      season: "fall",
      house: "polo",
      min: 3,
    });
    assert.ok(weekendPoloFall.length >= 3, `Weekend+Polo+Fall ${weekendPoloFall.length}`);
    const travelPoloFall = chapterVisible(book, FIXTURE, "travel", {
      season: "fall",
      house: "polo",
      min: 3,
    });
    assert.ok(travelPoloFall.length >= 3, `Travel+Polo+Fall ${travelPoloFall.length}`);
    const weekdaySs = chapterVisible(book, FIXTURE, "weekday", {
      season: "fall",
      house: "sweetStable",
      min: 3,
    });
    assert.ok(weekdaySs.length >= 3, `Weekday+SweetStable ${weekdaySs.length}`);
    const weekday545 = chapterVisible(book, FIXTURE, "weekday", {
      season: "fall",
      house: "fiveFourFive",
      min: 3,
    });
    assert.ok(weekday545.length >= 3, `Weekday+545 ${weekday545.length}`);
  });

  it("INVARIANT 2 — house is a rank; dropping lookFitsHouse must not go below 3", () => {
    const book = buildLookbook(FIXTURE, "2026-09-12");
    const shown = chapterVisible(book, FIXTURE, "weekend", {
      season: "fall",
      house: "polo",
      min: 3,
    });
    assert.ok(shown.length >= 3);
    const hard = shown.filter((l) => {
      const pieces = l.garmentIds
        .map((id) => FIXTURE.find((g) => g.id === id))
        .filter((g): g is Garment => Boolean(g));
      return lookFitsHouse(pieces, "polo", "weekend", FIXTURE);
    });
    assert.ok(hard.length >= 1, `Polo weekend hard-fit ${hard.length} of ${shown.length}`);
  });

  it("INVARIANT 3 — exhausted is never true at 0", () => {
    assert.equal(chapterExhausted(0, 0, 0), false);
    assert.equal(chapterExhausted(0, 0, 5), false);
    assert.equal(chapterExhausted(2, 0, 0), false);
    assert.equal(chapterExhausted(5, 0, 0), true);
    assert.equal(chapterExhausted(5, 3, 0), false);
  });

  it("INVARIANT 4 — whole rack is in the book", () => {
    const book = coverUnused(FIXTURE, buildLookbook(FIXTURE, "2026-09-12"));
    const stats = lookbookStats(book, FIXTURE);
    const unused = stats.unusedNames;
    const slots = new Set(
      FIXTURE.map((g) => g.category).filter((c) =>
        ["top", "bottom", "footwear", "outerwear"].includes(c),
      ),
    );
    void slots;
    assert.equal(
      unused.length,
      0,
      `unused ${unused.length}: ${unused.slice(0, 12).join(", ")}`,
    );
  });

  it("INVARIANT 5 — clashes still hard; ALD loafer and jeans weekday legal", () => {
    const camp990 = [
      plate({ id: "c", name: "Linen camp collar", category: "top", subtype: "camp shirt", warmth: 1 }),
      plate({ id: "ch", name: "Khaki chinos", category: "bottom", subtype: "chino" }),
      plate({ id: "nb", name: "Grey 990", category: "footwear", subtype: "sneaker" }),
      plate({ id: "cb", name: "Beige cord blazer", category: "outerwear", subtype: "blazer" }),
    ];
    assert.equal(lookClashes(camp990), true);
    const rugbyBlazer = [
      plate({ id: "rg", name: "Navy rugby", category: "top", subtype: "rugby" }),
      plate({ id: "jean", name: "Indigo jeans", category: "bottom", subtype: "jean" }),
      plate({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer" }),
      plate({ id: "bz", name: "Navy blazer", category: "outerwear", subtype: "blazer" }),
    ];
    assert.equal(lookClashes(rugbyBlazer), true);
    assert.equal(
      lookAllowsBlazer(rugbyBlazer.slice(0, 3), rugbyBlazer[3]!, "weekday"),
      false,
    );
    const hoodie = plate({
      id: "hood",
      name: "Black 90s hoodie",
      category: "outerwear",
      subtype: "hoodie",
    });
    assert.equal(slotOf(hoodie), "top");
    const ald = [
      plate({ id: "rg", name: "Navy rugby", category: "top", subtype: "rugby" }),
      plate({ id: "jean", name: "Indigo jeans", category: "bottom", subtype: "jean" }),
      plate({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer" }),
    ];
    assert.equal(lookFitsOccasion(ald, "weekday"), true);
    const fi = [
      plate({ id: "fi", name: "Cream fair isle", category: "top", subtype: "knit" }),
      plate({ id: "cord", name: "Brown cords", category: "bottom", subtype: "cord" }),
      plate({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer" }),
    ];
    assert.equal(lookFitsOccasion(fi, "weekday"), true);
    const jeanWeek = [
      plate({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford" }),
      plate({ id: "jean", name: "Dark indigo jeans", category: "bottom", subtype: "jean" }),
      plate({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer" }),
    ];
    assert.equal(lookFitsOccasion(jeanWeek, "weekday"), true);
  });

  it("INVARIANT 6 — season hard rejects only; fall does not wipe oxford", () => {
    const linen = [
      plate({
        id: "camp",
        name: "Linen camp collar",
        category: "top",
        subtype: "camp shirt",
        warmth: 1,
        seasons: [],
      }),
      plate({
        id: "tr",
        name: "Linen trousers",
        category: "bottom",
        subtype: "trouser",
        warmth: 2,
        seasons: [],
      }),
      plate({ id: "lf", name: "Navy loafers", category: "footwear", subtype: "loafer" }),
    ];
    assert.equal(lookFitsSeason(linen, "winter"), false);
    const coatSummer = [
      plate({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford", warmth: 2 }),
      plate({ id: "ch", name: "Khaki chino", category: "bottom", subtype: "chino" }),
      plate({
        id: "oc",
        name: "Camel overcoat",
        category: "outerwear",
        subtype: "overcoat",
        warmth: 5,
      }),
    ];
    assert.equal(lookFitsSeason(coatSummer, "summer"), false);
    const shortsWinter = [
      plate({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford" }),
      plate({ id: "sh", name: "Linen shorts", category: "bottom", subtype: "shorts", warmth: 1 }),
      plate({ id: "lf", name: "Navy loafers", category: "footwear", subtype: "loafer" }),
    ];
    assert.equal(lookFitsSeason(shortsWinter, "winter"), false);
    assert.equal(lookFitsSeason(RALPH_WEEKEND, "fall"), true);
  });

  it("this week has 7; unused rail empty after cover; oxford stars in 5", () => {
    const week = buildWeek(FIXTURE, "2026-09-14");
    assert.equal(week.length, 7, `week ${week.length}`);
    const book = coverUnused(FIXTURE, [...week, ...buildLookbook(FIXTURE, "2026-09-14")]);
    assert.equal(
      unusedFromLooks(FIXTURE, book).length,
      0,
      `unused ${unusedFromLooks(FIXTURE, book).map((g) => g.name).slice(0, 8).join(", ")}`,
    );
    const ox = FIXTURE.find((g) => g.id === "ox-lb")!;
    const five = looksForHero(ox, FIXTURE);
    assert.equal(five.length, 5, `hero looks ${five.length}`);
    for (const l of five) {
      assert.ok(l.garmentIds.includes(ox.id), l.name);
      const pieces = l.garmentIds
        .map((id) => FIXTURE.find((g) => g.id === id))
        .filter((g): g is Garment => Boolean(g));
      assert.equal(lookClashes(pieces), false);
    }
    const wrf = chapterVisible(week, FIXTURE, "weekend", {
      season: "fall",
      house: "polo",
      min: 3,
    });
    assert.ok(wrf.length >= 3, `Weekend×Ralph×Fall week band ${wrf.length}`);
  });
});

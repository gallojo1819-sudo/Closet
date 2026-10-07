import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  guessSeason,
  lookFitsSeason,
  seasonControlLabel,
  seasonFromWeather,
  seasonsOf,
} from "./season.ts";
import type { Garment } from "./types.ts";

function g(
  partial: Pick<Garment, "id" | "name" | "subtype"> & Partial<Garment>,
): Garment {
  return {
    category: "top",
    colors: ["navy"],
    material: "cotton",
    brand: "",
    notes: "",
    formality: 3,
    warmth: 3,
    seasons: [],
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

describe("guessSeason", () => {
  it("linen and camp are summer; overcoat is winter; blazer is fall and spring", () => {
    assert.deepEqual(
      guessSeason(g({ id: "1", name: "Linen camp collar", subtype: "camp shirt", warmth: 1 })),
      ["summer"],
    );
    assert.deepEqual(
      guessSeason(
        g({
          id: "2",
          name: "Camel overcoat",
          subtype: "overcoat",
          category: "outerwear",
          warmth: 5,
        }),
      ),
      ["winter"],
    );
    assert.deepEqual(
      guessSeason(
        g({ id: "3", name: "Navy blazer", subtype: "blazer", category: "outerwear", warmth: 3 }),
      ),
      ["fall", "spring"],
    );
  });

  it("user chips win", () => {
    const linen = g({
      id: "1",
      name: "Linen camp collar",
      subtype: "camp shirt",
      warmth: 1,
      seasons: ["winter"],
    });
    assert.deepEqual(seasonsOf(linen), ["winter"]);
  });
});

describe("seasonFromWeather", () => {
  it("Auto in September NYC is fall", () => {
    const sep = new Date(2026, 8, 13);
    assert.equal(seasonFromWeather(68, sep), "fall");
    assert.equal(seasonFromWeather(80, sep), "summer");
    assert.equal(seasonFromWeather(40, sep), "winter");
    assert.equal(seasonFromWeather(undefined, sep), "fall");
    assert.equal(seasonFromWeather(null, sep), "fall");
  });

  it("October Auto reads Auto · Fall, and the five seasons are chips", () => {
    const october = new Date(2026, 9, 15);
    assert.equal(seasonControlLabel("auto", october, 68), "Auto · Fall");
    assert.equal(seasonControlLabel("auto", october), "Auto · Fall");
    assert.equal(seasonControlLabel("fall", october), "Fall");
    const book = readFileSync(new URL("../routes/lookbook.tsx", import.meta.url), "utf8");
    assert.equal(book.includes("data-house-row"), true);
    assert.equal(book.includes("HOUSE_CHIPS"), true);
    assert.equal(book.includes("seasonOpen"), false);
    const seasonAt = book.indexOf("data-season-control");
    const detectorsAt = book.indexOf("<DetectorSections");
    assert.ok(seasonAt > 0 && detectorsAt > seasonAt);
    const seasonCtl = book.slice(seasonAt, book.indexOf("</div>", book.indexOf("SEASONS.map")));
    assert.match(book.slice(seasonAt, detectorsAt), /\{seasonShown\}/);
    assert.equal(book.split("SEASONS.map").length - 1, 1);
    assert.equal(seasonCtl.includes("SEASONS.map"), true);
    assert.equal(seasonCtl.includes("seasonOpen"), false);
    assert.equal((seasonCtl.match(/<button/g) ?? []).length, 2);
    assert.equal(book.slice(0, seasonAt).includes("SEASONS.map"), false);
  });
});

describe("lookFitsSeason", () => {
  it("Out summer is camp/linen/mule, no overcoat", () => {
    const summer = [
      g({ id: "camp", name: "Linen camp collar", subtype: "camp shirt", warmth: 1 }),
      g({ id: "tr", name: "Linen trousers", subtype: "trouser", category: "bottom", warmth: 2 }),
      g({ id: "mu", name: "White mules", subtype: "mule", category: "footwear", warmth: 2 }),
    ];
    const coat = g({
      id: "oc",
      name: "Camel overcoat",
      subtype: "overcoat",
      category: "outerwear",
      warmth: 5,
    });
    assert.equal(lookFitsSeason(summer, "summer"), true);
    assert.equal(lookFitsSeason([...summer, coat], "summer"), false);
  });

  it("winter rejects linen camp as the only shirt", () => {
    const camp = [
      g({ id: "camp", name: "Linen camp collar", subtype: "camp shirt", warmth: 1 }),
      g({ id: "tr", name: "Wool trousers", subtype: "trouser", category: "bottom", warmth: 4 }),
      g({ id: "lf", name: "Navy loafers", subtype: "loafer", category: "footwear", warmth: 3 }),
    ];
    const winter = [
      g({ id: "knit", name: "Grey merino", subtype: "knit", warmth: 3 }),
      g({ id: "tr", name: "Wool trousers", subtype: "trouser", category: "bottom", warmth: 4 }),
      g({
        id: "oc",
        name: "Camel overcoat",
        subtype: "overcoat",
        category: "outerwear",
        warmth: 5,
      }),
      g({ id: "lf", name: "Navy loafers", subtype: "loafer", category: "footwear", warmth: 3 }),
    ];
    assert.equal(lookFitsSeason(camp, "winter"), false);
    assert.equal(lookFitsSeason(winter, "winter"), true);
  });

  it("empty seasons[] is eligible for a Summer look if the combo is otherwise legal", () => {
    const look = [
      g({ id: "ox", name: "Navy oxford", subtype: "oxford", seasons: [], warmth: 2 }),
      g({
        id: "ch",
        name: "Khaki chino",
        subtype: "chino",
        category: "bottom",
        seasons: [],
        warmth: 3,
      }),
      g({
        id: "lf",
        name: "Navy loafers",
        subtype: "loafer",
        category: "footwear",
        seasons: [],
        warmth: 2,
      }),
    ];
    assert.deepEqual(seasonsOf(look[0]!), ["spring", "summer", "fall", "winter"]);
    assert.equal(lookFitsSeason(look, "summer"), true);
  });

  it("fall + oxford/chino/loafer always passes", () => {
    const look = [
      g({ id: "ox", name: "Navy oxford", subtype: "oxford", warmth: 2 }),
      g({ id: "ch", name: "Khaki chino", subtype: "chino", category: "bottom", warmth: 3 }),
      g({ id: "lf", name: "Navy loafers", subtype: "loafer", category: "footwear", warmth: 2 }),
    ];
    assert.equal(lookFitsSeason(look, "fall"), true);
  });
});

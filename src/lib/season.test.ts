import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  guessSeason,
  lookFitsSeason,
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

  it("fall + oxford/chino/loafer always passes", () => {
    const look = [
      g({ id: "ox", name: "Navy oxford", subtype: "oxford", warmth: 2 }),
      g({ id: "ch", name: "Khaki chino", subtype: "chino", category: "bottom", warmth: 3 }),
      g({ id: "lf", name: "Navy loafers", subtype: "loafer", category: "footwear", warmth: 2 }),
    ];
    assert.equal(lookFitsSeason(look, "fall"), true);
  });
});

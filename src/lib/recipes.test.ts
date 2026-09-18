import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isButtonDown, matchRecipe, pickRecipe, recipesFor } from "./recipes.ts";
import type { Garment } from "./types.ts";

function g(
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

describe("recipes", () => {
  it("oxford is a button-down; polo is not", () => {
    assert.equal(isButtonDown(g({ id: "a", name: "Navy oxford", category: "top", subtype: "oxford" })), true);
    assert.equal(isButtonDown(g({ id: "b", name: "Navy polo", category: "top", subtype: "polo" })), false);
    assert.equal(isButtonDown(g({ id: "c", name: "Cream cable", category: "top", subtype: "cable" })), false);
  });

  it("weekday recipes include WD_PREP_OCBD", () => {
    const ids = recipesFor("weekday", "polo").map((r) => r.id);
    assert.ok(ids.includes("WD_PREP_OCBD"));
  });

  it("pickRecipe weekday Polo starts at WD_PREP_OCBD", () => {
    const pool = [
      g({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford" }),
      g({ id: "tr", name: "Navy trousers", category: "bottom", subtype: "trouser" }),
      g({ id: "lf", name: "Brown loafer", category: "footwear", subtype: "loafer" }),
    ];
    const r = pickRecipe("weekday", pool, { house: "polo" });
    assert.equal(r.id, "WD_PREP_OCBD");
  });

  it("matchRecipe stamps WD_PREP_OCBD on oxford + trouser + loafer", () => {
    const pieces = [
      g({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford" }),
      g({ id: "tr", name: "Navy trousers", category: "bottom", subtype: "trouser" }),
      g({ id: "lf", name: "Brown loafer", category: "footwear", subtype: "loafer" }),
    ];
    assert.equal(matchRecipe(pieces, "weekday", "polo"), "WD_PREP_OCBD");
  });
});

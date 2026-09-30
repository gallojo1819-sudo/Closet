import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isButtonDown, matchRecipe, pickRecipe, plateGapNote, recipeFitsPool, recipesFor, scaledButtonDownQuota } from "./recipes.ts";
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

  it("a recipe whose plate is missing is skipped", () => {
    const pool = [
      g({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford" }),
      g({ id: "tr", name: "Navy trousers", category: "bottom", subtype: "trouser" }),
      g({ id: "lf", name: "Brown loafer", category: "footwear", subtype: "loafer" }),
    ];
    const turtleneck = recipesFor("out", "italianWinter").find((r) => r.id === "OUT_IVORY_DB_DENIM");
    assert.ok(turtleneck);
    assert.equal(recipeFitsPool(turtleneck!, pool), false);
    const picked = pickRecipe("weekday", pool, { house: "polo" });
    assert.notEqual(picked.id, "OUT_IVORY_DB_DENIM");
    assert.equal(scaledButtonDownQuota(pool, 4), 1);
    const note = plateGapNote(pool, "out", "italianWinter");
    assert.ok(note);
    assert.equal(note!.includes("None in"), false);
    assert.equal(/shop|buy/i.test(note!), false);
    assert.match(note!, /closest plates/);
  });

  it("RRL weekday does not fall through to oxford, chino, and a loafer", () => {
    const pool = [
      g({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford" }),
      g({ id: "tr", name: "Khaki chinos", category: "bottom", subtype: "chino" }),
      g({ id: "lf", name: "Brown penny loafers", category: "footwear", subtype: "loafer" }),
      g({ id: "bz", name: "Navy blazer", category: "outerwear", subtype: "blazer" }),
      g({ id: "ws", name: "Indigo work shirt", category: "top", subtype: "shirt" }),
      g({ id: "jn", name: "Indigo selvedge jean", category: "bottom", subtype: "jean" }),
      g({ id: "bt", name: "Brown boot", category: "footwear", subtype: "boot" }),
      g({ id: "ch", name: "Brown chore jacket", category: "outerwear", subtype: "chore" }),
    ];
    const picked = pickRecipe("weekday", pool, { house: "rrl" });
    assert.equal(picked.houses.includes("rrl"), true);
    assert.notEqual(picked.id, "WD_PREP_OCBD");
    assert.notEqual(picked.id, "WD_WESTERN_UNDER_NAVY");
    assert.notEqual(picked.id, "WD_CHORE_CRISP");
    const prep = [
      g({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford" }),
      g({ id: "tr", name: "Khaki chinos", category: "bottom", subtype: "chino" }),
      g({ id: "lf", name: "Brown penny loafers", category: "footwear", subtype: "loafer" }),
    ];
    assert.notEqual(matchRecipe(prep, "weekday", "rrl"), "WD_PREP_OCBD");
    const rugged = [
      g({ id: "ws", name: "Indigo work shirt", category: "top", subtype: "shirt" }),
      g({ id: "jn", name: "Indigo selvedge jean", category: "bottom", subtype: "jean" }),
      g({ id: "bt", name: "Brown boot", category: "footwear", subtype: "boot" }),
      g({ id: "ch", name: "Brown chore jacket", category: "outerwear", subtype: "chore" }),
    ];
    const stamped = matchRecipe(rugged, "weekday", "rrl");
    assert.equal(stamped?.startsWith("WD_"), true);
    assert.notEqual(stamped, "WD_PREP_OCBD");
  });
});

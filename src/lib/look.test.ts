import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { heroPieces, kitBand, kitCells, layersForOnMe, nameLook, spreadTitle } from "./look.ts";
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

describe("layersForOnMe", () => {
  it("sends one knit, not fair isle fused with a 90s hoodie", () => {
    const look = [
      g({ id: "fair", name: "Cream fair isle", category: "top", subtype: "knit" }),
      g({ id: "hood", name: "Black 90s hoodie", category: "top", subtype: "hoodie" }),
      g({ id: "b", name: "Navy chinos", category: "bottom", subtype: "chino" }),
      g({ id: "s", name: "Brown loafers", category: "footwear", subtype: "loafer" }),
    ];
    const sent = layersForOnMe(look);
    const topIds = sent.filter((x) => x.category === "top" || /hoodie|knit|fair/i.test(x.name));
    const ids = sent.map((x) => x.id);
    assert.ok(ids.includes("b") && ids.includes("s"));
    assert.ok(ids.includes("fair"), `fair isle missing: ${ids.join(",")}`);
    assert.ok(!ids.includes("hood"), `90s hoodie sent with fair isle: ${ids.join(",")}`);
    assert.ok(topIds.length <= 2);
  });

  it("camp collar is the only top — no hoodie", () => {
    const look = [
      g({ id: "camp", name: "Linen camp collar", category: "top", subtype: "shirt" }),
      g({ id: "hood", name: "Black 90s hoodie", category: "outerwear", subtype: "hoodie" }),
      g({ id: "b", name: "Cream trousers", category: "bottom", subtype: "trouser" }),
      g({ id: "s", name: "Navy loafers", category: "footwear", subtype: "loafer" }),
    ];
    const sent = layersForOnMe(look);
    const ids = sent.map((x) => x.id);
    assert.ok(ids.includes("camp"));
    assert.ok(!ids.includes("hood"), `hoodie sent on camp collar: ${ids.join(",")}`);
  });

  it("does not send hoodie as a second outer on a knit", () => {
    const look = [
      g({ id: "flag", name: "Flag sweatshirt", category: "top", subtype: "sweatshirt" }),
      g({ id: "hood", name: "Navy hoodie", category: "outerwear", subtype: "hoodie" }),
      g({ id: "b", name: "Khaki chinos", category: "bottom", subtype: "chino" }),
      g({ id: "s", name: "White mules", category: "footwear", subtype: "mule" }),
    ];
    const sent = layersForOnMe(look);
    const ids = sent.map((x) => x.id);
    assert.equal(
      [ids.includes("flag"), ids.includes("hood")].filter(Boolean).length,
      1,
      `fused graphics: ${ids.join(",")}`,
    );
  });

  it("does not send a blazer when the look is three pieces", () => {
    const look = [
      g({ id: "polo", name: "Pink polo", category: "top", subtype: "polo" }),
      g({ id: "tr", name: "Blue trousers", category: "bottom", subtype: "trouser" }),
      g({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer" }),
      g({ id: "blz", name: "Navy blazer", category: "outerwear", subtype: "blazer" }),
    ];
    const three = layersForOnMe(look.slice(0, 3));
    assert.deepEqual(
      three.map((x) => x.id),
      ["polo", "tr", "lf"],
    );
    const four = layersForOnMe(look);
    assert.ok(four.some((x) => x.id === "blz"));
  });
});

describe("kitCells", () => {
  it("shows polo, trousers, blazer, loafers as four tiles", () => {
    const look = [
      g({ id: "polo", name: "Pink polo", category: "top", subtype: "polo" }),
      g({ id: "tr", name: "Blue trousers", category: "bottom", subtype: "trouser" }),
      g({ id: "blz", name: "Navy blazer", category: "outerwear", subtype: "blazer" }),
      g({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer" }),
    ];
    const cells = kitCells(look);
    assert.deepEqual(
      cells.map((x) => x.id),
      ["polo", "tr", "blz", "lf"],
    );
  });

  it("three pieces put footwear on the full second row", () => {
    const look = [
      g({ id: "polo", name: "Pink polo", category: "top", subtype: "polo" }),
      g({ id: "tr", name: "Blue trousers", category: "bottom", subtype: "trouser" }),
      g({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer" }),
    ];
    assert.deepEqual(
      kitCells(look).map((x) => x.id),
      ["polo", "tr", "lf"],
    );
  });
});

describe("heroPieces", () => {
  it("uses the strip look when that cell has a thumbnail", () => {
    const drop: Garment[] = [];
    const strip = [
      g({ id: "a", name: "Navy oxford", category: "top", subtype: "oxford" }),
      g({ id: "b", name: "Cream chino", category: "bottom", subtype: "chino" }),
      g({ id: "c", name: "Brown loafers", category: "footwear", subtype: "loafer" }),
    ];
    const hero = heroPieces(drop, strip);
    assert.equal(nameLook(drop), "Nothing on the rack");
    assert.notEqual(nameLook(hero), "Nothing on the rack");
    assert.deepEqual(hero.map((piece) => piece.id), ["a", "b", "c"]);
  });

  it("keeps the drop when the strip cell has no thumbnail", () => {
    const drop = [g({ id: "a", name: "Navy oxford", category: "top", subtype: "oxford" })];
    assert.equal(heroPieces(drop, []).length, 1);
    assert.equal(heroPieces([], [drop[0]!]).length, 0);
  });
});

describe("kitBand", () => {
  it("files the khaki varsity as a jacket, not a sweater", () => {
    const varsity = g({ id: "g_j5og5jmzh5tx", name: "Khaki varsity", category: "top", subtype: "" });
    assert.equal(kitBand(varsity), "jacket");
  });
});

describe("spreadTitle", () => {
  it("is editorial, not a SKU dump", () => {
    const look = [
      g({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford", colors: ["navy"] }),
      g({ id: "ch", name: "Cream chino", category: "bottom", subtype: "chino", colors: ["cream"] }),
      g({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer", colors: ["brown"] }),
    ];
    const week = spreadTitle(look, "weekday");
    assert.ok(!week.includes("Navy oxford ·"), week);
    assert.ok(/Ralph|cream|navy|Quiet office/i.test(week), week);
    const out = spreadTitle(look, "out");
    assert.ok(!out.includes("Navy oxford ·"), out);
    assert.ok(/Ralph|cream|navy|Out/i.test(out), out);
  });
});

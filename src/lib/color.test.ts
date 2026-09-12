import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canonicalize, colorLine, harmony, nearestName, preferPixels } from "./color.ts";
import type { Garment } from "./types.ts";

function g(
  partial: Pick<Garment, "id" | "name" | "category"> & Partial<Garment>,
): Garment {
  return {
    subtype: "",
    colors: [],
    material: "",
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

describe("nearestName", () => {
  it("navy leather is navy, not white or olive", () => {
    assert.equal(nearestName(30, 42, 88), "navy");
    assert.notEqual(nearestName(30, 42, 88), "olive");
    assert.notEqual(nearestName(30, 42, 88), "white");
  });

  it("maroon cloth is maroon, not brown", () => {
    assert.equal(nearestName(118, 34, 44), "maroon");
    assert.notEqual(nearestName(118, 34, 44), "brown");
  });
});

describe("preferPixels", () => {
  it("keeps navy pixels when the tag says olive", () => {
    assert.deepEqual(preferPixels(["navy"], ["olive"]), ["navy"]);
  });
});

describe("harmony", () => {
  it("navy × cream × brown scores well", () => {
    const look = [
      g({ id: "t", name: "Cream oxford", category: "top", subtype: "oxford", colors: ["cream"] }),
      g({ id: "b", name: "Navy chinos", category: "bottom", subtype: "chino", colors: ["navy"] }),
      g({ id: "s", name: "Brown loafers", category: "footwear", subtype: "loafer", colors: ["brown"] }),
    ];
    assert.ok(harmony(look) > 0);
  });

  it("black + brown with no navy is a clash", () => {
    const look = [
      g({ id: "t", name: "Black knit", category: "top", subtype: "knit", colors: ["black"] }),
      g({ id: "b", name: "Brown trousers", category: "bottom", subtype: "trouser", colors: ["brown"] }),
      g({ id: "s", name: "Brown loafers", category: "footwear", subtype: "loafer", colors: ["brown"] }),
    ];
    assert.ok(harmony(look) < 0);
  });

  it("color line is quiet", () => {
    const look = [
      g({ id: "t", name: "Cream oxford", category: "top", subtype: "oxford", colors: ["cream"] }),
      g({ id: "b", name: "Navy chinos", category: "bottom", subtype: "chino", colors: ["navy"] }),
      g({ id: "s", name: "Brown loafers", category: "footwear", subtype: "loafer", colors: ["brown"] }),
    ];
    assert.equal(colorLine(look, "Ralph"), "Navy × cream × brown — Ralph.");
  });
});

describe("canonicalize", () => {
  it("maps gray to grey", () => {
    assert.equal(canonicalize("Gray"), "grey");
    assert.equal(canonicalize("navy blue"), "navy");
  });
});

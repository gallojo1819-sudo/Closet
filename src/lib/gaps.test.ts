import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rackGaps, rackLine } from "./gaps.ts";
import type { Garment } from "./types.ts";

function piece(
  partial: Pick<Garment, "id" | "name" | "category" | "subtype"> & Partial<Garment>,
): Garment {
  return {
    colors: ["navy"],
    material: "cotton",
    brand: "",
    notes: "",
    formality: 3,
    warmth: 3,
    seasons: ["fall"],
    imageSrc: "/x.jpg",
    cutoutSrc: "/x.jpg",
    imageSource: "official",
    matteQuality: "clean",
    demo: false,
    archived: false,
    wornOn: ["2026-09-10"],
    createdAt: "2026-01-01T12:00:00.000Z",
    ...partial,
  };
}

describe("rackGaps", () => {
  it("ignores demo and archived", () => {
    const g = [
      ...Array.from({ length: 20 }, (_, i) =>
        piece({
          id: `d${i}`,
          name: `Demo oxford ${i}`,
          category: "top",
          subtype: "oxford",
          demo: true,
        }),
      ),
      piece({
        id: "a",
        name: "Archived oxford",
        category: "top",
        subtype: "oxford",
        archived: true,
      }),
    ];
    assert.deepEqual(rackGaps(g), []);
  });

  it("tops vs footwear", () => {
    const g = [
      ...Array.from({ length: 12 }, (_, i) =>
        piece({
          id: `t${i}`,
          name: `Navy knit ${i}`,
          category: "top",
          subtype: "knit",
          colors: ["navy"],
        }),
      ),
      piece({
        id: "b1",
        name: "Charcoal trousers",
        category: "bottom",
        subtype: "trouser",
        colors: ["charcoal"],
      }),
      piece({
        id: "s1",
        name: "White sneakers",
        category: "footwear",
        subtype: "sneaker",
        colors: ["white"],
      }),
      piece({
        id: "s2",
        name: "Grey sneakers",
        category: "footwear",
        subtype: "sneaker",
        colors: ["grey"],
      }),
    ];
    const lines = rackGaps(g);
    assert.ok(
      lines.some((l) => l.includes("12 tops, 2 shoes")),
      lines.join(" | "),
    );
    assert.ok(lines.some((l) => l.includes("Trousers without a leather shoe")));
  });

  it("oxford holes and linen, not maroon nag", () => {
    const g = [
      ...Array.from({ length: 6 }, (_, i) =>
        piece({
          id: `k${i}`,
          name: `Navy knit ${i}`,
          category: "top",
          subtype: "knit",
          colors: ["navy"],
          warmth: 2,
        }),
      ),
      piece({
        id: "maroon",
        name: "Maroon knit",
        category: "top",
        subtype: "knit",
        colors: ["maroon"],
      }),
      ...Array.from({ length: 4 }, (_, i) =>
        piece({
          id: `p${i}`,
          name: `Navy polo ${i}`,
          category: "top",
          subtype: "polo",
          colors: ["navy"],
        }),
      ),
      piece({
        id: "ox",
        name: "Navy oxford",
        category: "top",
        subtype: "oxford",
        colors: ["navy"],
      }),
      piece({
        id: "b1",
        name: "Navy chinos",
        category: "bottom",
        subtype: "chino",
        colors: ["navy"],
      }),
      piece({
        id: "s1",
        name: "Brown loafers",
        category: "footwear",
        subtype: "loafer",
        colors: ["brown"],
      }),
    ];
    const lines = rackGaps(g);
    const blob = lines.join(" | ");
    assert.ok(blob.includes("Light blue or white oxford"), blob);
    assert.ok(blob.includes("No linen shirt"), blob);
    assert.ok(blob.includes("Khaki or olive"), blob);
    assert.ok(!/maroon/i.test(blob), blob);
    assert.ok(!/buy/i.test(blob), blob);
    assert.ok(!/cart/i.test(blob), blob);
    assert.ok(lines.length >= 1 && lines.length <= 8);
  });

  it("zero oxford under knits", () => {
    const g = [
      piece({
        id: "k1",
        name: "Cream knit",
        category: "top",
        subtype: "knit",
        colors: ["cream"],
      }),
      piece({
        id: "b1",
        name: "Khaki chinos",
        category: "bottom",
        subtype: "chino",
        colors: ["khaki"],
      }),
      piece({
        id: "s1",
        name: "Brown loafers",
        category: "footwear",
        subtype: "loafer",
        colors: ["brown"],
      }),
    ];
    const lines = rackGaps(g);
    assert.ok(
      lines.some((l) => l.includes("Need an oxford")),
      lines.join(" | "),
    );
  });

  it("idle sitting", () => {
    const g = Array.from({ length: 6 }, (_, i) =>
      piece({
        id: `t${i}`,
        name: i < 3 ? `White oxford ${i}` : `Olive chino ${i}`,
        category: i < 3 ? "top" : "bottom",
        subtype: i < 3 ? "oxford" : "chino",
        colors: i < 3 ? ["white"] : ["olive"],
        wornOn: [],
        createdAt: "2026-01-01T12:00:00.000Z",
      }),
    ).concat([
      piece({
        id: "s1",
        name: "Brown loafers",
        category: "footwear",
        subtype: "loafer",
        colors: ["brown"],
        wornOn: [],
      }),
      piece({
        id: "s2",
        name: "White mules",
        category: "footwear",
        subtype: "mule",
        colors: ["white"],
        wornOn: [],
      }),
    ]);
    const lines = rackGaps(g);
    assert.ok(
      lines.some((l) => /pieces sitting/.test(l)),
      lines.join(" | "),
    );
  });

  it("balanced rack is one even line", () => {
    const g = [
      piece({
        id: "oxw",
        name: "White oxford",
        category: "top",
        subtype: "oxford",
        colors: ["white"],
      }),
      piece({
        id: "oxn",
        name: "Navy oxford",
        category: "top",
        subtype: "oxford",
        colors: ["navy"],
      }),
      piece({
        id: "lin",
        name: "White linen shirt",
        category: "top",
        subtype: "linen shirt",
        material: "linen",
        colors: ["white"],
        warmth: 1,
        seasons: ["summer"],
      }),
      piece({
        id: "k1",
        name: "Navy knit",
        category: "top",
        subtype: "knit",
        colors: ["navy"],
      }),
      piece({
        id: "b1",
        name: "Khaki chinos",
        category: "bottom",
        subtype: "chino",
        colors: ["khaki"],
      }),
      piece({
        id: "b2",
        name: "Olive trousers",
        category: "bottom",
        subtype: "trouser",
        colors: ["olive"],
      }),
      piece({
        id: "s1",
        name: "Brown loafers",
        category: "footwear",
        subtype: "loafer",
        colors: ["brown"],
      }),
      piece({
        id: "s2",
        name: "White mules",
        category: "footwear",
        subtype: "mule",
        colors: ["white"],
      }),
    ];
    const lines = rackGaps(g);
    assert.deepEqual(lines, ["The rack is even. Wear what’s sitting."]);
    assert.equal(rackLine(g), "The rack is even. Wear what’s sitting.");
  });
});

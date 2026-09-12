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

  it("names cream trousers + navy loafers waiting on a pale oxford", () => {
    const g = [
      piece({
        id: "k1",
        name: "Navy knit",
        category: "top",
        subtype: "knit",
        colors: ["navy"],
      }),
      piece({
        id: "b1",
        name: "Cream trousers",
        category: "bottom",
        subtype: "trouser",
        colors: ["cream"],
      }),
      piece({
        id: "s1",
        name: "Navy loafers",
        category: "footwear",
        subtype: "loafer",
        colors: ["navy"],
      }),
    ];
    const lines = rackGaps(g);
    const blob = lines.join(" | ");
    assert.ok(
      blob.includes("Light blue or white oxford would finish the Cream trousers + Navy loafers"),
      blob,
    );
    assert.ok(!/\d+ tops/.test(blob), blob);
    assert.ok(!/buy/i.test(blob), blob);
    assert.ok(!/cart/i.test(blob), blob);
  });

  it("trousers + knits without leather want a loafer", () => {
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
    ];
    const lines = rackGaps(g);
    const blob = lines.join(" | ");
    assert.ok(blob.includes("Charcoal trousers are waiting on a loafer"), blob);
    assert.ok(blob.includes("not another knit"), blob);
    assert.ok(!/12 tops/.test(blob), blob);
  });

  it("cords with only sneakers want a brown or burgundy loafer", () => {
    const g = [
      piece({
        id: "k1",
        name: "Navy knit",
        category: "top",
        subtype: "knit",
        colors: ["navy"],
      }),
      piece({
        id: "b1",
        name: "Burgundy cords",
        category: "bottom",
        subtype: "cord",
        colors: ["burgundy"],
      }),
      piece({
        id: "s1",
        name: "Black sneakers",
        category: "footwear",
        subtype: "sneaker",
        colors: ["black"],
      }),
    ];
    const lines = rackGaps(g);
    const blob = lines.join(" | ");
    assert.ok(blob.includes("Brown or burgundy loafer would dress the Burgundy cords"), blob);
    assert.ok(blob.includes("Sneakers are the only shoe"), blob);
  });

  it("navy knits without khaki/olive bottoms", () => {
    const g = [
      ...Array.from({ length: 4 }, (_, i) =>
        piece({
          id: `k${i}`,
          name: `Navy knit ${i}`,
          category: "top",
          subtype: "knit",
          colors: ["navy"],
        }),
      ),
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
    assert.ok(blob.includes("Navy knits have no khaki/olive bottom"), blob);
    assert.ok(blob.includes("navy-on-navy"), blob);
    assert.ok(!/maroon/i.test(blob), blob);
  });

  it("linen would unlock cream trousers in heat", () => {
    const g = [
      piece({
        id: "k1",
        name: "Navy knit",
        category: "top",
        subtype: "knit",
        colors: ["navy"],
        warmth: 2,
      }),
      piece({
        id: "b1",
        name: "Cream trousers",
        category: "bottom",
        subtype: "trouser",
        colors: ["cream"],
        warmth: 1,
        seasons: ["summer"],
      }),
      piece({
        id: "s1",
        name: "Navy loafers",
        category: "footwear",
        subtype: "loafer",
        colors: ["navy"],
      }),
    ];
    const lines = rackGaps(g);
    const blob = lines.join(" | ");
    assert.ok(blob.includes("Linen shirt would unlock the Cream trousers in heat"), blob);
    assert.ok(blob.includes("Knits are doing that job now"), blob);
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

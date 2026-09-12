import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lookMissing, rackLine, rackNotes } from "./gaps.ts";
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

describe("rackNotes", () => {
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
    assert.deepEqual(rackNotes(g), []);
  });

  it("white oxford finishes cream trousers + navy loafers", () => {
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
    const notes = rackNotes(g);
    const first = notes[0]!;
    assert.equal(first.title, "White oxford");
    assert.ok(first.body.includes("Cream trousers"), first.body);
    assert.ok(first.body.includes("Navy loafers"), first.body);
    assert.ok(/ralph/i.test(first.body), first.body);
    assert.deepEqual(first.finishes, ["Cream trousers + Navy loafers"]);
    assert.equal(
      rackLine(g),
      "White oxford — Cream trousers + Navy loafers",
    );
    assert.ok(!notes.some((n) => /navy knit/i.test(n.title)));
    assert.ok(!notes.some((n) => /buy|cart|shop/i.test(`${n.title} ${n.body}`)));
  });

  it("brown loafer finishes trousers when knits exist and leather does not", () => {
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
    const notes = rackNotes(g);
    const loafer = notes.find((n) => n.title === "Brown loafer");
    assert.ok(loafer, notes.map((n) => n.title).join(","));
    assert.ok(loafer!.body.includes("Charcoal trousers"), loafer!.body);
    assert.ok(!/another knit/i.test(loafer!.title));
  });

  it("cords with only sneakers want a brown loafer", () => {
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
    const notes = rackNotes(g);
    const blob = notes.map((n) => `${n.title} ${n.body}`).join(" | ");
    assert.ok(/loafer/i.test(blob), blob);
    assert.ok(blob.includes("Burgundy cords"), blob);
  });

  it("4+ navy knits never recommend another navy knit; khaki chino instead", () => {
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
    const notes = rackNotes(g);
    assert.ok(notes.some((n) => n.title === "Khaki chino"), notes.map((n) => n.title).join(","));
    assert.ok(!notes.some((n) => /navy knit/i.test(n.title)));
  });

  it("linen camp shirt unlocks cream trousers in heat", () => {
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
    const notes = rackNotes(g);
    const linen = notes.find((n) => n.title === "Linen camp shirt");
    assert.ok(linen, notes.map((n) => n.title).join(","));
    assert.ok(linen!.body.includes("Cream trousers"), linen!.body);
    assert.ok(/faloni/i.test(linen!.body), linen!.body);
  });

  it("idle sitting is first when five or more", () => {
    const g = [
      ...Array.from({ length: 5 }, (_, i) =>
        piece({
          id: `idle${i}`,
          name: `Sitting knit ${i}`,
          category: "top",
          subtype: "knit",
          colors: ["navy"],
          wornOn: [],
          createdAt: "2026-01-01T12:00:00.000Z",
        }),
      ),
      piece({
        id: "b1",
        name: "Cream trousers",
        category: "bottom",
        subtype: "trouser",
        colors: ["cream"],
        wornOn: [],
      }),
      piece({
        id: "s1",
        name: "Navy loafers",
        category: "footwear",
        subtype: "loafer",
        colors: ["navy"],
        wornOn: [],
      }),
    ];
    const notes = rackNotes(g);
    assert.ok(notes.length >= 3, String(notes.length));
    assert.equal(notes[0]!.title, "Wear what’s sitting");
    assert.ok(notes.some((n) => n.title === "White oxford"));
  });

  it("balanced rack is one even note", () => {
    const g = [
      piece({
        id: "oxw",
        name: "White oxford",
        category: "top",
        subtype: "oxford",
        colors: ["white"],
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
    const notes = rackNotes(g);
    assert.equal(notes.length, 1);
    assert.equal(notes[0]!.title, "The rack is even");
    assert.equal(rackLine(g), "The rack is even. Wear what’s sitting.");
  });

  it("lookMissing names the oxford hole under trousers + loafers", () => {
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
    const hole = lookMissing([g[0]!, g[1]!, g[2]!], g);
    assert.ok(hole);
    assert.equal(hole!.title, "White oxford");
    assert.ok(hole!.finishes.includes("Cream trousers"));
  });
});

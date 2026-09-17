import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bottomShoePair,
  dressThisPiece,
  moreOutfitsForLook,
  resolvePiecesFromText,
  WHICH_PIECE,
} from "./dress.ts";
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

function rack(): Garment[] {
  return [
    piece({
      id: "cable",
      name: "Cream cable",
      category: "top",
      subtype: "cable knit",
      colors: ["cream"],
    }),
    piece({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford", colors: ["navy"] }),
    piece({ id: "polo", name: "Grey polo", category: "top", subtype: "polo", colors: ["grey"] }),
    piece({ id: "chino", name: "Khaki chinos", category: "bottom", subtype: "chino", colors: ["khaki"] }),
    piece({
      id: "olive",
      name: "Olive chinos",
      category: "bottom",
      subtype: "chino",
      colors: ["olive"],
    }),
    piece({
      id: "trouser",
      name: "Charcoal trousers",
      category: "bottom",
      subtype: "trouser",
      colors: ["charcoal"],
    }),
    piece({
      id: "jean",
      name: "Indigo jeans",
      category: "bottom",
      subtype: "jean",
      colors: ["navy"],
    }),
    piece({
      id: "loafer",
      name: "Navy loafers",
      category: "footwear",
      subtype: "loafer",
      colors: ["navy"],
    }),
    piece({
      id: "brown-loafer",
      name: "Brown loafers",
      category: "footwear",
      subtype: "loafer",
      colors: ["brown"],
    }),
    piece({
      id: "sneaker",
      name: "White sneakers",
      category: "footwear",
      subtype: "sneaker",
      colors: ["white"],
    }),
    piece({
      id: "mule",
      name: "White mules",
      category: "footwear",
      subtype: "mule",
      colors: ["white"],
    }),
  ];
}

describe("resolvePiecesFromText", () => {
  it("resolves wear the cream cable against livePool", () => {
    const hit = resolvePiecesFromText("wear the cream cable", rack());
    assert.equal(hit[0]?.id, "cable");
  });
  it("resolves navy loafers, dinner without inventing a SKU", () => {
    const hit = resolvePiecesFromText("navy loafers, dinner", rack());
    assert.equal(hit[0]?.id, "loafer");
    assert.equal(hit.length, 1);
  });
  it("0 matches is Which piece, never a made-up id", () => {
    const hit = resolvePiecesFromText("wear the gucci horsebit", rack());
    assert.equal(hit.length, 0);
    assert.ok(WHICH_PIECE.includes("Closet"));
  });
});

describe("dressThisPiece", () => {
  it("lock cream cable → look contains that id", () => {
    const g = rack();
    const look = dressThisPiece({
      lockedIds: ["cable"],
      garments: g,
      occasion: "weekday",
    });
    assert.ok(look);
    assert.ok(look!.garmentIds.includes("cable"));
    assert.ok(look!.pieces.some((p) => p.id === "cable"));
  });

  it("3 other outfits don’t reuse the same bottom+shoe if alternatives exist", () => {
    const g = rack();
    const seed = dressThisPiece({
      lockedIds: ["cable"],
      garments: g,
      occasion: "weekday",
    });
    assert.ok(seed);
    const alts = moreOutfitsForLook({
      seedIds: seed!.garmentIds,
      lockedIds: ["cable"],
      garments: g,
      occasion: "weekday",
      n: 3,
    });
    assert.equal(alts.length, 3);
    const pairs = [bottomShoePair(seed!.pieces), ...alts.map((a) => bottomShoePair(a.pieces))];
    assert.ok(pairs.every(Boolean));
    assert.equal(new Set(pairs).size, pairs.length);
    for (const a of alts) assert.ok(a.garmentIds.includes("cable"));
  });
});

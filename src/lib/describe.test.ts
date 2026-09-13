import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPlaceholderName, patchFromNotes } from "./describe.ts";
import type { Garment } from "./types.ts";

function g(partial: Partial<Garment> & Pick<Garment, "id" | "name">): Garment {
  return {
    category: "bottom",
    subtype: "drawstring",
    colors: ["olive"],
    material: "cotton",
    brand: "",
    notes: "",
    formality: 3,
    warmth: 2,
    seasons: [],
    imageSrc: "idb:g:o",
    cutoutSrc: "idb:g:c",
    imageSource: "photo",
    matteQuality: "ok",
    demo: false,
    archived: false,
    wornOn: [],
    createdAt: "2026-01-01T12:00:00.000Z",
    ...partial,
  };
}

describe("patchFromNotes", () => {
  it("retitles a drawstring tag to Gurkha trousers", () => {
    const patch = patchFromNotes(
      g({ id: "1", name: "Olive drawstring trousers" }),
      "Gurkha. Extended waistband, side buckle, no belt, not a drawstring.",
    );
    assert.equal(patch.subtype, "gurkha");
    assert.equal(patch.category, "bottom");
    assert.equal(patch.name, "Olive Gurkha trousers");
    assert.ok(patch.notes?.includes("Gurkha"));
  });

  it("does not rename a custom name", () => {
    const patch = patchFromNotes(
      g({ id: "1", name: "Saturday olive pants", subtype: "pant" }),
      "Gurkha, extended waist, side buckle.",
    );
    assert.equal(patch.subtype, "gurkha");
    assert.equal(patch.name, undefined);
    assert.equal(isPlaceholderName("Saturday olive pants"), false);
    assert.equal(isPlaceholderName("Olive drawstring"), true);
  });
});

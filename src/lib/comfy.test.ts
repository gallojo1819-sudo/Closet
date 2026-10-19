import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { comfyCostume, pickLook } from "./style.ts";
import type { Garment } from "./types.ts";

let n = 0;
function piece(name: string, category: Garment["category"], subtype = "", extra: Partial<Garment> = {}): Garment {
  n += 1;
  return {
    id: `g_comfy_${n}`,
    name,
    category,
    subtype,
    colors: [],
    material: "",
    brand: "",
    notes: "",
    formality: 2,
    warmth: 3,
    seasons: [],
    imageSrc: "",
    cutoutSrc: "",
    imageSource: "official",
    matteQuality: "clean",
    demo: false,
    wornOn: [],
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

describe("Comfy chip (light patch)", () => {
  it("a collared woven shirt over tailored trousers is the costume Comfy refuses", () => {
    const oxford = piece("White oxford", "top", "oxford");
    const trousers = piece("Grey wool trousers", "bottom", "trousers");
    const loafers = piece("Brown loafers", "footwear", "loafer");
    assert.equal(comfyCostume([oxford, trousers, loafers]), true);
    const knit = piece("Cream knit", "top", "sweater");
    const jeans = piece("Navy jeans", "bottom", "jeans");
    assert.equal(comfyCostume([knit, trousers, loafers]), false);
    assert.equal(comfyCostume([oxford, jeans, loafers]), false);
    assert.equal(comfyCostume([piece("Navy polo shirt", "top", "polo"), trousers, loafers]), false);
  });

  it("Comfy leads with the knit, the jeans and the sneakers", () => {
    const pool = [
      piece("White oxford", "top", "oxford", { formality: 3 }),
      piece("Cream knit", "top", "sweater"),
      piece("Grey wool trousers", "bottom", "trousers", { formality: 3 }),
      piece("Navy jeans", "bottom", "jeans"),
      piece("Brown loafers", "footwear", "loafer"),
      piece("White sneakers", "footwear", "sneaker"),
    ];
    const ids = pickLook(pool, { occasion: "comfy", salt: 1 });
    const names = ids.map((id) => pool.find((g) => g.id === id)?.name);
    assert.ok(names.includes("Cream knit"), names.join(", "));
    assert.ok(names.includes("Navy jeans"), names.join(", "));
    assert.ok(names.includes("White sneakers"), names.join(", "));
  });
});

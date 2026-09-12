import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { layersForOnMe } from "./look.ts";
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
});

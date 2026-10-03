import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dressThisPiece } from "./dress.ts";
import {
  houseFingerprintOk,
  houseGapNote,
  houseKill,
  isPoloDefaultSilhouette,
  lookPrint,
  type House,
} from "./houses.ts";
import { lookFitsHouse } from "./lookbook.ts";
import { pickLook } from "./style.ts";
import { houseLegalCombo } from "./houses.ts";
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

const FIX = [
  g({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford", colors: ["navy"] }),
  g({ id: "rugby", name: "Navy rugby", category: "top", subtype: "rugby", colors: ["navy"], formality: 2 }),
  g({ id: "camp", name: "White camp collar", category: "top", subtype: "camp shirt", colors: ["white"], warmth: 1 }),
  g({ id: "sangallo", name: "White sangallo", category: "top", subtype: "sangallo", colors: ["white"], warmth: 1 }),
  g({ id: "cable", name: "Cream cable", category: "top", subtype: "cable knit", colors: ["cream"] }),
  g({ id: "fair", name: "Cream fair isle", category: "top", subtype: "knit", colors: ["cream"] }),
  g({ id: "chino", name: "Khaki chinos", category: "bottom", subtype: "chino", colors: ["khaki"] }),
  g({ id: "jean", name: "Indigo jeans", category: "bottom", subtype: "jean", colors: ["navy"], formality: 2 }),
  g({ id: "cord", name: "Brown cords", category: "bottom", subtype: "cord", colors: ["brown"] }),
  g({ id: "penny", name: "Brown penny loafers", category: "footwear", subtype: "loafer", colors: ["brown"] }),
  g({ id: "nb", name: "Grey 990", category: "footwear", subtype: "sneaker", colors: ["grey"], formality: 2 }),
  g({ id: "mule", name: "Tan driving mule", category: "footwear", subtype: "mule", colors: ["tan"] }),
  g({ id: "court", name: "White court sneakers", category: "footwear", subtype: "sneaker", colors: ["white"] }),
  g({ id: "boot", name: "Brown boots", category: "footwear", subtype: "boot", colors: ["brown"] }),
];

function combo(ids: string[]): Garment[] {
  return ids.map((id) => FIX.find((x) => x.id === id)!);
}

function pick(house: House, occasion: "weekday" | "weekend" | "out") {
  return pickLook(FIX, {
    occasion,
    moment: "day",
    weather: { f: 68, label: "Fair", code: 2 },
    house,
    legalCombo: (p) => houseLegalCombo(p, house, occasion, undefined, FIX),
  });
}

describe("house fingerprints HARD", () => {
  it("Grey 990 is the New Balance shoe family", () => {
    assert.equal(lookPrint(combo(["rugby", "jean", "nb"]), "weekday").shoe_family, "nb990");
    assert.notEqual(
      lookPrint(combo(["ox", "chino", "penny"]), "weekday").shoe_family,
      "nb990",
    );
  });

  it("Sweet Stable weekday is allowed and out stays off", () => {
    assert.equal(lookFitsHouse(combo(["fair", "cord", "boot"]), "sweetStable", "weekday", FIX), true);
    assert.equal(houseKill(combo(["fair", "cord", "boot"]), "sweetStable", "weekday"), null);
    assert.equal(lookFitsHouse(combo(["fair", "cord", "boot"]), "sweetStable", "out", FIX), false);
    assert.equal(houseKill(combo(["fair", "cord", "boot"]), "sweetStable", "out"), "SS-G-out");
  });

  it("a house chip never pads a failing synthetic rack into a legal look", () => {
    for (const house of ["polo", "ald", "faloni", "fiveFourFive"] as House[]) {
      const ids = pick(house, "weekday");
      if (ids.length < 3) continue;
      assert.equal(lookFitsHouse(combo(ids), house, "weekday", FIX), true, house);
      assert.equal(isPoloDefaultSilhouette(lookPrint(combo(ids), "weekday")) && house !== "polo", false);
    }
  });

  it("gap notes come from the approved profile, never None in", () => {
    const five = houseGapNote("fiveFourFive", FIX, "weekday");
    const sweet = houseGapNote("sweetStable", FIX, "weekday");
    assert.match(five ?? "", /henley and relaxed jeans/i);
    assert.match(sweet ?? "", /plain cords and pink gingham/i);
    assert.equal((five ?? "").includes("None in"), false);
    assert.equal((sweet ?? "").includes("None in"), false);
  });

  it("Outfit with this on cream cable includes that id", () => {
    const look = dressThisPiece({
      lockedIds: ["cable"],
      garments: FIX,
      occasion: "weekday",
    });
    assert.ok(look);
    assert.ok(look!.garmentIds.includes("cable"));
  });
});

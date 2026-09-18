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
  it("Polo weekday ≠ ALD weekday (shoe 990 vs penny; top rugby vs oxford)", () => {
    const polo = pick("polo", "weekday");
    const ald = pick("ald", "weekday");
    const poloG = combo(polo);
    const aldG = combo(ald);
    assert.ok(polo.includes("ox") || poloG.some((x) => /oxford|polo|cable/.test(x.subtype)));
    assert.ok(lookFitsHouse(poloG, "polo", "weekday", FIX));
    assert.ok(lookFitsHouse(aldG, "ald", "weekday", FIX));
    const pp = lookPrint(poloG, "weekday");
    const ap = lookPrint(aldG, "weekday");
    assert.equal(ap.shoe_family, "nb990");
    assert.ok(ap.top_type === "rugby" || ap.top_type === "oversized_oxford");
    assert.ok(pp.shoe_family === "penny_loafer" || pp.shoe_family === "leather_sneaker" || pp.shoe_family === "boat");
    assert.notEqual(pp.shoe_family, ap.shoe_family);
    assert.notEqual(pp.top_type, ap.top_type);
  });

  it("Faloni summer ≠ 545 (sangallo or white court)", () => {
    const faloniLook = combo(["camp", "chino", "mule"]);
    const fiveLook = combo(["sangallo", "chino", "court"]);
    assert.ok(lookFitsHouse(faloniLook, "faloni", "weekend", FIX));
    assert.ok(lookFitsHouse(fiveLook, "fiveFourFive", "weekend", FIX));
    assert.equal(lookFitsHouse(faloniLook, "fiveFourFive", "weekend", FIX), false);
    const fiveP = lookPrint(fiveLook, "weekend");
    assert.ok(fiveP.top_type === "sangallo" || fiveP.shoe_family === "white_court");
    const faloni = pick("faloni", "weekend");
    const ff = pick("fiveFourFive", "weekend");
    assert.ok(faloni.length >= 3, `faloni pick ${faloni.join(",")}`);
    assert.ok(ff.length >= 3, `545 pick ${ff.join(",")}`);
    assert.ok(
      lookFitsHouse(combo(ff), "fiveFourFive", "weekend", FIX),
      `545 pick ${ff.join(",")} print=${JSON.stringify(lookPrint(combo(ff), "weekend"))} kill=${houseKill(combo(ff), "fiveFourFive", "weekend")}`,
    );
    assert.ok(!isPoloDefaultSilhouette(lookPrint(combo(faloni), "weekend")));
  });

  it("Sweet Stable weekday = 0 looks", () => {
    const ids = pick("sweetStable", "weekday");
    const pieces = combo(ids);
    assert.equal(houseFingerprintOk(pieces, "sweetStable", "weekday"), false);
    assert.equal(lookFitsHouse(combo(["fair", "cord", "boot"]), "sweetStable", "weekday", FIX), false);
    assert.equal(lookFitsHouse(combo(["fair", "cord", "boot"]), "sweetStable", "weekend", FIX), true);
  });

  it("Non-Polo never emits OCBD+khaki+penny", () => {
    for (const house of ["ald", "faloni", "fiveFourFive", "purple", "rrl", "italianSummer"] as House[]) {
      const ids = pick(house, "weekday");
      if (ids.length < 3) continue;
      const print = lookPrint(combo(ids), "weekday");
      assert.equal(isPoloDefaultSilhouette(print), false, house);
      assert.ok(!(print.top_type === "oxford" && print.shoe_family === "penny_loafer" && (print.bottom_type === "chino" || print.bottom_type === "khaki")), house);
    }
  });

  it("545 weekday note is thin-on-Weekday, not the only content", () => {
    assert.equal(
      houseGapNote("fiveFourFive", FIX, "weekday"),
      "545 is thin on Weekday — closest plates",
    );
    assert.equal(
      houseGapNote("sweetStable", FIX, "weekday"),
      "Sweet Stable is a Weekend house.",
    );
  });

  it("Outfit with this on cream cable includes that id", () => {
    const look = dressThisPiece({
      lockedIds: ["cable"],
      garments: FIX,
      occasion: "weekday",
      house: "polo",
    });
    assert.ok(look);
    assert.ok(look!.garmentIds.includes("cable"));
  });
});

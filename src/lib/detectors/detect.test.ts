import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { garmentTrips, hardBlock, rankWays } from "./detect.ts";
import type { Garment } from "../types.ts";

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

describe("detect", () => {
  it("a Rhude and AMI closet never gets flannel and cashmere", () => {
    const rack = [
      g({ id: "tee", name: "graphic tee", category: "top", subtype: "tee", brand: "Rhude" }),
      g({ id: "crew", name: "heavyweight crew", category: "top", subtype: "crew", brand: "AMI Paris" }),
      g({ id: "jean", name: "straight jean", category: "bottom", subtype: "jean", brand: "AMI" }),
      g({ id: "shoe", name: "leather sneaker", category: "footwear", subtype: "sneaker", brand: "AMI" }),
    ];
    const ways = rankWays(rack, { season: "fall" });
    assert.equal(ways.some((way) => way.id === "flannel_cashmere"), false);
    assert.ok(ways.length > 0 && ways.length <= 4);
    for (const way of ways) assert.equal(/\b(Polo|Purple|RRL|ALD|Faloni|545)\b/.test(way.title), false);
  });

  it("linen and a loafer never get the shrunken suit", () => {
    const rack = [
      g({ id: "shirt", name: "linen camp collar", category: "top", subtype: "camp shirt", material: "linen" }),
      g({ id: "bottom", name: "linen gurkha", category: "bottom", subtype: "gurkha", material: "linen" }),
      g({ id: "shoe", name: "suede loafer", category: "footwear", subtype: "loafer", material: "suede" }),
    ];
    const ways = rankWays(rack, { season: "summer" });
    assert.equal(ways.some((way) => way.id === "shrunken_suit"), false);
    assert.ok(ways.some((way) => way.id === "linen_soft"));
  });

  it("a cropped trouser with a chunky sneaker is blocked", () => {
    const pieces = [
      g({ id: "j", name: "short jacket", category: "outerwear", subtype: "jacket" }),
      g({ id: "t", name: "cropped trouser", category: "bottom", subtype: "trouser" }),
      g({ id: "s", name: "chunky sneaker", category: "footwear", subtype: "sneaker" }),
    ];
    assert.match(hardBlock(pieces) ?? "", /chunky sneaker/);
    const ways = rankWays(pieces, { season: "fall" });
    assert.equal(ways.some((way) => way.id === "shrunken_suit"), false);
  });

  it("Porto Richezze and a gurkha trip linen", () => {
    const porto = g({
      id: "p",
      name: "soft shirt",
      category: "top",
      subtype: "shirt",
      brand: "Porto Richezze",
      material: "cotton",
    });
    const gurkha = g({ id: "g", name: "stone gurkha", category: "bottom", subtype: "gurkha" });
    assert.equal(garmentTrips(porto, "linen_soft"), true);
    assert.equal(garmentTrips(gurkha, "linen_soft"), true);
    assert.equal(garmentTrips(porto, "shrunken_suit"), false);
  });

  it("Mr Porter trips nothing", () => {
    const shirt = g({ id: "m", name: "blue shirt", category: "top", subtype: "shirt", brand: "Mr Porter" });
    for (const id of [
      "western_work",
      "ivy_prep",
      "country_stable",
      "glossy_formal",
      "shrunken_suit",
      "fine_knit_loafer",
      "henley_denim",
      "linen_soft",
      "flannel_cashmere",
      "clean_city",
      "boxy_tonal",
      "print_plain",
      "graphic_street",
      "worn_paris",
      "soft_outdoor",
    ]) {
      assert.equal(garmentTrips(shirt, id), false, id);
    }
    assert.equal(garmentTrips({ ...shirt, brand: "Amiri" }, "clean_city"), false);
  });

  it("a closet with no complete outfit returns Your usual", () => {
    const scarf = g({ id: "s", name: "wool scarf", category: "accessory", subtype: "scarf" });
    const ways = rankWays([scarf], { season: "winter" });
    assert.ok(ways.length > 0);
    assert.equal(ways[0]?.title, "Your usual");
  });
});

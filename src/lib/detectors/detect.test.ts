import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { garmentTrips, hardBlock, phraseHits, rankWays } from "./detect.ts";
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
  it("a plural trips the word, and a longer word does not", () => {
    assert.equal(phraseHits("brown loafers", "loafer"), true);
    assert.equal(phraseHits("brown boots", "boot"), true);
    assert.equal(phraseHits("suede loafers", "suede loafer"), true);
    assert.equal(phraseHits("Amiri", "AMI"), false);
    assert.equal(phraseHits("polonaise", "polo"), false);
    assert.equal(phraseHits("polo shirt", "polo"), true);
    const loafers = g({ id: "lf", name: "brown loafers", category: "footwear", subtype: "shoe" });
    const boots = g({ id: "bt", name: "brown boots", category: "footwear", subtype: "shoe" });
    assert.equal(garmentTrips(loafers, "henley_denim"), true);
    assert.equal(garmentTrips(loafers, "clean_city"), true);
    assert.equal(garmentTrips(boots, "country_stable"), true);
    assert.equal(garmentTrips(g({ id: "am", name: "white tee", category: "top", subtype: "tee", brand: "Amiri" }), "clean_city"), false);
  });

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
    const ways = rankWays(rack, { season: "summer", occasion: "weekend" });
    assert.equal(ways.some((way) => way.id === "shrunken_suit"), false);
    assert.equal(ways.some((way) => way.id === "linen_soft"), false);
    assert.equal(ways[0]?.usual, true);
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
    assert.match(ways[0]?.reasons[0] ?? "", /top, a bottom, and a shoe/);
    assert.equal((ways[0]?.reasons[0] ?? "").includes("68"), false);
  });

  it("your usual uses a jacket he owns instead of the first six tops", () => {
    const tops = [0, 1, 2, 3, 4, 5].map((i) =>
      g({ id: `t${i}`, name: `hoodie ${i}`, category: "top", subtype: "hoodie" }),
    );
    const oxford = g({ id: "ox", name: "navy oxford", category: "top", subtype: "oxford" });
    const chino = g({ id: "ch", name: "tan chinos", category: "bottom", subtype: "chino" });
    const loafer = g({ id: "lf", name: "brown loafers", category: "footwear", subtype: "loafer" });
    const jacket = g({ id: "jk", name: "camel blazer", category: "outerwear", subtype: "blazer", colors: ["camel"] });
    const ways = rankWays([...tops, oxford, chino, loafer, jacket], { season: "fall", occasion: "weekday" });
    const usual = ways.find((way) => way.usual) ?? ways[0];
    assert.ok(usual);
    const dressed = usual!.outfits.some((outfit) => outfit.pieces.some((piece) => piece.id === "jk"));
    assert.equal(dressed, true);
    assert.equal(JSON.stringify(usual).includes("68"), false);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HOUSE_CHIPS, HOUSE_LABEL } from "./houses.ts";
import { lookOpinion } from "./look-opinion.ts";
import { emptyTaste } from "./taste.ts";
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

const oxford = g({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford" });
const chino = g({ id: "ch", name: "Khaki chinos", category: "bottom", subtype: "chino", colors: ["khaki"] });
const loafer = g({
  id: "lf",
  name: "brown penny loafer",
  category: "footwear",
  subtype: "loafer",
  material: "leather",
  colors: ["brown"],
});
const hoodie = g({ id: "hd", name: "navy hoodie", category: "top", subtype: "hoodie", formality: 1 });
const sneaker = g({
  id: "sn",
  name: "white sneaker",
  category: "footwear",
  subtype: "sneaker",
  colors: ["white"],
  formality: 1,
});

describe("look opinion", () => {
  it("two Polo plates say this matches Polo, not the chip he had selected", () => {
    const opinion = lookOpinion([oxford, chino], [oxford, chino, loafer], {
      occasion: "weekday",
      season: "fall",
      house: "purple",
    });
    assert.equal(opinion?.headline, "This matches. Polo.");
    assert.equal(opinion?.house, "polo");
  });

  it("hoodie and loafer do not match, and the better shoe is one he owns", () => {
    const pool = [hoodie, loafer, sneaker];
    const opinion = lookOpinion([hoodie, loafer], pool, { occasion: "weekday", season: "fall" });
    assert.equal(opinion?.headline, "This doesn't match.");
    assert.match(opinion?.reason ?? "", /Hoodie with loafers/);
    assert.match(opinion?.reason ?? "", /ALD/);
    const shoe = opinion?.swaps.find((swap) => swap.slot === "footwear");
    assert.ok(shoe);
    assert.equal(shoe?.id, sneaker.id);
    assert.equal(pool.some((piece) => piece.id === shoe?.id), true);
    assert.match(shoe?.line ?? "", /^Better: white sneaker, not the brown penny loafer\./);
    for (const swap of opinion?.swaps ?? []) {
      assert.equal(pool.some((piece) => piece.id === swap.id), true);
    }
  });

  it("says nothing else in the closet fixes it when he owns no better plate", () => {
    const opinion = lookOpinion([hoodie, loafer], [hoodie, loafer], {
      occasion: "weekday",
      season: "fall",
    });
    assert.equal(opinion?.headline, "This doesn't match.");
    assert.equal(opinion?.swaps.length, 0);
    assert.equal(opinion?.stuck, "Nothing else in the closet fixes this.");
    assert.equal(/shop|buy|sale/i.test(`${opinion?.reason} ${opinion?.stuck}`), false);
  });

  it("a veto is a clash even when the house would allow the plates", () => {
    const taste = emptyTaste();
    taste.vetoes.push({ kind: "piece", id: oxford.id });
    const opinion = lookOpinion([oxford, chino], [oxford, chino], {
      occasion: "weekday",
      season: "fall",
      house: "polo",
      taste,
    });
    assert.equal(opinion?.headline, "This doesn't match.");
    assert.equal(opinion?.reason, "You skipped this.");
  });

  it("Purple Label is the label, never Purple alone", () => {
    assert.equal(HOUSE_LABEL.purple, "Purple Label");
    assert.equal(HOUSE_LABEL.polo, "Polo");
    assert.deepEqual(
      HOUSE_CHIPS.map((chip) => chip.label),
      [
        "Polo",
        "Purple Label",
        "RRL",
        "ALD",
        "Faloni",
        "545",
        "Sweet Stable",
        "Italian summer",
        "Italian winter",
      ],
    );
    assert.equal(
      HOUSE_CHIPS.some((chip) => chip.label === "Purple" || chip.label === "ItalianSummer" || chip.label === "SweetStable"),
      false,
    );
  });
});

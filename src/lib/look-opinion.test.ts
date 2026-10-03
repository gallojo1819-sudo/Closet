import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lookOpinion, suggestLine } from "./look-opinion.ts";
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
  it("oxford and chino match in clothes, not a house name", () => {
    const opinion = lookOpinion([oxford, chino], [oxford, chino, loafer], {
      occasion: "weekday",
      season: "fall",
      house: "purple",
    });
    assert.equal(opinion?.headline, "This matches.");
    assert.equal(opinion?.reason, "Oxford, chino, navy blazer");
    assert.equal(opinion?.house, null);
    assert.equal(opinion?.swaps.length, 0);
    assert.equal(/\b(Polo|Purple|RRL|ALD)\b/.test(`${opinion?.headline} ${opinion?.reason}`), false);
  });

  it("names his pieces and the clash", () => {
    const polo = g({ id: "pk", name: "pink polo", category: "top", subtype: "polo", colors: ["pink"] });
    const white = g({
      id: "ws",
      name: "white sneaker",
      category: "footwear",
      subtype: "sneaker",
      colors: ["white"],
    });
    const opinion = lookOpinion([polo, white], [polo, white]);
    assert.equal(opinion?.headline, "This doesn't match.");
    assert.match(opinion?.reason ?? "", /pink polo/);
    assert.match(opinion?.reason ?? "", /white sneaker/);
    assert.match(opinion?.reason ?? "", /A pink polo with a white sneaker\./);
    assert.equal(opinion?.swaps.length, 0);
  });

  it("offers one piece he already owns", () => {
    const tee = g({ id: "tee", name: "graphic tee", category: "top", subtype: "tee" });
    const retro = g({
      id: "retro",
      name: "retro sneaker",
      category: "footwear",
      subtype: "sneaker",
    });
    const pool = [tee, loafer, retro];
    const opinion = lookOpinion([tee, loafer], pool);
    assert.equal(opinion?.headline, "This doesn't match.");
    assert.match(opinion?.reason ?? "", /graphic tee/);
    assert.match(opinion?.reason ?? "", /brown penny loafer/);
    assert.equal(opinion?.swaps.length, 1);
    assert.equal(opinion?.swaps[0]?.id, retro.id);
    assert.equal(opinion?.swaps[0]?.line, "Better: retro sneaker, not the brown penny loafer.");
    assert.equal(suggestLine(opinion!, pool), "Better: retro sneaker");
    assert.equal(suggestLine({ ...opinion!, swaps: [{ id: "missing", slot: "footwear", line: "Better: invented loafer" }] }, pool).includes("invented"), false);
    assert.equal(pool.some((piece) => piece.id === opinion?.swaps[0]?.id), true);
  });

  it("stops when nothing he owns finishes the way", () => {
    const opinion = lookOpinion([hoodie, loafer], [hoodie, loafer, sneaker], {
      occasion: "weekday",
      season: "fall",
    });
    assert.equal(opinion?.headline, "This doesn't match.");
    assert.match(opinion?.reason ?? "", /navy hoodie/);
    assert.match(opinion?.reason ?? "", /brown penny loafer/);
    assert.equal(opinion?.swaps.length, 0);
    assert.equal(opinion?.stuck, "The pair doesn't work.");
    assert.equal(suggestLine(opinion!, [hoodie, loafer, sneaker]), "This doesn't match: navy hoodie, brown penny loafer. The pair doesn't work.");
    assert.equal(/shop|buy|sale/i.test(`${opinion?.reason} ${opinion?.stuck}`), false);
  });

  it("a veto names the pieces and says he skipped them", () => {
    const taste = emptyTaste();
    taste.vetoes.push({ kind: "piece", id: oxford.id });
    const opinion = lookOpinion([oxford, chino], [oxford, chino], {
      occasion: "weekday",
      season: "fall",
      house: "polo",
      taste,
    });
    assert.equal(opinion?.headline, "This doesn't match.");
    assert.equal(opinion?.reason, "Navy oxford, Khaki chinos. You skipped this.");
  });

  it("the builder is labeled Suggest and paints a slot edge", () => {
    const src = readFileSync(new URL("../components/closet/look-builder.tsx", import.meta.url), "utf8");
    const today = readFileSync(new URL("../routes/index.tsx", import.meta.url), "utf8");
    assert.match(src, /heading = "Suggest"/);
    assert.equal(src.includes("Make a look"), false);
    assert.match(src, /suggestLine\(shown, pool\)/);
    assert.match(src, /border-green-800/);
    assert.match(src, /border-red-800/);
    assert.match(src, /slot-crossfade/);
    assert.match(src, /draggable/);
    assert.match(src, /onDrop/);
    assert.equal(src.includes("parallax"), false);
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    assert.match(css, /@keyframes slot-crossfade/);
    const reduce = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    assert.match(reduce, /\.slot-crossfade\s*\{[^}]*animation:\s*none/);
    assert.equal(today.includes("Make a look"), false);
  });
});

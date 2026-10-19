import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FAILS_PREFIX, PASSES_LINE, lookOpinion, suggestLine } from "./look-opinion.ts";
import { RULE_SENTENCES } from "./stylist/rule-copy.ts";
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

const oxford = g({ id: "ox", name: "White oxford", category: "top", subtype: "oxford", colors: ["white"] });
const chino = g({ id: "ch", name: "Khaki chinos", category: "bottom", subtype: "chino", colors: ["khaki"] });
const loafer = g({
  id: "lf",
  name: "brown penny loafer",
  category: "footwear",
  subtype: "loafer",
  material: "leather",
  colors: ["brown"],
});
const blazer = g({
  id: "bz",
  name: "Navy blazer",
  category: "outerwear",
  subtype: "blazer",
  colors: ["navy"],
  material: "wool",
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

/* The verdict is the rules' pass or fail in plain words (probability round): no "matches", no score, no house. */
describe("look opinion", () => {
  it("a finished oxford look passes the rules, with no house name", () => {
    const opinion = lookOpinion([oxford, chino, loafer, blazer], [oxford, chino, loafer, blazer], {
      occasion: "weekday",
      season: "fall",
      house: "purple",
    });
    assert.equal(opinion?.headline, PASSES_LINE);
    assert.equal(opinion?.reason, PASSES_LINE);
    assert.deepEqual(opinion?.failed, []);
    assert.equal(opinion?.house, null);
    assert.equal(opinion?.swaps.length, 0);
    assert.equal(/\b(Polo|Purple|RRL|ALD)\b/.test(`${opinion?.headline} ${opinion?.reason}`), false);
    assert.equal(suggestLine(opinion!, [oxford, chino, loafer, blazer]), PASSES_LINE);
  });

  it("names the failing rule, never a rule id", () => {
    const polo = g({ id: "pk", name: "pink polo", category: "top", subtype: "polo", colors: ["pink"] });
    const white = g({
      id: "ws",
      name: "white sneaker",
      category: "footwear",
      subtype: "sneaker",
      colors: ["white"],
    });
    const opinion = lookOpinion([polo, white], [polo, white]);
    assert.ok(opinion?.headline.startsWith(FAILS_PREFIX), opinion?.headline);
    assert.ok(opinion?.failed.includes("SLOTS"), opinion?.failed.join(","));
    assert.equal(opinion?.headline, `${FAILS_PREFIX}${RULE_SENTENCES.SLOTS}`);
    assert.ok(opinion?.reason.includes(RULE_SENTENCES.SLOTS!));
    assert.equal(/\b[A-Z]{2,4}-[A-Z0-9-]+\b/.test(`${opinion?.headline} ${opinion?.reason}`), false, "a rule id reached the copy");
    assert.equal(opinion?.swaps.length, 0);
  });

  it("offers one piece he already owns when that swap passes", () => {
    const retro = g({
      id: "retro",
      name: "retro sneaker",
      category: "footwear",
      subtype: "sneaker",
      colors: ["white"],
      formality: 1,
    });
    const pool = [oxford, chino, loafer, retro, blazer];
    const opinion = lookOpinion([oxford, chino, retro, blazer], pool, {
      occasion: "weekday",
      season: "fall",
    });
    assert.ok(opinion?.headline.startsWith(FAILS_PREFIX), opinion?.headline);
    assert.ok(opinion!.failed.length >= 1);
    for (const id of opinion!.failed) assert.ok(RULE_SENTENCES[id], `no sentence for ${id}`);
    assert.equal(opinion?.swaps.length, 1);
    assert.equal(opinion?.swaps[0]?.id, loafer.id);
    assert.equal(opinion?.swaps[0]?.line, "Better: brown penny loafer, not the retro sneaker.");
    assert.equal(suggestLine(opinion!, pool), `${opinion!.headline} Better: brown penny loafer`);
    assert.equal(suggestLine({ ...opinion!, swaps: [{ id: "missing", slot: "footwear", line: "Better: invented loafer" }] }, pool).includes("invented"), false);
    assert.equal(pool.some((piece) => piece.id === opinion?.swaps[0]?.id), true);
  });

  it("the pink linen shirt does not pass in October", () => {
    const linen = g({
      id: "pl",
      name: "Pink linen shirt",
      category: "top",
      subtype: "shirt",
      material: "linen",
      colors: ["pink"],
    });
    const flannel = g({
      id: "fl",
      name: "Grey flannel trousers",
      category: "bottom",
      subtype: "trouser",
      material: "flannel",
      colors: ["grey"],
    });
    const opinion = lookOpinion([linen, flannel, loafer], [linen, flannel, loafer], {
      occasion: "weekend",
      season: "fall",
    });
    assert.notEqual(opinion?.headline, PASSES_LINE);
    /* Linen and flannel never share a look: a hard rule, named. */
    assert.ok(opinion?.failed.includes("CLASH"), opinion?.failed.join(","));
    const bare = lookOpinion([linen, loafer], [linen, loafer, chino], {
      occasion: "weekend",
      season: "fall",
    });
    assert.notEqual(bare?.headline, PASSES_LINE);
  });

  it("stops when nothing he owns swaps in to pass", () => {
    const opinion = lookOpinion([hoodie, loafer], [hoodie, loafer, sneaker], {
      occasion: "weekday",
      season: "fall",
    });
    assert.ok(opinion?.headline.startsWith(FAILS_PREFIX));
    assert.equal(opinion?.swaps.length, 0);
    assert.equal(opinion?.stuck, "Nothing you own swaps in to pass.");
    assert.equal(suggestLine(opinion!, [hoodie, loafer, sneaker]), opinion!.headline);
    assert.equal(/shop|buy|sale/i.test(`${opinion?.reason} ${opinion?.stuck}`), false);
  });

  it("a veto is a rule the user wrote, and it reads as one", () => {
    const taste = emptyTaste();
    taste.vetoes.push({ kind: "piece", id: oxford.id });
    const opinion = lookOpinion([oxford, chino, loafer, blazer], [oxford, chino, loafer, blazer], {
      occasion: "weekday",
      season: "fall",
      house: "polo",
      taste,
    });
    assert.ok(opinion?.headline.startsWith(FAILS_PREFIX));
    assert.deepEqual(opinion?.failed, ["VETO-PIECE"]);
    assert.equal(opinion?.headline, `${FAILS_PREFIX}${RULE_SENTENCES["VETO-PIECE"]}`);
  });

  it("the builder is labeled Suggest, says Passes the rules, and paints a slot edge", () => {
    const src = readFileSync(new URL("../components/closet/look-builder.tsx", import.meta.url), "utf8");
    const today = readFileSync(new URL("../routes/index.tsx", import.meta.url), "utf8");
    assert.match(src, /heading = "Suggest"/);
    assert.equal(src.includes("Make a look"), false);
    assert.match(src, /suggestLine\(shown, pool\)/);
    assert.match(src, /PASSES_LINE/);
    assert.equal(src.includes("This matches."), false);
    assert.equal(src.includes("This doesn't match."), false);
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

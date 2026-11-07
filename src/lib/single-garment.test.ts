import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkSingleGarment,
  colorsFromPlateTag,
  cutoutCheckOf,
  paperStudioOnly,
  parseSingleGarment,
  singleGarmentNoun,
  singleGarmentQuestion,
} from "./single-garment.ts";

const NOW = () => "2026-10-16T12:00:00.000Z";
const PLATE = { image: "data:image/jpeg;base64,plate", noun: "sweater" };

describe("the single-garment question", () => {
  it("names the piece, allows app paper, and still rejects a second garment, a person, or a room", () => {
    const q = singleGarmentQuestion("sweater");
    assert.match(q, /^Does this image show exactly one sweater\?/);
    assert.match(q, /uniform neutral studio background/);
    assert.match(q, /transparent background/);
    assert.match(q, /#F4EFE6/);
    assert.match(q, /plain beige, off-white, neutral, transparent, or #F4EFE6 paper background alone is not a reason for no/);
    assert.match(q, /a second garment/);
    assert.match(q, /a person, skin, hair, a hand, a hanger, a room, or scenery/);
    assert.match(q, /"one":"yes\|no\|unclear"/);
    assert.doesNotMatch(q, /no part of any other garment, body or background/);
    assert.equal(singleGarmentQuestion("  ").startsWith("Does this image show exactly one garment?"), true);
  });

  it("the noun is the subtype, else the category, else garment", () => {
    assert.equal(singleGarmentNoun({ subtype: "Cable-knit sweater", category: "top" }), "cable-knit sweater");
    assert.equal(singleGarmentNoun({ subtype: "", category: "outerwear" }), "outerwear");
    assert.equal(singleGarmentNoun({ subtype: "", category: "footwear" }), "pair of shoes");
    assert.equal(singleGarmentNoun({ subtype: "", category: "bottom" }), "pair of trousers");
    assert.equal(singleGarmentNoun({ subtype: "", category: "other" }), "garment");
    assert.equal(singleGarmentNoun({}), "garment");
  });
});

describe("parsing the answer", () => {
  it("reads yes, no and unclear, and keeps why only when not yes", () => {
    assert.deepEqual(parseSingleGarment('{"one":"yes","why":"fine"}'), { one: "yes", why: "" });
    assert.deepEqual(parseSingleGarment('Sure. {"one":"no","why":"jacket sleeve at the left"}'), {
      one: "no",
      why: "jacket sleeve at the left",
    });
    assert.deepEqual(parseSingleGarment('{"one":"unclear","why":""}'), { one: "unclear", why: "" });
    assert.deepEqual(parseSingleGarment('{"one":"no","why":"plain beige background visible"}'), {
      one: "yes",
      why: "",
    });
    assert.deepEqual(parseSingleGarment('{"one":true}'), { one: "yes", why: "" });
    assert.deepEqual(parseSingleGarment('{"one":"maybe"}'), { one: "unclear", why: "" });
  });

  it("no JSON, no one, or broken JSON is unclear", () => {
    assert.equal(parseSingleGarment("yes").one, "unclear");
    assert.equal(parseSingleGarment('{"clean":true}').one, "unclear");
    assert.equal(parseSingleGarment('{"one":').one, "unclear");
  });
});

describe("checkSingleGarment", () => {
  it("carries the asker's verdict and the time it ran", async () => {
    const yes = await checkSingleGarment(PLATE, async () => ({ one: "yes", why: "" }), { now: NOW });
    assert.deepEqual(cutoutCheckOf(yes), { one: "yes", why: "", at: NOW() });
    const no = await checkSingleGarment(PLATE, async () => ({ one: "no", why: "two garments" }), { now: NOW });
    assert.deepEqual(cutoutCheckOf(no), { one: "no", why: "two garments", at: NOW() });
  });

  it("asks with the picture and the noun", async () => {
    const seen: { image: string; noun: string }[] = [];
    await checkSingleGarment(
      PLATE,
      async (input) => {
        seen.push(input);
        return { one: "yes" };
      },
      { now: NOW },
    );
    assert.deepEqual(seen, [PLATE]);
  });

  it("a null answer, a thrown ask, a slow ask or no image is unclear", async () => {
    const nothing = await checkSingleGarment(PLATE, async () => null, { now: NOW });
    assert.equal(nothing.one, "unclear");
    const thrown = await checkSingleGarment(
      PLATE,
      async () => {
        throw new Error("network");
      },
      { now: NOW },
    );
    assert.equal(thrown.one, "unclear");
    const slow = await checkSingleGarment(
      PLATE,
      () => new Promise((resolve) => setTimeout(() => resolve({ one: "yes" }), 200)),
      { now: NOW, timeoutMs: 20 },
    );
    assert.equal(slow.one, "unclear");
    let asked = 0;
    const empty = await checkSingleGarment(
      { image: "  ", noun: "sweater" },
      async () => {
        asked += 1;
        return { one: "yes" };
      },
      { now: NOW },
    );
    assert.equal(empty.one, "unclear");
    assert.equal(empty.why, "no image");
    assert.equal(asked, 0);
  });
});

describe("a paper studio background", () => {
  it("accepts beige, app paper, neutral, and transparent, and nothing else", () => {
    for (const why of [
      "plain beige background visible",
      "uniform neutral studio background",
      "transparent background",
      "app paper #F4EFE6",
      "off-white paper",
    ]) {
      assert.equal(paperStudioOnly(why), true, why);
    }
    for (const why of [
      "",
      "background visible",
      "a second garment at the hem",
      "a person is visible",
      "a room behind the piece",
      "scenery outside",
      "a hand holding it",
      "a hanger",
      "jacket sleeve at the left",
      "person on beige paper",
      "beige room",
    ]) {
      assert.equal(paperStudioOnly(why), false, why);
    }
  });

  it("one sweater on beige paper is yes; a second garment, a person, or a room stays no", async () => {
    const beige = await checkSingleGarment(
      PLATE,
      async () => ({ one: "no", why: "plain beige background visible" }),
      { now: NOW },
    );
    assert.deepEqual(cutoutCheckOf(beige), { one: "yes", why: "", at: NOW() });
    for (const why of ["#F4EFE6 paper", "transparent background", "neutral studio"]) {
      const paper = await checkSingleGarment(PLATE, async () => ({ one: "no", why }), { now: NOW });
      assert.equal(paper.one, "yes", why);
    }
    for (const why of ["a second garment", "a person is visible", "a room behind the piece"]) {
      const bad = await checkSingleGarment(PLATE, async () => ({ one: "no", why }), { now: NOW });
      assert.equal(bad.one, "no", why);
      assert.equal(bad.why, why, why);
    }
    const vague = await checkSingleGarment(
      PLATE,
      async () => ({ one: "no", why: "background visible" }),
      { now: NOW },
    );
    assert.equal(vague.one, "no");
    const unclear = await checkSingleGarment(
      PLATE,
      async () => ({ one: "unclear", why: "plain beige background visible" }),
      { now: NOW },
    );
    assert.equal(unclear.one, "unclear");
  });
});

describe("colours read off a clean plate", () => {
  it("keeps the tag's palette words, lowercased, deduped, at most four", () => {
    assert.deepEqual(
      colorsFromPlateTag({ ok: true, colors: ["Cream", "cream", " ivory ", "tan", "brown", "navy"] }),
      ["cream", "ivory", "tan", "brown"],
    );
  });

  it("a failed tag, a person, more than one piece or no colour writes nothing", () => {
    assert.deepEqual(colorsFromPlateTag({ ok: false }), []);
    assert.deepEqual(colorsFromPlateTag(null), []);
    assert.deepEqual(colorsFromPlateTag({ ok: true, colors: ["cream"], person: true }), []);
    assert.deepEqual(colorsFromPlateTag({ ok: true, colors: ["cream"], count: 2 }), []);
    assert.deepEqual(colorsFromPlateTag({ ok: true, colors: [] }), []);
    assert.deepEqual(colorsFromPlateTag({ ok: true, colors: [3, null] }), []);
  });
});

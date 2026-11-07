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
  it("names the piece, expects plain paper, and rejects a room, a body, or a second item", () => {
    const q = singleGarmentQuestion("sweater");
    assert.match(q, /^Does this image show exactly one sweater\?/);
    assert.match(
      q,
      /A plain, uniform paper, studio, or transparent background \(like #F4EFE6\) is expected and is never a reason for no/,
    );
    assert.match(
      q,
      /one is no only for a room, furniture, scenery, a person or any body part, a hanger, or a second garment or item/,
    );
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

/** Reasons a "no" may be treated as paper. A ground noun, described by a colour or finish. */
const PAPER_REASONS = [
  "plain beige background visible",
  "plain paper background",
  "uniform off-white studio background",
  "uniform neutral studio background",
  "off-white paper",
  "light beige paper background",
] as const;

/** Studio gear and a bare colour. None of these names a described ground noun. */
const STUDIO_GEAR_REASONS = [
  "a studio light is visible",
  "studio lamp visible",
  "light visible",
  "studio visible",
  "white visible",
] as const;

/**
 * The 48 adversarial reasons from the prod audit. Each must stay a "no".
 * A beige or paper word in the same sentence does not make it a clean plate.
 */
const ADVERSARIAL_REASONS = [
  "busy background",
  "background visible",
  "second garment on beige background",
  "another shirt on beige paper",
  "person on beige paper",
  "beige room",
  "hand on beige paper",
  "arm visible on beige paper",
  "arms on beige background",
  "fingers on beige paper",
  "leg visible, beige background",
  "jeans visible on beige paper",
  "pants on beige background",
  "shirt underneath, beige background",
  "t-shirt under it on beige paper",
  "jacket on beige background",
  "coat over it, neutral background",
  "scarf on beige paper",
  "belt on beige background",
  "shoes on beige paper",
  "shorts, beige paper",
  "tie on beige paper",
  "bag on beige paper",
  "other garment on beige paper",
  "multiple items on beige paper",
  "three pieces on beige paper",
  "more than one piece on beige",
  "both pieces on neutral background",
  "beige bedroom",
  "beige carpet",
  "beige sofa",
  "bed sheet, beige",
  "beige couch behind",
  "studio apartment",
  "plant on beige studio backdrop",
  "door frame, beige",
  "non-neutral background",
  "not a neutral background",
  "patterned paper background",
  "colored background, not beige",
  "beige and red patterned background",
  "dark background, not paper",
  "torso on beige paper",
  "neck visible, beige paper",
  "mirror reflection, beige",
  "text label on beige paper",
  "logo watermark on paper",
  "shadow of person on beige paper",
] as const;

describe("a paper studio background", () => {
  it("accepts only a plain paper reason, and a vague or extra word stays rejected", () => {
    for (const why of PAPER_REASONS) assert.equal(paperStudioOnly(why), true, why);
    for (const why of ["", "background visible", "transparent background", "app paper #F4EFE6", "#F4EFE6 paper"]) {
      assert.equal(paperStudioOnly(why), false, why);
    }
  });

  it("a described paper ground comes back clean", async () => {
    for (const why of [
      "plain beige background visible",
      "plain paper background",
      "uniform off-white studio background",
      "light beige paper background",
    ] as const) {
      assert.equal(paperStudioOnly(why), true, why);
      const check = await checkSingleGarment(PLATE, async () => ({ one: "no", why }), { now: NOW });
      assert.equal(check.one, "yes", why);
      assert.equal(check.why, "", why);
    }
    const unclear = await checkSingleGarment(
      PLATE,
      async () => ({ one: "unclear", why: "plain beige background visible" }),
      { now: NOW },
    );
    assert.equal(unclear.one, "unclear");
    assert.equal(unclear.why, "plain beige background visible");
  });

  it("a studio light or a bare colour stays rejected", async () => {
    for (const why of STUDIO_GEAR_REASONS) {
      assert.equal(paperStudioOnly(why), false, why);
      const check = await checkSingleGarment(PLATE, async () => ({ one: "no", why }), { now: NOW });
      assert.equal(check.one, "no", why);
      assert.equal(check.why, why, why);
    }
    assert.equal(paperStudioOnly("neutral studio"), false);
    assert.equal(paperStudioOnly("light grey paper background"), true);
  });

  it("all 48 adversarial reasons stay rejected", async () => {
    assert.equal(ADVERSARIAL_REASONS.length, 48);
    for (const why of ADVERSARIAL_REASONS) {
      assert.equal(paperStudioOnly(why), false, why);
      const check = await checkSingleGarment(PLATE, async () => ({ one: "no", why }), { now: NOW });
      assert.equal(check.one, "no", why);
      assert.equal(check.why, why, why);
      const parsed = parseSingleGarment(JSON.stringify({ one: "no", why }));
      assert.equal(parsed.one, "no", why);
      assert.equal(parsed.why, why, why);
    }
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

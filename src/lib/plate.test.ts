import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { borderIsCleanStudio } from "./matte.ts";
import {
  coverIsOriginal,
  coverStillPhoto,
  needsReprintTile,
  plateResultPatch,
  rawOuterwearCovers,
  REPRINT_CAPTION,
  runPlatePass,
} from "./plate.ts";

const photo = {
  id: "suede",
  name: "Brown suede jacket",
  category: "outerwear",
  imageSrc: "idb:suede:o",
  cutoutSrc: "idb:suede:c",
  imageSource: "photo",
};

describe("studio border", () => {
  it("a white seamless border is a studio ground", () => {
    assert.equal(borderIsCleanStudio({ r: 250, g: 250, b: 250 }, 0.01, 2, false), true);
  });

  it("a room, a page, or a cream wall is not", () => {
    assert.equal(borderIsCleanStudio({ r: 140, g: 110, b: 80 }, 0.3, 20, false), false);
    assert.equal(borderIsCleanStudio({ r: 250, g: 250, b: 250 }, 0.01, 1, true), false);
    assert.equal(borderIsCleanStudio({ r: 244, g: 239, b: 230 }, 0.02, 2, false), false);
  });
});

describe("raw outerwear covers", () => {
  it("includes a phone cover and skips a plate", () => {
    const blazer = {
      id: "blazer",
      name: "Navy blazer",
      category: "outerwear",
      imageSrc: "idb:blazer:o",
      cutoutSrc: "idb:blazer:c",
      imageSource: "official",
    };
    const toggle = {
      id: "toggle",
      name: "White beige toggle jacket",
      category: "outerwear",
      imageSrc: "sb:u/toggle/o.jpg",
      cutoutSrc: "sb:u/toggle/c.jpg",
      imageSource: "cutout",
    };
    const field = {
      id: "field",
      name: "Navy field jacket",
      category: "outerwear",
      imageSrc: "idb:field:o",
      cutoutSrc: "idb:field:o",
      imageSource: "photo",
    };
    const jeans = {
      id: "jeans",
      name: "Light blue jeans",
      category: "bottom",
      imageSrc: "idb:jeans:o",
      cutoutSrc: "idb:jeans:o",
      imageSource: "photo",
    };
    const chosen = {
      ...photo,
      id: "chosen",
      reprint: false as const,
    };
    const picked = rawOuterwearCovers([photo, blazer, toggle, field, jeans, chosen]);
    assert.deepEqual(picked.map((g) => g.id), ["suede", "field"]);
    assert.equal(coverIsOriginal(blazer), false);
    assert.equal(coverIsOriginal(toggle), false);
    assert.equal(needsReprintTile(photo), true);
    assert.equal(needsReprintTile(blazer), false);
    assert.equal(needsReprintTile(toggle), false);
    assert.equal(needsReprintTile({ ...jeans, reprint: true }), true);
    assert.equal(needsReprintTile(chosen), false);
    assert.equal(coverStillPhoto(chosen), false);
    assert.equal(coverIsOriginal(chosen), true);
  });
});

describe("plate patch", () => {
  it("writes the plate key and never imageSrc", () => {
    const ok = plateResultPatch(
      "idb:suede:o",
      { reprint: false, cutoutSrc: "data:image/jpeg;base64,plate" },
      "idb:suede:c",
    );
    assert.equal("imageSrc" in ok, false);
    assert.equal(ok.cutoutSrc, "idb:suede:c");
    assert.equal(ok.imageSource, "cutout");
    assert.equal(ok.reprint, false);
    const refused = plateResultPatch(
      "idb:suede:o",
      { reprint: true, cutoutSrc: "idb:suede:o" },
      "idb:suede:c",
    );
    assert.equal(refused.cutoutSrc, "idb:suede:o");
    assert.equal(refused.reprint, true);
    assert.notEqual(refused.cutoutSrc, "idb:suede:c");
    assert.equal(REPRINT_CAPTION, "Cover still has the hand — tap Reprint.");
  });
});

describe("plate pass", () => {
  it("runs two at a time and does not drop items", async () => {
    let active = 0;
    let max = 0;
    const seen: number[] = [];
    await runPlatePass(
      [1, 2, 3, 4],
      async (n) => {
        active += 1;
        max = Math.max(max, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        seen.push(n);
      },
      2,
    );
    assert.equal(max, 2);
    assert.deepEqual(seen.sort((a, b) => a - b), [1, 2, 3, 4]);
  });
});

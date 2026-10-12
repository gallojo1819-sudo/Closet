import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { colorsDisagree, colorsForName, looseColor, nameLeadColor, shownColors } from "./garment-color.ts";
import { preferPixels } from "./color.ts";

describe("garment colour: the name wins over a sampled hue", () => {
  it("navy trousers tagged light blue show navy", () => {
    const g = { name: "Navy trousers", colors: ["light blue"] };
    assert.deepEqual(shownColors(g), ["navy", "light blue"]);
    assert.equal(colorsDisagree(g.name, g.colors), true);
  });

  it("a name that agrees, or names no colour, leaves the stored colours alone", () => {
    assert.deepEqual(colorsForName("Navy trousers", ["navy", "brown"]), ["navy", "brown"]);
    assert.deepEqual(colorsForName("Dark blue trousers", ["navy"]), ["navy"]);
    assert.deepEqual(colorsForName("Gurkha trousers", ["light blue"]), ["light blue"]);
    assert.deepEqual(colorsForName("Navy", ["light blue"]), ["light blue"]);
    assert.deepEqual(colorsForName("New piece", []), []);
    assert.equal(colorsDisagree("Cream knit", []), false);
  });

  it("leading colour words, one or two", () => {
    assert.equal(nameLeadColor("Light blue oxford"), "light blue");
    assert.equal(nameLeadColor("Dark blue jeans"), "navy");
    assert.equal(nameLeadColor("Blue oxford"), "navy");
    assert.equal(nameLeadColor("Cream knit"), "cream");
    assert.equal(nameLeadColor("Gurkha trousers"), null);
    assert.equal(nameLeadColor(""), null);
  });

  it("loose colour words map to the palette; unknowns stay null", () => {
    assert.equal(looseColor("blue"), "navy");
    assert.equal(looseColor("sky blue"), "light blue");
    assert.equal(looseColor("light grey"), "grey");
    assert.equal(looseColor("gray"), "grey");
    assert.equal(looseColor("off-white"), "ivory");
    assert.equal(looseColor("multicolor"), null);
  });

  it("a tag that says blue keeps the sample from flipping a navy piece to light blue", () => {
    // What retitleFakeNames hands preferPixels after the loose pass: "blue" became "navy".
    assert.deepEqual(preferPixels(["light blue"], ["navy"]), ["navy", "light blue"]);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cameraPieceCategory, wordsCategory } from "./camera-tag.ts";
import { derivedCategory } from "./garment-category.ts";

describe("garment category: knits are tops", () => {
  it("knit words filed under Other re-derive to top at read", () => {
    for (const name of ["Cream knit", "Grey merino sweater", "Navy cardigan", "Cream crewneck", "Olive knit polo", "Brown cable knit", "Cream jumper", "Navy half-zip pullover"]) {
      assert.equal(derivedCategory({ category: "other", name, subtype: "" }), "top", name);
    }
    assert.equal(derivedCategory({ category: "other", name: "New piece", subtype: "sweater" }), "top");
  });

  it("other words find their slot; nothing named stays other; a stored category stands", () => {
    assert.equal(derivedCategory({ category: "other", name: "Navy trousers", subtype: "" }), "bottom");
    assert.equal(derivedCategory({ category: "other", name: "Brown suede loafers", subtype: "" }), "footwear");
    assert.equal(derivedCategory({ category: "other", name: "Navy chore jacket", subtype: "" }), "outerwear");
    assert.equal(derivedCategory({ category: "other", name: "Grey hoodie", subtype: "" }), "top");
    assert.equal(derivedCategory({ category: "other", name: "New piece", subtype: "", notes: "camera" }), "other");
    assert.equal(derivedCategory({ category: "accessory", name: "Cream knit", subtype: "" }), "accessory");
    assert.equal(derivedCategory({ category: "bottom", name: "Cream knit", subtype: "" }), "bottom");
  });

  it("the tagger's category: knit words and knitwear synonyms map to top", () => {
    assert.equal(cameraPieceCategory("Cream knit", "", "other"), "top");
    assert.equal(cameraPieceCategory("Cream knit", "sweater", "knitwear"), "top");
    assert.equal(cameraPieceCategory("Grey crewneck", "", "sweater"), "top");
    assert.equal(cameraPieceCategory("Navy trousers", "", "trousers"), "bottom");
    assert.equal(cameraPieceCategory("Brown loafers", "", "shoes"), "footwear");
    assert.equal(cameraPieceCategory("Navy blazer", "", "top"), "outerwear");
    assert.equal(cameraPieceCategory("Grey hoodie", "", "outerwear"), "top");
    assert.equal(cameraPieceCategory("Something", "", "bottom"), "bottom");
    assert.equal(cameraPieceCategory("Something", "", "nonsense"), "other");
    assert.equal(wordsCategory("silk scarf"), "accessory");
  });
});

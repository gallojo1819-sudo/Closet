import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isCaptureNote, styleNotes } from "./garment-notes.ts";

describe("garment notes: capture markers are not a style", () => {
  it("the Add flow's source markers read as blank", () => {
    for (const marker of [
      "camera",
      "Camera",
      "held",
      "worn · Polo",
      "worn · Navy knit",
      "Official plate · ssense",
      "Kept your real pixels — same fabric, same color — on paper.",
      "Floated on paper. Soft edge — a plainer surface will be tighter.",
      "Floated on paper from this shot. A cream sheet and window light will cut cleaner.",
      "Already a catalog shot — centered on paper, pixels untouched.",
    ]) {
      assert.equal(isCaptureNote(marker), true, marker);
      assert.equal(styleNotes(marker), "", marker);
    }
  });

  it("a real description stays", () => {
    const text = "Gurkha. Extended waistband, side buckle, no belt.";
    assert.equal(isCaptureNote(text), false);
    assert.equal(styleNotes(text), text);
    assert.equal(styleNotes("Shot on camera, then tailored"), "Shot on camera, then tailored");
    assert.equal(styleNotes("  "), "");
    assert.equal(styleNotes(undefined), "");
  });
});

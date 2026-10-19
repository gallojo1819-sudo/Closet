import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FINDING_LOOKS, lookbookCountLine, pageResolved, screenLookCount, weekShowsEmptyReason, weekShowsSkeletons } from "./lookbook-status.ts";

describe("Lookbook loading state", () => {
  it("never says 0 looks before the row resolves", () => {
    assert.equal(lookbookCountLine({ resolved: false, count: 0, chapter: "Weekday", season: "Fall" }), FINDING_LOOKS);
    assert.equal(lookbookCountLine({ resolved: false, count: 2, chapter: "Weekday", season: "Fall" }), FINDING_LOOKS);
  });
  it("counts once resolved, including a true zero", () => {
    assert.equal(lookbookCountLine({ resolved: true, count: 8, chapter: "Weekday", season: "Fall" }), "8 looks · Weekday · Fall");
    assert.equal(lookbookCountLine({ resolved: true, count: 0, chapter: "Comfy", season: "Winter" }), "0 looks · Comfy · Winter");
  });
  it("counts the week cards that render plus the idea-row cards, not the week row alone", () => {
    const three = ["a", "b", "c"];
    const week = [three, three, ["a", "b"], three, [], three];
    const rows = Array.from({ length: 11 }, (_, i) => ({ id: `r${i}` }));
    assert.equal(screenLookCount(week, rows), 4 + 11);
    assert.equal(screenLookCount(week, []), 4);
    assert.equal(screenLookCount([], []), 0);
  });
  it("skeletons while unresolved and empty; the empty reason only after", () => {
    assert.equal(weekShowsSkeletons({ resolved: false, shown: 0 }), true);
    assert.equal(weekShowsSkeletons({ resolved: false, shown: 2 }), false);
    assert.equal(weekShowsSkeletons({ resolved: true, shown: 0 }), false);
    assert.equal(weekShowsEmptyReason({ resolved: false, shown: 0 }), false);
    assert.equal(weekShowsEmptyReason({ resolved: true, shown: 0 }), true);
  });
});

describe("Lookbook page resolution", () => {
  it("the page is resolved only when the week row and the idea rows are both in", () => {
    assert.equal(pageResolved({ week: false, ways: false }), false);
    assert.equal(pageResolved({ week: true, ways: false }), false);
    assert.equal(pageResolved({ week: false, ways: true }), false);
    assert.equal(pageResolved({ week: true, ways: true }), true);
  });
  it("the count line, the skeletons and the empty reason read the same resolution: no number, no reason, before both rows", () => {
    for (const rows of [{ week: true, ways: false }, { week: false, ways: true }]) {
      const resolved = pageResolved(rows);
      assert.equal(lookbookCountLine({ resolved, count: 8, chapter: "Weekday", season: "Fall" }), FINDING_LOOKS);
      assert.equal(weekShowsSkeletons({ resolved, shown: 0 }), true);
      assert.equal(weekShowsEmptyReason({ resolved, shown: 0 }), false);
    }
  });
});

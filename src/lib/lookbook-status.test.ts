import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FINDING_LOOKS, lookbookCountLine, weekShowsEmptyReason, weekShowsSkeletons } from "./lookbook-status.ts";

describe("Lookbook loading state", () => {
  it("never says 0 looks before the row resolves", () => {
    assert.equal(lookbookCountLine({ resolved: false, count: 0, chapter: "Weekday", season: "Fall" }), FINDING_LOOKS);
    assert.equal(lookbookCountLine({ resolved: false, count: 2, chapter: "Weekday", season: "Fall" }), FINDING_LOOKS);
  });
  it("counts once resolved, including a true zero", () => {
    assert.equal(lookbookCountLine({ resolved: true, count: 8, chapter: "Weekday", season: "Fall" }), "8 looks · Weekday · Fall");
    assert.equal(lookbookCountLine({ resolved: true, count: 0, chapter: "Comfy", season: "Winter" }), "0 looks · Comfy · Winter");
  });
  it("skeletons while unresolved and empty; the empty reason only after", () => {
    assert.equal(weekShowsSkeletons({ resolved: false, shown: 0 }), true);
    assert.equal(weekShowsSkeletons({ resolved: false, shown: 2 }), false);
    assert.equal(weekShowsSkeletons({ resolved: true, shown: 0 }), false);
    assert.equal(weekShowsEmptyReason({ resolved: false, shown: 0 }), false);
    assert.equal(weekShowsEmptyReason({ resolved: true, shown: 0 }), true);
  });
});

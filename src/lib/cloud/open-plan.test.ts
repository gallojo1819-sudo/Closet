import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OPEN_THUMB_BATCH,
  OPEN_THUMB_CONCURRENCY,
  loadingPhotosCopy,
  openBlobRequests,
  openDownloadPlan,
} from "./open-plan.ts";

/** Fake user — tests never read or write closet.v6. */
const FAKE_USER = "fake-user-joe";

describe("openDownloadPlan", () => {
  it(`fake user ${FAKE_USER}: 145 meta, 0 blobs — only first 24 thumbs, never :o/:c`, () => {
    const ids = Array.from({ length: 145 }, (_, i) => `g${i}`);
    const plan = openDownloadPlan(ids);
    assert.equal(plan.eager.length, OPEN_THUMB_BATCH);
    assert.equal(plan.deferred.length, 145 - OPEN_THUMB_BATCH);
    assert.deepEqual(plan.kinds, ["t"]);
    assert.equal(plan.concurrency, OPEN_THUMB_CONCURRENCY);
    const reqs = openBlobRequests(plan);
    assert.equal(reqs.length, OPEN_THUMB_BATCH);
    assert.ok(reqs.every((r) => r.kind === "t"));
    assert.ok(!reqs.some((r) => r.kind === "o" || r.kind === "c"));
  });

  it("does not replace a non-empty rack with [] — plan of 145 stays 145 ids", () => {
    const ids = Array.from({ length: 145 }, (_, i) => `g${i}`);
    const plan = openDownloadPlan(ids);
    assert.equal(plan.eager.length + plan.deferred.length, 145);
  });
});

describe("loadingPhotosCopy", () => {
  it("counts thumbs while they fill", () => {
    assert.equal(loadingPhotosCopy(12, 145), "Loading photos · 12/145");
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cloudSrc, idbCount, isCloudSrc, parseCloudSrc, rewriteCloudSrcs } from "./src.ts";

/** Fake user — tests never read or write closet.v6. */
void "fake-user-joe";

describe("rewriteCloudSrcs", () => {
  it("idbCount after rewrite is 0 when thumbs uploaded", () => {
    const user = "11111111-1111-1111-1111-111111111111";
    const garments = [
      { id: "a", imageSrc: "idb:a:o", cutoutSrc: "idb:a:c" },
      { id: "b", imageSrc: "idb:b:o", cutoutSrc: "idb:b:c" },
    ];
    assert.equal(idbCount(garments), 2);
    const next = rewriteCloudSrcs(garments, user, new Set(["a:t", "b:t"]));
    assert.equal(idbCount(next), 0);
    assert.equal(isCloudSrc(next[0]!.cutoutSrc), true);
    assert.equal(parseCloudSrc(next[0]!.cutoutSrc)?.kind, "t");
    assert.equal(cloudSrc(user, "a", "t"), next[0]!.cutoutSrc);
  });
});

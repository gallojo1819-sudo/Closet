import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { uploadBlobKeys } from "./blobs.ts";

/** Fake user — tests never read or write closet.v6. */
void "fake-user-joe";

describe("uploadBlobKeys", () => {
  it(":t falls back to cutoutSrc then imageSrc", () => {
    const g = { id: "a", imageSrc: "idb:a:o", cutoutSrc: "idb:a:c" };
    assert.deepEqual(uploadBlobKeys(g, "t"), ["idb:a:t", "idb:a:c", "idb:a:o"]);
    assert.deepEqual(uploadBlobKeys(g, "c"), ["idb:a:c"]);
    assert.deepEqual(uploadBlobKeys(g, "o"), ["idb:a:o"]);
  });
});

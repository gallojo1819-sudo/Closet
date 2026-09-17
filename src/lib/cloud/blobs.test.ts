import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cloudErrorCopy } from "./copy.ts";
import { countTjpgFromLists, needsJpegConvert, uploadBlobKeys } from "./blobs.ts";

/** Fake user — tests never read or write closet.v6. */
void "fake-user-joe";

describe("uploadBlobKeys", () => {
  it(":t falls back to cutoutSrc then imageSrc then other kinds", () => {
    const g = { id: "a", imageSrc: "idb:a:o", cutoutSrc: "idb:a:c" };
    assert.deepEqual(uploadBlobKeys(g, "t"), ["idb:a:t", "idb:a:c", "idb:a:o"]);
    assert.deepEqual(uploadBlobKeys(g, "c"), ["idb:a:c", "idb:a:o", "idb:a:t"]);
    assert.deepEqual(uploadBlobKeys(g, "o"), ["idb:a:o", "idb:a:c", "idb:a:t"]);
  });
});

describe("needsJpegConvert", () => {
  it("converts heic/webp/png, not jpeg", () => {
    assert.equal(needsJpegConvert("image/jpeg"), false);
    assert.equal(needsJpegConvert("image/jpg"), false);
    assert.equal(needsJpegConvert("image/webp"), true);
    assert.equal(needsJpegConvert("image/heic"), true);
    assert.equal(needsJpegConvert("image/png"), true);
  });
});

describe("cloudErrorCopy", () => {
  it("banners status and supabase message, not a silent success", () => {
    const line = cloudErrorCopy({ status: 403, message: "new row violates row-level security" });
    assert.equal(line.includes("403"), true);
    assert.equal(line.includes("row-level"), true);
    assert.equal(/saved/i.test(line), false);
  });
});

describe("countTjpgFromLists", () => {
  it("counts t.jpg inside garment folders, not the me folder", () => {
    const n = countTjpgFromLists(
      [{ name: "g1" }, { name: "g2" }, { name: "me" }],
      {
        g1: [{ name: "t.jpg" }, { name: "c.jpg" }],
        g2: [{ name: "c.jpg" }],
        me: [{ name: "ref.jpg" }],
      },
    );
    assert.equal(n, 1);
  });
});

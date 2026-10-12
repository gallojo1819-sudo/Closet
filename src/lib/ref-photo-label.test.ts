import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { refPhotoLabel } from "./ref-photo-label.ts";

describe("Fit dialog photo button", () => {
  it("says Add photo when there is no photo to show, even if a key is stored", () => {
    assert.equal(refPhotoLabel({ busy: false, shown: null }), "Add photo");
    assert.equal(refPhotoLabel({ busy: false, shown: "" }), "Add photo");
    assert.equal(refPhotoLabel({ busy: false, shown: undefined }), "Add photo");
  });
  it("says Replace photo once a photo is shown, and Saving while busy", () => {
    assert.equal(refPhotoLabel({ busy: false, shown: "blob:x" }), "Replace photo");
    assert.equal(refPhotoLabel({ busy: true, shown: "blob:x" }), "Saving…");
    assert.equal(refPhotoLabel({ busy: true, shown: null }), "Saving…");
  });
});

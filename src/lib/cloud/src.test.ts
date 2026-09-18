import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyBackupToStore,
  backupRemaining,
  cloudSrc,
  idbCount,
  isCloudSrc,
  paintSrc,
  parseCloudSrc,
  rewriteCloudSrcs,
  shouldShowBackupBanner,
} from "./src.ts";

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
    assert.equal(parseCloudSrc(next[0]!.cutoutSrc)?.path, `${user}/a/t.jpg`);
    assert.equal(cloudSrc(user, "a", "t"), next[0]!.cutoutSrc);
  });

  it("fake 3-garment backup: idbCount is 0 and upsert payload has sb: not idb:", () => {
    const user = "11111111-1111-1111-1111-111111111111";
    const pre = [
      { id: "g1", imageSrc: "idb:g1:o", cutoutSrc: "idb:g1:c" },
      { id: "g2", imageSrc: "idb:g2:o", cutoutSrc: "idb:g2:c" },
      { id: "g3", imageSrc: "idb:g3:o", cutoutSrc: "idb:g3:c" },
    ];
    const uploaded = new Set([
      "g1:t",
      "g1:c",
      "g1:o",
      "g2:t",
      "g2:c",
      "g2:o",
      "g3:t",
      "g3:c",
      "g3:o",
    ]);
    let store = { garments: pre };
    const fromState = applyBackupToStore(
      () => store.garments,
      (next) => {
        store = { garments: next };
      },
      user,
      uploaded,
    );
    assert.equal(idbCount(fromState), 0);
    assert.equal(idbCount(store.garments), 0);
    const payload = JSON.stringify({ garments: store.garments });
    assert.equal(payload.includes("idb:"), false);
    assert.equal(payload.includes("sb:"), true);
    assert.equal(parseCloudSrc(store.garments[0]!.cutoutSrc)?.kind, "c");
    assert.equal(parseCloudSrc(store.garments[0]!.imageSrc)?.kind, "o");
    assert.notEqual(fromState, pre);
  });
});

describe("paintSrc", () => {
  it("never returns sb: as an img src; signed URL must be http", () => {
    assert.equal(paintSrc("sb:uid/gid/c.jpg", "https://signed.example/c.jpg"), "https://signed.example/c.jpg");
    assert.equal(paintSrc("idb:gid:c", "https://signed.example/c.jpg"), "https://signed.example/c.jpg");
    assert.equal(paintSrc("sb:uid/gid/o.jpg", "sb:uid/gid/o.jpg"), "");
    assert.equal(paintSrc("blob:abc", ""), "blob:abc");
    const signed = "https://proj.supabase.co/storage/v1/object/sign/closet-images/u/g/c.jpg";
    assert.equal(paintSrc("", signed).startsWith("http"), true);
  });
});

describe("shouldShowBackupBanner", () => {
  it("hides when srcs are sb: even if listed thumbs are 0", () => {
    assert.equal(
      shouldShowBackupBanner({
        signedIn: true,
        liveCount: 145,
        remaining: 0,
        listedThumbs: 0,
      }),
      false,
    );
  });
  it("hides when listed objects cover the rack even with leftover idb:", () => {
    assert.equal(
      shouldShowBackupBanner({
        signedIn: true,
        liveCount: 145,
        remaining: 12,
        listedThumbs: 145,
      }),
      false,
    );
  });
  it("shows only when leftover idb: AND listed objects < N", () => {
    assert.equal(
      shouldShowBackupBanner({
        signedIn: true,
        liveCount: 145,
        remaining: 12,
        listedThumbs: 0,
      }),
      true,
    );
    assert.equal(
      shouldShowBackupBanner({ signedIn: true, liveCount: 145, remaining: 12 }),
      false,
    );
  });
});

describe("backupRemaining", () => {
  it("is 0 when idb is 0 or listed objects cover N", () => {
    assert.equal(backupRemaining({ idbRemaining: 0, listedThumbs: 0, liveCount: 145 }), 0);
    assert.equal(backupRemaining({ idbRemaining: 12, listedThumbs: 145, liveCount: 145 }), 0);
    assert.equal(backupRemaining({ idbRemaining: 12, listedThumbs: 0, liveCount: 145 }), 12);
  });
});

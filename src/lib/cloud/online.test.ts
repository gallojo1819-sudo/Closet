import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isRetryableCloudError, onOnlineIntent, shouldPushClosetMeta, visibleCloudIntent } from "./online.ts";

/** Fake user — tests never read or write closet.v6. */
void "fake-user-joe";

describe("onOnlineIntent", () => {
  it("a saved user edit retries once the pull has landed and the network is back", () => {
    assert.equal(
      onOnlineIntent({
        online: true,
        signedIn: true,
        localCount: 12,
        localOnly: true,
        pendingEdit: true,
        pulled: true,
      }),
      "push",
    );
  });

  it("a full rack on Wi‑Fi does not push, and a edit does not push before the pull", () => {
    assert.equal(
      onOnlineIntent({ online: true, signedIn: true, localCount: 145, pulled: true }),
      "idle",
    );
    assert.equal(
      onOnlineIntent({
        online: true,
        signedIn: true,
        pendingEdit: true,
        pulled: false,
        localCount: 145,
      }),
      "idle",
    );
  });

  it("stays idle while offline or signed out", () => {
    assert.equal(
      onOnlineIntent({
        online: false,
        signedIn: true,
        localCount: 12,
        localOnly: true,
        pendingEdit: true,
        pulled: true,
      }),
      "idle",
    );
    assert.equal(
      onOnlineIntent({ online: true, signedIn: false, localCount: 12, pendingEdit: true, pulled: true }),
      "idle",
    );
  });
});

describe("shouldPushClosetMeta", () => {
  it("a Today reroll that only changes drop does not upsert the blob", () => {
    const prev = { garments: [], looks: [], journal: [], avoid: {}, refPhoto: null, drop: null };
    const next = { ...prev, drop: { date: "2026-09-26", garmentIds: ["g1"] } };
    assert.equal(shouldPushClosetMeta(prev, next), false);
    assert.equal(shouldPushClosetMeta(prev, { ...prev, journal: [{}] }), true);
  });
});

describe("visibleCloudIntent", () => {
  it("focus does not push a rack that was only opened", () => {
    assert.equal(visibleCloudIntent({ action: "push", appliedCloud: false }), "idle");
    assert.equal(visibleCloudIntent({ action: "union", appliedCloud: false }), "idle");
  });

  it("applies a real cloud pull", () => {
    assert.equal(
      visibleCloudIntent({ action: "pull", appliedCloud: true }),
      "apply",
    );
  });

  it("a pending edit may push after the focus pull", () => {
    assert.equal(
      visibleCloudIntent({ action: "union", appliedCloud: false, pendingEdit: true }),
      "push",
    );
  });
});

describe("isRetryableCloudError", () => {
  it("retries 403 and dead network, not a silent drop", () => {
    assert.equal(isRetryableCloudError({ status: 403 }), true);
    assert.equal(isRetryableCloudError({ message: "Failed to fetch" }), true);
    assert.equal(isRetryableCloudError({ message: "ok" }), false);
  });
});

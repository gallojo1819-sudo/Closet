import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isRetryableCloudError, onOnlineIntent, visibleCloudIntent } from "./online.ts";

/** Fake user — tests never read or write closet.v6. */
void "fake-user-joe";

describe("onOnlineIntent", () => {
  it("back on Wi‑Fi with local pieces retries the account push", () => {
    assert.equal(
      onOnlineIntent({ online: true, signedIn: true, localCount: 12, localOnly: true }),
      "push",
    );
    assert.equal(
      onOnlineIntent({ online: true, signedIn: true, localCount: 145 }),
      "push",
    );
  });

  it("stays idle while offline or signed out", () => {
    assert.equal(
      onOnlineIntent({ online: false, signedIn: true, localCount: 12, localOnly: true }),
      "idle",
    );
    assert.equal(
      onOnlineIntent({ online: true, signedIn: false, localCount: 12 }),
      "idle",
    );
  });
});

describe("visibleCloudIntent", () => {
  it("never pulls empty cloud over a non-empty rack — pushes instead", () => {
    assert.equal(
      visibleCloudIntent({ action: "push", appliedCloud: false }),
      "push",
    );
  });

  it("applies a real cloud pull", () => {
    assert.equal(
      visibleCloudIntent({ action: "pull", appliedCloud: true }),
      "apply",
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

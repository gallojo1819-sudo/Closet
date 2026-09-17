import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allowSampleRack, isHomeEmail, WRONG_ACCOUNT } from "./home.ts";

describe("home email", () => {
  it("signed-in empty + non-home email does not loadSample", () => {
    assert.equal(isHomeEmail("joe@prereal.com"), true);
    assert.equal(isHomeEmail("gallojo1819@gmail.com"), false);
    assert.equal(allowSampleRack(true), false);
    assert.equal(allowSampleRack(false), true);
    assert.ok(WRONG_ACCOUNT.includes("joe@prereal.com"));
  });
});

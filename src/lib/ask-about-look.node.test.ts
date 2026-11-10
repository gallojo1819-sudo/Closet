/**
 * Look-ask pins that do not load the engine: the shared quota bucket, the deadlines,
 * and the server function's gate sitting before any fetch. No model call, no closet.v6 write.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { LOOK_ASK_DEADLINE_MS, LOOK_ASK_SERVER_MS } from "./ai-budget.ts";
import { AI_FN_BUCKET, AI_LIMITS } from "./auth/ai-quota.ts";

describe("look ask quota and budget", () => {
  it("askAboutLook shares outfit_check at 20 an hour and 20 a day", () => {
    assert.equal(AI_FN_BUCKET.askAboutLook, "outfit_check");
    assert.equal(AI_FN_BUCKET.checkOutfit, "outfit_check");
    assert.equal(AI_LIMITS.outfit_check.hour, 20);
    assert.equal(AI_LIMITS.outfit_check.day, 20);
    assert.equal(LOOK_ASK_SERVER_MS, 25000);
    assert.equal(LOOK_ASK_DEADLINE_MS, 30000);
    assert.ok(LOOK_ASK_SERVER_MS < LOOK_ASK_DEADLINE_MS);
    assert.ok(LOOK_ASK_DEADLINE_MS < 60000);
  });

  it("the server function gates before any fetch and does not log a photo or a note", () => {
    const src = readFileSync(new URL("./ask-about-look.ts", import.meta.url), "utf8");
    const start = src.indexOf("export const askAboutLook");
    assert.ok(start >= 0);
    const block = src.slice(start);
    assert.match(block, /\.middleware\(\[closetCaller\]\)/);
    const whoAt = block.indexOf("callerId");
    const gateAt = block.indexOf("callerGate(");
    const fetchAt = block.indexOf("fetch(");
    assert.ok(whoAt > 0 && whoAt < gateAt, "signed-out check before the quota take");
    assert.ok(gateAt > 0 && fetchAt > gateAt, "callerGate before fetch");
    assert.match(block, /askAboutLook/);
    assert.match(block, /NODE_ENV !== "production"/);
    assert.equal(src.includes("console.log"), false);
    assert.equal(src.includes("putImage"), false);
    assert.equal(src.includes("rememberFromAsk"), false);
    assert.equal(src.includes("image:"), false);
  });
});

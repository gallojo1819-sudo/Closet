/**
 * Photo-check pins that do not load the engine: the quota bucket, the deadlines, and the
 * server function's gate sitting before any fetch. No model call, no closet.v6 write.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { CHECK_DEADLINE_MS, CHECK_PHOTO_EDGE, CHECK_PHOTO_MAX_BYTES, CHECK_PHOTO_QUALITY, CHECK_SERVER_MS } from "./ai-budget.ts";
import { AI_FN_BUCKET, AI_LIMITS } from "./auth/ai-quota.ts";
import { CHECK_UNCLEAR_TEXT, dataUrlBytes, unmatchedLine } from "./outfit-check-copy.ts";

describe("outfit check quota and budget", () => {
  it("outfit_check is 20 an hour and 20 a day, and checkOutfit draws on it", () => {
    assert.equal(AI_FN_BUCKET.checkOutfit, "outfit_check");
    assert.equal(AI_LIMITS.outfit_check.hour, 20);
    assert.equal(AI_LIMITS.outfit_check.day, 20);
    assert.equal(CHECK_SERVER_MS, 25000);
    assert.equal(CHECK_DEADLINE_MS, 30000);
    assert.ok(CHECK_SERVER_MS < CHECK_DEADLINE_MS);
    assert.ok(CHECK_DEADLINE_MS < 60000);
    assert.equal(CHECK_PHOTO_EDGE, 1024);
    assert.equal(CHECK_PHOTO_QUALITY, 0.8);
    assert.equal(CHECK_PHOTO_MAX_BYTES, Math.floor(1.5 * 1024 * 1024));
  });

  it("the server function gates before any fetch and does not log the image", () => {
    const src = readFileSync(new URL("./outfit-check-ask.ts", import.meta.url), "utf8");
    const start = src.indexOf("export const checkOutfit");
    assert.ok(start >= 0);
    const block = src.slice(start);
    assert.match(block, /\.middleware\(\[closetCaller\]\)/);
    const gateAt = block.indexOf("callerGate(");
    const fetchAt = block.indexOf("fetch(");
    assert.ok(gateAt > 0 && fetchAt > gateAt, "callerGate before fetch");
    assert.match(block, /checkOutfit/);
    assert.match(block, /NODE_ENV !== "production"/);
    assert.equal(src.includes("console.log"), false);
    assert.equal(src.includes("putImage"), false);
    assert.equal(src.includes("rememberFromAsk"), false);
  });

  it("the plain lines do not shop, score, or carry a data URL", () => {
    const line = unmatchedLine("green quilted vest");
    assert.match(line, /green quilted vest/);
    assert.match(line, /couldn't find/);
    for (const text of [line, CHECK_UNCLEAR_TEXT]) {
      assert.equal(/\b(buy|shop|store)\b/i.test(text), false, text);
      assert.equal(/https?:|data:image/i.test(text), false, text);
      assert.equal(/\b(score|rating)\b|\d+\s*\/\s*10/i.test(text), false, text);
    }
    assert.equal(dataUrlBytes("data:image/jpeg;base64,QUJD"), 3);
  });
});

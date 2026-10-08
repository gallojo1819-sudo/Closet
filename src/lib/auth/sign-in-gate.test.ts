import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolveSignInGateState } from "./sign-in-gate.ts";
import {
  AI_FN_BUCKET,
  AI_LIMITS,
  DAY_SECONDS,
  HOUR_SECONDS,
  SIGNED_OUT,
  isGateMessage,
  limitMessage,
  takeLocal,
  windowStart,
  type AiBucket,
} from "./ai-quota.ts";

describe("resolveSignInGateState", () => {
  it("is pending while the session check is in flight, user or not", () => {
    assert.equal(
      resolveSignInGateState({ isPending: true, hasUser: false }),
      "pending",
    );
    assert.equal(
      resolveSignInGateState({ isPending: true, hasUser: true }),
      "pending",
    );
  });

  it("is signed_in once a user is present", () => {
    assert.equal(
      resolveSignInGateState({ isPending: false, hasUser: true }),
      "signed_in",
    );
  });

  it("is signed_out only after the check resolved with no user", () => {
    assert.equal(
      resolveSignInGateState({ isPending: false, hasUser: false }),
      "signed_out",
    );
  });
});

const SPENDERS: Record<AiBucket, string[]> = {
  chat: ["askStylist", "trendLayer", "composeChapter", "judgeChapter", "describeCover"],
  vision: ["tagGarment", "classifyScan", "judgeHeldPlate", "identifyPiece"],
  image: ["printGarment", "extractGarment", "recolorCover", "onMePreview"],
  search: ["findOfficialCover", "searchOfficial", "fetchListing"],
};

describe("xAI caller gate", () => {
  const limits = { chat: { hour: 3, day: 5 }, vision: { hour: 3, day: 5 }, image: { hour: 3, day: 5 }, search: { hour: 3, day: 5 } };
  const T0 = Date.UTC(2026, 9, 8, 14, 10, 0);

  it("takeLocal allows the hour, then denies with a retry, then allows in the next window", () => {
    const store = new Map<string, number>();
    for (let i = 0; i < 3; i += 1) assert.deepEqual(takeLocal(store, "u1", "chat", T0 + i * 1000, limits), { ok: true });
    const denied = takeLocal(store, "u1", "chat", T0 + 4000, limits);
    assert.equal(denied.ok, false);
    assert.ok(!denied.ok && denied.retryAfterSec > 0 && denied.retryAfterSec <= HOUR_SECONDS, JSON.stringify(denied));
    const next = windowStart(T0, HOUR_SECONDS) + HOUR_SECONDS * 1000;
    assert.deepEqual(takeLocal(store, "u1", "chat", next, limits), { ok: true });
  });

  it("the day cap holds across hours", () => {
    const store = new Map<string, number>();
    const h = HOUR_SECONDS * 1000;
    const base = windowStart(T0, DAY_SECONDS);
    let allowed = 0;
    for (let hour = 0; hour < 4; hour += 1) {
      for (let i = 0; i < 3; i += 1) {
        if (takeLocal(store, "u1", "image", base + hour * h + i * 1000, limits).ok) allowed += 1;
      }
    }
    assert.equal(allowed, 5, "five a day");
    const denied = takeLocal(store, "u1", "image", base + 5 * h, limits);
    assert.ok(!denied.ok && denied.retryAfterSec > HOUR_SECONDS, JSON.stringify(denied));
    assert.deepEqual(takeLocal(store, "u1", "image", base + DAY_SECONDS * 1000, limits), { ok: true });
  });

  it("two users and two buckets do not share a counter", () => {
    const store = new Map<string, number>();
    for (let i = 0; i < 3; i += 1) takeLocal(store, "u1", "chat", T0, limits);
    assert.equal(takeLocal(store, "u1", "chat", T0, limits).ok, false);
    assert.deepEqual(takeLocal(store, "u2", "chat", T0, limits), { ok: true });
    assert.deepEqual(takeLocal(store, "u1", "vision", T0, limits), { ok: true });
    takeLocal(store, "u1", "chat", T0 + 3 * DAY_SECONDS * 1000, limits);
    assert.equal([...store.keys()].some((key) => key.endsWith(`|${windowStart(T0, HOUR_SECONDS)}`)), false, "old keys pruned");
  });

  it("every spender has a bucket, and the buckets cover exactly the 16 spenders", () => {
    const names = Object.keys(AI_FN_BUCKET).sort();
    const expected = Object.values(SPENDERS).flat().sort();
    assert.deepEqual(names, expected);
    for (const [bucket, fns] of Object.entries(SPENDERS) as [AiBucket, string[]][]) {
      for (const fn of fns) assert.equal(AI_FN_BUCKET[fn], bucket, fn);
    }
    assert.equal(SPENDERS.chat.length, 5);
    assert.equal(SPENDERS.vision.length, 4);
    assert.equal(SPENDERS.image.length, 4);
    assert.equal(SPENDERS.search.length, 3);
    assert.equal(AI_FN_BUCKET.aiStatus, undefined, "aiStatus is gated but not bucketed");
    for (const bucket of Object.keys(SPENDERS) as AiBucket[]) {
      assert.ok(AI_LIMITS[bucket].hour > 0 && AI_LIMITS[bucket].day >= AI_LIMITS[bucket].hour, bucket);
    }
    assert.equal(SIGNED_OUT, "Sign in to use this.");
    assert.equal(limitMessage(700), "Too many requests. Try again in 12 min.");
    assert.equal(isGateMessage(SIGNED_OUT), true);
    assert.equal(isGateMessage(limitMessage(30)), true);
    assert.equal(isGateMessage("print"), false);
  });

  it("every spender and aiStatus run the caller middleware and gate before any call", () => {
    const files = ["../ai.ts", "../listing.ts", "../packshot-search.ts"];
    const seen = new Set<string>();
    for (const rel of files) {
      const src = readFileSync(new URL(rel, import.meta.url), "utf8");
      const re = /export const (\w+) = createServerFn/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const name = m[1]!;
        const start = m.index;
        const nextExport = src.indexOf("export ", start + 1);
        const block = src.slice(start, nextExport < 0 ? undefined : nextExport);
        if (!(name in AI_FN_BUCKET) && name !== "aiStatus") continue;
        seen.add(name);
        assert.match(block, /\.middleware\(\[closetCaller\]\)/, `${name}: no middleware`);
        const gateAt = block.indexOf("callerGate(");
        assert.ok(gateAt > 0, `${name}: no callerGate`);
        const calls = ["xaiFetch(", "xaiPost(", "fetch(", "imagineEdit(", "serpShopping(", "scrapeFarfetch(", "searchOnce("]
          .map((call) => block.indexOf(call, block.indexOf(".handler(")))
          .filter((i) => i >= 0);
        for (const at of calls) assert.ok(gateAt < at, `${name}: a call before the gate`);
      }
    }
    assert.deepEqual([...seen].sort(), [...Object.keys(AI_FN_BUCKET), "aiStatus"].sort());
    const weather = readFileSync(new URL("../weather.ts", import.meta.url), "utf8");
    assert.equal(weather.includes("closetCaller"), false, "getNycWeather is untouched");
  });

  it("the quota migration is written under supabase/migrations and not in the auto-applied folder", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/20261007200000_ai_quota.sql", import.meta.url), "utf8");
    for (const bit of ["security definer", "auth.uid()", "force row level security", "grant execute"]) {
      assert.ok(sql.includes(bit), bit);
    }
    assert.match(sql, /create table if not exists public\.ai_quota/);
    assert.match(sql, /create or replace function public\.ai_quota_take\(/);
    assert.match(sql, /revoke all on function public\.ai_quota_take\(text, int, int\) from public, anon/);
    const top = new URL("../../../migrations/", import.meta.url);
    for (const entry of readdirSync(top)) {
      const path = new URL(entry, top);
      if (!statSync(path).isFile()) continue;
      assert.equal(readFileSync(path, "utf8").includes("ai_quota"), false, entry);
    }
  });
});

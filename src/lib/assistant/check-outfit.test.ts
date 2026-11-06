/**
 * Photo check with a scripted model. No live xAI call and no persisted closet write.
 * The vest, oversized, unmatched and hallucinated cases run on the real clock and
 * with the clock pinned to 2026-11-04 and 2027-03-15.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHECK_DEADLINE_MS, CHECK_SERVER_MS } from "../ai-budget.ts";
import { AI_LIMITS, SIGNED_OUT, limitMessage, takeLocal, type AiLimit } from "../auth/ai-quota.ts";
import { testCloset } from "../__fixtures__/snapshot.ts";
import { HOUSE_WORDS, RULE_ID } from "../outfit-check.ts";
import { CHECK_NO_KEY_TEXT, CHECK_OVERSIZE_TEXT, CHECK_TIMEOUT_TEXT, CHECK_TYPE_TEXT, CHECK_UNCLEAR_TEXT } from "../outfit-check-copy.ts";
import { submitOutfitCheck } from "../outfit-check-client.ts";
import { livePool } from "../rack.ts";
import { oversizedOf } from "../stylist/oversized.ts";
import { emptyTaste } from "../taste.ts";
import type { Garment } from "../types.ts";
import {
  CHECK_FLAG_USD,
  CHECK_MAX_STEPS,
  checkOutfitCore,
  outfitPromptSizes,
  parseSeen,
  phaseBUser,
  shapeOutfitReply,
  type CheckOutfitDeps,
  type CheckOutfitInput,
  type SeenPiece,
} from "./check-outfit.ts";
import type { XaiPost } from "./xai-adapter.ts";

const POOL = livePool(testCloset);
const FLANNEL = "g_2b6fao81vqrs";
const VEST = "g_ef0u3ljnwa09";
const CORDS = "g_cfm8n594jea7";
const BOOTS = "g_b4zsf3dfrhdv";
const POLO = "g_reesb6nbrmm4";
const IMAGE = "data:image/jpeg;base64,QUJDRA==";

const VEST_IDS = [FLANNEL, VEST, CORDS, BOOTS];
const POLO_IDS = [POLO, VEST, CORDS, BOOTS];

function piece(id: string): Garment {
  const g = POOL.find((p) => p.id === id);
  if (!g) throw new Error(`${id} is not in the snapshot`);
  return g;
}

type SeenIn = {
  what: string;
  slot: string;
  id: string | null;
  confidence: "high" | "low";
  worn: "tucked" | "untucked" | "n/a";
  hem_below_outer: boolean | null;
};

function seen(id: string | null, slot: string, over: Partial<SeenIn> = {}): SeenIn {
  const owned = id ? POOL.find((p) => p.id === id) : undefined;
  return {
    what: owned?.name ?? "unknown piece",
    slot,
    id,
    confidence: "high",
    worn: "n/a",
    hem_below_outer: null,
    ...over,
  };
}

function visionJson(payload: { seen: SeenIn[]; unmatched?: string[] }, usage?: { prompt_tokens: number; completion_tokens: number; completion_tokens_details?: { reasoning_tokens: number } }) {
  return {
    choices: [{ message: { role: "assistant", content: JSON.stringify({ seen: payload.seen, unmatched: payload.unmatched ?? [] }) } }],
    ...(usage ? { usage } : {}),
  };
}

function choice(reply: { text?: string; toolCalls?: { name: string; args: unknown }[] }, usage?: { prompt_tokens: number; completion_tokens: number }) {
  const message: Record<string, unknown> = { role: "assistant", content: reply.text ?? null };
  if (reply.toolCalls?.length) {
    message.tool_calls = reply.toolCalls.map((call, i) => ({
      id: `call_x_${i}`,
      type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
    }));
  }
  return { choices: [{ message }], ...(usage ? { usage } : {}) };
}

function isVision(body: unknown): boolean {
  const messages = (body as { messages?: { content?: unknown }[] }).messages ?? [];
  return messages.some((m) => Array.isArray(m.content) && m.content.some((part) => (part as { type?: string }).type === "image_url"));
}

function inputOf(over: Partial<CheckOutfitInput> = {}): CheckOutfitInput {
  return {
    image: IMAGE,
    garments: POOL,
    page: { route: "today", onScreenLookIds: [], occasion: "weekend", season: "fall", weatherF: 58 },
    weatherF: 58,
    taste: emptyTaste(),
    ...over,
  };
}

function depsOf(post: XaiPost, over: Partial<CheckOutfitDeps> = {}): CheckOutfitDeps {
  return { post, gate: async () => ({ ok: true }), hasKey: true, dev: true, ...over };
}

function linesOf(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

function assertPlain(text: string) {
  expect(text).not.toMatch(RULE_ID);
  expect(text).not.toMatch(HOUSE_WORDS);
  expect(text).not.toMatch(/\b(buy|shop|store)\b/i);
  expect(text).not.toMatch(/https?:|www\./i);
  expect(text).not.toMatch(/\b(score|rating)\b|\d+\s*\/\s*10|%\s*match/i);
}

const DATES = ["real", "2026-11-04", "2027-03-15"] as const;

for (const date of DATES) {
  describe(`check outfit (${date})`, () => {
    beforeEach(() => {
      if (date === "real") {
        vi.useRealTimers();
        return;
      }
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(`${date}T16:00:00.000Z`));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const dateDep = date === "real" ? {} : { date };

    it("vest photo: tuck in, one verdict, at most three fixes, an owned knit", async () => {
      const bodies: { messages?: { role?: string; content?: unknown }[]; temperature?: number; max_tokens?: number }[] = [];
      const post: XaiPost = async (raw) => {
        const body = raw as { messages?: { role?: string; content?: unknown }[]; temperature?: number; max_tokens?: number };
        bodies.push(body);
        if (isVision(body)) {
          return {
            ok: true,
            json: visionJson({
              seen: [
                seen(FLANNEL, "top", { worn: "untucked", hem_below_outer: true }),
                seen(VEST, "outer"),
                seen(CORDS, "bottom"),
                seen(BOOTS, "shoe"),
              ],
            }),
          };
        }
        const last = body.messages?.at(-1);
        if (last?.role !== "tool") {
          return { ok: true, json: choice({ toolCalls: [{ name: "closet_check_look", args: { ids: VEST_IDS, occasion: "weekend", season: "fall" } }] }) };
        }
        return { ok: true, json: choice({ text: "Almost.\nTuck the blue plaid flannel shirt, or swap it to a knit." }) };
      };
      const res = await checkOutfitCore(inputOf(), depsOf(post, dateDep));
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const lines = linesOf(res.text);
      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines.length).toBeLessThanOrEqual(4);
      expect(lines[0]).toMatch(/^(Works|Almost|Doesn't work yet)\b/);
      expect(res.text).toMatch(/tuck/i);
      expect(res.text).toMatch(/knit/i);
      assertPlain(res.text);
      expect(res.garmentIds.every((id) => POOL.some((g) => g.id === id))).toBe(true);
      const answer = bodies.at(-1);
      const tool = answer?.messages?.at(-1);
      expect(tool?.role).toBe("tool");
      expect(String(tool?.content)).toContain('"tuck":"in"');
      expect(bodies[0]?.temperature).toBe(0);
      expect(bodies[0]?.max_tokens).toBe(600);
      expect(bodies.some((body, i) => i > 0 && isVision(body))).toBe(false);
      expect(JSON.stringify(bodies.slice(1))).not.toContain(IMAGE);
    });

    it("oversized under a vest: no tuck, swap is an owned regular piece", async () => {
      const found: { report: { legal?: boolean; reasons?: string[] } | null; swapId: string; swapLabel: string } = {
        report: null,
        swapId: "",
        swapLabel: "",
      };
      const post: XaiPost = async (raw) => {
        const body = raw as { messages?: { role?: string; content?: string }[] };
        if (isVision(body)) {
          return {
            ok: true,
            json: visionJson({
              seen: [seen(POLO, "top", { worn: "untucked", hem_below_outer: true }), seen(VEST, "outer"), seen(CORDS, "bottom"), seen(BOOTS, "shoe")],
            }),
          };
        }
        const messages = body.messages ?? [];
        const last = messages.at(-1);
        const called = messages.filter((m) => m.role === "tool").map((m) => m.content ?? "");
        if (!called.length) {
          return { ok: true, json: choice({ toolCalls: [{ name: "closet_check_look", args: { ids: POLO_IDS, occasion: "weekend", season: "fall" } }] }) };
        }
        if (called.length === 1) {
          found.report = (JSON.parse(called[0] ?? "{}") as { data?: { legal?: boolean; reasons?: string[] } }).data ?? null;
          return { ok: true, json: choice({ toolCalls: [{ name: "closet_suggest_swap", args: { ids: POLO_IDS, occasion: "weekend", season: "fall" } }] }) };
        }
        const swap = JSON.parse(last?.content ?? "{}") as { data?: { swaps?: { items?: { slot: string; in: { id: string; label: string } }[] } } };
        const items = swap.data?.swaps?.items ?? [];
        const top = items.find((item) => item.slot === "top" && POOL.some((g) => g.id === item.in.id) && !oversizedOf(piece(item.in.id)));
        found.swapId = top?.in.id ?? "";
        found.swapLabel = (top?.in.label ?? "shirt").split("·")[0]!.trim();
        return { ok: true, json: choice({ text: `Doesn't work yet.\nSwap the navy long-sleeve polo for the ${found.swapLabel}.` }) };
      };
      const res = await checkOutfitCore(inputOf(), depsOf(post, dateDep));
      expect(found.report?.legal).toBe(false);
      expect((found.report?.reasons ?? []).join(" ")).toMatch(/hang below the vest|tuck or a knit/i);
      expect(found.swapId, "no regular top swap").not.toBe("");
      expect(oversizedOf(piece(found.swapId))).toBe(false);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.text).not.toMatch(/\btuck\b/i);
      expect(res.text).toContain(found.swapLabel);
      expect(linesOf(res.text).length).toBeLessThanOrEqual(4);
      expect(linesOf(res.text)[0]).toMatch(/Doesn't work yet/);
      assertPlain(res.text);
      expect(res.text).not.toBe(CHECK_UNCLEAR_TEXT);
      expect(res.garmentIds.every((id) => POOL.some((g) => g.id === id))).toBe(true);
      if (res.garmentIds.includes(found.swapId)) expect(oversizedOf(piece(found.swapId))).toBe(false);
    });

    it("unmatched piece is named plainly and phase B does not run", async () => {
      let posts = 0;
      const post: XaiPost = async (raw) => {
        posts += 1;
        const body = raw as { messages?: { content?: unknown }[] };
        expect(isVision(body)).toBe(true);
        return { ok: true, json: visionJson({ seen: [seen(FLANNEL, "top")], unmatched: ["green quilted vest"] }) };
      };
      const res = await checkOutfitCore(inputOf(), depsOf(post, dateDep));
      expect(posts).toBe(1);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.text.toLowerCase()).toContain("green quilted vest");
      expect(res.text.toLowerCase()).toContain("couldn't find");
      assertPlain(res.text);
      expect(res.garmentIds).toEqual([]);
    });

    it("hallucinated ids are dropped and a thin match asks for a clearer photo", async () => {
      let posts = 0;
      const post: XaiPost = async (raw) => {
        posts += 1;
        expect(isVision(raw as { messages?: { content?: unknown }[] })).toBe(true);
        return {
          ok: true,
          json: visionJson({
            seen: [
              seen("g_not_in_this_closet", "top", { what: "invented coat" }),
              seen("g_also_missing", "bottom", { what: "invented trouser" }),
            ],
          }),
        };
      };
      const res = await checkOutfitCore(inputOf(), depsOf(post, dateDep));
      expect(posts).toBe(1);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.text).toContain(CHECK_UNCLEAR_TEXT);
      expect(res.text).not.toContain("g_not_in_this_closet");
      expect(res.text).not.toContain("g_also_missing");
      expect(res.text).not.toContain("invented");
      assertPlain(res.text);
    });
  });
}

/** A signed-in gate that counts units, and a post that fails the test if it is called. */
async function rejectedSpend(image: string, over: Partial<CheckOutfitDeps> = {}) {
  let posts = 0;
  let takes = 0;
  const post: XaiPost = async () => {
    posts += 1;
    return { ok: false, json: null, error: "no" };
  };
  const res = await checkOutfitCore(
    inputOf({ image }),
    depsOf(post, {
      gate: async () => {
        takes += 1;
        return { ok: true };
      },
      ...over,
    }),
  );
  return { res, posts, takes };
}

describe("check outfit gates, log, and shape", () => {
  it("a signed-out caller gets SIGNED_OUT and no POST", async () => {
    let posts = 0;
    let takes = 0;
    const post: XaiPost = async () => {
      posts += 1;
      return { ok: false, json: null, error: "no" };
    };
    const res = await checkOutfitCore(
      inputOf({ image: "data:image/gif;base64,R0lGODlh" }),
      depsOf(post, {
        identify: async () => ({ ok: false, error: SIGNED_OUT }),
        gate: async () => {
          takes += 1;
          return { ok: true };
        },
      }),
    );
    expect(posts).toBe(0);
    expect(takes).toBe(0);
    expect(res).toEqual({ ok: false, error: SIGNED_OUT, reason: "signed_out" });
  });

  it("a bad image type spends no quota unit", async () => {
    const spent = await rejectedSpend("data:image/gif;base64,R0lGODlh");
    expect(spent.posts).toBe(0);
    expect(spent.takes).toBe(0);
    expect(spent.res).toEqual({ ok: false, error: CHECK_TYPE_TEXT, reason: "image" });
  });

  it("an oversized image spends no quota unit", async () => {
    const spent = await rejectedSpend(`data:image/jpeg;base64,${"A".repeat(2_200_000)}`);
    expect(spent.posts).toBe(0);
    expect(spent.takes).toBe(0);
    expect(spent.res).toEqual({ ok: false, error: CHECK_OVERSIZE_TEXT, reason: "image" });
  });

  it("a missing key spends no quota unit", async () => {
    const spent = await rejectedSpend(IMAGE, { hasKey: false });
    expect(spent.posts).toBe(0);
    expect(spent.takes).toBe(0);
    expect(spent.res).toEqual({ ok: false, error: CHECK_NO_KEY_TEXT, reason: "no_key" });
  });

  it("the 21st check in a day is the limit line and no POST", async () => {
    const store = new Map<string, number>();
    const limits = { ...AI_LIMITS, outfit_check: { hour: 20, day: 20 } satisfies AiLimit };
    const now = Date.parse("2026-11-04T16:00:00.000Z");
    for (let i = 0; i < 20; i += 1) expect(takeLocal(store, "joe", "outfit_check", now, limits).ok).toBe(true);
    let posts = 0;
    const post: XaiPost = async () => {
      posts += 1;
      return { ok: false, json: null, error: "no" };
    };
    const res = await checkOutfitCore(
      inputOf(),
      depsOf(post, {
        now: () => now,
        gate: async () => {
          const taken = takeLocal(store, "joe", "outfit_check", now, limits);
          if (!taken.ok) return { ok: false, error: limitMessage(taken.retryAfterSec) };
          return { ok: true };
        },
      }),
    );
    expect(posts).toBe(0);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("quota");
    expect(res.error).toMatch(/^Too many requests/);
  });

  it("one vision call and three loop calls take exactly one unit", async () => {
    let takes = 0;
    let posts = 0;
    const post: XaiPost = async (raw) => {
      posts += 1;
      const body = raw as { messages?: { role?: string; content?: string }[] };
      const usage = posts === 1 ? { prompt_tokens: 5000, completion_tokens: 600 } : { prompt_tokens: 5000, completion_tokens: 400 };
      if (isVision(body)) return { ok: true, json: visionJson({ seen: [seen(FLANNEL, "top"), seen(CORDS, "bottom"), seen(BOOTS, "shoe")] }, usage) };
      const tools = (body.messages ?? []).filter((m) => m.role === "tool").length;
      if (tools === 0) return { ok: true, json: choice({ toolCalls: [{ name: "closet_check_look", args: { ids: [FLANNEL, CORDS, BOOTS], occasion: "weekend", season: "fall" } }] }, usage) };
      if (tools === 1) return { ok: true, json: choice({ toolCalls: [{ name: "closet_weather_now", args: {} }] }, usage) };
      return { ok: true, json: choice({ text: "Almost.\nTuck the blue plaid flannel shirt." }, usage) };
    };
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    try {
      const res = await checkOutfitCore(
        inputOf(),
        depsOf(post, {
          gate: async () => {
            takes += 1;
            return { ok: true };
          },
        }),
      );
      expect(takes).toBe(1);
      expect(posts).toBe(4);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.tokens).toEqual({ in: 20000, out: 1800, reasoning: 0, calls: 4 });
      expect(res.estUsd).toBeCloseTo(0.0508, 4);
      expect(res.estUsd ?? 1).toBeLessThanOrEqual(CHECK_FLAG_USD);
      const line = logs.find((row) => row.startsWith("[closet] checkOutfit tokens"));
      expect(line).toMatch(/in=20000 out=1800 reasoning=0 calls=4 est_usd=0\.0508/);
      expect(logs.join("\n")).not.toContain("data:image");
      expect(logs.join("\n")).not.toContain(IMAGE);
    } finally {
      spy.mockRestore();
    }
  });

  it("a check does not store the photo or write the closet", async () => {
    const images = await import("../images.ts");
    const store = await import("../store.ts");
    const cloud = await import("../cloud/client.ts");
    const put = vi.spyOn(images, "putImage");
    const update = vi.spyOn(store.useCloset.getState(), "updateGarment");
    const setState = vi.spyOn(store.useCloset, "setState");
    const account = vi.spyOn(cloud, "getSupabase");
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    const storeName = "closet" + ".v6";
    const browserStore = (globalThis as unknown as Record<string, Storage | undefined>)["local" + "Storage"];
    const before = browserStore ? browserStore.getItem(storeName) : null;
    try {
      const post: XaiPost = async (raw) => {
        const body = raw as { messages?: { role?: string }[] };
        if (isVision(body)) return { ok: true, json: visionJson({ seen: [seen(FLANNEL, "top"), seen(CORDS, "bottom"), seen(BOOTS, "shoe")] }) };
        const last = body.messages?.at(-1);
        if (last?.role !== "tool") {
          return { ok: true, json: choice({ toolCalls: [{ name: "closet_check_look", args: { ids: [FLANNEL, CORDS, BOOTS], occasion: "weekend", season: "fall" } }] }) };
        }
        return { ok: true, json: choice({ text: "Works.\nThe blue plaid flannel shirt with the burgundy corduroy pants and the brown leather boots." }) };
      };
      const res = await checkOutfitCore(inputOf(), depsOf(post));
      expect(res.ok).toBe(true);
      expect(put).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(setState).not.toHaveBeenCalled();
      expect(account).not.toHaveBeenCalled();
      expect(logs.join("\n")).not.toContain("data:image");
      expect(logs.join("\n")).not.toContain("QUJDRA");
      if (browserStore) expect(browserStore.getItem(storeName)).toBe(before);
    } finally {
      spy.mockRestore();
      put.mockRestore();
      update.mockRestore();
      setState.mockRestore();
      account.mockRestore();
    }
  });

  it("a 6-fix answer is cut to 3 and ratings are stripped", () => {
    const shaped = shapeOutfitReply(["Works.", "Fix one.", "Fix two.", "Fix three.", "Fix four.", "Fix five.", "Fix six.", "8/10", "score", "rating"].join("\n"));
    expect(linesOf(shaped)).toEqual(["Works.", "Fix one.", "Fix two.", "Fix three."]);
    const mixed = shapeOutfitReply("Almost. 8/10\nThis has a score.\nA rating stays out.\nTuck the blue plaid flannel shirt.");
    expect(mixed).not.toMatch(/8\s*\/\s*10|\bscore\b|\brating\b/i);
    expect(linesOf(mixed).length).toBeLessThanOrEqual(4);
  });

  it("a shaped model answer keeps one verdict and three fixes", async () => {
    const post: XaiPost = async (raw) => {
      const body = raw as { messages?: { role?: string }[] };
      if (isVision(body)) return { ok: true, json: visionJson({ seen: [seen(FLANNEL, "top"), seen(CORDS, "bottom"), seen(BOOTS, "shoe")] }) };
      const last = body.messages?.at(-1);
      if (last?.role !== "tool") {
        return { ok: true, json: choice({ toolCalls: [{ name: "closet_check_look", args: { ids: [FLANNEL, CORDS, BOOTS], occasion: "weekend", season: "fall" } }] }) };
      }
      return {
        ok: true,
        json: choice({
          text: ["Almost. 8/10", "Tuck the blue plaid flannel shirt.", "Fix two stays.", "Fix three stays.", "Fix four goes.", "Fix five goes.", "Fix six goes.", "score"].join("\n"),
        }),
      };
    };
    const res = await checkOutfitCore(inputOf(), depsOf(post));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const lines = linesOf(res.text);
    expect(lines.length).toBeLessThanOrEqual(4);
    expect(lines[0]).toMatch(/^Almost\b/);
    expect(res.text).not.toMatch(/Fix four|Fix five|Fix six|8\s*\/\s*10|\bscore\b/);
    expect(res.text).toMatch(/Tuck the blue plaid flannel shirt/);
  });

  it("phase B past the server budget returns the timeout line", async () => {
    let clock = 1_000;
    let loops = 0;
    const post: XaiPost = async (raw) => {
      const body = raw as { messages?: { content?: unknown }[] };
      if (isVision(body)) {
        clock += CHECK_SERVER_MS;
        return { ok: true, json: visionJson({ seen: [seen(FLANNEL, "top"), seen(CORDS, "bottom"), seen(BOOTS, "shoe")] }) };
      }
      loops += 1;
      return { ok: true, json: choice({ text: "Works." }) };
    };
    const res = await checkOutfitCore(inputOf(), depsOf(post, { now: () => clock }));
    expect(loops).toBe(0);
    expect(res).toMatchObject({ ok: false, error: CHECK_TIMEOUT_TEXT, reason: "timeout" });
  });

  it("the client shows the timeout line and does not build a closet look", async () => {
    vi.useFakeTimers();
    try {
      const check = vi.fn(() => new Promise<never>(() => {}));
      const pending = submitOutfitCheck(inputOf(), { check, deadlineMs: CHECK_DEADLINE_MS });
      await vi.advanceTimersByTimeAsync(CHECK_DEADLINE_MS);
      expect(await pending).toEqual({ ok: false, error: CHECK_TIMEOUT_TEXT, reason: "timeout" });
      expect(check).toHaveBeenCalledTimes(1);
      const dock = readFileSync(new URL("../../components/shell/stylist-dock.tsx", import.meta.url), "utf8");
      const photo = dock.slice(dock.indexOf("const checkPhoto"), dock.indexOf("const form"));
      expect(photo).toContain("submitOutfitCheck");
      expect(photo).toContain("CHECK_DEADLINE_MS");
      expect(photo).not.toContain("localStylistReply");
      const send = dock.slice(dock.indexOf("const send = async"), dock.indexOf("const wearDraft"));
      expect(send).toContain("localStylistReply(");
    } finally {
      vi.useRealTimers();
    }
  });

  it("phase B stops at 4 steps", async () => {
    let loops = 0;
    const post: XaiPost = async (raw) => {
      const body = raw as { messages?: { content?: unknown }[] };
      if (isVision(body)) return { ok: true, json: visionJson({ seen: [seen(FLANNEL, "top"), seen(CORDS, "bottom"), seen(BOOTS, "shoe")] }) };
      loops += 1;
      return { ok: true, json: choice({ toolCalls: [{ name: "closet_search_pieces", args: { query: `flannel ${loops}` } }] }) };
    };
    await checkOutfitCore(inputOf(), depsOf(post));
    expect(loops).toBe(CHECK_MAX_STEPS);
  });

  it("parseSeen drops unknown ids and keeps one piece per slot", () => {
    const parsed = parseSeen(
      JSON.stringify({
        seen: [
          seen(FLANNEL, "top", { confidence: "low" }),
          seen(POLO, "top", { confidence: "high" }),
          seen("g_nope", "bottom"),
          seen(BOOTS, "shoe"),
        ],
        unmatched: ["green quilted vest", "green quilted vest"],
      }),
      POOL,
    );
    expect(parsed?.matched.map((row) => row.id)).toEqual([POLO, BOOTS]);
    expect(parsed?.unmatched).toEqual(["green quilted vest"]);
  });

  it("logs the phase A and phase B prompt sizes", () => {
    const sizes = outfitPromptSizes(POOL, { route: "today", onScreenLookIds: [], occasion: "weekend", season: "fall" });
    const sampleUser = phaseBUser(
      VEST_IDS.map((id, i) => ({ what: piece(id).name, slot: (["top", "outer", "bottom", "shoe"] as const)[i]!, id, confidence: "high", worn: "untucked", hemBelowOuter: true }) satisfies SeenPiece),
      ["green quilted vest"],
    );
    console.log(`outfit-check prompts: ${JSON.stringify({ ...sizes, phaseBSampleUserChars: sampleUser.length, phaseBSampleTokens: Math.ceil((sizes.phaseBSystemChars + sampleUser.length + sizes.phaseBToolChars) / 4) })}`);
    expect(sizes.closetLines).toBe(POOL.length + 1);
    expect(sizes.phaseAChars).toBe(sizes.phaseASystemChars + sizes.phaseAUserChars);
    expect(sizes.phaseATokens).toBe(Math.ceil(sizes.phaseAChars / 4));
    expect(sizes.phaseBTokens).toBe(Math.ceil(sizes.phaseBChars / 4));
    expect(sizes.phaseAUserChars).toBeGreaterThan(sizes.phaseASystemChars);
    expect(sizes.phaseBToolChars).toBeGreaterThan(1000);
  });
});

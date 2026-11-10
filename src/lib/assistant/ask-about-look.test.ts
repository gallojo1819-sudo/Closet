/**
 * Look ask with a scripted model. No live xAI call and no persisted closet write.
 * Vest, quota, shaper and swap cases run on the real clock and on 2026-11-04 and 2027-03-15.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOOK_ASK_DEADLINE_MS, LOOK_ASK_SERVER_MS } from "../ai-budget.ts";
import { AI_FN_BUCKET, AI_LIMITS, SIGNED_OUT, limitMessage, takeLocal, type AiLimit } from "../auth/ai-quota.ts";
import { testCloset } from "../__fixtures__/snapshot.ts";
import { clearJacketDrafts, readJacketDraft, setJacketDraftAccount } from "../jacket-draft.ts";
import { applyLookAskSwaps, swapIsLegal } from "../look-swap.ts";
import { PASSES_LINE, lookOpinion, opinionSlotOf } from "../look-opinion.ts";
import { HOUSE_WORDS, RULE_ID } from "../outfit-check.ts";
import { livePool } from "../rack.ts";
import { isLegal } from "../stylist/legal.ts";
import { oversizedOf } from "../stylist/oversized.ts";
import { isShortOuter } from "../stylist/short-outer.ts";
import { memoryNotes } from "../stylist-notes/notes.ts";
import { emptyTaste, tuckHabitIds } from "../taste.ts";
import { isKnitTop, isShirtLike } from "../tuck.ts";
import type { Garment } from "../types.ts";
import { assistantRegistry, oneOfEach } from "./tools.ts";
import { runTool, type AssistantCtx } from "./registry.ts";
import type { Trace } from "./loop.ts";
import type { XaiPost } from "./xai-adapter.ts";
import {
  LOOK_ASK_IDS_TEXT,
  LOOK_ASK_NO_KEY_TEXT,
  askAboutLookCore,
  harvestLookSwaps,
  lookAskPromptSizes,
  lookAskSystem,
  lookAskUser,
  shapeLookAskReply,
  type AskAboutLookDeps,
  type AskAboutLookInput,
} from "./ask-about-look.ts";
import { CHECK_FLAG_USD, estimateCheckUsd, shapeOutfitReply } from "./check-outfit.ts";

const POOL = livePool(testCloset);
const FLANNEL = "g_2b6fao81vqrs";
const VEST = "g_ef0u3ljnwa09";
const CORDS = "g_cfm8n594jea7";
const BOOTS = "g_b4zsf3dfrhdv";
const LINEN = "g_9t24uvtl10wd";
const NAVY_SWEATER = "g_d1awqw83gd3c";
const STRIPE = "g_kh5r3xy9r1i5";
const BEIGE = "g_6xkkzn06sbdm";
const DENIM = "g_ulv8tgkujvjh";
const STARS = "g_rxglifsoqobm";
const VEST_IDS = [FLANNEL, VEST, CORDS, BOOTS];
const STRIPE_IDS = [STRIPE, BEIGE, DENIM, STARS];

function piece(id: string): Garment {
  const g = POOL.find((p) => p.id === id);
  if (!g) throw new Error(`${id} is not in the snapshot`);
  return g;
}

function choice(reply: { text?: string; toolCalls?: { name: string; args: unknown }[] }, usage?: { prompt_tokens: number; completion_tokens: number; completion_tokens_details?: { reasoning_tokens: number } }) {
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

function inputOf(over: Partial<AskAboutLookInput> = {}): AskAboutLookInput {
  return {
    prompt: "What would make this better?",
    lookIds: VEST_IDS,
    garments: POOL,
    page: { route: "today", onScreenLookIds: [], occasion: "weekend", season: "fall", weatherF: 58 },
    weatherF: 58,
    taste: emptyTaste(),
    occasion: "weekend",
    ...over,
  };
}

function depsOf(post: XaiPost, over: Partial<AskAboutLookDeps> = {}): AskAboutLookDeps {
  return { post, gate: async () => ({ ok: true }), hasKey: true, dev: true, ...over };
}

function linesOf(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

function assertPlain(text: string) {
  expect(text).not.toMatch(RULE_ID);
  expect(text).not.toMatch(HOUSE_WORDS);
  expect(text).not.toMatch(/\b(buy|shop|shopping|store|stores)\b/i);
  expect(text).not.toMatch(/https?:|www\./i);
  expect(text).not.toMatch(/\b(score|rating|grades?)\b|\d+\s*\/\s*10|%\s*match/i);
}

function ctxOf(date: string): AssistantCtx {
  return {
    pool: POOL,
    taste: emptyTaste(),
    page: { route: "today", onScreenLookIds: VEST_IDS, occasion: "weekend", season: "fall" },
    weatherF: 58,
    notes: memoryNotes(),
    today: { drop: null, garments: POOL, taste: emptyTaste() },
    date,
  };
}

/** A knit that can replace the flannel under the vest and still pass. */
function legalKnitId(date: string): string | null {
  const base = VEST_IDS.map(piece);
  for (const cand of POOL) {
    if (cand.id === FLANNEL || !isKnitTop(cand) || oversizedOf(cand) || isShortOuter(cand)) continue;
    const next = base.map((g) => (g.id === FLANNEL ? cand : g));
    if (swapIsLegal(next, { occasion: "weekend", season: "fall" }, POOL)) return cand.id;
    void date;
  }
  return null;
}

const DATES = ["real", "2026-11-04", "2027-03-15"] as const;

for (const date of DATES) {
  describe(`ask about this look (${date})`, () => {
    beforeEach(() => {
      clearJacketDrafts();
      setJacketDraftAccount("");
      if (date === "real") {
        vi.useRealTimers();
        return;
      }
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(`${date}T16:00:00.000Z`));
    });
    afterEach(() => {
      vi.useRealTimers();
      clearJacketDrafts();
    });

    const dateDep = date === "real" ? {} : { date };

    it("answers can I tuck this with yes and does not repeat a tuck the sheet shows", async () => {
      const post: XaiPost = async (raw) => {
        const body = raw as { messages?: { role?: string }[] };
        const last = body.messages?.at(-1);
        if (last?.role !== "tool") {
          return { ok: true, json: choice({ toolCalls: [{ name: "closet_check_look", args: { ids: VEST_IDS, occasion: "weekend", season: "fall" } }] }) };
        }
        return {
          ok: true,
          json: choice({ text: "Works.\nTuck the blue plaid flannel shirt.\nLeave the brown leather boots." }),
        };
      };
      const res = await askAboutLookCore(inputOf({ prompt: "can I tuck this?" }), depsOf(post, dateDep));
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const lines = linesOf(res.text);
      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines.length).toBeLessThanOrEqual(4);
      expect(lines[0]).toMatch(/^yes\b/i);
      expect(res.text).not.toMatch(/^works\b/im);
      expect(res.text.toLowerCase()).not.toMatch(/tuck the\b/);
      expect(res.text).toMatch(/boots/i);
      expect(res.text.toLowerCase()).not.toMatch(/tuck the navy/);
      assertPlain(res.text);
      expect(res.swaps).toEqual([]);
    });

    it("answers the striped-shirt tuck question and does not recite the sheet tuck", async () => {
      const pieces = STRIPE_IDS.map(piece);
      expect(lookAskUser("can I tuck this?", pieces, POOL, "weekday")).toContain("Shown on the sheet as: tucked");
      const post: XaiPost = async (raw) => {
        const body = raw as { messages?: { role?: string; content?: unknown }[] };
        const last = body.messages?.at(-1);
        const system = body.messages?.find((message) => message.role === "system");
        if (typeof system?.content === "string" && last?.role !== "tool") {
          expect(system.content).toMatch(/yes or no in the first line/);
          expect(system.content).toMatch(/do not tell him to tuck or untuck as a fix/);
          expect(system.content).toMatch(/You do not have to call closet_weather_now/);
        }
        if (last?.role !== "tool") {
          return { ok: true, json: choice({ toolCalls: [{ name: "closet_check_look", args: { ids: STRIPE_IDS, occasion: "weekday", season: "fall" } }] }) };
        }
        return { ok: true, json: choice({ text: "Works.\nTuck the light blue striped shirt." }) };
      };
      const res = await askAboutLookCore(
        inputOf({
          prompt: "can I tuck this?",
          lookIds: STRIPE_IDS,
          occasion: "weekday",
          page: { route: "today", onScreenLookIds: STRIPE_IDS, occasion: "weekday", season: "fall", weatherF: 58 },
        }),
        depsOf(post, dateDep),
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const lines = linesOf(res.text);
      expect(lines[0]).toMatch(/^yes\b/i);
      expect(res.text).not.toMatch(/^works\b/im);
      expect(res.text.toLowerCase()).not.toMatch(/tuck the\b/);
      expect(res.text).not.toBe("Works.\nTuck the light blue striped shirt.");
      assertPlain(res.text);
    });

    it("swaps the shirt under the vest, not the vest as the top", async () => {
      expect(oneOfEach(VEST_IDS.map(piece))).toBe(true);
      expect(opinionSlotOf(piece(VEST))).toBe("outerwear");
      expect(opinionSlotOf(piece(FLANNEL))).toBe("top");
      expect(isShortOuter(piece(VEST))).toBe(true);
      const today = date === "real" ? new Date().toISOString().slice(0, 10) : date;
      const result = await runTool(assistantRegistry, ctxOf(today), "closet_suggest_swap", {
        ids: VEST_IDS,
        occasion: "weekend",
        season: "fall",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as { swaps?: { items?: { slot: string; out: { id: string }; in: { id: string } }[] } };
      const items = data.swaps?.items ?? [];
      expect(items.length).toBeGreaterThan(0);
      const tops = items.filter((swap) => swap.slot === "top");
      expect(tops.length).toBeGreaterThan(0);
      for (const swap of items) {
        expect(swap.slot === "top" && swap.out.id === VEST).toBe(false);
      }
      for (const swap of tops) {
        expect(swap.out.id).toBe(FLANNEL);
        const incoming = piece(swap.in.id);
        expect(isKnitTop(incoming) || isShirtLike(incoming)).toBe(true);
        expect(isShortOuter(incoming)).toBe(false);
        expect(oversizedOf(incoming)).toBe(false);
        const next = VEST_IDS.map(piece).map((g) => (g.id === FLANNEL ? incoming : g));
        expect(swapIsLegal(next, { occasion: "weekend", season: "fall" }, POOL)).toBe(true);
      }
      const opinion = lookOpinion(VEST_IDS.map(piece), POOL, { occasion: "weekend", season: "fall" });
      expect(opinion?.headline).toBe(PASSES_LINE);
      expect(opinion?.swaps.length).toBeGreaterThan(0);
      expect(opinion?.swaps[0]?.slot).toBe("top");
      expect(opinion?.swaps[0]?.id).toBe(tops[0]?.in.id);
      const harvested = harvestLookSwaps([
        { step: 1, call: { name: "closet_suggest_swap", args: { ids: VEST_IDS } }, result },
      ]);
      expect(harvested.length).toBeGreaterThan(0);
      for (const swap of harvested) {
        if (swap.slot === "top") expect(swap.fromId).toBe(FLANNEL);
        expect(swap.fromId === VEST && swap.slot === "top").toBe(false);
      }
    });

    it("harvests a scripted swap from the tool trace, not from the prose", async () => {
      const knit = legalKnitId(date);
      expect(knit, "a legal knit under the vest").toBeTruthy();
      if (!knit) return;
      let posts = 0;
      const post: XaiPost = async (raw) => {
        posts += 1;
        const body = raw as { messages?: { role?: string; content?: unknown }[] };
        const last = body.messages?.at(-1);
        const toolContent = typeof last?.content === "string" ? last.content : "";
        if (last?.role !== "tool") {
          return { ok: true, json: choice({ toolCalls: [{ name: "closet_check_look", args: { ids: VEST_IDS, occasion: "weekend", season: "fall" } }] }) };
        }
        if (!toolContent.includes("closet_suggest_swap") && !toolContent.includes("\"swaps\"")) {
          return { ok: true, json: choice({ toolCalls: [{ name: "closet_suggest_swap", args: { ids: VEST_IDS, occasion: "weekend", season: "fall" } }] }) };
        }
        return { ok: true, json: choice({ text: "Almost.\nTuck the blue plaid flannel shirt.\nLeave the brown leather boots." }, { prompt_tokens: 1000, completion_tokens: 40 }) };
      };
      const takes: string[] = [];
      const res = await askAboutLookCore(
        inputOf(),
        depsOf(post, {
          ...dateDep,
          gate: async () => {
            takes.push("outfit_check");
            return { ok: true };
          },
        }),
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(takes).toEqual(["outfit_check"]);
      expect(posts).toBeGreaterThanOrEqual(2);
      const top = res.swaps.find((swap) => swap.slot === "top");
      if (top) {
        expect(top.fromId).toBe(FLANNEL);
        expect(top.fromId).not.toBe(VEST);
        expect(POOL.some((g) => g.id === top.toId)).toBe(true);
      }
      expect(res.text).not.toContain(knit);
      const base = [...VEST_IDS];
      const stamp = `look:${date}`;
      const applied = applyLookAskSwaps({
        ids: base,
        baseIds: base,
        stamp,
        closet: POOL,
        swaps: [{ fromId: FLANNEL, toId: knit, slot: "top" }],
        ctx: { occasion: "weekend", season: "fall" },
      });
      expect(applied.wrote).toBe(true);
      expect(applied.ids).toContain(knit);
      expect(applied.ids).not.toContain(FLANNEL);
      expect(applied.ids).toContain(VEST);
      expect(readJacketDraft(base, stamp)?.ids).toEqual(applied.ids);
      expect(readJacketDraft(base, stamp)?.preSwapIds).toEqual(base);
    });

    it("logs tokens and flags an ask over 30 cents", async () => {
      const logs: string[] = [];
      const spy = vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
        if (typeof line === "string") logs.push(line);
      });
      const post: XaiPost = async () => ({
        ok: true,
        json: choice(
          { text: "Almost.\nTuck the blue plaid flannel shirt." },
          { prompt_tokens: 200_000, completion_tokens: 20_000, completion_tokens_details: { reasoning_tokens: 10 } },
        ),
      });
      const res = await askAboutLookCore(inputOf(), depsOf(post, dateDep));
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.tokens?.in).toBe(200_000);
      expect(res.estUsd).toBeGreaterThan(CHECK_FLAG_USD);
      expect(logs.some((line) => line.startsWith("[closet] askAboutLook tokens") && line.includes("est_usd="))).toBe(true);
      expect(logs.some((line) => line.includes("askAboutLook flag") && line.includes("above 0.30"))).toBe(true);
      spy.mockRestore();
    });

    it("includes reasoning tokens in est_usd at the output rate", async () => {
      const logs: string[] = [];
      const spy = vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
        if (typeof line === "string") logs.push(line);
      });
      const usage = { prompt_tokens: 10_000, completion_tokens: 156, completion_tokens_details: { reasoning_tokens: 343 } };
      const post: XaiPost = async () => ({
        ok: true,
        json: choice({ text: "Almost.\nLeave the brown leather boots." }, usage),
      });
      const res = await askAboutLookCore(inputOf(), depsOf(post, dateDep));
      const est = estimateCheckUsd(10_000, 156, 343);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.tokens).toEqual({ in: 10_000, out: 156, reasoning: 343, calls: 1 });
      expect(res.estUsd).toBe(est);
      expect(est).toBeGreaterThan(estimateCheckUsd(10_000, 156));
      expect(logs.some((line) => line.includes(`reasoning=343`) && line.includes(`est_usd=${est.toFixed(4)}`))).toBe(true);
      expect(logs.some((line) => line.includes("askAboutLook flag"))).toBe(false);
      spy.mockRestore();
    });

    it("answers rain in plain words and does not invent a shell", async () => {
      const post: XaiPost = async (raw) => {
        const body = raw as { messages?: { role?: string }[] };
        const last = body.messages?.at(-1);
        if (last?.role !== "tool") {
          return { ok: true, json: choice({ toolCalls: [{ name: "closet_weather_now", args: {} }] }) };
        }
        return { ok: true, json: choice({ text: "Almost.\nIt is raining.\nThe brown leather boots will drink the rain." }) };
      };
      const bodies: { messages?: { role?: string; content?: unknown }[] }[] = [];
      const wrapped: XaiPost = async (raw) => {
        bodies.push(raw as { messages?: { role?: string; content?: unknown }[] });
        return post(raw);
      };
      const res = await askAboutLookCore(
        inputOf({
          prompt: "is this ok for rain?",
          weatherF: 48,
          page: { route: "today", onScreenLookIds: VEST_IDS, occasion: "weekend", season: "fall", weatherF: 48 },
        }),
        depsOf(wrapped, dateDep),
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.text.toLowerCase()).toMatch(/rain/);
      expect(res.text.toLowerCase()).not.toMatch(/waterproof|water-resistant|shell/);
      assertPlain(res.text);
      const tool = bodies.map((body) => body.messages?.at(-1)).find((message) => message?.role === "tool");
      expect(String(tool?.content)).toContain("48");
    });

    it("spends one shared unit for three model rounds and nothing when blocked", async () => {
      const limits = { ...AI_LIMITS, outfit_check: { hour: 20, day: 20 } satisfies AiLimit };
      const now = date === "real" ? Date.now() : new Date(`${date}T16:00:00.000Z`).getTime();
      const store = new Map<string, number>();
      for (let i = 0; i < 20; i += 1) expect(takeLocal(store, "joe", "outfit_check", now, limits).ok).toBe(true);
      let posts = 0;
      const post: XaiPost = async () => {
        posts += 1;
        return { ok: true, json: choice({ text: "Almost." }) };
      };
      const capped = await askAboutLookCore(
        inputOf(),
        depsOf(post, {
          ...dateDep,
          gate: async () => {
            const taken = takeLocal(store, "joe", "outfit_check", now, limits);
            return taken.ok ? { ok: true } : { ok: false, error: limitMessage(taken.retryAfterSec) };
          },
        }),
      );
      expect(capped.ok).toBe(false);
      if (capped.ok) return;
      expect(capped.reason).toBe("quota");
      expect(capped.error.startsWith("Too many requests")).toBe(true);
      expect(posts).toBe(0);

      let rounds = 0;
      let takes = 0;
      const looping: XaiPost = async (raw) => {
        rounds += 1;
        const body = raw as { messages?: { role?: string }[] };
        const last = body.messages?.at(-1);
        if (rounds < 3 && last?.role !== "tool") {
          const name = rounds === 1 ? "closet_check_look" : "closet_weather_now";
          const args = name === "closet_check_look" ? { ids: VEST_IDS, occasion: "weekend", season: "fall" } : {};
          return { ok: true, json: choice({ toolCalls: [{ name, args }] }) };
        }
        if (rounds < 3) {
          return { ok: true, json: choice({ toolCalls: [{ name: "closet_weather_now", args: {} }] }) };
        }
        return { ok: true, json: choice({ text: "Almost.\nTuck the blue plaid flannel shirt." }) };
      };
      const fresh = new Map<string, number>();
      const once = await askAboutLookCore(
        inputOf(),
        depsOf(looping, {
          ...dateDep,
          gate: async () => {
            takes += 1;
            const taken = takeLocal(fresh, "joe", "outfit_check", now, limits);
            return taken.ok ? { ok: true } : { ok: false, error: limitMessage(taken.retryAfterSec) };
          },
        }),
      );
      expect(once.ok).toBe(true);
      expect(takes).toBe(1);
      expect(rounds).toBeGreaterThanOrEqual(3);
    });

    it("refuses signed-out, short looks and a missing key before any post or take", async () => {
      let posts = 0;
      let takes = 0;
      const post: XaiPost = async () => {
        posts += 1;
        return { ok: true, json: choice({ text: "Almost." }) };
      };
      const gate = async () => {
        takes += 1;
        return { ok: true as const };
      };
      const signedOut = await askAboutLookCore(inputOf(), depsOf(post, { ...dateDep, gate, identify: async () => ({ ok: false, error: SIGNED_OUT }) }));
      expect(signedOut).toMatchObject({ ok: false, error: SIGNED_OUT, reason: "signed_out" });
      const short = await askAboutLookCore(inputOf({ lookIds: [FLANNEL] }), depsOf(post, { ...dateDep, gate }));
      expect(short).toMatchObject({ ok: false, error: LOOK_ASK_IDS_TEXT, reason: "ids" });
      const missing = await askAboutLookCore(inputOf({ lookIds: [FLANNEL, "g_missing"] }), depsOf(post, { ...dateDep, gate }));
      expect(missing).toMatchObject({ ok: false, reason: "ids" });
      const noKey = await askAboutLookCore(inputOf(), depsOf(post, { ...dateDep, gate, hasKey: false }));
      expect(noKey).toMatchObject({ ok: false, error: LOOK_ASK_NO_KEY_TEXT, reason: "no_key" });
      expect(posts).toBe(0);
      expect(takes).toBe(0);
    });

    it("does not apply an illegal, refused, or unowned swap", () => {
      const base = [...VEST_IDS];
      const stamp = `illegal:${date}`;
      const ctx = { occasion: "weekend" as const, season: "fall" as const };
      const linen = applyLookAskSwaps({
        ids: base,
        baseIds: base,
        stamp,
        closet: POOL,
        swaps: [{ fromId: VEST, toId: LINEN, slot: "top" }],
        ctx,
      });
      expect(linen.wrote).toBe(false);
      expect(linen.ids).toEqual(base);
      expect(readJacketDraft(base, stamp)).toBeNull();
      expect(isLegal([piece(FLANNEL), piece(LINEN), piece(CORDS), piece(BOOTS)], { occasion: "weekend", season: "fall" })).toBe(false);

      const oversized = applyLookAskSwaps({
        ids: base,
        baseIds: base,
        stamp,
        closet: POOL,
        swaps: [{ fromId: FLANNEL, toId: NAVY_SWEATER, slot: "top" }],
        ctx,
      });
      expect(oversizedOf(piece(NAVY_SWEATER))).toBe(true);
      expect(oversized.wrote).toBe(false);
      expect(readJacketDraft(base, stamp)).toBeNull();

      const unowned = applyLookAskSwaps({
        ids: base,
        baseIds: base,
        stamp,
        closet: POOL,
        swaps: [{ fromId: FLANNEL, toId: "g_not_owned", slot: "top" }],
        ctx,
      });
      expect(unowned.wrote).toBe(false);

      const refused = applyLookAskSwaps({
        ids: base,
        baseIds: base,
        stamp,
        closet: POOL,
        swaps: [{ fromId: VEST, toId: LINEN, slot: "outerwear" }],
        ctx,
      });
      expect(refused.wrote).toBe(false);
      expect(readJacketDraft(base, stamp)).toBeNull();
    });
  });
}

describe("look ask shape and prompt", () => {
  it("cuts six lines to a verdict and at most three fixes and strips a score", () => {
    const shaped = shapeOutfitReply(["Works.", "Fix one.", "Fix two.", "Fix three.", "Fix four.", "Fix five.", "Fix six.", "8/10", "score", "rating"].join("\n"));
    expect(linesOf(shaped).length).toBeLessThanOrEqual(4);
    expect(shaped).not.toMatch(/8\/10|score|rating/i);
    expect(shapeOutfitReply(shaped)).toBe(shaped);
  });

  it("reads swaps from the capped tool result and from outId fields", () => {
    const steps: Trace[] = [
      {
        step: 1,
        call: { name: "closet_suggest_swap", args: {} },
        result: {
          ok: true,
          data: { swaps: { items: [{ slot: "top", out: { id: FLANNEL, label: "flannel" }, in: { id: "g_knit", label: "knit" } }], more: 0 } },
        },
      },
      {
        step: 2,
        call: { name: "closet_suggest_swap", args: {} },
        result: { ok: true, data: { swaps: [{ slot: "top", outId: FLANNEL, inId: "g_knit" }, { slot: "top", fromId: FLANNEL, toId: "g_knit" }] } },
      },
      {
        step: 3,
        call: { name: "closet_check_look", args: {} },
        result: { ok: true, data: { swaps: [{ fromId: FLANNEL, toId: "g_other", slot: "top" }] } },
      },
    ];
    expect(harvestLookSwaps(steps)).toEqual([{ fromId: FLANNEL, toId: "g_knit", slot: "top" }]);
  });

  it("measures the look-ask prompt and keeps photo check on the same bucket", () => {
    const size = lookAskPromptSizes(POOL, { route: "today", onScreenLookIds: VEST_IDS, occasion: "weekend", season: "fall" }, "can I tuck this?", VEST_IDS);
    expect(size.systemChars).toBeGreaterThan(500);
    expect(size.userChars).toBeGreaterThan(20);
    expect(size.tokens).toBe(Math.ceil(size.chars / 4));
    console.log(`[closet] lookAsk prompt chars=${size.chars} tokens~${size.tokens} system=${size.systemChars} user=${size.userChars} tools=${size.toolChars}`);
    expect(AI_FN_BUCKET.askAboutLook).toBe("outfit_check");
    expect(AI_FN_BUCKET.checkOutfit).toBe("outfit_check");
    expect(LOOK_ASK_SERVER_MS).toBe(25000);
    expect(LOOK_ASK_DEADLINE_MS).toBe(30000);
    const dock = readFileSync(new URL("../../components/shell/stylist-dock.tsx", import.meta.url), "utf8");
    expect(dock).toContain("checkOutfit");
    expect(dock).toContain("askAboutLook");
    expect(dock).toContain("askStylist");
    expect(dock).toContain("z-[70]");
    const sheet = readFileSync(new URL("../../components/closet/look-sheet.tsx", import.meta.url), "utf8");
    expect(sheet).toContain("Ask about this look");
    expect(sheet).toContain("data-undo-swap");
    expect(sheet).not.toContain("function slotOf");
  });

  it("puts the sheet tuck mark on the striped-shirt look", () => {
    const pieces = STRIPE_IDS.map(piece);
    const tucked = lookAskUser("can I tuck this?", pieces, POOL, "weekday");
    expect(tucked).toContain(`${STRIPE} |`);
    expect(tucked).toContain(`${DENIM} |`);
    expect(tucked).toContain("Shown on the sheet as: tucked");
    expect(tucked).toContain("Call closet_check_look on these ids first.");
    expect(lookAskUser("can I tuck this?", pieces, POOL, "weekend")).toContain("Shown on the sheet as: untucked");
    const taste = emptyTaste();
    taste.vetoes.push({ kind: "habit", id: STRIPE, habit: "never tuck", source: "ask" });
    expect(lookAskUser("can I tuck this?", pieces, POOL, "weekday", tuckHabitIds(taste))).toContain("Shown on the sheet as: untucked");
    expect(lookAskUser("can I tuck this?", [piece(STRIPE)], POOL, "weekday")).toContain("Shown on the sheet as: no tuck mark");
  });

  it("answers a tuck question yes or no and drops a tuck the sheet already shows", () => {
    const tucked = shapeLookAskReply("Works.\nTuck the light blue striped shirt.", "can I tuck this?", "tucked");
    expect(linesOf(tucked)[0]).toMatch(/^yes\b/i);
    expect(tucked).not.toMatch(/^works\b/im);
    expect(tucked.toLowerCase()).not.toMatch(/tuck the\b/);
    expect(tucked).not.toBe("Works.\nTuck the light blue striped shirt.");
    const kept = shapeLookAskReply("Almost.\nTuck the shirt.\nLeave the brown leather boots.", "can I tuck this?", "tucked");
    expect(kept).toBe("Yes.\nLeave the brown leather boots.");
    const untucked = shapeLookAskReply("Works.\nUntuck the light blue striped shirt.", "can I tuck this?", "untucked");
    expect(linesOf(untucked)[0]).toMatch(/^no\b/i);
    expect(untucked.toLowerCase()).not.toMatch(/\buntuck\b/);
  });

  it("lets a look ask skip closet_weather_now when the page already has a reading", () => {
    const withReading = lookAskSystem(POOL, { route: "today", onScreenLookIds: STRIPE_IDS, weatherF: 48 });
    expect(withReading).toMatch(/you may answer rain from that reading/i);
    expect(withReading).toMatch(/You do not have to call closet_weather_now/);
    const without = lookAskSystem(POOL, { route: "today", onScreenLookIds: STRIPE_IDS });
    expect(without).toMatch(/closet_weather_now when the question is about rain or weather/);
    expect(without).not.toMatch(/You do not have to call closet_weather_now/);
  });
});

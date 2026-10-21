/**
 * Round 2 on the owner's real closet: the xAI adapter (tools, messages, replies, bad JSON),
 * the server core (a gate per model call, the reasons, the deadline, no note written), the
 * switch (its own key, off by default) and the dock router (today's order off, the assistant
 * first on, the total wait inside the deadline). No live xAI and no network: the POST is a
 * scripted fake that records every body it is handed.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_SNAPSHOT_COUNT, testCloset } from "../__fixtures__/snapshot.ts";
import { SIGNED_OUT } from "../auth/ai-quota.ts";
import { HOUSE_WORDS, RULE_ID } from "../outfit-check.ts";
import { livePool } from "../rack.ts";
import { seasonFromWeather } from "../season.ts";
import { addNote, listActive, memoryNotes } from "../stylist-notes/notes.ts";
import { NOT_IN_CLOSET, scrubHouseNames } from "../stylist-page.ts";
import { ASK_DEADLINE_MS, type LocalReply } from "../stylist-session.ts";
import { isLegal } from "../stylist/legal.ts";
import type { Garment } from "../types.ts";
import { ASSISTANT_SWITCH_KEY, readAssistantSwitch, subscribeAssistantSwitch, writeAssistantSwitch } from "../assistant-switch.ts";
import type { ModelMessage, ModelReply } from "./loop.ts";
import { NOT_OWNED, runTool, toModelTools, type AssistantCtx } from "./registry.ts";
import { ASSISTANT_SHARE_MS, askThroughSwitch } from "./route.ts";
import {
  ASSISTANT_MODELS,
  ASSISTANT_SERVER_MS,
  MODEL_ERROR,
  TIMEOUT_ERROR,
  askAssistantCore,
  historyMessages,
  type AssistantAskInput,
  type AssistantDeps,
} from "./serve.ts";
import { buildAssistantSystem } from "./system.ts";
import { assistantRegistry } from "./tools.ts";
import {
  AssistantQuotaError,
  fromXaiReply,
  parseArguments,
  toXaiMessages,
  toXaiTools,
  xaiModel,
  type XaiMessage,
  type XaiPost,
} from "./xai-adapter.ts";

const POOL: Garment[] = testCloset;
const DATE = "2026-10-21";
const WEATHER = 58;
const CORDS = "g_ayfv9c97ohmv";
const STRANGER = "g_notinthiscloset";

function piece(id: string): Garment {
  const g = POOL.find((p) => p.id === id);
  if (!g) throw new Error(`${id} is not in the snapshot`);
  return g;
}

/* xAI's shape for one reply, built from R1's ModelReply. */
function choice(reply: ModelReply, ids = (i: number) => `call_x_${i}`): unknown {
  const message: Record<string, unknown> = { role: "assistant", content: reply.text ?? null };
  if (reply.toolCalls?.length) {
    message.tool_calls = reply.toolCalls.map((c, i) => ({
      id: ids(i),
      type: "function",
      function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
    }));
  }
  return { choices: [{ message }] };
}

type Body = { model: string; messages: XaiMessage[]; tools: unknown[]; tool_choice: string; max_tokens: number; temperature: number };

/** A scripted POST: `script` sees the body's messages and answers like the model would. */
function scriptedPost(script: (messages: XaiMessage[], body: Body) => ModelReply | { fail: string }) {
  const bodies: Body[] = [];
  const post: XaiPost = async (raw) => {
    const body = raw as Body;
    bodies.push(body);
    const reply = script(body.messages, body);
    if ("fail" in reply) return { ok: false, json: null, error: reply.fail };
    return { ok: true, json: choice(reply) };
  };
  return { post, bodies };
}

/** The last tool observation in an xAI message list, parsed. */
function lastTool(messages: XaiMessage[]): any {
  const last = messages.at(-1)!;
  return last.role === "tool" ? JSON.parse(last.content) : null;
}

/** A model that dresses for the occasion, then answers with the look's labels and a LOOK row. */
function dresser(occasion: "weekday" | "out" | "weekend" = "weekday") {
  return (messages: XaiMessage[]): ModelReply => {
    const seen = lastTool(messages);
    if (!seen) return { toolCalls: [{ name: "closet_build_look", args: { prompt: "what do I wear", occasion } }] };
    const d = seen.data;
    const labels = d.pieces.map((p: { label: string }) => `the ${p.label}`).join(", ");
    return { text: `For ${occasion}: ${labels}.\nLOOK: ${d.pieces.map((p: { id: string }) => p.id).join(",")}` };
  };
}

function depsOf(post: XaiPost, over: Partial<AssistantDeps> = {}) {
  const gate = vi.fn(async () => ({ ok: true as const }));
  const loadNotes = vi.fn(async () => []);
  const deps: AssistantDeps = { post, gate, loadNotes, hasKey: true, date: DATE, ...over };
  return { deps, gate, loadNotes };
}

function inputOf(over: Partial<AssistantAskInput> = {}): AssistantAskInput {
  return { prompt: "what do I wear today", garments: POOL, page: { route: "today", onScreenLookIds: [], weatherF: WEATHER }, ...over };
}

const SEASON = seasonFromWeather(WEATHER, new Date(`${DATE}T12:00:00`));
const CLOSET_KEY = "closet" + ".v6";
const META_KEY = "closet" + "_meta";
const STORE_WORD = "local" + "Storage";

describe("the snapshot", () => {
  it("is the owner's closet, counted from the fixture", () => {
    expect(POOL.length).toBe(LIVE_SNAPSHOT_COUNT);
    expect(livePool(POOL).length).toBe(LIVE_SNAPSHOT_COUNT);
    expect(piece(CORDS).id).toBe(CORDS);
    expect(POOL.some((g) => g.id === STRANGER)).toBe(false);
  });
});

describe("xai adapter", () => {
  it("lists the twelve read tools as functions with their names and schemas", () => {
    const tools = toXaiTools(toModelTools(assistantRegistry));
    expect(tools.length).toBe(12);
    expect(tools.every((t) => t.type === "function" && t.function.name.startsWith("closet_"))).toBe(true);
    expect(tools.map((t) => t.function.name)).toEqual(assistantRegistry.list.map((t) => t.name));
    expect(tools.find((t) => t.function.name === "closet_check_look")?.function.parameters).toMatchObject({ type: "object", required: ["ids"] });
  });

  it("maps a reply with tool_calls to toolCalls with parsed args, and content to text", () => {
    const withCalls = fromXaiReply(choice({ toolCalls: [{ name: "closet_get_piece", args: { id: CORDS } }] }));
    expect(withCalls.toolCalls).toEqual([{ name: "closet_get_piece", args: { id: CORDS } }]);
    expect(withCalls.text).toBeUndefined();
    const text = fromXaiReply(choice({ text: "Wear the cords." }));
    expect(text).toEqual({ text: "Wear the cords." });
    expect(fromXaiReply(null)).toEqual({ text: "" });
    expect(fromXaiReply({ choices: [] })).toEqual({ text: "" });
  });

  it("round-trips tool messages with the call id of the assistant turn that asked", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "ask" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { name: "closet_get_piece", args: { id: CORDS } },
          { name: "closet_weather_now", args: {} },
        ],
      },
      { role: "tool", name: "closet_get_piece", content: "{\"ok\":true}" },
      { role: "tool", name: "closet_weather_now", content: "{\"ok\":true}" },
      { role: "assistant", content: "", toolCalls: [{ name: "closet_search_pieces", args: { query: "cords" } }] },
      { role: "tool", name: "closet_search_pieces", content: "{\"ok\":false}" },
    ];
    const out = toXaiMessages(messages);
    expect(out.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "tool", "assistant", "tool"]);
    const first = out[2] as Extract<XaiMessage, { role: "assistant" }>;
    expect(first.tool_calls?.map((c) => c.id)).toEqual(["call_1_0", "call_1_1"]);
    expect(first.tool_calls?.[0]?.function).toEqual({ name: "closet_get_piece", arguments: JSON.stringify({ id: CORDS }) });
    expect(out[3]).toEqual({ role: "tool", tool_call_id: "call_1_0", content: "{\"ok\":true}" });
    expect(out[4]).toEqual({ role: "tool", tool_call_id: "call_1_1", content: "{\"ok\":true}" });
    const second = out[5] as Extract<XaiMessage, { role: "assistant" }>;
    expect(second.tool_calls?.[0]?.id).toBe("call_2_0");
    expect(out[6]).toEqual({ role: "tool", tool_call_id: "call_2_0", content: "{\"ok\":false}" });
    const ids = new Set(out.filter((m) => m.role === "tool").map((m) => (m as { tool_call_id: string }).tool_call_id));
    expect(ids.size).toBe(3);
  });

  it("turns arguments that will not parse into a structured runTool error, not a throw", async () => {
    const reply = fromXaiReply({
      choices: [{ message: { tool_calls: [{ id: "c", type: "function", function: { name: "closet_get_piece", arguments: "{not json" } }] } }],
    });
    expect(reply.toolCalls?.[0]?.args).toEqual({ __unparsed: "{not json" });
    expect(parseArguments("")).toEqual({});
    const ctx: AssistantCtx = {
      pool: POOL,
      taste: { } as AssistantCtx["taste"],
      page: { route: "today", onScreenLookIds: [] },
      notes: memoryNotes(),
      today: { drop: null, garments: POOL },
      date: DATE,
    };
    const result = await runTool(assistantRegistry, ctx, reply.toolCalls![0]!.name, reply.toolCalls![0]!.args);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toMatch(/Fix the arguments for closet_get_piece/);
  });

  it("posts with tool_choice auto, 400 tokens and 0.4, and moves to the next model only on a failed post", async () => {
    const seen: string[] = [];
    const post: XaiPost = async (raw) => {
      const body = raw as Body;
      seen.push(body.model);
      if (body.model !== "grok-4") return { ok: false, json: null, error: "down" };
      expect(body.tool_choice).toBe("auto");
      expect(body.max_tokens).toBe(400);
      expect(body.temperature).toBe(0.4);
      return { ok: true, json: choice({ text: "ok" }) };
    };
    const model = xaiModel(post, { models: ASSISTANT_MODELS, beforeCall: async () => true });
    const reply = await model([{ role: "user", content: "x" }], toModelTools(assistantRegistry));
    expect(reply).toEqual({ text: "ok" });
    expect(seen).toEqual([...ASSISTANT_MODELS]);
    const refused = xaiModel(post, { models: ASSISTANT_MODELS, beforeCall: async () => false });
    await expect(refused([{ role: "user", content: "x" }], [])).rejects.toBeInstanceOf(AssistantQuotaError);
  });
});

describe("server core", () => {
  it("takes the gate once per model call: a three-round run spends three units", async () => {
    let round = 0;
    const { post, bodies } = scriptedPost((messages) => {
      round += 1;
      if (round === 1) return { toolCalls: [{ name: "closet_get_piece", args: { id: CORDS } }] };
      if (round === 2) return { toolCalls: [{ name: "closet_build_look", args: { prompt: "work", occasion: "weekday" } }] };
      const d = lastTool(messages).data;
      return { text: `Weekday: ${d.pieces.map((p: { label: string }) => `the ${p.label}`).join(", ")}.\nLOOK: ${d.pieces.map((p: { id: string }) => p.id).join(",")}` };
    });
    const { deps, gate } = depsOf(post);
    const res = await askAssistantCore(inputOf(), deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(gate).toHaveBeenCalledTimes(3);
    expect(res.modelCalls).toBe(3);
    expect(bodies.length).toBe(3);
    expect(res.stopReason).toBe("answer");
    expect(res.garmentIds.length).toBeGreaterThanOrEqual(2);
    expect(bodies[0]!.messages[0]).toEqual({ role: "system", content: buildAssistantSystem({ pool: POOL, page: inputOf().page }) });
  });

  it("stops with reason quota when the gate says no on the second call, with no more posts", async () => {
    const { post, bodies } = scriptedPost(() => ({ toolCalls: [{ name: "closet_get_piece", args: { id: CORDS } }] }));
    let n = 0;
    const gate = vi.fn(async () => (++n === 2 ? { ok: false as const, error: "Too many requests. Try again in 12 min." } : { ok: true as const }));
    const { deps } = depsOf(post, { gate });
    const res = await askAssistantCore(inputOf(), deps);
    expect(res).toEqual({ ok: false, error: "Too many requests. Try again in 12 min.", reason: "quota" });
    expect(gate).toHaveBeenCalledTimes(2);
    expect(bodies.length).toBe(1);
  });

  it("reads a signed-out gate as signed_out, before any post", async () => {
    const { post, bodies } = scriptedPost(() => ({ text: "x" }));
    const gate = vi.fn(async () => ({ ok: false as const, error: SIGNED_OUT }));
    const { deps } = depsOf(post, { gate });
    const res = await askAssistantCore(inputOf(), deps);
    expect(res).toEqual({ ok: false, error: SIGNED_OUT, reason: "signed_out" });
    expect(bodies.length).toBe(0);
  });

  it("answers no_key without a gate or a post, and empty for a closet with nothing live", async () => {
    const { post, bodies } = scriptedPost(() => ({ text: "x" }));
    const { deps, gate, loadNotes } = depsOf(post, { hasKey: false });
    const res = await askAssistantCore(inputOf(), deps);
    expect(res).toMatchObject({ ok: false, reason: "no_key" });
    expect(gate).toHaveBeenCalledTimes(0);
    expect(loadNotes).toHaveBeenCalledTimes(0);
    expect(bodies.length).toBe(0);
    const keyed = depsOf(post);
    const empty = await askAssistantCore(inputOf({ garments: POOL.map((g) => ({ ...g, archived: true })) }), keyed.deps);
    expect(empty).toMatchObject({ ok: false, reason: "empty" });
    expect(keyed.gate).toHaveBeenCalledTimes(1);
    expect(keyed.loadNotes).toHaveBeenCalledTimes(0);
  });

  it("refuses a signed-out caller before any data is read: no garments, no notes, no post", async () => {
    const { post, bodies } = scriptedPost(() => ({ text: "x" }));
    const gate = vi.fn(async () => ({ ok: false as const, error: SIGNED_OUT }));
    const loadNotes = vi.fn(async () => []);
    const readGarments = vi.fn(() => POOL);
    const input = inputOf();
    delete input.garments;
    Object.defineProperty(input, "garments", { get: readGarments, enumerable: true });
    const res = await askAssistantCore(input, depsOf(post, { gate, loadNotes }).deps);
    expect(res).toEqual({ ok: false, error: SIGNED_OUT, reason: "signed_out" });
    expect(gate).toHaveBeenCalledTimes(1);
    expect(loadNotes).toHaveBeenCalledTimes(0);
    expect(readGarments).toHaveBeenCalledTimes(0);
    expect(bodies.length).toBe(0);
  });

  it("reports model when every model fails a call, and timeout once the deadline has passed", async () => {
    const { post, bodies } = scriptedPost(() => ({ fail: "down" }));
    const { deps } = depsOf(post);
    const res = await askAssistantCore(inputOf(), deps);
    expect(res).toEqual({ ok: false, error: MODEL_ERROR, reason: "model" });
    expect(bodies.length).toBe(ASSISTANT_MODELS.length);
    let clock = 1_000_000;
    const slow = scriptedPost(() => {
      clock += ASSISTANT_SERVER_MS;
      return { toolCalls: [{ name: "closet_get_piece", args: { id: CORDS } }] };
    });
    const late = await askAssistantCore(inputOf(), depsOf(slow.post, { now: () => clock }).deps);
    expect(late).toMatchObject({ ok: false, reason: "timeout" });
    expect(slow.bodies.length).toBe(1);
  });

  it("refuses a final text naming a piece not in the closet, with no ids", async () => {
    const { post } = scriptedPost(() => ({ text: "Wear the green tweed jacket with the tan chinos." }));
    const res = await askAssistantCore(inputOf(), depsOf(post).deps);
    expect(res).toMatchObject({ ok: true, text: NOT_IN_CLOSET, garmentIds: [] });
  });

  it("hands a tool call with a stranger's id the registry's not-owned error, which the next post carries", async () => {
    let round = 0;
    const { post, bodies } = scriptedPost(() => {
      round += 1;
      if (round === 1) return { toolCalls: [{ name: "closet_get_piece", args: { id: STRANGER } }] };
      return { text: "I can only read pieces in this closet." };
    });
    const res = await askAssistantCore(inputOf(), depsOf(post).deps);
    expect(res.ok).toBe(true);
    expect(bodies.length).toBe(2);
    const observed = lastTool(bodies[1]!.messages);
    expect(observed).toEqual({ ok: false, error: NOT_OWNED });
  });

  it("scrubs a house word that reaches the final text, and the output carries no house word or rule id", async () => {
    const word = HOUSE_WORDS.source.match(/\(([^)]+)\)/)![1]!.split("|").find((w) => scrubHouseNames(w) === "")!;
    expect(word).toBeTruthy();
    const { post } = scriptedPost(() => ({ text: `Wear the tan chinos with the brown suede loafers, ${word} style.` }));
    const res = await askAssistantCore(inputOf(), depsOf(post).deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.text).not.toMatch(HOUSE_WORDS);
    expect(res.text).not.toMatch(RULE_ID);
    expect(res.text).toMatch(/tan chinos/);
  });

  it("builds a look of owned pieces that is legal for its occasion", async () => {
    const { post } = scriptedPost(dresser("weekday"));
    const res = await askAssistantCore(inputOf({ page: { route: "lookbook", occasion: "weekday", onScreenLookIds: [], weatherF: WEATHER } }), depsOf(post).deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.text).not.toBe(NOT_IN_CLOSET);
    expect(res.occasion).toBe("weekday");
    expect(res.garmentIds.length).toBeGreaterThanOrEqual(2);
    const owned = new Set(POOL.map((g) => g.id));
    expect(res.garmentIds.every((id) => owned.has(id))).toBe(true);
    expect(isLegal(res.garmentIds.map(piece), { occasion: res.occasion, season: SEASON, weatherF: WEATHER })).toBe(true);
    const fromPrompt = await askAssistantCore(inputOf({ prompt: "dinner out on Friday", page: { route: "today", onScreenLookIds: [] } }), depsOf(scriptedPost(dresser("out")).post).deps);
    expect(fromPrompt.ok && fromPrompt.occasion).toBe("out");
  });

  it("sends the last eight thread turns, cut to 1200 characters, as user and assistant", async () => {
    const thread = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? ("stylist" as const) : ("user" as const), text: `turn ${i} ${"x".repeat(1300)}` }));
    const history = historyMessages(thread);
    expect(history.length).toBe(8);
    expect(history[0]).toMatchObject({ role: "user" });
    expect(history[1]).toMatchObject({ role: "assistant" });
    expect(history[0]!.content.startsWith("turn 2 ")).toBe(true);
    expect(history.every((m) => m.content.length === 1200)).toBe(true);
    const { post, bodies } = scriptedPost(() => ({ text: "x" }));
    await askAssistantCore(inputOf({ thread }), depsOf(post).deps);
    const roles = bodies[0]!.messages.map((m) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "user", "assistant", "user", "assistant", "user", "assistant", "user"]);
  });

  it("recalls the seeded notes and writes none: the backend holds the same rows after the run", async () => {
    const backend = memoryNotes();
    await addNote(backend, { text: "never a bow tie", kind: "never", topic: "bow tie", source: "stated" }, Date.parse("2026-10-20T12:00:00Z"));
    await addNote(backend, { text: "lean to brown shoes", kind: "lean", topic: "shoes", source: "stated" }, Date.parse("2026-10-20T12:01:00Z"));
    const before = JSON.stringify(backend.all());
    let round = 0;
    const { post, bodies } = scriptedPost(() => {
      round += 1;
      if (round === 1) return { toolCalls: [{ name: "closet_memory_recall", args: { query: "shoes" } }] };
      return { text: "You lean to the brown suede loafers." };
    });
    const loadNotes = vi.fn(() => listActive(backend));
    const res = await askAssistantCore(inputOf(), depsOf(post, { loadNotes }).deps);
    expect(res.ok).toBe(true);
    expect(loadNotes).toHaveBeenCalledTimes(1);
    const recalled = lastTool(bodies[1]!.messages);
    expect(recalled.ok).toBe(true);
    expect(recalled.data.active).toBe(2);
    expect(recalled.data.notes.items.map((n: { text: string }) => n.text)).toContain("lean to brown shoes");
    expect(JSON.stringify(backend.all())).toBe(before);
    expect((await listActive(backend)).length).toBe(2);
  });

  it("aborts the run 6000 ms after the ask began, not 6000 ms after a slow notes read", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      const start = Date.now();
      let abortedAt: number | undefined;
      const bodies: unknown[] = [];
      const post: XaiPost = (body, signal) => {
        bodies.push(body);
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            abortedAt = Date.now() - start;
            reject(new Error("aborted"));
          });
        });
      };
      const loadNotes = () => new Promise<never[]>((resolve) => setTimeout(() => resolve([]), 2900));
      const pending = askAssistantCore(inputOf(), depsOf(post, { loadNotes, now: () => Date.now() }).deps);
      await vi.advanceTimersByTimeAsync(2900);
      expect(bodies.length).toBe(1);
      await vi.advanceTimersByTimeAsync(ASSISTANT_SERVER_MS - 2900 - 1);
      expect(abortedAt).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      const res = await pending;
      expect(abortedAt).toBe(ASSISTANT_SERVER_MS);
      expect(res).toEqual({ ok: false, error: TIMEOUT_ERROR, reason: "timeout" });
      expect(bodies.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never hands the client the upstream error: a failed post gives the generic model error", async () => {
    const { post, bodies } = scriptedPost(() => ({ fail: "Incorrect API key provided: xa***yz" }));
    const res = await askAssistantCore(inputOf(), depsOf(post).deps);
    expect(res).toEqual({ ok: false, error: MODEL_ERROR, reason: "model" });
    expect(bodies.length).toBe(ASSISTANT_MODELS.length);
    expect(JSON.stringify(res)).not.toMatch(/API key/);
    expect(JSON.stringify(res)).not.toMatch(/xa\*\*\*yz/);
  });

  it("goes on without notes when the loader hangs past its race", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      const { post } = scriptedPost(() => ({ text: "Wear the tan chinos." }));
      const loadNotes = () => new Promise<never[]>(() => {});
      const pending = askAssistantCore(inputOf(), depsOf(post, { loadNotes }).deps);
      await vi.advanceTimersByTimeAsync(3000);
      const res = await pending;
      expect(res.ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("switch", () => {
  const fake = () => {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      map,
    };
  };
  let saved: unknown;
  beforeEach(() => {
    saved = (globalThis as any).window;
  });
  afterEach(() => {
    if (saved === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = saved;
  });

  it("has its own key, apart from the closet's", () => {
    expect(ASSISTANT_SWITCH_KEY).not.toBe(CLOSET_KEY);
    expect(ASSISTANT_SWITCH_KEY.includes(CLOSET_KEY)).toBe(false);
    expect(ASSISTANT_SWITCH_KEY.includes(META_KEY)).toBe(false);
  });

  it("reads false with no window and false by default, and round-trips a write", () => {
    delete (globalThis as any).window;
    expect(readAssistantSwitch()).toBe(false);
    writeAssistantSwitch(true);
    expect(readAssistantSwitch()).toBe(false);
    const store = fake();
    (globalThis as any).window = { [STORE_WORD]: store, addEventListener() {}, removeEventListener() {} };
    expect(readAssistantSwitch()).toBe(false);
    const seen = vi.fn();
    const off = subscribeAssistantSwitch(seen);
    writeAssistantSwitch(true);
    expect(readAssistantSwitch()).toBe(true);
    expect(store.getItem(ASSISTANT_SWITCH_KEY)).toBe("1");
    expect(seen).toHaveBeenCalledTimes(1);
    writeAssistantSwitch(false);
    expect(readAssistantSwitch()).toBe(false);
    expect([...store.map.keys()]).toEqual([]);
    store.setItem(ASSISTANT_SWITCH_KEY, "yes");
    expect(readAssistantSwitch()).toBe(false);
    off();
    writeAssistantSwitch(true);
    expect(seen).toHaveBeenCalledTimes(2);
    expect([...store.map.keys()]).toEqual([ASSISTANT_SWITCH_KEY]);
  });
});

describe("dock router", () => {
  const LOCAL: LocalReply = { text: "from the closet", garmentIds: [CORDS], occasion: "weekday", technique: null };
  const hang = <T,>() => new Promise<T>(() => {});
  type A = { ok: true; text: string } | { ok: false; error: string; reason: string };
  type S = { ok: true; text: string } | { ok: false; error: string };

  function legs(over: Partial<Parameters<typeof askThroughSwitch<A, S>>[0]> = {}) {
    const askAssistant = vi.fn(async (): Promise<A> => ({ ok: true, text: "assistant" }));
    const askStylist = vi.fn(async (): Promise<S> => ({ ok: true, text: "stylist" }));
    const local = vi.fn((): LocalReply | null => LOCAL);
    const remember = vi.fn();
    const opts = { on: false, askAssistant, askStylist, local, remember, ...over };
    return { opts, askAssistant: opts.askAssistant, askStylist: opts.askStylist, local: opts.local, remember: opts.remember };
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("off: remembers once, asks the stylist, never the assistant", async () => {
    const l = legs({ on: false });
    const out = await askThroughSwitch(l.opts);
    expect(out).toEqual({ via: "stylist", result: { ok: true, text: "stylist" } });
    expect(l.remember).toHaveBeenCalledTimes(1);
    expect(l.askAssistant).toHaveBeenCalledTimes(0);
    expect(l.askStylist).toHaveBeenCalledTimes(1);
    expect(l.local).toHaveBeenCalledTimes(0);
  });

  it("off: a stylist that fails or hangs falls to the closet, as today", async () => {
    const failed = legs({ on: false, askStylist: vi.fn(async () => { throw new Error("boom"); }) });
    expect(await askThroughSwitch(failed.opts)).toEqual({ via: "local", result: LOCAL });
    const hung = legs({ on: false, askStylist: vi.fn(() => hang<S>()) });
    const pending = askThroughSwitch(hung.opts);
    await vi.advanceTimersByTimeAsync(ASK_DEADLINE_MS);
    expect(await pending).toEqual({ via: "local", result: LOCAL });
    expect(hung.remember).toHaveBeenCalledTimes(1);
  });

  it("on: the assistant answers and remember is never called", async () => {
    const l = legs({ on: true });
    const out = await askThroughSwitch(l.opts);
    expect(out).toEqual({ via: "assistant", result: { ok: true, text: "assistant" } });
    expect(l.remember).toHaveBeenCalledTimes(0);
    expect(l.askStylist).toHaveBeenCalledTimes(0);
    expect(l.local).toHaveBeenCalledTimes(0);
  });

  it("on: a thrown assistant or an ok:false (no_key) goes to the stylist, with remember still off", async () => {
    const thrown = legs({ on: true, askAssistant: vi.fn(async () => { throw new Error("boom"); }) });
    expect(await askThroughSwitch(thrown.opts)).toMatchObject({ via: "stylist", result: { ok: true, text: "stylist" } });
    expect(thrown.remember).toHaveBeenCalledTimes(0);
    const noKey = legs({ on: true, askAssistant: vi.fn(async (): Promise<A> => ({ ok: false, error: "no key", reason: "no_key" })) });
    const out = await askThroughSwitch(noKey.opts);
    expect(out).toEqual({ via: "stylist", result: { ok: true, text: "stylist" }, fallbackFrom: "assistant: no_key" });
    expect(noKey.remember).toHaveBeenCalledTimes(0);
    expect(noKey.askStylist).toHaveBeenCalledTimes(1);
  });

  it("on: an assistant that hangs gives way to the stylist inside the deadline", async () => {
    const l = legs({ on: true, askAssistant: vi.fn(() => hang<A>()) });
    const started = Date.now();
    const pending = askThroughSwitch(l.opts);
    await vi.advanceTimersByTimeAsync(ASSISTANT_SHARE_MS - 1);
    expect(l.askStylist).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    const out = await pending;
    expect(out).toMatchObject({ via: "stylist", result: { ok: true, text: "stylist" } });
    expect(Date.now() - started).toBeLessThanOrEqual(ASK_DEADLINE_MS);
    expect(l.remember).toHaveBeenCalledTimes(0);
  });

  it("on: both hanging falls to the closet with the total wait at most the deadline", async () => {
    const l = legs({ on: true, askAssistant: vi.fn(() => hang<A>()), askStylist: vi.fn(() => hang<S>()) });
    const started = Date.now();
    let settled: unknown = null;
    const pending = askThroughSwitch(l.opts).then((r) => (settled = r));
    await vi.advanceTimersByTimeAsync(ASK_DEADLINE_MS - 1);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toMatchObject({ via: "local", result: LOCAL });
    expect(Date.now() - started).toBe(ASK_DEADLINE_MS);
    expect(l.askStylist).toHaveBeenCalledTimes(1);
    const none = legs({ on: true, askAssistant: vi.fn(() => hang<A>()), askStylist: vi.fn(() => hang<S>()), local: vi.fn(() => null) });
    const p2 = askThroughSwitch(none.opts);
    await vi.advanceTimersByTimeAsync(ASK_DEADLINE_MS);
    expect(await p2).toMatchObject({ via: "none", result: null });
  });
});

describe("source pins", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

  it("the server function gates before it fetches, imports nothing from the stylist's server module, and is the only file that fetches", () => {
    const src = read("../assistant-ask.ts");
    const block = src.slice(src.indexOf("export const askAssistant"));
    expect(block).toMatch(/\.middleware\(\[closetCaller\]\)/);
    const gateAt = block.indexOf("callerGate(");
    const fetchAt = block.indexOf("fe" + "tch(");
    expect(gateAt).toBeGreaterThan(0);
    expect(fetchAt).toBeGreaterThan(gateAt);
    expect(src).not.toMatch(/from "\.\/ai"/);
    expect(src).not.toContain("addNote");
    expect(src).not.toContain("deleteNote");
    expect(src).not.toContain("rememberFromAsk");
    expect(src).not.toContain(CLOSET_KEY);
    expect(src).not.toContain(META_KEY);
  });

  it("the switch lives outside src/lib/assistant and touches only its own key", () => {
    const src = read("../assistant-switch.ts");
    expect(src).not.toContain(CLOSET_KEY);
    expect(src).not.toContain(META_KEY);
    expect(src).not.toMatch(/import [^\n]*(zustand|persist|store)/);
    expect(src.split(STORE_WORD).length - 1).toBeGreaterThan(0);
  });

  it("the core and the router never write a note or remember an ask", () => {
    for (const rel of ["./serve.ts", "./route.ts", "./xai-adapter.ts"]) {
      const src = read(rel);
      expect(src, rel).not.toContain("addNote");
      expect(src, rel).not.toContain("deleteNote");
      expect(src, rel).not.toContain("rememberFromAsk");
    }
  });
});

/**
 * The stylist's ask always answers in time. The server (askStylistCore, stylist-ask.ts) runs
 * the notes read beside the prompt build and caps it at NOTES_TIMEOUT_MS, asks one model with
 * the budget that is left, a second only if MIN_MODEL_MS remain, and composes the answer from
 * the closet when no model answers; it reports where the answer came from and the time each
 * phase took. With the fetch stubbed to hang, the worst case ends inside SERVER_DEADLINE_MS,
 * which is under the client's ASK_DEADLINE_MS, so the dock's "thinking…" always turns into an
 * answer. Live latency is UNVERIFIED here: no key, no network; the per-phase log is the stub's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_MODEL_MS, NOTES_TIMEOUT_MS, SERVER_DEADLINE_MS } from "./ai-budget.ts";
import { askStylistCore, CHAT_MODELS, phasesLine, type ChatFn } from "./stylist-ask.ts";
import { ASK_DEADLINE_MS, ASK_MARGIN_MS } from "./stylist-session.ts";
import { emptyTaste } from "./taste.ts";
import type { Garment } from "./types.ts";
import { liveSnapshot } from "./__fixtures__/snapshot.ts";

const CLOSET: Garment[] = liveSnapshot;

/** A model call that never returns until its signal aborts it. */
const hanging: ChatFn = ({ signal }) =>
  new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve({ ok: false, text: "", error: "aborted" }), { once: true });
  });

/** A notes read that never settles. */
const hangingNotes = () => new Promise<never>(() => {});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T15:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the ask's time budget", () => {
  it("the client waits the server's deadline plus a margin", () => {
    expect(ASK_DEADLINE_MS).toBe(SERVER_DEADLINE_MS + ASK_MARGIN_MS);
    expect(SERVER_DEADLINE_MS).toBeLessThan(ASK_DEADLINE_MS);
    expect(NOTES_TIMEOUT_MS).toBeLessThan(1500 + 1);
    expect(MIN_MODEL_MS).toBeLessThan(SERVER_DEADLINE_MS);
  });

  it("with the fetch and the notes hanging, the server answers from the closet inside its deadline, before the client gives up", async () => {
    const started = Date.now();
    let answeredAt = 0;
    const pending = askStylistCore(
      { prompt: "What should I wear today?", garments: CLOSET, taste: emptyTaste(), weatherF: 58 },
      { chat: hanging, loadNotes: hangingNotes },
    );
    let settled: Awaited<typeof pending> | null = null;
    void pending.then((r) => {
      settled = r;
      answeredAt = Date.now();
    });
    /* Just short of the deadline nothing has answered: the models are still hanging. */
    await vi.advanceTimersByTimeAsync(SERVER_DEADLINE_MS - 1);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(ASK_MARGIN_MS);
    const result = await pending;
    const took = answeredAt - started;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe("closet");
    expect(result.garmentIds.length).toBeGreaterThanOrEqual(3);
    for (const id of result.garmentIds) expect(CLOSET.some((g) => g.id === id)).toBe(true);
    const total = result.phases.reduce((s, p) => s + p.ms, 0);
    console.log(`stylist ask, fetch stubbed to hang: ${phasesLine(result.phases)} (total ${total} ms; client deadline ${ASK_DEADLINE_MS} ms; live latency UNVERIFIED)`);
    expect(took).toBeLessThanOrEqual(SERVER_DEADLINE_MS + 1);
    expect(total).toBeLessThanOrEqual(SERVER_DEADLINE_MS + 1);
    expect(total).toBeLessThan(ASK_DEADLINE_MS);
    /* The notes read gave up at its cap, one model got the rest of the budget, no second model started (too little left). */
    const notes = result.phases.find((p) => p.phase === "notes")!;
    expect(notes.ms).toBeLessThanOrEqual(NOTES_TIMEOUT_MS + 1);
    const models = result.phases.filter((p) => p.phase.startsWith("model:"));
    expect(models.length).toBe(1);
    expect(models[0]!.phase).toBe(`model:${CHAT_MODELS[0]}`);
    expect(models[0]!.ms).toBeLessThanOrEqual(SERVER_DEADLINE_MS - notes.ms + 1);
  });

  it("a model that answers in time is a live answer; a failed first model hands what is left to the second", async () => {
    const calls: string[] = [];
    const quick: ChatFn = async ({ model }) => {
      calls.push(model);
      return { ok: true, text: "Wear the first look.\nLOOK: " + CLOSET.slice(0, 3).map((g) => g.id).join(","), error: "" };
    };
    const live = await askStylistCore({ prompt: "dinner", garments: CLOSET, taste: emptyTaste() }, { chat: quick, loadNotes: async () => [] });
    expect(live.ok && live.source).toBe("live");
    expect(calls).toEqual([CHAT_MODELS[0]]);

    const failing: ChatFn = async ({ model }) => {
      calls.push(model);
      return model === CHAT_MODELS[0] ? { ok: false, text: "", error: "503" } : { ok: true, text: "LOOK: " + CLOSET.slice(0, 3).map((g) => g.id).join(","), error: "" };
    };
    calls.length = 0;
    const second = await askStylistCore({ prompt: "dinner", garments: CLOSET, taste: emptyTaste() }, { chat: failing, loadNotes: async () => [] });
    expect(second.ok && second.source).toBe("live");
    expect(calls).toEqual([CHAT_MODELS[0], CHAT_MODELS[1]]);
  });

  it("with no key (no chat) the closet answers at once and says so", async () => {
    const result = await askStylistCore({ prompt: "What should I wear today?", garments: CLOSET, taste: emptyTaste() }, { chat: null, loadNotes: async () => [] });
    expect(result.ok && result.source).toBe("closet");
    expect(result.phases.map((p) => p.phase)).toEqual(["resolve"]);
  });
});

/**
 * The server-side core of an ask to the assistant, with its dependencies injected: the POST,
 * the quota gate, the notes loader and whether a key exists. Pure in the same sense as the
 * rest of this folder (no env, no network, no account store): assistant-ask.ts wraps it in the
 * server function. The gate is taken once per model call through xaiModel's beforeCall, so an
 * ask that runs three model rounds spends three chat units, like three asks of askStylist. The
 * run sits under one deadline (ASSISTANT_SERVER_MS) so the dock's own 8 s wait is never the
 * first thing to give up. Nothing here writes a note: the notes backend is memoryNotes seeded
 * from the loader, read by closet_memory_recall and nothing else.
 */
/* tools.ts first: it imports lookbook.ts ahead of legal.ts, the order the engine resolves in. */
import { assistantRegistry } from "./tools.ts";
import type { GateResult } from "../auth/closet-caller.ts";
import { SIGNED_OUT } from "../auth/ai-quota.ts";
import { livePool } from "../rack.ts";
import type { StylistPageContext } from "../stylist-page.ts";
import { NOT_IN_CLOSET } from "../stylist-page.ts";
import { memoryNotes, type StylistNote } from "../stylist-notes/notes.ts";
import { emptyTaste, normalizeTaste, occasionFromPrompt, type TasteMemory } from "../taste.ts";
import type { TodayLookState } from "../today-look.ts";
import { OCCASIONS, type Garment, type Look, type Occasion } from "../types.ts";
import { todayISO } from "../utils.ts";
import { runAssistant, type ModelMessage, type StopReason } from "./loop.ts";
import type { AssistantCtx } from "./registry.ts";
import { buildAssistantSystem } from "./system.ts";
import { AssistantModelError, AssistantQuotaError, AssistantTimeoutError, xaiModel, type XaiPost } from "./xai-adapter.ts";

/** The same list, in the same order, as CHAT_MODELS in the stylist's ask module: the assistant falls back the way the stylist does. */
export const ASSISTANT_MODELS = ["grok-4.5", "grok-4.3", "grok-4"] as const;
/** The whole run's deadline, under the dock's 8 s wait. */
export const ASSISTANT_SERVER_MS = 6000;
/** How long the notes read may take before the ask goes on without them (NOTES_TIMEOUT_MS in the stylist's ask module). */
export const ASSISTANT_NOTES_MS = 3000;
/** The thread turns and the characters per turn the model sees, as askStylist cuts them. */
export const HISTORY_TURNS = 8;
export const HISTORY_CHARS = 1200;
/** An answer counts as a look only with this many owned pieces. */
export const MIN_LOOK_IDS = 2;

export type AssistantAskInput = {
  prompt: string;
  garments?: Garment[];
  taste?: TasteMemory;
  page?: StylistPageContext;
  weatherF?: number;
  thread?: { role: "user" | "stylist"; text: string }[];
  today?: Partial<Omit<TodayLookState, "garments">>;
  looks?: Look[];
};

export type AssistantFailReason = "no_key" | "quota" | "signed_out" | "model" | "timeout" | "empty";

export type AssistantAskResult =
  | { ok: true; text: string; garmentIds: string[]; occasion: Occasion; stopReason: StopReason; modelCalls: number }
  | { ok: false; error: string; reason: AssistantFailReason };

export type AssistantDeps = {
  post: XaiPost;
  gate: () => Promise<GateResult>;
  loadNotes: () => Promise<StylistNote[]>;
  hasKey: boolean;
  now?: () => number;
  /** The day as YYYY-MM-DD; tests pin it. */
  date?: string;
};

export const NO_KEY_ERROR = "The assistant is not configured.";
export const EMPTY_ERROR = "The assistant has nothing to dress.";
export const TIMEOUT_ERROR = "The assistant took too long.";
export const MODEL_ERROR = "The assistant could not answer.";

function finite(n: unknown): number | undefined {
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function isOccasion(raw: unknown): raw is Occasion {
  return typeof raw === "string" && OCCASIONS.some((o) => o.id === raw);
}

/** The page's occasion when it is one of the five, else the one the prompt implies. */
export function askOccasion(page: StylistPageContext | undefined, prompt: string): Occasion {
  return isOccasion(page?.occasion) ? page.occasion : occasionFromPrompt(prompt);
}

/** The last HISTORY_TURNS turns of the dock's thread as model messages, each cut to HISTORY_CHARS. */
export function historyMessages(thread: AssistantAskInput["thread"]): ModelMessage[] {
  return (thread ?? [])
    .slice(-HISTORY_TURNS)
    .filter((m) => m.text.trim())
    .map((m) =>
      m.role === "user"
        ? { role: "user" as const, content: m.text.slice(0, HISTORY_CHARS) }
        : { role: "assistant" as const, content: m.text.slice(0, HISTORY_CHARS) },
    );
}

/** The loader's rows, or none once ASSISTANT_NOTES_MS have passed or it throws. */
async function notesWithin(load: () => Promise<StylistNote[]>, ms: number): Promise<StylistNote[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<StylistNote[]>((resolve) => {
    timer = setTimeout(() => resolve([]), ms);
  });
  try {
    return await Promise.race([load().catch(() => [] as StylistNote[]), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** A refused gate as the core's answer: signed out, or over the limit. */
function gateRefusal(gate: GateResult): AssistantAskResult {
  const error = gate.ok ? SIGNED_OUT : gate.error;
  return { ok: false, error, reason: error === SIGNED_OUT ? "signed_out" : "quota" };
}

export async function askAssistantCore(input: AssistantAskInput, deps: AssistantDeps): Promise<AssistantAskResult> {
  /* No key touches no data, so it may answer before the gate. */
  if (!deps.hasKey) return { ok: false, error: NO_KEY_ERROR, reason: "no_key" };
  const now = deps.now ?? Date.now;
  const startedAt = now();

  /* Identity first: the caller gate (sign-in, then the chat bucket) runs before anything reads
     the caller's data, the garments and the notes included, as askStylist gates before its pool.
     This first take is the first model call's unit; beforeCall reuses it, so the count stays
     one unit per model call. */
  const firstGate = await deps.gate();
  if (!firstGate.ok) return gateRefusal(firstGate);

  const pool = livePool(input.garments ?? []);
  if (!pool.length) return { ok: false, error: EMPTY_ERROR, reason: "empty" };
  const occasion = askOccasion(input.page, input.prompt);
  const taste = input.taste ? normalizeTaste(input.taste) : emptyTaste();
  const weatherF = finite(input.page?.weatherF) ?? finite(input.weatherF);

  /* What the user told the stylist, read as the caller. The assistant only recalls: the backend
     it gets is in memory, seeded from the loader, and no tool in the registry can add to it. */
  const notes = memoryNotes();
  for (const row of await notesWithin(deps.loadNotes, ASSISTANT_NOTES_MS)) {
    if (row.supersededAt !== null) continue;
    await notes.insert({ text: row.text, kind: row.kind, topic: row.topic, source: row.source }, row.createdAt);
  }

  const ctx: AssistantCtx = {
    pool,
    taste,
    page: input.page ?? { route: "today", onScreenLookIds: [] },
    ...(weatherF !== undefined ? { weatherF } : {}),
    notes,
    today: { drop: null, ...(input.today ?? {}), garments: pool, taste },
    date: deps.date ?? todayISO(),
    ...(input.looks ? { looks: input.looks } : {}),
  };

  const controller = new AbortController();
  const deadlineAt = startedAt + ASSISTANT_SERVER_MS;
  const timer = setTimeout(() => controller.abort(), ASSISTANT_SERVER_MS);
  const gateSeen: { last: GateResult } = { last: firstGate };
  let modelCalls = 0;
  const beforeCall = async () => {
    if (now() >= deadlineAt) {
      controller.abort();
      throw new AssistantTimeoutError();
    }
    modelCalls += 1;
    if (modelCalls === 1) return true; /* the unit taken before any data was read */
    gateSeen.last = await deps.gate();
    return gateSeen.last.ok;
  };
  try {
    const run = await runAssistant({
      model: xaiModel(deps.post, { models: ASSISTANT_MODELS, beforeCall, signal: controller.signal }),
      registry: assistantRegistry,
      ctx,
      system: buildAssistantSystem({ pool, page: input.page }),
      history: historyMessages(input.thread),
      prompt: input.prompt.slice(0, HISTORY_CHARS),
    });
    const owned = new Set(pool.map((g) => g.id));
    const ids = run.garmentIds.filter((id) => owned.has(id));
    const isLook = run.text !== NOT_IN_CLOSET && ids.length >= MIN_LOOK_IDS;
    return { ok: true, text: run.text, garmentIds: isLook ? ids : [], occasion, stopReason: run.stopReason, modelCalls };
  } catch (err) {
    if (err instanceof AssistantQuotaError) return gateRefusal(gateSeen.last);
    if (err instanceof AssistantTimeoutError || controller.signal.aborted) {
      return { ok: false, error: TIMEOUT_ERROR, reason: "timeout" };
    }
    const message = err instanceof AssistantModelError ? err.message : "";
    return { ok: false, error: message && message !== "model" ? message : MODEL_ERROR, reason: "model" };
  } finally {
    clearTimeout(timer);
  }
}

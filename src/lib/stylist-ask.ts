/**
 * The server-side ask, pure of transport: what askStylist (ai.ts) runs once the caller gate has
 * passed. The page answers first when it can (answerAsked); otherwise the notes read starts at
 * once and runs beside the system prompt build, capped at NOTES_TIMEOUT_MS; then the model is
 * asked once with whatever is left of SERVER_DEADLINE_MS, a second model only if at least
 * MIN_MODEL_MS remain, and the closet composes the answer (composeAtlasLook) when no model
 * answered in time. The result says where it came from: "live" (a model's own words) or "closet"
 * (composed here), and carries the phases' timings for the dev log and the timing test.
 * Relative imports only; the fetch and the notes read are handed in, so a test can stub them.
 */
import { MIN_MODEL_MS, NOTES_TIMEOUT_MS, SERVER_DEADLINE_MS, type AskPhase } from "./ai-budget.ts";
import { livePool } from "./rack.ts";
import { acceptStylistReply, answerAsked, pageNotes, type StylistPageContext } from "./stylist-page.ts";
import type { StylistNote } from "./stylist-notes/notes.ts";
import { notesBlock, relevantNotes } from "./stylist-notes/rank.ts";
import { buildStylistSystem, composeAtlasLook, normalizeTaste, occasionFromPrompt, type TasteMemory } from "./taste.ts";
import type { Garment, Occasion } from "./types.ts";

export const CHAT_MODELS = ["grok-4.5", "grok-4.3", "grok-4"] as const;

export type ChatMessage = { role: string; content: string };

export type ChatReply = { ok: boolean; text: string; error: string };

/** One model call. Resolves (never throws) with the reply text; the signal aborts it at the deadline. */
export type ChatFn = (req: { model: string; messages: ChatMessage[]; signal: AbortSignal }) => Promise<ChatReply>;

export type StylistAskInput = {
  prompt: string;
  context?: string;
  garments?: Garment[];
  weatherF?: number;
  taste?: TasteMemory;
  lockedIds?: string[];
  thread?: { role: "user" | "stylist"; text: string }[];
  page?: StylistPageContext;
  onScreenLooks?: { id: string; garmentIds: string[] }[];
};

export type StylistAskDeps = {
  /** The model transport; null when no key is set, so the closet answers at once. */
  chat: ChatFn | null;
  /** The caller's active notes. A read that hangs or throws costs the answer nothing. */
  loadNotes: () => Promise<StylistNote[]>;
  now?: () => number;
  deadlineMs?: number;
  notesTimeoutMs?: number;
};

export type StylistAskResult =
  | { ok: true; text: string; garmentIds: string[]; occasion: Occasion; source: "live" | "closet"; phases: AskPhase[] }
  | { ok: false; error: string; phases: AskPhase[] };

function finiteTemp(n: unknown): number | undefined {
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function resolveStylistLook(
  garments: Garment[],
  prompt: string,
  f: number | undefined,
  grokText?: string,
  taste?: TasteMemory,
  lockedIds?: string[],
): { text: string; garmentIds: string[]; occasion: Occasion } {
  return composeAtlasLook({
    garments,
    prompt,
    ...(f !== undefined ? { weatherF: f } : {}),
    occasion: occasionFromPrompt(prompt),
    taste: normalizeTaste(taste),
    modelText: grokText,
    lockedIds,
  });
}

/** Resolves with `fallback` after `ms` unless `work` settles first; a rejection is the fallback too. */
function within<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(fallback);
    }, ms);
    work.then(
      (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

export async function askStylistCore(data: StylistAskInput, deps: StylistAskDeps): Promise<StylistAskResult> {
  const now = deps.now ?? (() => Date.now());
  const started = now();
  const deadlineMs = deps.deadlineMs ?? SERVER_DEADLINE_MS;
  const remaining = () => deadlineMs - (now() - started);
  const phases: AskPhase[] = [];
  let mark = started;
  const phase = (name: string) => {
    const t = now();
    phases.push({ phase: name, ms: t - mark });
    mark = t;
  };
  const rack = livePool(data.garments ?? []);
  const page = data.page;
  const f = finiteTemp(page?.weatherF) ?? finiteTemp(data.weatherF);
  const taste = normalizeTaste(data.taste);
  const onScreen = (data.onScreenLooks ?? []).filter((look) => page?.onScreenLookIds?.includes(look.id));
  if (page && (page.onScreenLookIds.length > 0 || page.openGarmentId)) {
    const local = answerAsked({ prompt: data.prompt, page, garments: rack, looks: onScreen });
    phase("page");
    if (local.kind === "reject") return { ok: false, error: "That piece is not in this closet.", phases };
    if (local.kind === "answer") {
      const occasion = (page.occasion as Occasion) || occasionFromPrompt(data.prompt);
      return { ok: true, text: local.text, garmentIds: local.garmentIds, occasion, source: "closet", phases };
    }
  }
  const fallback = (): StylistAskResult => {
    if (!rack.length) return { ok: false, error: "The stylist has nothing to dress.", phases };
    const resolved = resolveStylistLook(rack, data.prompt, f, undefined, taste, data.lockedIds);
    phase("resolve");
    return { ok: true, ...resolved, source: "closet", phases };
  };
  if (!deps.chat) return fallback();

  /* The notes read starts now and runs beside the prompt build; it never waits past its cap. */
  const notesRead = within(deps.loadNotes().catch(() => [] as StylistNote[]), deps.notesTimeoutMs ?? NOTES_TIMEOUT_MS, [] as StylistNote[]);
  const system = buildStylistSystem({
    garments: rack,
    taste,
    ...(f !== undefined ? { weatherF: f } : {}),
    occasion: (page?.occasion as Occasion) || occasionFromPrompt(data.prompt),
    lockedIds: data.lockedIds,
  });
  const noteBody = [data.context, pageNotes(page)].filter(Boolean).join("\n");
  const notes = noteBody ? `\n\nNOTES\n${noteBody}` : "";
  phase("prompt");
  const active = await notesRead;
  phase("notes");
  const remembered = notesBlock(relevantNotes(active, { prompt: data.prompt, garments: rack, lockedIds: data.lockedIds }), rack);
  const prior = (data.thread ?? [])
    .slice(-8)
    .filter((m) => m.text.trim())
    .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text.slice(0, 1200) }));
  const messages: ChatMessage[] = [
    { role: "system", content: `${system}${notes}${remembered}` },
    ...prior,
    { role: "user", content: data.prompt.slice(0, 1200) },
  ];

  for (const model of CHAT_MODELS) {
    const left = remaining();
    if (left < MIN_MODEL_MS) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), left);
    let reply: ChatReply;
    try {
      reply = await deps.chat({ model, messages, signal: controller.signal });
    } catch {
      reply = { ok: false, text: "", error: "model call failed" };
    } finally {
      clearTimeout(timer);
    }
    phase(`model:${model}`);
    if (!reply.ok || !reply.text.trim()) continue;
    if (!rack.length) break;
    if (!acceptStylistReply(reply.text, rack)) return { ok: false, error: "That piece is not in this closet.", phases };
    const resolved = resolveStylistLook(rack, data.prompt, f, reply.text, taste, data.lockedIds);
    phase("resolve");
    if (!acceptStylistReply(resolved.text, rack)) return { ok: false, error: "That piece is not in this closet.", phases };
    return { ok: true, ...resolved, source: "live", phases };
  }
  return fallback();
}

/** The phases as one dev-log line. */
export function phasesLine(phases: readonly AskPhase[]): string {
  return phases.map((p) => `${p.phase} ${p.ms}ms`).join(" · ");
}

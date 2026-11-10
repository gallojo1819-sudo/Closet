/**
 * Look ask, pure core. Phase B of the photo check with no image: the ids come from the
 * open sheet. One outfit_check unit for the whole ask, taken after the ids and the key
 * are accepted and before any model POST. Swaps are read from closet_suggest_swap tool
 * results, never from the prose. Nothing here is stored.
 */
/* tools.ts first: it imports lookbook.ts ahead of legal.ts, the order the engine resolves in. */
import { assistantRegistry } from "./tools.ts";
import { LOOK_ASK_SERVER_MS } from "../ai-budget.ts";
import { SIGNED_OUT } from "../auth/ai-quota.ts";
import type { GateResult } from "../auth/closet-caller.ts";
import { leadTop, lookTuckDecision } from "../look.ts";
import { opinionSlotOf } from "../look-opinion.ts";
import { HOUSE_WORDS, RULE_ID } from "../outfit-check.ts";
import { pieceLabel } from "../piece-label.ts";
import { livePool } from "../rack.ts";
import { memoryNotes } from "../stylist-notes/notes.ts";
import type { StylistPageContext } from "../stylist-page.ts";
import { NOT_IN_CLOSET } from "../stylist-page.ts";
import { emptyTaste, normalizeTaste, occasionFromPrompt, tuckHabitIds, type TasteMemory } from "../taste.ts";
import { tuckMark } from "../tuck.ts";
import { OCCASIONS, type Garment, type Occasion } from "../types.ts";
import { todayISO } from "../utils.ts";
import {
  CHECK_FLAG_USD,
  CHECK_MAX_STEPS,
  CHECK_MODELS,
  estimateCheckUsd,
  shapeOutfitReply,
  type CheckTokens,
} from "./check-outfit.ts";
import { finalTextLines, runAssistant, type Model, type Trace } from "./loop.ts";
import { toModelTools, type AssistantCtx } from "./registry.ts";
import { buildAssistantSystem } from "./system.ts";
import {
  AssistantModelError,
  AssistantTimeoutError,
  readUsage,
  xaiModel,
  type XaiPost,
} from "./xai-adapter.ts";
import type { LookAskSwap } from "../look-swap.ts";

export const LOOK_ASK_IDS_TEXT = "Ask about a look with at least two pieces you own.";
export const LOOK_ASK_NO_KEY_TEXT = "The stylist is not configured.";
export const LOOK_ASK_TIMEOUT_TEXT = "That ask took too long. Try again.";
export const LOOK_ASK_MODEL_TEXT = "The stylist could not answer.";
export const LOOK_ASK_HINT = "What would make this better?";

export type { LookAskSwap };

export type AskAboutLookInput = {
  prompt: string;
  lookIds?: string[];
  garments?: Garment[];
  page?: StylistPageContext;
  weatherF?: number;
  taste?: TasteMemory;
  occasion?: Occasion;
};

export type AskAboutLookResult =
  | { ok: true; text: string; swaps: LookAskSwap[]; occasion: Occasion; tokens?: CheckTokens; estUsd?: number }
  | { ok: false; error: string; reason: "signed_out" | "quota" | "no_key" | "timeout" | "model" | "ids" };

export type AskAboutLookDeps = {
  post: XaiPost;
  /** Spends one outfit_check unit. Called only after the ids and the key are accepted. */
  gate: () => Promise<GateResult>;
  /** Signed-out check that does not spend a unit. Runs before the ids are judged. */
  identify?: () => Promise<GateResult>;
  hasKey: boolean;
  now?: () => number;
  date?: string;
  /** When true, the result carries token counts. The server sets this off in production. */
  dev?: boolean;
  serverMs?: number;
};

const SWAP_SLOTS = ["top", "bottom", "footwear", "outerwear"] as const;

function formatUsd(inputTokens: number, outputTokens: number, reasoningTokens = 0): string {
  return estimateCheckUsd(inputTokens, outputTokens, reasoningTokens).toFixed(4);
}

function tokensOf(chars: number): number {
  return Math.ceil(chars / 4);
}

function isOccasion(raw: unknown): raw is Occasion {
  return typeof raw === "string" && OCCASIONS.some((o) => o.id === raw);
}

function finite(n: unknown): number | undefined {
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function gateReason(error: string): "signed_out" | "quota" {
  return error === SIGNED_OUT ? "signed_out" : "quota";
}

function slotLabel(g: Garment): string {
  return opinionSlotOf(g) ?? g.category;
}

export type SheetTuck = "tucked" | "untucked" | "no tuck mark";

function pageHasWeather(page: StylistPageContext | undefined): boolean {
  return typeof page?.weatherF === "number" && Number.isFinite(page.weatherF);
}

type WeatherFlags = StylistPageContext["conditions"];

/** Flags the page actually measured. A missing boolean was not measured. */
function knownWeatherFlags(conditions: WeatherFlags): string {
  const parts: string[] = [];
  if (typeof conditions?.wet === "boolean") parts.push(conditions.wet ? "wet" : "not wet");
  if (typeof conditions?.windy === "boolean") parts.push(conditions.windy ? "windy" : "not windy");
  return parts.length ? `Measured: ${parts.join(", ")}.` : "";
}

/** Rain and wind the page did not measure. Temperature is not a substitute. */
function unmeasuredWeather(conditions: WeatherFlags): string {
  const missing: string[] = [];
  if (typeof conditions?.wet !== "boolean") missing.push("rain");
  if (typeof conditions?.windy !== "boolean") missing.push("wind");
  if (!missing.length) return "";
  const noun = missing.join(" and ");
  const titled = `${noun.charAt(0).toUpperCase()}${noun.slice(1)}`;
  const verb = missing.length === 1 ? "was" : "were";
  const pronoun = missing.length === 1 ? "it" : "them";
  return `${titled} ${verb} not measured. Never invent ${pronoun}.`;
}

/** The tuck mark the sheet already shows, so the ask does not recite it as a fix. */
export function sheetTuckLine(pieces: readonly Garment[], occasion?: string, neverTuck: readonly string[] = []): SheetTuck {
  const mark = tuckMark(lookTuckDecision(pieces, occasion, neverTuck), leadTop(pieces));
  switch (mark) {
    case "tucked":
    case "untucked":
      return mark;
    case null:
      return "no tuck mark";
    default: {
      const never: never = mark;
      return never;
    }
  }
}

export function lookAskSystem(pool: readonly Garment[], page: StylistPageContext | undefined): string {
  const weatherKnown = pageHasWeather(page);
  const flags = knownWeatherFlags(page?.conditions);
  const unmeasured = weatherKnown ? unmeasuredWeather(page?.conditions) : "";
  const rainLine = weatherKnown
    ? [flags, unmeasured, "Never invent a waterproof claim for cotton, wool, or suede."].filter(Boolean).join(" ")
    : [flags, "Rain and weather come from closet_weather_now or the page reading. Never invent a waterproof claim for cotton, wool, or suede."]
        .filter(Boolean)
        .join(" ");
  return [
    buildAssistantSystem({ pool, ...(page ? { page } : {}) }),
    [
      "LOOK ASK",
      "You are answering one question about a look the user already has open.",
      "Call closet_check_look on the given ids first.",
      weatherKnown
        ? "Then call closet_suggest_swap when a swap would help. The temperature is already known. You do not have to call closet_weather_now just to read degrees. Do not infer rain or wind from the temperature."
        : "Then call closet_suggest_swap, or closet_weather_now when the question is about rain or weather.",
      "Answer the user's question.",
      "If the sheet already shows the look tucked or untucked, do not tell him to tuck or untuck as a fix.",
      "A yes or no question, such as \"can I tuck this?\", is answered yes or no in the first line. \"Works.\" is not an answer to that question.",
      "Reply with one short verdict line and at most 3 fixes, unless the question was yes or no. A fix is a tuck, a length, or a swap to a piece he owns, by name.",
      "When the question is not yes or no, the verdict line is one of: Works. Almost. Doesn't work yet.",
      "No houses, scores, shopping, links, prices, brands, or rule ids.",
      "An oversized piece stays untucked. Never tell him to tuck an oversized top.",
      "Never label a knit tucked.",
      "Loafers are fine in every season.",
      rainLine,
      "Swaps are the tool's. Do not invent a piece he does not own.",
    ].join("\n"),
  ].join("\n\n");
}

export function lookAskUser(
  prompt: string,
  pieces: readonly Garment[],
  pool: readonly Garment[],
  occasion?: string,
  neverTuck: readonly string[] = [],
  conditions?: WeatherFlags,
): string {
  const lines = [prompt.trim(), "Look ids:"];
  if (!pieces.length) lines.push("none");
  for (const g of pieces) lines.push(`${g.id} | ${pieceLabel(g, pool)} | ${slotLabel(g)}`);
  lines.push(`Shown on the sheet as: ${sheetTuckLine(pieces, occasion, neverTuck)}`);
  const flags = knownWeatherFlags(conditions);
  if (flags) lines.push(flags);
  lines.push("Call closet_check_look on these ids first.");
  return lines.join("\n");
}

const VERDICT_LINE = /^(?:works|almost|doesn't work yet|does not work yet)\b/i;
const TUCK_QUESTION = /^(?:can|could|should|do|may|will)\s+i\b/i;

function tuckQuestion(prompt: string): "tuck" | "untuck" | null {
  const q = prompt.trim();
  if (!TUCK_QUESTION.test(q) || !/\btuck\b/i.test(q)) return null;
  return /\buntuck\b/i.test(q) ? "untuck" : "tuck";
}

function tuckAdvice(line: string): SheetTuck | null {
  const lower = line.toLowerCase();
  if (/\buntuck/.test(lower)) return "untucked";
  if (/\btuck/.test(lower)) return "tucked";
  return null;
}

/** Drop a tuck or untuck fix the sheet already shows. */
function redundantTuckLine(line: string, shown: SheetTuck): boolean {
  const advice = tuckAdvice(line);
  return advice !== null && advice === shown;
}

function tuckAnswer(ask: "tuck" | "untuck", shown: SheetTuck): string {
  const yes = ask === "tuck" ? shown === "tucked" : shown === "untucked";
  return yes ? "Yes." : "No.";
}

/**
 * One verdict (or yes/no) and at most three fixes. A tuck question is answered yes or no
 * first. A tuck the sheet already shows is not offered as a fix.
 */
export function shapeLookAskReply(raw: string, prompt: string, shown: SheetTuck): string {
  const kept = shapeOutfitReply(raw)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !redundantTuckLine(line, shown));
  const ask = tuckQuestion(prompt);
  if (!ask) return kept.slice(0, 4).join("\n");
  const first = kept[0] ?? "";
  if (/^(?:yes|no)\b/i.test(first)) return kept.slice(0, 4).join("\n");
  const rest = kept.filter((line) => !VERDICT_LINE.test(line));
  return [tuckAnswer(ask, shown), ...rest].slice(0, 4).join("\n");
}

/** Character counts and a 4-characters-per-token estimate for the look-ask prompt. No model call. */
export function lookAskPromptSizes(
  pool: readonly Garment[],
  page: StylistPageContext | undefined,
  prompt: string,
  ids: readonly string[],
): { systemChars: number; userChars: number; toolChars: number; chars: number; tokens: number } {
  const pieces = ids.map((id) => pool.find((g) => g.id === id)).filter((g): g is Garment => Boolean(g));
  const systemChars = lookAskSystem(pool, page).length;
  const userChars = lookAskUser(prompt, pieces, pool, page?.occasion, [], page?.conditions).length;
  const toolChars = JSON.stringify(toModelTools(assistantRegistry)).length;
  const chars = systemChars + userChars + toolChars;
  return { systemChars, userChars, toolChars, chars, tokens: tokensOf(chars) };
}

function asSlot(raw: unknown): LookAskSwap["slot"] | null {
  if (typeof raw !== "string") return null;
  const slot = raw.trim().toLowerCase();
  if (slot === "dress") return "top";
  if (slot === "shoe" || slot === "shoes") return "footwear";
  if (slot === "outer" || slot === "jacket" || slot === "mid") return "outerwear";
  if ((SWAP_SLOTS as readonly string[]).includes(slot)) return slot as LookAskSwap["slot"];
  return null;
}

function refId(raw: unknown): string | null {
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (!raw || typeof raw !== "object") return null;
  const id = (raw as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function swapRows(data: unknown): unknown[] {
  if (!data || typeof data !== "object") return [];
  const swaps = (data as { swaps?: unknown }).swaps;
  if (Array.isArray(swaps)) return swaps;
  /* closet_suggest_swap returns cap(): { items, more }, not a bare array. */
  if (swaps && typeof swaps === "object" && Array.isArray((swaps as { items?: unknown }).items)) {
    return (swaps as { items: unknown[] }).items;
  }
  return [];
}

/** Structured swaps from closet_suggest_swap traces. Prose is never parsed for ids. */
export function harvestLookSwaps(steps: readonly Trace[]): LookAskSwap[] {
  const out: LookAskSwap[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    if (step.call.name !== "closet_suggest_swap" || !step.result.ok) continue;
    for (const raw of swapRows(step.result.data)) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as { out?: unknown; in?: unknown; outId?: unknown; inId?: unknown; fromId?: unknown; toId?: unknown; slot?: unknown };
      const fromId = refId(row.out) ?? refId(row.outId) ?? refId(row.fromId);
      const toId = refId(row.in) ?? refId(row.inId) ?? refId(row.toId);
      const slot = asSlot(row.slot);
      if (!fromId || !toId || !slot) continue;
      const key = `${fromId}+${toId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ fromId, toId, slot });
    }
  }
  return out;
}

function askOccasion(input: AskAboutLookInput): Occasion {
  if (isOccasion(input.occasion)) return input.occasion;
  if (isOccasion(input.page?.occasion)) return input.page.occasion;
  return occasionFromPrompt(input.prompt ?? "");
}

/**
 * Run one look ask. Signed out, fewer than two owned ids, or a missing key returns
 * before any quota unit is taken. The one unit is taken after those checks and before
 * any model POST. Three tool rounds still take one unit.
 */
export async function askAboutLookCore(input: AskAboutLookInput, deps: AskAboutLookDeps): Promise<AskAboutLookResult> {
  if (deps.identify) {
    const who = await deps.identify();
    if (!who.ok) return { ok: false, error: who.error, reason: gateReason(who.error) };
  }
  const pool = livePool(input.garments ?? []);
  const owned = new Set(pool.map((g) => g.id));
  const lookIds = Array.isArray(input.lookIds) ? input.lookIds.filter((id) => typeof id === "string") : [];
  if (lookIds.length < 2 || lookIds.some((id) => !owned.has(id))) {
    return { ok: false, error: LOOK_ASK_IDS_TEXT, reason: "ids" };
  }
  if (!deps.hasKey) return { ok: false, error: LOOK_ASK_NO_KEY_TEXT, reason: "no_key" };

  const gate = await deps.gate();
  if (!gate.ok) return { ok: false, error: gate.error, reason: gateReason(gate.error) };

  const tally = { in: 0, out: 0, reasoning: 0, calls: 0 };
  let logged = false;
  const log = (result: AskAboutLookResult): AskAboutLookResult => {
    if (logged) return result;
    logged = true;
    const est = estimateCheckUsd(tally.in, tally.out, tally.reasoning);
    console.log(
      `[closet] askAboutLook tokens in=${tally.in} out=${tally.out} reasoning=${tally.reasoning} calls=${tally.calls} est_usd=${formatUsd(tally.in, tally.out, tally.reasoning)}`,
    );
    if (est > CHECK_FLAG_USD) console.log(`[closet] askAboutLook flag est_usd=${est.toFixed(4)} above 0.30`);
    if (deps.dev && result.ok) return { ...result, tokens: { ...tally }, estUsd: est };
    return result;
  };

  const now = deps.now ?? Date.now;
  const started = now();
  const budget = deps.serverMs ?? LOOK_ASK_SERVER_MS;
  const deadlineAt = started + budget;
  const controller = new AbortController();
  const remaining = () => Math.max(0, deadlineAt - now());
  const post: XaiPost = async (body, signal) => {
    const r = await deps.post(body, signal);
    if (r.ok) {
      tally.calls += 1;
      const usage = readUsage(r.json);
      if (usage) {
        tally.in += usage.promptTokens;
        tally.out += usage.completionTokens;
        tally.reasoning += usage.reasoningTokens;
      }
    }
    return r;
  };

  try {
    if (remaining() === 0) return log({ ok: false, error: LOOK_ASK_TIMEOUT_TEXT, reason: "timeout" });
    const occasion = askOccasion(input);
    const taste = input.taste ? normalizeTaste(input.taste) : emptyTaste();
    const neverTuck = tuckHabitIds(taste);
    const weatherF = finite(input.page?.weatherF) ?? finite(input.weatherF);
    const pieces = lookIds.map((id) => pool.find((g) => g.id === id)).filter((g): g is Garment => Boolean(g));
    const shown = sheetTuckLine(pieces, occasion, neverTuck);
    const page = input.page ?? { route: "today", onScreenLookIds: lookIds };
    const ctx: AssistantCtx = {
      pool,
      taste,
      page,
      ...(weatherF !== undefined ? { weatherF } : {}),
      ...(input.page?.conditions ? { conditions: input.page.conditions } : {}),
      notes: memoryNotes(),
      today: { drop: null, garments: pool, taste },
      date: deps.date ?? todayISO(),
    };
    const timer = setTimeout(() => controller.abort(), remaining());
    try {
      const inner = xaiModel(post, {
        models: CHECK_MODELS,
        signal: controller.signal,
        beforeCall: async () => {
          if (controller.signal.aborted || now() >= deadlineAt) {
            controller.abort();
            throw new AssistantTimeoutError();
          }
          return true;
        },
      });
      const model: Model = async (messages, tools) => {
        const reply = await inner(messages, tools);
        if (reply.toolCalls?.length) return reply;
        return { ...reply, text: shapeLookAskReply(reply.text ?? "", input.prompt ?? "", shown) };
      };
      const run = await runAssistant({
        model,
        registry: assistantRegistry,
        ctx,
        system: lookAskSystem(pool, input.page),
        prompt: lookAskUser(input.prompt ?? "", pieces, pool, occasion, neverTuck, input.page?.conditions),
        maxSteps: CHECK_MAX_STEPS,
        keepLines: true,
      });
      const swaps = harvestLookSwaps(run.steps);
      const spoken = run.text && run.text !== NOT_IN_CLOSET ? finalTextLines(run.text, pool) : run.text || NOT_IN_CLOSET;
      if (!spoken || spoken === NOT_IN_CLOSET || RULE_ID.test(spoken) || HOUSE_WORDS.test(spoken)) {
        return log({ ok: true, text: NOT_IN_CLOSET, swaps, occasion });
      }
      return log({ ok: true, text: spoken, swaps, occasion });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (err instanceof AssistantTimeoutError || controller.signal.aborted) {
      return log({ ok: false, error: LOOK_ASK_TIMEOUT_TEXT, reason: "timeout" });
    }
    if (err instanceof AssistantModelError) return log({ ok: false, error: LOOK_ASK_MODEL_TEXT, reason: "model" });
    return log({ ok: false, error: LOOK_ASK_MODEL_TEXT, reason: "model" });
  }
}

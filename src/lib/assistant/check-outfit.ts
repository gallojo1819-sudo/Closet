/**
 * Photo check, pure core. One vision call reads the picture, then the existing text loop
 * judges the matched pieces. The image is an argument to the injected POST and is never
 * stored, logged, or written into a note. The gate is taken once for the whole check.
 */
/* tools.ts first: it imports lookbook.ts ahead of legal.ts, the order the engine resolves in. */
import { assistantRegistry } from "./tools.ts";
import { CHECK_PHOTO_MAX_BYTES, CHECK_SERVER_MS } from "../ai-budget.ts";
import { SIGNED_OUT } from "../auth/ai-quota.ts";
import type { GateResult } from "../auth/closet-caller.ts";
import { dataUrlBytes, CHECK_MODEL_TEXT, CHECK_NO_KEY_TEXT, CHECK_OVERSIZE_TEXT, CHECK_TIMEOUT_TEXT, CHECK_TYPE_TEXT, CHECK_UNCLEAR_TEXT, unmatchedLine } from "../outfit-check-copy.ts";
import { HOUSE_WORDS, RULE_ID } from "../outfit-check.ts";
import { livePool } from "../rack.ts";
import { memoryNotes } from "../stylist-notes/notes.ts";
import type { StylistPageContext } from "../stylist-page.ts";
import { NOT_IN_CLOSET } from "../stylist-page.ts";
import { emptyTaste, normalizeTaste, occasionFromPrompt, type TasteMemory } from "../taste.ts";
import { OCCASIONS, type Garment, type Occasion } from "../types.ts";
import { todayISO } from "../utils.ts";
import { finalTextLines, runAssistant, type Model } from "./loop.ts";
import { toModelTools, type AssistantCtx } from "./registry.ts";
import { buildAssistantSystem } from "./system.ts";
import {
  AssistantModelError,
  AssistantTimeoutError,
  readUsage,
  xaiModel,
  xaiVisionJson,
  type XaiPost,
} from "./xai-adapter.ts";

/** grok-4.5, then 4.3, then 4. The same order the text assistant uses. */
export const CHECK_MODELS = ["grok-4.5", "grok-4.3", "grok-4"] as const;
export const CHECK_MAX_STEPS = 4;
export const MAX_FIXES = 3;

/** grok-4.5 list prices, USD per 1M tokens (docs.x.ai/docs/models, 2026-11-06). */
export const GROK45_IN_PER_M = 2;
export const GROK45_OUT_PER_M = 6;
/** A single check above this is logged as a flag. The 10-check mean is read after real checks. */
export const CHECK_FLAG_USD = 0.3;

const SEEN_SLOTS = ["top", "mid", "outer", "bottom", "shoe", "accessory"] as const;
type SeenSlot = (typeof SEEN_SLOTS)[number];
type Worn = "tucked" | "untucked" | "n/a";
type Confidence = "high" | "low";

export type SeenPiece = {
  what: string;
  slot: SeenSlot;
  id: string | null;
  confidence: Confidence;
  worn: Worn;
  hemBelowOuter: boolean | null;
};

export type CheckOutfitInput = {
  image: string;
  garments?: Garment[];
  page?: StylistPageContext;
  weatherF?: number;
  taste?: TasteMemory;
};

export type CheckTokens = { in: number; out: number; reasoning: number; calls: number };

export type CheckOutfitResult =
  | { ok: true; text: string; garmentIds: string[]; occasion: Occasion; tokens?: CheckTokens; estUsd?: number }
  | { ok: false; error: string; reason: "signed_out" | "quota" | "no_key" | "timeout" | "model" | "image" };

export type CheckOutfitDeps = {
  post: XaiPost;
  gate: () => Promise<GateResult>;
  hasKey: boolean;
  now?: () => number;
  date?: string;
  /** When true, the result carries token counts. The server sets this off in production. */
  dev?: boolean;
  serverMs?: number;
};

const RATING = /\b(?:\d{1,3}\s*\/\s*10|\d{1,3}\s*%\s*match|scores?|ratings?|grades?)\b/gi;
const SHOP = /\b(?:buy|shop|shops|shopping|store|stores|purchase)\b/gi;
const URL = /\b(?:https?:\/\/|www\.)\S+/gi;
const VERDICT = /^(?:works|almost|doesn't work yet|does not work yet)\b/i;

export function estimateCheckUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * GROK45_IN_PER_M + (outputTokens / 1_000_000) * GROK45_OUT_PER_M;
}

function formatUsd(inputTokens: number, outputTokens: number): string {
  return estimateCheckUsd(inputTokens, outputTokens).toFixed(4);
}

/** One verdict line and at most three fixes. Ratings, links and shopping words are cut. */
export function shapeOutfitReply(raw: string): string {
  const lines = raw
    .replace(RATING, " ")
    .replace(URL, " ")
    .replace(SHOP, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => /[a-z]/i.test(line));
  if (!lines.length) return "";
  const verdictAt = lines.findIndex((line) => VERDICT.test(line));
  const verdict = verdictAt >= 0 ? lines[verdictAt]! : lines[0]!;
  const rest = lines.filter((_, i) => i !== (verdictAt >= 0 ? verdictAt : 0));
  return [verdict, ...rest.slice(0, MAX_FIXES)].join("\n");
}

/** The model reply, plus a plain line for each unmatched piece the reply does not already name. */
export function mergeOutfitReply(modelText: string, unmatched: readonly string[]): string {
  const shaped = modelText.trim() ? shapeOutfitReply(modelText) : "";
  const lines = shaped.split("\n").filter(Boolean);
  const forced = unmatched
    .map((name) => name.trim())
    .filter((name) => name && !shaped.toLowerCase().includes(name.toLowerCase()))
    .map((name) => unmatchedLine(name));
  const verdict = lines[0] ?? (forced.length ? "Almost." : "");
  const fixes = lines.slice(1);
  const room = Math.max(0, MAX_FIXES - forced.length);
  return [verdict, ...fixes.slice(0, room), ...forced.slice(0, MAX_FIXES)].filter(Boolean).join("\n");
}

function normalizeSlot(raw: string): SeenSlot | null {
  switch (raw) {
    case "top":
    case "mid":
    case "outer":
    case "bottom":
    case "shoe":
    case "accessory":
      return raw;
    case "outerwear":
    case "jacket":
      return "outer";
    case "footwear":
    case "shoes":
      return "shoe";
    default:
      return null;
  }
}

function normalizeWorn(raw: unknown): Worn {
  if (raw === "tucked" || raw === "untucked" || raw === "n/a") return raw;
  return "n/a";
}

function jsonObject(text: string): unknown {
  const fenced = text.replace(/```(?:json)?/gi, "");
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Parse the vision JSON. Ids that are not in the pool are dropped. One piece per slot. */
export function parseSeen(text: string, pool: readonly Garment[]): { matched: SeenPiece[]; unmatched: string[] } | null {
  const body = jsonObject(text);
  if (!body || typeof body !== "object") return null;
  const row = body as { seen?: unknown; unmatched?: unknown };
  const owned = new Set(pool.map((g) => g.id));
  const parsed: SeenPiece[] = [];
  if (Array.isArray(row.seen)) {
    for (const item of row.seen) {
      if (!item || typeof item !== "object") continue;
      const rec = item as { what?: unknown; slot?: unknown; id?: unknown; confidence?: unknown; worn?: unknown; hem_below_outer?: unknown };
      const slot = typeof rec.slot === "string" ? normalizeSlot(rec.slot.trim().toLowerCase()) : null;
      if (!slot) continue;
      const what = typeof rec.what === "string" ? rec.what.replace(/\s+/g, " ").trim().slice(0, 80) : "";
      const idRaw = rec.id === null || rec.id === "null" ? null : typeof rec.id === "string" ? rec.id.trim() : null;
      const id = idRaw && owned.has(idRaw) ? idRaw : null;
      const confidence: Confidence = rec.confidence === "high" ? "high" : "low";
      const hem = rec.hem_below_outer === true ? true : rec.hem_below_outer === false ? false : null;
      parsed.push({ what, slot, id, confidence, worn: normalizeWorn(rec.worn), hemBelowOuter: hem });
    }
  }
  const bySlot = new Map<SeenSlot, SeenPiece>();
  for (const piece of parsed) {
    const prev = bySlot.get(piece.slot);
    if (!prev || (prev.confidence === "low" && piece.confidence === "high")) bySlot.set(piece.slot, piece);
  }
  const matched = SEEN_SLOTS.map((slot) => bySlot.get(slot)).filter((piece): piece is SeenPiece => Boolean(piece?.id));
  const unmatched: string[] = [];
  if (Array.isArray(row.unmatched)) {
    for (const name of row.unmatched) {
      if (typeof name !== "string") continue;
      const clean = name.replace(/\s+/g, " ").trim().slice(0, 80);
      if (clean && !unmatched.some((have) => have.toLowerCase() === clean.toLowerCase())) unmatched.push(clean);
    }
  }
  return { matched, unmatched: unmatched.slice(0, MAX_FIXES) };
}

export function closetListText(pool: readonly Garment[]): string {
  const header = "id | label | category | subtype | colors";
  const lines = pool.map((g) => {
    const colors = (g.colors ?? []).join(", ");
    return `${g.id} | ${g.name} | ${g.category} | ${g.subtype} | ${colors}`;
  });
  return [header, ...lines].join("\n");
}

export function phaseASystem(): string {
  return [
    "You look at one photo of someone wearing clothes and match each visible garment to the closet list.",
    "JSON only, no prose. Do not invent a garment that is not visible.",
    "No shopping, links, prices, brands, house names or scores.",
  ].join(" ");
}

export function phaseAUserText(pool: readonly Garment[]): string {
  return [
    "Closet, one piece per line:",
    closetListText(pool),
    "",
    'Return JSON only: {"seen":[{"what":"blue plaid flannel shirt","slot":"top|mid|outer|bottom|shoe|accessory","id":"g_… or null","confidence":"high|low","worn":"tucked|untucked|n/a","hem_below_outer":true}],"unmatched":["a piece you can see that is not in the list"]}',
    "seen is what is worn, in wear order. id is a closet id when you are sure, else null. unmatched names what you see that is not in the closet.",
  ].join("\n");
}

export function observedSentence(matched: readonly SeenPiece[]): string {
  const bits: string[] = [];
  for (const row of matched) {
    const name = row.what || "a piece";
    if (row.worn === "untucked" && row.hemBelowOuter === true) bits.push(`the ${name} is worn untucked and hangs below the outer layer`);
    else if (row.worn === "untucked") bits.push(`the ${name} is worn untucked`);
    else if (row.worn === "tucked") bits.push(`the ${name} is worn tucked`);
    else if (row.hemBelowOuter === true) bits.push(`the ${name} hangs below the outer layer`);
  }
  return bits.length ? bits.join("; ") : "no tuck or hem was clear in the photo";
}

export function phaseBSystem(pool: readonly Garment[], page: StylistPageContext | undefined, observed: string): string {
  return [
    buildAssistantSystem({ pool, ...(page ? { page } : {}) }),
    [
      "PHOTO CHECK",
      "You are checking a photo of an outfit. Call closet_check_look on the matched ids, then closet_suggest_swap if it does not work.",
      `Observed: ${observed}`,
      "Reply with one short verdict line and at most 3 fixes, each a tuck, length, shoe or color change, or a swap to an owned piece by name.",
      "The verdict line is one of: Works. Almost. Doesn't work yet.",
      "Name any piece that is not in the closet in plain words. Never shopping, links, prices, brands, house names, rule ids or scores.",
    ].join("\n"),
  ].join("\n\n");
}

export function phaseBUser(matched: readonly SeenPiece[], unmatched: readonly string[]): string {
  const lines = ["Check this outfit.", "Matched pieces:"];
  if (!matched.length) lines.push("none");
  for (const row of matched) {
    const hem = row.hemBelowOuter === null ? "unclear" : row.hemBelowOuter ? "yes" : "no";
    lines.push(`- ${row.id} | ${row.what} | ${row.slot} | worn ${row.worn} | hem_below_outer ${hem}`);
  }
  lines.push("Unmatched:");
  if (!unmatched.length) lines.push("none");
  for (const name of unmatched) lines.push(`- ${name}`);
  lines.push("Call closet_check_look on the matched ids.");
  return lines.join("\n");
}

function tokensOf(chars: number): number {
  return Math.ceil(chars / 4);
}

/** Character counts and a 4-characters-per-token estimate. No model call. */
export function outfitPromptSizes(pool: readonly Garment[], page?: StylistPageContext): {
  phaseASystemChars: number;
  phaseAUserChars: number;
  phaseAChars: number;
  phaseATokens: number;
  phaseBSystemChars: number;
  phaseBUserChars: number;
  phaseBToolChars: number;
  phaseBChars: number;
  phaseBTokens: number;
  closetLines: number;
} {
  const phaseASystemChars = phaseASystem().length;
  const phaseAUserChars = phaseAUserText(pool).length;
  const phaseAChars = phaseASystemChars + phaseAUserChars;
  const observed = "the shirt is worn untucked and hangs below the vest";
  const phaseBSystemChars = phaseBSystem(pool, page, observed).length;
  const phaseBUserChars = phaseBUser([], []).length;
  const phaseBToolChars = JSON.stringify(toModelTools(assistantRegistry)).length;
  const phaseBChars = phaseBSystemChars + phaseBUserChars + phaseBToolChars;
  return {
    phaseASystemChars,
    phaseAUserChars,
    phaseAChars,
    phaseATokens: tokensOf(phaseAChars),
    phaseBSystemChars,
    phaseBUserChars,
    phaseBToolChars,
    phaseBChars,
    phaseBTokens: tokensOf(phaseBChars),
    closetLines: pool.length + 1,
  };
}

function isOccasion(raw: unknown): raw is Occasion {
  return typeof raw === "string" && OCCASIONS.some((o) => o.id === raw);
}

function askOccasion(page: StylistPageContext | undefined): Occasion {
  return isOccasion(page?.occasion) ? page.occasion : occasionFromPrompt("");
}

function finite(n: unknown): number | undefined {
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function imageProblem(image: string): string | null {
  if (!/^data:image\/(jpeg|jpg|png|webp)(;|,)/i.test(image)) return CHECK_TYPE_TEXT;
  if (dataUrlBytes(image) > CHECK_PHOTO_MAX_BYTES) return CHECK_OVERSIZE_TEXT;
  return null;
}

function unclearText(unmatched: readonly string[]): string {
  const lines = unmatched.map((name) => unmatchedLine(name));
  lines.push(CHECK_UNCLEAR_TEXT);
  return lines.join("\n");
}

function gateReason(error: string): "signed_out" | "quota" {
  return error === SIGNED_OUT ? "signed_out" : "quota";
}

/**
 * Run one check. `gate` is awaited once, before any POST. A refusal, a missing key, or a
 * photo the server will not send returns without a model call.
 */
export async function checkOutfitCore(input: CheckOutfitInput, deps: CheckOutfitDeps): Promise<CheckOutfitResult> {
  const gate = await deps.gate();
  if (!gate.ok) return { ok: false, error: gate.error, reason: gateReason(gate.error) };

  const tally = { in: 0, out: 0, reasoning: 0, calls: 0 };
  let logged = false;
  const log = (result: CheckOutfitResult): CheckOutfitResult => {
    if (logged) return result;
    logged = true;
    const est = estimateCheckUsd(tally.in, tally.out);
    const line = `[closet] checkOutfit tokens in=${tally.in} out=${tally.out} reasoning=${tally.reasoning} calls=${tally.calls} est_usd=${formatUsd(tally.in, tally.out)}`;
    console.log(line);
    if (est > CHECK_FLAG_USD) console.log(`[closet] checkOutfit flag est_usd=${est.toFixed(4)} above 0.30`);
    if (deps.dev && result.ok) {
      return { ...result, tokens: { ...tally }, estUsd: est };
    }
    return result;
  };

  const now = deps.now ?? Date.now;
  const started = now();
  const budget = deps.serverMs ?? CHECK_SERVER_MS;
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
    if (!deps.hasKey) return log({ ok: false, error: CHECK_NO_KEY_TEXT, reason: "no_key" });
    const imageError = imageProblem(input.image);
    if (imageError) return log({ ok: false, error: imageError, reason: "image" });
    if (remaining() === 0) return log({ ok: false, error: CHECK_TIMEOUT_TEXT, reason: "timeout" });

    const pool = livePool(input.garments ?? []);
    const occasion = askOccasion(input.page);
    const taste = input.taste ? normalizeTaste(input.taste) : emptyTaste();
    const weatherF = finite(input.page?.weatherF) ?? finite(input.weatherF);
    const timer = setTimeout(() => controller.abort(), remaining());

    try {
      const vision = await xaiVisionJson(post, {
        models: CHECK_MODELS,
        image: input.image,
        system: phaseASystem(),
        text: phaseAUserText(pool),
        signal: controller.signal,
      });
      if (controller.signal.aborted || now() >= deadlineAt) return log({ ok: false, error: CHECK_TIMEOUT_TEXT, reason: "timeout" });

      const parsed = parseSeen(vision.text, pool);
      const matched = parsed?.matched ?? [];
      const unmatched = parsed?.unmatched ?? [];
      if (matched.length < 2) {
        const text = finalTextLines(unclearText(unmatched), pool);
        return log({ ok: true, text: text === NOT_IN_CLOSET ? CHECK_UNCLEAR_TEXT : text, garmentIds: [], occasion });
      }

      const ctx: AssistantCtx = {
        pool,
        taste,
        page: input.page ?? { route: "today", onScreenLookIds: [] },
        ...(weatherF !== undefined ? { weatherF } : {}),
        notes: memoryNotes(),
        today: { drop: null, garments: pool, taste },
        date: deps.date ?? todayISO(),
      };
      const observed = observedSentence(matched);
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
        return { ...reply, text: shapeOutfitReply(reply.text ?? "") };
      };
      const run = await runAssistant({
        model,
        registry: assistantRegistry,
        ctx,
        system: phaseBSystem(pool, input.page, observed),
        prompt: phaseBUser(matched, unmatched),
        maxSteps: CHECK_MAX_STEPS,
        keepLines: true,
      });
      const modelText = run.text === NOT_IN_CLOSET ? "" : run.text;
      const merged = mergeOutfitReply(modelText, unmatched);
      const text = merged ? finalTextLines(merged, pool) : NOT_IN_CLOSET;
      const spoken = text === NOT_IN_CLOSET && unmatched.length ? finalTextLines(unclearText(unmatched), pool) : text;
      if (spoken === NOT_IN_CLOSET || RULE_ID.test(spoken) || HOUSE_WORDS.test(spoken)) {
        return log({ ok: true, text: NOT_IN_CLOSET, garmentIds: [], occasion });
      }
      const ids = run.garmentIds.filter((id) => pool.some((g) => g.id === id));
      return log({ ok: true, text: spoken, garmentIds: ids, occasion });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (err instanceof AssistantTimeoutError || controller.signal.aborted) {
      return log({ ok: false, error: CHECK_TIMEOUT_TEXT, reason: "timeout" });
    }
    if (err instanceof AssistantModelError) return log({ ok: false, error: CHECK_MODEL_TEXT, reason: "model" });
    return log({ ok: false, error: CHECK_MODEL_TEXT, reason: "model" });
  }
}

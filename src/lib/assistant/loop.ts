/**
 * A step-capped ReAct loop over the registry. The model is injected: a function from the
 * messages so far and the tool list to either tool calls or a text answer. Each round the
 * loop runs the calls through runTool and appends the observations; a text answer ends it.
 * It stops early when the same call with the same arguments comes twice in a row, or at
 * maxSteps, and then returns a short plain line that asks the user. The final text has house
 * words scrubbed and must pass acceptStylistReply, else it is NOT_IN_CLOSET. Pure: no network,
 * no store, no writes.
 */
import { HOUSE_WORDS, RULE_ID } from "../outfit-check.ts";
import { displayName, pieceLabel } from "../piece-label.ts";
import { acceptStylistReply, lookRowIds, NOT_IN_CLOSET, scrubHouseNames } from "../stylist-page.ts";
import type { AssistantCtx, ModelTool, Registry, ToolResult } from "./registry.ts";
import { runTool, toModelTools } from "./registry.ts";

export type ToolCall = { name: string; args: unknown };

export type ModelMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; name: string; content: string };

export type ModelReply = { toolCalls?: ToolCall[]; text?: string };

/** The injected model. Scripted in tests; a real caller adapts a provider to this shape. */
export type Model = (messages: ModelMessage[], tools: ModelTool[]) => ModelReply | Promise<ModelReply>;

export type Trace = { step: number; call: ToolCall; result: ToolResult };

export type StopReason = "answer" | "repeat" | "max_steps";

export type AssistantRun = {
  text: string;
  garmentIds: string[];
  steps: Trace[];
  stopReason: StopReason;
};

export const DEFAULT_MAX_STEPS = 12;
export const REPEAT_TEXT = "I checked the same thing twice and got no further. Which piece or occasion should I focus on?";
export const MAX_STEPS_TEXT = "That took more steps than I allow myself. Can you narrow it to one piece or one occasion?";

function callKey(call: ToolCall): string {
  return `${call.name}\u0000${JSON.stringify(call.args ?? {}, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort()) : v))}`;
}

/** Owned ids the answer names: on a LOOK row, as a bare id, or by label, in text order. */
export function idsInText(text: string, pool: readonly import("../types.ts").Garment[]): string[] {
  const out = new Set<string>(lookRowIds(text, pool));
  const low = text.toLowerCase();
  for (const g of pool) {
    if (low.includes(g.id)) out.add(g.id);
  }
  const named: { id: string; at: number }[] = [];
  for (const g of pool) {
    if (out.has(g.id)) continue;
    const label = pieceLabel(g, pool).toLowerCase();
    const name = displayName(g).toLowerCase();
    const at = low.indexOf(label);
    const atName = at < 0 ? low.indexOf(name) : at;
    if (atName >= 0 && (at >= 0 || !pool.some((o) => o.id !== g.id && displayName(o).toLowerCase() === name))) {
      named.push({ id: g.id, at: atName });
    }
  }
  named.sort((a, b) => a.at - b.at);
  return [...out, ...named.map((n) => n.id)];
}

/** Scrub house names, then the stylist's acceptance; a rule id or a house word that survives is refused too. */
export function finalText(raw: string, pool: readonly import("../types.ts").Garment[]): string {
  const scrubbed = scrubHouseNames(raw);
  const accepted = acceptStylistReply(scrubbed, pool);
  if (!accepted) return NOT_IN_CLOSET;
  if (RULE_ID.test(accepted) || HOUSE_WORDS.test(accepted)) return NOT_IN_CLOSET;
  return accepted;
}

export async function runAssistant(opts: {
  model: Model;
  registry: Registry;
  ctx: AssistantCtx;
  system: string;
  history?: ModelMessage[];
  prompt: string;
  maxSteps?: number;
}): Promise<AssistantRun> {
  const maxSteps = Math.max(1, Math.floor(opts.maxSteps ?? DEFAULT_MAX_STEPS));
  const tools = toModelTools(opts.registry);
  const messages: ModelMessage[] = [
    { role: "system", content: opts.system },
    ...(opts.history ?? []),
    { role: "user", content: opts.prompt },
  ];
  const steps: Trace[] = [];
  let lastKey: string | null = null;
  const finish = (raw: string, stopReason: StopReason): AssistantRun => {
    const text = finalText(raw, opts.ctx.pool);
    const garmentIds = text === NOT_IN_CLOSET ? [] : idsInText(raw, opts.ctx.pool);
    return { text, garmentIds, steps, stopReason };
  };

  for (let step = 1; step <= maxSteps; step++) {
    const reply = await opts.model(messages, tools);
    const calls = reply.toolCalls ?? [];
    if (!calls.length) return finish(reply.text ?? "", "answer");
    messages.push({ role: "assistant", content: reply.text ?? "", toolCalls: calls });
    for (const call of calls) {
      const key = callKey(call);
      if (key === lastKey) return finish(REPEAT_TEXT, "repeat");
      lastKey = key;
      const result = await runTool(opts.registry, opts.ctx, call.name, call.args);
      steps.push({ step, call, result });
      messages.push({ role: "tool", name: call.name, content: JSON.stringify(result) });
    }
  }
  return finish(MAX_STEPS_TEXT, "max_steps");
}

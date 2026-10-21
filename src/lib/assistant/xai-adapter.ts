/**
 * The bridge between R1's injected Model (loop.ts) and the xAI chat-completions tools format
 * (OpenAI-style function calling). Pure: the POST itself is injected as an XaiPost, so this
 * file reads no env and opens no connection. Every model call first awaits `beforeCall`,
 * the caller's quota gate: one unit per model call, never per ask. The models are tried in
 * order and the next one is tried only when the previous POST failed.
 */
import type { Model, ModelMessage, ModelReply, ToolCall } from "./loop.ts";
import type { ModelTool } from "./registry.ts";

export type XaiPost = (body: unknown, signal?: AbortSignal) => Promise<{ ok: boolean; json: unknown; error?: string }>;

export const ASSISTANT_MAX_TOKENS = 400;
export const ASSISTANT_TEMPERATURE = 0.4;

/** The quota gate said no before a model call (signed out or over the limit). */
export class AssistantQuotaError extends Error {
  constructor(message = "quota") {
    super(message);
    this.name = "AssistantQuotaError";
  }
}

/** Every model in the list failed on one call. */
export class AssistantModelError extends Error {
  constructor(message = "model") {
    super(message);
    this.name = "AssistantModelError";
  }
}

/** The run's signal was aborted (the server's own deadline) before a call could be made. */
export class AssistantTimeoutError extends Error {
  constructor(message = "timeout") {
    super(message);
    this.name = "AssistantTimeoutError";
  }
}

export type XaiTool = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type XaiToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type XaiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: XaiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export function toXaiTools(tools: readonly ModelTool[]): XaiTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

/** A stable call id: the assistant turn's ordinal and the call's position in it. */
export function callId(step: number, index: number): string {
  return `call_${step}_${index}`;
}

/**
 * R1's messages as the API wants them. A tool message in loop.ts carries the tool's name and
 * no call id, so each assistant turn's calls are given ids and the tool messages that follow
 * are matched to them in order (the loop appends one observation per call, in call order).
 */
export function toXaiMessages(messages: readonly ModelMessage[]): XaiMessage[] {
  const out: XaiMessage[] = [];
  let step = 0;
  let pending: { id: string; name: string }[] = [];
  for (const m of messages) {
    if (m.role === "assistant" && m.toolCalls?.length) {
      step += 1;
      pending = m.toolCalls.map((call, i) => ({ id: callId(step, i), name: call.name }));
      out.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((call, i) => ({
          id: pending[i]!.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
        })),
      });
    } else if (m.role === "tool") {
      const at = pending.findIndex((p) => p.name === m.name);
      const match = at >= 0 ? pending.splice(at, 1)[0]! : { id: callId(step, out.length), name: m.name };
      out.push({ role: "tool", tool_call_id: match.id, content: m.content });
    } else if (m.role === "assistant") {
      out.push({ role: "assistant", content: m.content });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

type XaiChoiceMessage = {
  content?: string | null;
  tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
};

/** Arguments that will not parse come back under __unparsed, so the schema check reports them and nothing throws. */
export function parseArguments(raw: unknown): unknown {
  if (raw === undefined || raw === null || raw === "") return {};
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return { __unparsed: raw };
  }
}

export function fromXaiReply(json: unknown): ModelReply {
  const body = json as { choices?: { message?: XaiChoiceMessage }[] } | null;
  const message = body?.choices?.[0]?.message;
  if (!message) return { text: "" };
  const calls = (message.tool_calls ?? []).filter((c) => typeof c?.function?.name === "string");
  if (calls.length) {
    const toolCalls: ToolCall[] = calls.map((c) => ({ name: c.function!.name!, args: parseArguments(c.function!.arguments) }));
    return { toolCalls, ...(message.content ? { text: message.content } : {}) };
  }
  return { text: typeof message.content === "string" ? message.content : "" };
}

/**
 * A Model over an injected POST. Each call: the gate first (false throws AssistantQuotaError),
 * then one POST per model until one succeeds; all failing throws AssistantModelError. An
 * aborted signal throws AssistantTimeoutError instead of trying the next model.
 */
export function xaiModel(
  post: XaiPost,
  opts: { models: readonly string[]; beforeCall: () => Promise<boolean>; signal?: AbortSignal },
): Model {
  return async (messages, tools) => {
    if (opts.signal?.aborted) throw new AssistantTimeoutError();
    const allowed = await opts.beforeCall();
    if (!allowed) throw new AssistantQuotaError();
    const body = {
      messages: toXaiMessages(messages),
      tools: toXaiTools(tools),
      tool_choice: "auto",
      max_tokens: ASSISTANT_MAX_TOKENS,
      temperature: ASSISTANT_TEMPERATURE,
    };
    let lastError = "";
    for (const model of opts.models) {
      if (opts.signal?.aborted) throw new AssistantTimeoutError();
      const r = await post({ model, ...body }, opts.signal);
      if (r.ok) return fromXaiReply(r.json);
      lastError = r.error ?? "";
      if (opts.signal?.aborted) throw new AssistantTimeoutError();
    }
    throw new AssistantModelError(lastError || "model");
  };
}

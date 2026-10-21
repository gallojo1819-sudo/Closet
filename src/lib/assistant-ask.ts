/**
 * The assistant's server function. It sits outside src/lib/assistant/ because it reads the
 * env and opens the connection; the core (assistant/serve.ts) has both injected. The quota is
 * the stylist's chat bucket: one callerGate per model call, taken inside the core's beforeCall,
 * so AI_FN_BUCKET needs no new entry. Nothing here imports ./ai.
 *
 * Gate rule (sign-in-gate.test.ts): the first callerGate( sits textually before any fetch( in
 * the handler. This file is not in that test's scan yet; Part B can add it.
 */
import { createServerFn } from "@tanstack/react-start";
import { callerGate, closetCaller } from "./auth/closet-caller";
import { askAssistantCore, type AssistantAskResult } from "./assistant/serve";
import type { XaiPost } from "./assistant/xai-adapter";
import type { StylistPageContext } from "./stylist-page";
import type { TasteMemory } from "./taste";
import type { Garment } from "./types";

const XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions";

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([closetCaller])
  .validator(
    (input: {
      prompt: string;
      closet?: string;
      context?: string;
      garments?: Garment[];
      weatherF?: number;
      taste?: TasteMemory;
      lockedIds?: string[];
      thread?: { role: "user" | "stylist"; text: string }[];
      page?: StylistPageContext;
      onScreenLooks?: { id: string; garmentIds: string[] }[];
    }) => input,
  )
  .handler(async ({ data, context }): Promise<AssistantAskResult> => {
    /* One chat unit per model call, drawn through the core's beforeCall. */
    const gate = () => callerGate(context, "askStylist");
    const loadNotes = async () => {
      const { loadActiveNotes } = await import("./stylist-notes/notes.server");
      return loadActiveNotes(context.callerId, context.sbToken);
    };
    return askAssistantCore(
      {
        prompt: data.prompt,
        garments: data.garments ?? [],
        ...(data.taste ? { taste: data.taste } : {}),
        ...(data.page ? { page: data.page } : {}),
        ...(typeof data.weatherF === "number" ? { weatherF: data.weatherF } : {}),
        ...(data.thread ? { thread: data.thread } : {}),
      },
      { post: assistantPost, gate, loadNotes, hasKey: Boolean(process.env.XAI_API_KEY) },
    );
  });

/** The private POST, as packshot-search.ts keeps its own: the key is read at call time and never leaves this function. */
async function assistantPost(body: unknown, signal?: AbortSignal): ReturnType<XaiPost> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return { ok: false, json: null, error: "Set XAI_API_KEY." };
  let res: Response;
  try {
    res = await fetch(XAI_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    return { ok: false, json: null, error: name === "AbortError" || name === "TimeoutError" ? "xAI request timed out" : "xAI request failed" };
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, json, ...(res.ok ? {} : { error: errorLine(json, res.status) }) };
}

function errorLine(json: unknown, status: number): string {
  if (json && typeof json === "object") {
    const o = json as { error?: unknown };
    if (typeof o.error === "string" && o.error.trim()) return o.error.trim();
    if (o.error && typeof o.error === "object") {
      const m = (o.error as { message?: unknown }).message;
      if (typeof m === "string" && m.trim()) return m.trim();
    }
  }
  return `xAI request failed (${status})`;
}

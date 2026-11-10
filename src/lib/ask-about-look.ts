/**
 * The look ask's server function. The core (assistant/ask-about-look.ts) has the POST and
 * the gate injected. One callerGate for the whole ask, textually before any fetch. No image,
 * no note, no closet.v6 write. The key is read at call time.
 */
import { createServerFn } from "@tanstack/react-start";
import { SIGNED_OUT } from "./auth/ai-quota";
import { callerGate, closetCaller } from "./auth/closet-caller";
import { askAboutLookCore, type AskAboutLookResult } from "./assistant/ask-about-look";
import type { XaiPost } from "./assistant/xai-adapter";
import type { Occasion } from "./types";
import type { StylistPageContext } from "./stylist-page";
import type { TasteMemory } from "./taste";
import type { Garment } from "./types";

const XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions";

export const askAboutLook = createServerFn({ method: "POST" })
  .middleware([closetCaller])
  .validator(
    (input: {
      prompt: string;
      lookIds?: string[];
      garments?: Garment[];
      page?: StylistPageContext;
      weatherF?: number;
      taste?: TasteMemory;
      occasion?: Occasion;
    }) => input,
  )
  .handler(async ({ data, context }): Promise<AskAboutLookResult> => {
    /* Signed out spends nothing. The one outfit_check unit is taken inside the core, after the ids and the key are accepted, and still before any fetch. */
    const identify = async () => (context.callerId ? { ok: true as const } : { ok: false as const, error: SIGNED_OUT });
    const gate = () => callerGate(context, "askAboutLook");
    return askAboutLookCore(data, {
      post: askAboutLookPost,
      identify,
      gate,
      hasKey: Boolean(process.env.XAI_API_KEY),
      dev: process.env.NODE_ENV !== "production",
    });
  });

/** The key is read at call time and never leaves this function. The body is not logged. */
async function askAboutLookPost(body: unknown, signal?: AbortSignal): ReturnType<XaiPost> {
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

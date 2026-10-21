/**
 * The dock's router between the assistant and today's stylist, pure (no React, no store).
 * Off, it is exactly today's order: the cue-word remember hook, then askStylist under the
 * ASK_DEADLINE_MS wait, then the closet's own reply. On, the assistant gets the first share of
 * the same deadline and the stylist whatever is left; the remember hook never runs, because
 * tap-to-save is locked and the propose card is a later round. The total wait never passes
 * the deadline, and a reply always comes back when the closet can dress.
 */
import { ASK_DEADLINE_MS, askWithDeadline, type LocalReply } from "../stylist-session.ts";

/** The assistant's share of the dock's deadline; the stylist gets the rest. */
export const ASSISTANT_SHARE_MS = 5000;

export type RoutedReply<A, S> =
  | { via: "assistant"; result: A }
  | { via: "stylist"; result: S; fallbackFrom?: string }
  | { via: "local"; result: LocalReply; fallbackFrom?: string }
  | { via: "none"; result: null; fallbackFrom?: string };

export type SwitchAsk<A extends { ok: boolean }, S> = {
  on: boolean;
  askAssistant: () => Promise<A>;
  askStylist: () => Promise<S>;
  local: () => LocalReply | null;
  /** Today's cue-word auto-save; called once when the switch is off, never when it is on. */
  remember: () => void;
  deadlineMs?: number;
  assistantShareMs?: number;
  now?: () => number;
};

function describe(result: { ok: boolean; error?: string; reason?: string } | null): string {
  if (result === null) return "assistant: no answer in time";
  const why = result.reason ?? result.error ?? "failed";
  return `assistant: ${why}`;
}

export async function askThroughSwitch<A extends { ok: boolean }, S>(opts: SwitchAsk<A, S>): Promise<RoutedReply<A, S>> {
  const deadlineMs = opts.deadlineMs ?? ASK_DEADLINE_MS;
  const now = opts.now ?? Date.now;
  const startedAt = now();
  let fallbackFrom: string | undefined;

  if (!opts.on) {
    opts.remember();
  } else {
    const share = Math.min(opts.assistantShareMs ?? ASSISTANT_SHARE_MS, deadlineMs);
    let first: A | null = null;
    try {
      first = await askWithDeadline(opts.askAssistant(), share);
    } catch {
      first = null;
    }
    if (first !== null && first.ok) return { via: "assistant", result: first };
    fallbackFrom = describe(first as { ok: boolean; error?: string; reason?: string } | null);
  }

  const remaining = Math.max(0, deadlineMs - (now() - startedAt));
  let stylist: S | null = null;
  try {
    stylist = await askWithDeadline(opts.askStylist(), remaining);
  } catch {
    stylist = null;
  }
  if (stylist !== null) return { via: "stylist", result: stylist, ...(fallbackFrom ? { fallbackFrom } : {}) };

  const local = opts.local();
  if (local) return { via: "local", result: local, ...(fallbackFrom ? { fallbackFrom } : {}) };
  return { via: "none", result: null, ...(fallbackFrom ? { fallbackFrom } : {}) };
}

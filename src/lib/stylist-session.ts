/**
 * What the stylist dock shows of the thread, and how long it waits for the server.
 *
 * This session's thread is the messages the dock itself pushed since the app opened, tracked
 * by id (noteSessionMessage), never by timestamp: a message stored by an earlier session, a
 * clock that disagrees between devices, or a tab kept alive for days cannot make an old answer
 * "this look". "This look" is Today's look until a stylist answer pushed in this session, dated
 * today, carries a look (thisLookMessage). The user's own question is echoed from the dock's
 * own list as well as the store (sessionThread), so it renders even when the store's messages
 * are replaced under it (a rehydrate, a merge).
 *
 * An ask is bounded: askWithDeadline resolves with the server's reply or, after ASK_DEADLINE_MS,
 * with null, and the dock then composes a reply from the closet itself (localStylistReply:
 * composeAtlasLook, the same composer the briefs use), so the panel always answers.
 * Pure: relative imports only, no React, no store.
 */
import { lookReply } from "./stylist-page.ts";
import { composeAtlasLook, emptyTaste, type TasteMemory } from "./taste.ts";
import type { Garment, Occasion, StylistMessage } from "./types.ts";
import { todayISO } from "./utils.ts";

/** How long the dock waits for the server before it answers from the closet itself. */
export const ASK_DEADLINE_MS = 8000;

/** The thread as the dock shows it: the store's copy of each message pushed this session, else the dock's own echo. */
export function sessionThread(
  messages: readonly StylistMessage[],
  sessionIds: ReadonlySet<string>,
  echo: readonly StylistMessage[] = [],
): StylistMessage[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const out: StylistMessage[] = [];
  const seen = new Set<string>();
  for (const m of echo) {
    if (!sessionIds.has(m.id) || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(byId.get(m.id) ?? m);
  }
  for (const m of messages) {
    if (!sessionIds.has(m.id) || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

/** The last stylist answer of this session that was pushed today, or null: before one, "This look" is Today's. */
export function thisLookMessage(thread: readonly StylistMessage[], today = todayISO()): StylistMessage | null {
  for (let i = thread.length - 1; i >= 0; i -= 1) {
    const m = thread[i]!;
    if (m.role !== "stylist") continue;
    if (!m.createdAt.startsWith(today)) return null;
    return m;
  }
  return null;
}

/** `ask`, or null once `ms` have passed (a hanging request, a server that never answers) or it throws. */
export function askWithDeadline<T>(ask: Promise<T>, ms = ASK_DEADLINE_MS): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(null);
    }, ms);
    ask.then(
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
        resolve(null);
      },
    );
  });
}

export const LOCAL_REPLY_NOTE = "The stylist is slow to answer, so this is from your closet alone.";

export type LocalReply = { text: string; garmentIds: string[]; occasion: Occasion; technique: string | null };

/**
 * A reply composed from the closet when the server does not answer in time: one legal look for
 * the occasion as one sentence, with a note that it came from the closet alone. Null only when
 * the closet cannot dress.
 */
export function localStylistReply(input: {
  prompt: string;
  garments: readonly Garment[];
  occasion: Occasion;
  taste?: TasteMemory;
  weatherF?: number;
}): LocalReply | null {
  const owned = input.garments.filter((g) => !g.archived);
  if (!owned.length) return null;
  const rolled = composeAtlasLook({
    garments: [...owned],
    prompt: input.prompt,
    occasion: input.occasion,
    taste: input.taste ?? emptyTaste(),
    ...(typeof input.weatherF === "number" && Number.isFinite(input.weatherF) ? { weatherF: input.weatherF } : {}),
  });
  const pieces = rolled.garmentIds
    .map((id) => owned.find((g) => g.id === id))
    .filter((g): g is Garment => Boolean(g));
  const line = lookReply(pieces);
  if (!line) return null;
  return {
    text: `${line} ${LOCAL_REPLY_NOTE}`,
    garmentIds: pieces.map((g) => g.id),
    occasion: input.occasion,
    technique: rolled.technique ?? null,
  };
}

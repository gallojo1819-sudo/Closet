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
 * composeAtlasLook, the same composer the briefs use), so the panel always answers. The server
 * keeps its own, shorter deadline (SERVER_DEADLINE_MS in ai.ts) and says whether its answer was
 * live or from the closet; the client's deadline is that plus a margin, so a server that
 * answers from the closet in time is marked, not timed out.
 *
 * The first open shows three starter chips (STARTER_CHIPS); two of them are answered here from
 * the closet: "Something different today" (a second draw, as a Skip would) and "Dress my
 * least-worn piece" (the piece idle longest, dressed). Pure: relative imports only, no React,
 * no store.
 */
import { SERVER_DEADLINE_MS } from "./ai-budget.ts";
import { pickDropIds, type PickState } from "./drop-pick.ts";
import { dressThisPiece } from "./dress.ts";
import { lookReply } from "./stylist-page.ts";
import { daysIdle } from "./style.ts";
import { composeAtlasLook, emptyTaste, type TasteMemory } from "./taste.ts";
import type { Garment, Occasion, StylistMessage } from "./types.ts";
import { todayNY } from "./utils.ts";

/** The margin the client allows past the server's own deadline. */
export const ASK_MARGIN_MS = 2500;
/** How long the dock waits for the server before it answers from the closet itself: the server's deadline plus the margin. */
export const ASK_DEADLINE_MS = SERVER_DEADLINE_MS + ASK_MARGIN_MS;

/** The starter chips of a first open: fixed prompts, sent through the dock's own send. */
export const STARTER_CHIPS: readonly string[] = ["What should I wear today?", "Something different today", "Dress my least-worn piece"];

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
export function thisLookMessage(thread: readonly StylistMessage[], today = todayNY()): StylistMessage | null {
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

/** A server answer composed from the closet carries the same note as the local fallback. */
export function markClosetReply(text: string): string {
  const clean = text.trim();
  if (!clean || clean.endsWith(LOCAL_REPLY_NOTE)) return clean;
  return `${clean} ${LOCAL_REPLY_NOTE}`;
}

export type LocalReply = { text: string; garmentIds: string[]; occasion: Occasion };

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
    text: markClosetReply(line),
    garmentIds: pieces.map((g) => g.id),
    occasion: input.occasion,
  };
}

/** "Something different today": another draw for today, as a Skip makes one. */
export function isDifferentTodayAsk(text: string): boolean {
  return /\b(something|anything)\s+(different|else)\b/i.test(text) && /\btoday\b/i.test(text);
}

/** "Dress my least-worn piece": the piece idle longest, dressed. */
export function isLeastWornAsk(text: string): boolean {
  return /\bleast[- ]worn\b|\bleast worn\b|\blongest (?:idle|unworn)\b/i.test(text);
}

/** The live piece worn longest ago (never worn: since it was added), in a dressable slot. */
export function leastWornPiece(garments: readonly Garment[], today = todayNY()): Garment | null {
  let best: Garment | null = null;
  let bestIdle = -1;
  for (const g of garments) {
    if (g.archived || g.demo) continue;
    if (g.category === "accessory" || g.category === "other") continue;
    const idle = daysIdle(g, today);
    if (idle > bestIdle || (idle === bestIdle && best && g.id < best.id)) {
      best = g;
      bestIdle = idle;
    }
  }
  return best;
}

/** A second draw for today, kept off today's own look: the Skip surface with a session counter. */
export function differentTodayReply(state: PickState, input: { occasion: Occasion; previousIds: readonly string[]; turn: number; today?: string }): LocalReply | null {
  const picked = pickDropIds(
    { ...state, skipCount: input.turn },
    { occasion: input.occasion, previousIds: [...input.previousIds], today: input.today },
  );
  const pieces = picked.ids.map((id) => state.garments.find((g) => g.id === id)).filter((g): g is Garment => Boolean(g));
  const line = lookReply(pieces);
  if (!line || pieces.length < 3) return null;
  return { text: line, garmentIds: pieces.map((g) => g.id), occasion: input.occasion };
}

/** The least-worn piece, dressed for the occasion; null when nothing dresses it. */
export function leastWornReply(input: { garments: readonly Garment[]; occasion: Occasion; journal?: PickState["journal"]; taste?: TasteMemory; today?: string }): LocalReply | null {
  const piece = leastWornPiece(input.garments, input.today);
  if (!piece) return null;
  const dressed = dressThisPiece({
    lockedIds: [piece.id],
    garments: [...input.garments],
    occasion: input.occasion,
    journal: input.journal ? [...input.journal] : undefined,
    taste: input.taste,
    today: input.today,
  });
  if (!dressed) return { text: `Nothing in your closet dresses the ${piece.name.trim()} today.`, garmentIds: [], occasion: input.occasion };
  const line = lookReply(dressed.pieces);
  if (!line) return null;
  return { text: line, garmentIds: dressed.garmentIds, occasion: dressed.occasion };
}

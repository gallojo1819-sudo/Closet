/**
 * The stylist ask's time budget, shared by the server (ai.ts) and the client (stylist-session.ts).
 * The server answers inside SERVER_DEADLINE_MS whatever the model does: the notes read is capped
 * at NOTES_TIMEOUT_MS and runs beside the prompt build, one model call gets the budget that is
 * left, a second only when enough remains, and the closet answers for the rest. The client waits
 * that long plus a margin (ASK_DEADLINE_MS in stylist-session.ts). A leaf module: no imports.
 */

/** The whole server-side ask, gate to answer. */
export const SERVER_DEADLINE_MS = 6500;
/** How long the stylist waits for the account's notes before answering without them. */
export const NOTES_TIMEOUT_MS = 1500;
/** The least time left for which a further model call is worth starting. */
export const MIN_MODEL_MS = 2000;

/** One phase of an ask, with the milliseconds it took. For the dev log and the timing test. */
export type AskPhase = { phase: string; ms: number };

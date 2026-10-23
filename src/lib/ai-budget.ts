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

/** One On me image edit (ref photo + up to four cutouts) may take this long. Other xAI calls keep XAI_TIMEOUT_MS. */
export const ONME_TIMEOUT_MS = 50000;
/** The whole On me server call, both edits if any: under the 60 s function limit. */
export const ONME_SERVER_BUDGET_MS = 55000;
/** The least time left for which the 422 retry is worth starting. */
export const ONME_MIN_RETRY_MS = 20000;

/** The 422 retry's timeout: the budget left after `elapsedMs`, or null when under ONME_MIN_RETRY_MS is left. */
export function onMeRetryMs(elapsedMs: number): number | null {
  const left = ONME_SERVER_BUDGET_MS - elapsedMs;
  return left >= ONME_MIN_RETRY_MS ? left : null;
}

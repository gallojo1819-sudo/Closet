/**
 * Per-account AI quota, pure. No Supabase, no TanStack, no Vite: node --test loads it as is.
 * The durable counter lives in the ai_quota_take RPC; this file holds the buckets, the
 * limits, and the in-memory fallback one serverless instance uses when the RPC is missing.
 */

export type AiBucket = "chat" | "vision" | "image" | "search";

/** Every server function that spends a key, by the bucket it draws on. aiStatus is gated but not bucketed. */
export const AI_FN_BUCKET: Record<string, AiBucket> = {
  askStylist: "chat",
  trendLayer: "chat",
  composeChapter: "chat",
  judgeChapter: "chat",
  describeCover: "chat",
  tagGarment: "vision",
  classifyScan: "vision",
  judgeHeldPlate: "vision",
  identifyPiece: "vision",
  printGarment: "image",
  extractGarment: "image",
  recolorCover: "image",
  onMePreview: "image",
  findOfficialCover: "search",
  searchOfficial: "search",
  fetchListing: "search",
};

export type AiLimit = { hour: number; day: number };

/* Sized so one 30-piece add session (about 4 vision, 2 image and 1 search call per piece) stays under the hour. */
const DEFAULT_LIMITS: Record<AiBucket, AiLimit> = {
  chat: { hour: 60, day: 300 },
  vision: { hour: 300, day: 1500 },
  image: { hour: 150, day: 600 },
  search: { hour: 100, day: 400 },
};

export const HOUR_SECONDS = 3600;
export const DAY_SECONDS = 86400;

function envNumber(name: string): number | null {
  if (typeof process === "undefined" || !process.env) return null;
  const raw = process.env[name];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** Defaults, with AI_LIMIT_<BUCKET>_HOUR / _DAY overrides read on the server only. */
export function readAiLimits(): Record<AiBucket, AiLimit> {
  const out = {} as Record<AiBucket, AiLimit>;
  for (const bucket of Object.keys(DEFAULT_LIMITS) as AiBucket[]) {
    const upper = bucket.toUpperCase();
    out[bucket] = {
      hour: envNumber(`AI_LIMIT_${upper}_HOUR`) ?? DEFAULT_LIMITS[bucket].hour,
      day: envNumber(`AI_LIMIT_${upper}_DAY`) ?? DEFAULT_LIMITS[bucket].day,
    };
  }
  return out;
}

export const AI_LIMITS: Record<AiBucket, AiLimit> = readAiLimits();

/** The start of the window holding `now` (ms since epoch), in ms. */
export function windowStart(now: number, seconds: number): number {
  const size = seconds * 1000;
  return Math.floor(now / size) * size;
}

export type QuotaTake = { ok: true } | { ok: false; retryAfterSec: number };

function keyOf(userId: string, bucket: AiBucket, kind: "h" | "d", start: number): string {
  return `${userId}|${bucket}|${kind}|${start}`;
}

function startOfKey(key: string): number {
  const n = Number(key.slice(key.lastIndexOf("|") + 1));
  return Number.isFinite(n) ? n : 0;
}

/**
 * The in-memory counter for one instance. Checks the hour and the day window,
 * increments only when both allow, and prunes keys older than two days.
 */
export function takeLocal(
  store: Map<string, number>,
  userId: string,
  bucket: AiBucket,
  now: number,
  limits: Record<AiBucket, AiLimit> = AI_LIMITS,
): QuotaTake {
  const stale = now - 2 * DAY_SECONDS * 1000;
  for (const key of [...store.keys()]) {
    if (startOfKey(key) < stale) store.delete(key);
  }
  const hourStart = windowStart(now, HOUR_SECONDS);
  const dayStart = windowStart(now, DAY_SECONDS);
  const hourKey = keyOf(userId, bucket, "h", hourStart);
  const dayKey = keyOf(userId, bucket, "d", dayStart);
  const hourUsed = store.get(hourKey) ?? 0;
  const dayUsed = store.get(dayKey) ?? 0;
  const limit = limits[bucket];
  if (hourUsed >= limit.hour) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((hourStart + HOUR_SECONDS * 1000 - now) / 1000)) };
  }
  if (dayUsed >= limit.day) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((dayStart + DAY_SECONDS * 1000 - now) / 1000)) };
  }
  store.set(hourKey, hourUsed + 1);
  store.set(dayKey, dayUsed + 1);
  return { ok: true };
}

export const SIGNED_OUT = "Sign in to use this.";

/** "Too many requests. Try again in 12 min." */
export function limitMessage(retryAfterSec: number): string {
  const sec = Math.max(1, Math.ceil(retryAfterSec));
  if (sec < 60) return "Too many requests. Try again in a minute.";
  const min = Math.ceil(sec / 60);
  if (min < 120) return `Too many requests. Try again in ${min} min.`;
  const hr = Math.ceil(min / 60);
  return `Too many requests. Try again in ${hr} hr.`;
}

/** A gate answer the client should not retry. */
export function isGateMessage(error: string | undefined | null): boolean {
  if (!error) return false;
  return error === SIGNED_OUT || error.startsWith("Too many requests");
}

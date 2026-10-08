import { createClient } from "@supabase/supabase-js";
import { readSupabaseEnv } from "../cloud/env.ts";
import { rpcFailurePlan } from "../cloud/commit.ts";
import {
  AI_LIMITS,
  DAY_SECONDS,
  HOUR_SECONDS,
  takeLocal,
  type AiBucket,
  type QuotaTake,
} from "./ai-quota.ts";

/**
 * Server half of `closetCaller` (`.server.ts`: never shipped to the browser).
 * Verifies the caller's Supabase access token and takes one unit of quota.
 * No service-role key: the quota RPC runs as the caller, under RLS.
 */

/** The caller when no Supabase env is set outside production: local dev with no account. */
export const DEV_CALLER = "dev-local";

export type VerifiedCaller = { userId: string | null; token: string | null };

type ClaimsAuth = {
  getClaims?: (jwt: string) => Promise<{ data: { claims?: { sub?: unknown } } | null; error: unknown }>;
  getUser: (jwt: string) => Promise<{ data: { user: { id: string } | null }; error: unknown }>;
};

function serverClient(url: string, key: string, token?: string) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}),
  });
}

/** The verified user id, or null. Never throws, never logs the token. */
export async function verifyCaller(token?: string | null): Promise<VerifiedCaller> {
  const { url, key } = readSupabaseEnv();
  if (!url || !key) {
    /* No account env: local dev. In production this fails closed. */
    if (process.env.VERCEL_ENV !== "production") return { userId: DEV_CALLER, token: null };
    return { userId: null, token: null };
  }
  if (!token) return { userId: null, token: null };
  try {
    const auth = serverClient(url, key).auth as unknown as ClaimsAuth;
    if (typeof auth.getClaims === "function") {
      const { data, error } = await auth.getClaims(token);
      const sub = data?.claims?.sub;
      if (!error && typeof sub === "string" && sub) return { userId: sub, token };
      return { userId: null, token: null };
    }
    const { data, error } = await auth.getUser(token);
    if (error || !data.user?.id) return { userId: null, token: null };
    return { userId: data.user.id, token };
  } catch {
    return { userId: null, token: null };
  }
}

/* The per-instance fallback. Vercel spreads calls over instances, so this is a floor, not the law. */
const local = new Map<string, number>();
/** Null until the RPC answers once. False after it reported missing: the instance stops asking. */
let rpcOk: boolean | null = null;

type TakeRow = { ok?: boolean; used?: number; limit?: number; reset_at?: string; reason?: string };

function secondsUntil(resetAt: string | undefined, now: number, windowSeconds: number): number {
  const at = resetAt ? Date.parse(resetAt) : NaN;
  if (Number.isFinite(at) && at > now) return Math.ceil((at - now) / 1000);
  return windowSeconds;
}

/** Which counter this instance is using right now. For logs and tests. */
export function quotaStore(): "rpc" | "local" | "unknown" {
  if (rpcOk === true) return "rpc";
  if (rpcOk === false) return "local";
  return "unknown";
}

/**
 * One take for the hour and the day window. The RPC when it is there; otherwise the
 * local counter. A missing function is remembered for the life of the instance. An
 * RPC hiccup never blocks the caller and never opens the gate past the local limit.
 */
export async function takeQuota(callerId: string, token: string | null, bucket: AiBucket): Promise<QuotaTake> {
  const now = Date.now();
  const fallback = () => takeLocal(local, callerId, bucket, now);
  if (callerId === DEV_CALLER || !token || rpcOk === false) return fallback();
  const { url, key } = readSupabaseEnv();
  if (!url || !key) return fallback();
  const limits = AI_LIMITS[bucket];
  try {
    const sb = serverClient(url, key, token);
    const windows: [number, number][] = [
      [HOUR_SECONDS, limits.hour],
      [DAY_SECONDS, limits.day],
    ];
    for (const [seconds, limit] of windows) {
      const { data, error } = await sb.rpc("ai_quota_take", {
        p_bucket: bucket,
        p_window_seconds: seconds,
        p_limit: limit,
      });
      if (error) {
        if (rpcFailurePlan(error) === "fallback") rpcOk = false;
        return fallback();
      }
      rpcOk = true;
      const row = (data ?? {}) as TakeRow;
      if (row.reason === "signed_out") return fallback();
      if (!row.ok) return { ok: false, retryAfterSec: secondsUntil(row.reset_at, now, seconds) };
    }
    return { ok: true };
  } catch {
    return fallback();
  }
}

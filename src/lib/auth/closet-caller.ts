import { createMiddleware } from "@tanstack/react-start";
import { AI_FN_BUCKET, SIGNED_OUT, limitMessage } from "./ai-quota.ts";

/**
 * Who is calling a server function that spends a key. Closet accounts are Supabase Auth,
 * so the client forwards the session's access token and the server verifies it. A missing
 * or bad token is not an error here: `callerId` is null and each handler returns its own
 * failure shape. The Check tab's photo call reuses this under the "vision" bucket.
 *
 *   export const askStylist = createServerFn({ method: "POST" })
 *     .middleware([closetCaller])
 *     .validator(...)
 *     .handler(async ({ data, context }) => {
 *       const gate = await callerGate(context, "askStylist");
 *       if (!gate.ok) return { ok: false, error: gate.error };
 *       ...
 */
export type CallerContext = {
  callerId: string | null;
  sbToken: string | null;
};

export const closetCaller = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    let sbToken: string | undefined;
    try {
      const { getSupabase } = await import("../cloud/client");
      const sb = getSupabase();
      if (sb) sbToken = (await sb.auth.getSession()).data.session?.access_token ?? undefined;
    } catch {
      sbToken = undefined;
    }
    return next({ sendContext: { sbToken } });
  })
  .server(async ({ next, context }) => {
    // ONLY `*.server` modules here. This file is dual client/server.
    const { assertSameSiteRequest } = await import("./isolation.server");
    const { verifyCaller } = await import("./closet-caller.server");
    assertSameSiteRequest();
    const raw = (context as { sbToken?: unknown } | undefined)?.sbToken;
    const caller = await verifyCaller(typeof raw === "string" ? raw : undefined);
    return next({ context: { callerId: caller.userId, sbToken: caller.token } satisfies CallerContext });
  });

export type GateResult = { ok: true } | { ok: false; error: string };

/**
 * Signed out: a refusal. Signed in: one take from the function's bucket, or a plain
 * rate-limit line. A function with no bucket (aiStatus) is gated but not counted.
 */
export async function callerGate(
  context: Partial<CallerContext> | null | undefined,
  fnName: string,
): Promise<GateResult> {
  const callerId = context?.callerId ?? null;
  if (!callerId) return { ok: false, error: SIGNED_OUT };
  const bucket = AI_FN_BUCKET[fnName];
  if (!bucket) return { ok: true };
  const { takeQuota } = await import("./closet-caller.server");
  const taken = await takeQuota(callerId, context?.sbToken ?? null, bucket);
  if (taken.ok) return { ok: true };
  return { ok: false, error: limitMessage(taken.retryAfterSec) };
}

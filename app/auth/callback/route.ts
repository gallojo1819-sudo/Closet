import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

/**
 * OAuth PKCE code-exchange handler.
 *
 * Google (or any OAuth provider) redirects back here after sign-in with a
 * `code` query param. We exchange that code for a Supabase session (which sets
 * the auth cookies) and then redirect the user to `next` (defaults to
 * `/closet`). On any failure we log the real Supabase error and redirect to the
 * `/auth/error` page carrying that message.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/closet";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocalEnv = process.env.NODE_ENV === "development";
      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`);
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      } else {
        return NextResponse.redirect(`${origin}${next}`);
      }
    }

    // Log the real Supabase error verbatim — the generic "Could not
    // authenticate user" string previously hid the actual cause. We also log
    // which Supabase cookies reached this handler, so we can see whether the
    // PKCE `code_verifier` cookie survived the redirect round-trip to this host
    // (its absence is the classic cause of a local, pre-network exchange
    // failure). Kept permanently.
    const cookieNames = request.cookies.getAll().map((c) => c.name);
    const err = error as { name?: string; status?: number; code?: string; message: string };
    console.error("[auth/callback] exchangeCodeForSession failed", {
      name: err.name,
      status: err.status,
      code: err.code,
      message: err.message,
      host: request.headers.get("host"),
      forwardedHost: request.headers.get("x-forwarded-host"),
      hasCodeVerifierCookie: cookieNames.some((n) => n.includes("code-verifier")),
      supabaseCookies: cookieNames.filter((n) => n.startsWith("sb-")),
    });
    return NextResponse.redirect(
      `${origin}/auth/error?error=${encodeURIComponent(err.message)}`,
    );
  }

  // No `code` at all — log it so this failure mode is distinguishable too.
  console.error("[auth/callback] missing code param", {
    params: [...searchParams.keys()],
    host: request.headers.get("host"),
  });
  return NextResponse.redirect(
    `${origin}/auth/error?error=${encodeURIComponent("No code parameter in callback")}`,
  );
}

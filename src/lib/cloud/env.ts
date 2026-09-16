/**
 * Closet account env. Prefer VITE_SUPABASE_*; also accept NEXT_PUBLIC_SUPABASE_*
 * so a Vercel project that still uses the Next names keeps working.
 */

type EnvMap = Record<string, string | undefined>;

function readEnv(): EnvMap {
  const meta = import.meta.env as EnvMap;
  const proc =
    typeof process !== "undefined" && process.env
      ? (process.env as EnvMap)
      : {};
  return { ...proc, ...meta };
}

function pick(env: EnvMap, names: string[]): string {
  for (const name of names) {
    const v = env[name]?.trim();
    if (v) return v;
  }
  return "";
}

export type SupabasePublicEnv = {
  url: string;
  key: string;
};

export function readSupabaseEnv(): SupabasePublicEnv {
  const env = readEnv();
  return {
    url: pick(env, ["VITE_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]),
    key: pick(env, [
      "VITE_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "VITE_SUPABASE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ]),
  };
}

export function supabaseConfigured(): boolean {
  const { url, key } = readSupabaseEnv();
  return Boolean(url && key);
}

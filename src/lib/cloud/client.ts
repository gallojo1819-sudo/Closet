import { createClient, type SupabaseClient, type SupportedStorage } from "@supabase/supabase-js";
import { readSupabaseEnv } from "./env.ts";

/** Session key in localStorage — survives iOS Safari and Add-to-Home-Screen. */
export const CLOSET_AUTH_STORAGE_KEY = "closet.auth.v1";

const BUCKET = "closet-images";

function memoryStorage(): SupportedStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** localStorage with a private-mode fallback so iOS Safari never throws. */
function persistStorage(): SupportedStorage {
  if (typeof window === "undefined") return memoryStorage();
  try {
    const probe = "__closet_auth_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
  } catch {
    return memoryStorage();
  }
  return {
    getItem: (key) => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* quota / private */
      }
    },
    removeItem: (key) => {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* */
      }
    },
  };
}

let client: SupabaseClient | null | undefined;
let testClient: { current: SupabaseClient | null } | null = null;

/** Tests only. Production leaves this unset. */
export function setSupabaseForTests(next: SupabaseClient | null): void {
  testClient = { current: next };
  client = next;
}

export function getSupabase(): SupabaseClient | null {
  if (testClient) return testClient.current;
  if (client !== undefined) return client;
  if (typeof window === "undefined") {
    client = null;
    return null;
  }
  const { url, key } = readSupabaseEnv();
  if (!url || !key) {
    client = null;
    return null;
  }
  client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
      storageKey: CLOSET_AUTH_STORAGE_KEY,
      storage: persistStorage(),
    },
  });
  return client;
}

export function closetImagesBucket(): string {
  return BUCKET;
}

export function garmentObjectPath(userId: string, garmentId: string, kind: "o" | "c" | "t"): string {
  return `${userId}/${garmentId}/${kind}.jpg`;
}

export function refObjectPath(userId: string): string {
  return `${userId}/me/ref.jpg`;
}

/** Preview sign-in must return to that host, not the production origin. */
const OAUTH_QUERY_DROP = new Set(["code", "error", "error_description", "state"]);

export function redirectToFromLocation(loc: {
  origin: string;
  pathname: string;
  search?: string;
}): string {
  const path = loc.pathname.startsWith("/") ? loc.pathname : `/${loc.pathname}`;
  const params = new URLSearchParams(loc.search ?? "");
  for (const key of OAUTH_QUERY_DROP) params.delete(key);
  const query = params.toString();
  return `${loc.origin}${path}${query ? `?${query}` : ""}`;
}

export function authRedirectTo(): string {
  if (typeof window === "undefined") return "";
  return redirectToFromLocation(window.location);
}

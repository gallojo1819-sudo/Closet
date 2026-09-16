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

export function getSupabase(): SupabaseClient | null {
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

export function authRedirectTo(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

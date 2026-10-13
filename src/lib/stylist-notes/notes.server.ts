/**
 * Server half of the notes (`.server.ts`: never shipped to the browser). askStylist reads
 * the caller's active notes as the caller, under RLS, with the access token closetCaller
 * verified. No service-role key. A missing table, env, or token means no notes, not an error.
 */
import { createClient } from "@supabase/supabase-js";
import { readSupabaseEnv } from "../cloud/env.ts";
import { listActive, supabaseNotes, type StylistNote } from "./notes.ts";

export async function loadActiveNotes(callerId: string | null, token: string | null): Promise<StylistNote[]> {
  if (!callerId || !token) return [];
  const { url, key } = readSupabaseEnv();
  if (!url || !key) return [];
  try {
    const sb = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    return await listActive(supabaseNotes(sb, callerId));
  } catch {
    return [];
  }
}

/**
 * The signed-in account's notes on the client. Null when there is no account or no
 * Supabase config: the stylist still answers, it just keeps nothing.
 */
import { getAccount } from "../cloud/account.ts";
import { getSupabase } from "../cloud/client.ts";
import { supabaseNotes, type NotesBackend } from "./notes.ts";

export function accountNotes(): NotesBackend | null {
  const sb = getSupabase();
  const user = getAccount().user;
  if (!sb || !user) return null;
  return supabaseNotes(sb, user.id);
}

import { useSyncExternalStore } from "react";
import { supabaseConfigured } from "./env.ts";
import { authRedirectTo, getSupabase } from "./client.ts";

export type ClosetAccountUser = {
  id: string;
  email: string | null;
};

export type AccountState = {
  user: ClosetAccountUser | null;
  pending: boolean;
  progress: string | null;
  configured: boolean;
  dialogOpen: boolean;
  emailSent: boolean;
  error: string | null;
  localOnly: boolean;
  wrongAccount: boolean;
};

const listeners = new Set<() => void>();

const serverSnapshot: AccountState = {
  user: null,
  pending: true,
  progress: null,
  configured: false,
  dialogOpen: false,
  emailSent: false,
  error: null,
  localOnly: false,
  wrongAccount: false,
};

let state: AccountState = { ...serverSnapshot };

function emit() {
  for (const fn of listeners) fn();
}

export function getAccount(): AccountState {
  return state;
}

export function subscribeAccount(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function patchAccount(partial: Partial<AccountState>) {
  state = { ...state, ...partial };
  emit();
}

export function isAccountSignedIn(): boolean {
  return state.user !== null;
}

export function useAccount(): AccountState {
  return useSyncExternalStore(subscribeAccount, getAccount, () => serverSnapshot);
}

export function setAccountProgress(progress: string | null) {
  patchAccount({ progress });
}

export function setLocalOnly(on: boolean) {
  patchAccount({ localOnly: on });
}

export function openAccountDialog() {
  patchAccount({ dialogOpen: true, error: null, emailSent: false });
}

export function closeAccountDialog() {
  patchAccount({ dialogOpen: false, error: null });
}

export async function signInWithApple(): Promise<void> {
  const sb = getSupabase();
  if (!sb) {
    patchAccount({ error: "Account is not configured." });
    return;
  }
  patchAccount({ error: null });
  const { error } = await sb.auth.signInWithOAuth({
    provider: "apple",
    options: {
      redirectTo: authRedirectTo(),
      skipBrowserRedirect: false,
    },
  });
  if (error) patchAccount({ error: error.message });
}

export async function signInWithGoogle(): Promise<void> {
  const sb = getSupabase();
  if (!sb) {
    patchAccount({ error: "Account is not configured." });
    return;
  }
  patchAccount({ error: null });
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: authRedirectTo(),
      skipBrowserRedirect: false,
    },
  });
  if (error) {
    const msg = error.message ?? "";
    patchAccount({
      error: /provider is not enabled/i.test(msg) ? "Google isn’t on yet." : msg,
    });
  }
}

export async function sendMagicLink(email: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) {
    patchAccount({ error: "Account is not configured." });
    return;
  }
  const trimmed = email.trim();
  if (!trimmed) {
    patchAccount({ error: "Enter an email." });
    return;
  }
  patchAccount({ error: null });
  const { error } = await sb.auth.signInWithOtp({
    email: trimmed,
    options: {
      emailRedirectTo: authRedirectTo(),
      shouldCreateUser: true,
    },
  });
  if (error) {
    patchAccount({ error: error.message });
    return;
  }
  patchAccount({ emailSent: true });
}

export async function signOutAccount(): Promise<void> {
  const sb = getSupabase();
  if (sb) await sb.auth.signOut();
  patchAccount({
    user: null,
    pending: false,
    dialogOpen: false,
    emailSent: false,
    error: null,
    progress: null,
    localOnly: false,
    wrongAccount: false,
  });
}

export function markConfigured() {
  patchAccount({ configured: supabaseConfigured() });
}

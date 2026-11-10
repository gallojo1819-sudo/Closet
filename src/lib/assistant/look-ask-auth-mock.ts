/**
 * Controllable session for the look-ask dock test. The dock imports useCurrentUserState;
 * the test points that import here so a signed-out open can become signed-in without a new tap.
 */
import { useSyncExternalStore } from "react";

type User = {
  id: string;
  displayName: string | null;
  primaryEmail: string | null;
  profileImageUrl: string | null;
  isDevFallback: boolean;
} | null;

const signedInUser: User = {
  id: "joe",
  displayName: "Joe",
  primaryEmail: null,
  profileImageUrl: null,
  isDevFallback: false,
};

let snapshot: { user: User; isPending: boolean } = { user: signedInUser, isPending: false };
const listeners = new Set<() => void>();

function get() {
  return snapshot;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useCurrentUserState() {
  return useSyncExternalStore(subscribe, get, get);
}

export function setLookAskAuth(next: { user: User; isPending: boolean }) {
  snapshot = next;
  for (const fn of listeners) fn();
}

export function signedInLookAskAuth() {
  return { user: signedInUser, isPending: false as const };
}

/**
 * The "Try the assistant" switch: one flag under its own localStorage key, off by default.
 * It lives beside assistant-ask.ts rather than in src/lib/assistant/ because that folder is
 * pinned storage-free by assistant.test.ts (the assistant core never reads a browser store).
 * This file touches only its own key: never the zustand store, never persist, never the
 * closet's keys. SSR-safe: without a window, or with storage denied, it reads false.
 */

export const ASSISTANT_SWITCH_KEY = "closet-assistant-try.v1";
const ON = "1";

const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** True only when the key holds "1". */
export function readAssistantSwitch(): boolean {
  try {
    return storage()?.getItem(ASSISTANT_SWITCH_KEY) === ON;
  } catch {
    return false;
  }
}

export function writeAssistantSwitch(on: boolean): void {
  try {
    const store = storage();
    if (!store) return;
    if (on) store.setItem(ASSISTANT_SWITCH_KEY, ON);
    else store.removeItem(ASSISTANT_SWITCH_KEY);
  } catch {
    /* storage denied: the switch stays as read */
  }
  for (const fn of listeners) fn();
}

/** For useSyncExternalStore: fires on a write from this tab and on another tab's storage event. */
export function subscribeAssistantSwitch(fn: () => void): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === ASSISTANT_SWITCH_KEY) fn();
  };
  const hasWindow = typeof window !== "undefined";
  if (hasWindow) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    if (hasWindow) window.removeEventListener("storage", onStorage);
  };
}

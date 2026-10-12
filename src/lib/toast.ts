import { useSyncExternalStore } from "react";

export type Toast = { id: number; text: string; leaving: boolean };

/** Shown for this long, then it slides away. */
export const TOAST_MS = 2000;
export const TOAST_OUT_MS = 220;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, number[]>();

function emit() {
  for (const fn of listeners) fn();
}

function patch(id: number, partial: Partial<Toast>) {
  toasts = toasts.map((t) => (t.id === id ? { ...t, ...partial } : t));
  emit();
}

function drop(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  for (const t of timers.get(id) ?? []) window.clearTimeout(t);
  timers.delete(id);
  emit();
}

/** A quiet line at the bottom of the screen. In memory only. */
export function showToast(text: string): number {
  const id = nextId++;
  toasts = [...toasts, { id, text, leaving: false }];
  emit();
  if (typeof window !== "undefined") {
    const out = window.setTimeout(() => patch(id, { leaving: true }), TOAST_MS);
    const gone = window.setTimeout(() => drop(id), TOAST_MS + TOAST_OUT_MS);
    timers.set(id, [out, gone]);
  }
  return id;
}

export function dismissToast(id: number): void {
  drop(id);
}

const EMPTY: Toast[] = [];

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => toasts,
    () => EMPTY,
  );
}

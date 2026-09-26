/** User edits that may write closet_meta. Open, focus, and reroll do not. */

type Listener = () => void;

const listeners = new Set<Listener>();
let pending = false;

export function onUserEdit(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** True if a user edit happened, including before sync subscribed. */
export function peekPendingEdit(): boolean {
  return pending;
}

export function clearPendingEdit(): void {
  pending = false;
}

export function noteUserEdit(): void {
  pending = true;
  for (const fn of listeners) fn();
}

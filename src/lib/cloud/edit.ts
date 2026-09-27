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

const refListeners = new Set<Listener>();

/** Only an explicit reference-photo change. A cloud merge must not set this. */
export function onRefPhotoEdit(fn: Listener): () => void {
  refListeners.add(fn);
  return () => {
    refListeners.delete(fn);
  };
}

export function noteRefPhotoEdit(): void {
  for (const fn of refListeners) fn();
}

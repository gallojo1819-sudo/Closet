/**
 * Back on Wi‑Fi: retry the account push. Never apply an empty cloud over a rack.
 * Tests must not touch closet.v6.
 */

export type LinkAction = "push" | "pull" | "union" | "keep";

export function onOnlineIntent(input: {
  online: boolean;
  signedIn: boolean;
  /** A user edit that has not been saved yet. A full rack is not an edit. */
  pendingEdit?: boolean;
  /** False until this client has pulled and merged. */
  pulled?: boolean;
  localCount?: number;
  localOnly?: boolean;
}): "push" | "idle" {
  void input.localCount;
  void input.localOnly;
  if (!input.online || !input.signedIn) return "idle";
  if (!input.pulled || !input.pendingEdit) return "idle";
  return "push";
}

/**
 * Focus and visibility pull and merge. They do not write.
 * A pending user edit may push only after that pull.
 */
export function visibleCloudIntent(input: {
  action: LinkAction;
  appliedCloud: boolean;
  pendingEdit?: boolean;
}): "apply" | "push" | "idle" {
  void input.action;
  if (input.appliedCloud) return "apply";
  if (input.pendingEdit) return "push";
  return "idle";
}

/**
 * closet_meta is one blob. A Today reroll that only changes `drop` must not
 * upsert it. Wear and Save change journal, garments, or looks, and those still push.
 */
export function shouldPushClosetMeta(
  prev: { garments: unknown; looks: unknown; journal: unknown; avoid: unknown; refPhoto: unknown },
  next: { garments: unknown; looks: unknown; journal: unknown; avoid: unknown; refPhoto: unknown },
): boolean {
  return (
    next.garments !== prev.garments ||
    next.looks !== prev.looks ||
    next.journal !== prev.journal ||
    next.avoid !== prev.avoid ||
    next.refPhoto !== prev.refPhoto
  );
}

export function isRetryableCloudError(error: {
  message?: string;
  status?: number;
  statusCode?: string;
}): boolean {
  if (error.status === 403 || error.statusCode === "403" || error.status === 0) return true;
  const m = error.message ?? "";
  return /403|401|fetch|network|timeout|offline|failed|not allowed|row-level/i.test(m);
}

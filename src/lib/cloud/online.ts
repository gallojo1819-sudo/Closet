/**
 * Back on Wi‑Fi: retry the account push. Never apply an empty cloud over a rack.
 * Tests must not touch closet.v6.
 */

export type LinkAction = "push" | "pull" | "union" | "keep";

export function onOnlineIntent(input: {
  online: boolean;
  signedIn: boolean;
  localCount: number;
  localOnly?: boolean;
}): "push" | "idle" {
  if (!input.online || !input.signedIn) return "idle";
  if (input.localOnly) return "push";
  if (input.localCount > 0) return "push";
  return "idle";
}

/** Visible/focus after a dead network: push local, never pull [] over 145. */
export function visibleCloudIntent(input: {
  action: LinkAction;
  appliedCloud: boolean;
}): "apply" | "push" | "idle" {
  if (input.appliedCloud) return "apply";
  if (input.action === "push" || input.action === "union") return "push";
  return "idle";
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

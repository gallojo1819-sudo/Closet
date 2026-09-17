import { isAccountSignedIn } from "./account.ts";

/** Logged out on a new device (empty local cache). */
export const EMPTY_DEVICE_COPY =
  "This phone is empty until you sign in. Your 145 are on the computer you uploaded from.";

export const SIGN_IN_PROMPT = "Sign in so this closet is on your phone";

export function savedAccountCopy(count: number): string {
  return `Saved to your account · ${count} pieces`;
}

export function savedFlashCopy(count: number): string {
  if (isAccountSignedIn()) return savedAccountCopy(count);
  return `Saved on this phone · ${count} pieces`;
}

export function savingProgress(done: number, total: number): string {
  return `Saving ${done}/${total} on your account.`;
}

export function backingUpCopy(done: number, total: number): string {
  return `Backing up photos · ${done}/${total}`;
}

export function backupFailedCopy(n: number): string {
  return `${n} photos failed — tap Backup`;
}

export function stillOnPhoneCopy(n: number): string {
  return `${n} photos still on this phone only — tap Backup`;
}

export function pulledCopy(count: number): string {
  return `${count} pieces on this phone.`;
}

export const EMPTY_ACCOUNT_CONFIRM = "Remove from this phone and your account?";

export const LOCAL_ONLY_CAPTION = "On this phone — not on your account yet.";

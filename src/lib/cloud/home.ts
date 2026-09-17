/** The 145 live in joe@prereal.com's closet_meta. Not the 31-row Gmail island. */

export const HOME_EMAILS = ["joe@prereal.com"];

export const WRONG_ACCOUNT =
  "This Google isn’t the closet with 145. Use joe@prereal.com.";

export function isHomeEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  return HOME_EMAILS.some((h) => h === e);
}

/** Sample rack is for a first visit only. Signed-in never loads it. */
export function allowSampleRack(signedIn: boolean): boolean {
  return !signedIn;
}

/**
 * The words a photo check shows. No engine, no network, no store: the dock and the
 * server core both read them so the line the client paints is the line the server returns.
 */

export const CHECK_TIMEOUT_TEXT = "That check took too long. Try again.";
export const CHECK_UNCLEAR_TEXT = "I can't tell the pieces in this photo. Try a clearer photo.";
export const CHECK_HEIC_TEXT = "That photo is HEIC. Use a JPEG, PNG or WebP.";
export const CHECK_OVERSIZE_TEXT = "That photo is still too large. Try a smaller one.";
export const CHECK_TYPE_TEXT = "Use a JPEG, PNG or WebP.";
export const CHECK_READ_TEXT = "Couldn't read that photo. Try a JPEG.";
export const CHECK_USER_TURN = "Check this outfit";
export const CHECK_BUTTON_LABEL = "Check this outfit";
export const CHECK_LOADING_TEXT = "Checking this outfit…";
export const CHECK_NO_KEY_TEXT = "The outfit check is not configured.";
export const CHECK_MODEL_TEXT = "The outfit check could not answer.";

export const CHECK_VERDICTS = ["Works", "Almost", "Doesn't work yet"] as const;

/** Decoded size of a data URL. A non-data string counts as its own length. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0) return dataUrl.length;
  const b64 = dataUrl.slice(comma + 1).replace(/\s/g, "");
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

/** "I couldn't find the green quilted vest in your closet." Shopping words are cut out of the name. */
export function unmatchedLine(name: string): string {
  const clean = name
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b(?:buy|shop|shops|shopping|store|stores|purchase)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `I couldn't find the ${clean} in your closet.`;
}

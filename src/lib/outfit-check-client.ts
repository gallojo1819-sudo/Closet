/**
 * The dock's side of a photo check: resize the file, then wait for the server.
 * A miss shows a plain line. It never substitutes a look from the closet.
 */
import { CHECK_DEADLINE_MS, CHECK_PHOTO_EDGE, CHECK_PHOTO_MAX_BYTES, CHECK_PHOTO_QUALITY } from "./ai-budget.ts";
import { isHeicFile } from "./camera.ts";
import { jpegDataUrl } from "./images.ts";
import { dataUrlBytes, CHECK_HEIC_TEXT, CHECK_OVERSIZE_TEXT, CHECK_READ_TEXT, CHECK_TIMEOUT_TEXT, CHECK_TYPE_TEXT } from "./outfit-check-copy.ts";
import { askWithDeadline } from "./stylist-session.ts";
import type { CheckOutfitInput, CheckOutfitResult } from "./assistant/check-outfit.ts";

export type OutfitFileResult = { ok: true; image: string } | { ok: false; error: string };

const ALLOWED = /image\/(jpeg|jpg|pjpeg|png|webp)/i;
const ALLOWED_NAME = /\.(jpe?g|png|webp)$/i;

function allowedFile(file: { type: string; name: string }): boolean {
  if (isHeicFile(file)) return false;
  if (ALLOWED.test(file.type)) return true;
  return ALLOWED_NAME.test(file.name);
}

async function resized(file: Blob): Promise<OutfitFileResult> {
  let image: string;
  try {
    image = await jpegDataUrl(file, CHECK_PHOTO_EDGE, CHECK_PHOTO_QUALITY);
  } catch {
    return { ok: false, error: CHECK_READ_TEXT };
  }
  if (dataUrlBytes(image) > CHECK_PHOTO_MAX_BYTES) return { ok: false, error: CHECK_OVERSIZE_TEXT };
  return { ok: true, image };
}

/**
 * JPEG, PNG or WebP, long edge 1024, quality 0.8. HEIC is converted when the browser can
 * decode it, and refused with a plain line when it cannot. Anything still over 1.5 MB is refused.
 */
export async function prepareOutfitPhoto(file: File): Promise<OutfitFileResult> {
  if (isHeicFile(file)) {
    const image = await resized(file);
    if (!image.ok) return { ok: false, error: CHECK_HEIC_TEXT };
    return image;
  }
  if (!allowedFile(file)) return { ok: false, error: CHECK_TYPE_TEXT };
  return resized(file);
}

export type OutfitCheckCaller = (input: CheckOutfitInput) => Promise<CheckOutfitResult>;

/** The server reply, or the timeout line once CHECK_DEADLINE_MS has passed. No closet look. */
export async function submitOutfitCheck(
  input: CheckOutfitInput,
  deps: { check: OutfitCheckCaller; deadlineMs?: number },
): Promise<CheckOutfitResult> {
  const res = await askWithDeadline(deps.check(input), deps.deadlineMs ?? CHECK_DEADLINE_MS);
  if (res === null) return { ok: false, error: CHECK_TIMEOUT_TEXT, reason: "timeout" };
  return res;
}

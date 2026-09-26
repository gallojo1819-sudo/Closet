/** iOS Take photo vs Photo library. Tests must not touch closet.v6. */

export const HEIC_ERROR = "Couldn't read that photo — try JPEG";

export const SHOT_MISS = "Shot didn’t stick — tap Take photo again.";

/** Small JPEG after shrink. Never the raw camera file. */
export const PENDING_CAMERA_KEY = "idb:pending:camera";

export const PENDING_CAMERA_FLAG = "closet.pending.camera";

export const CAMERA_EDGE = 1280;

export const CAMERA_JPEG = 0.72;

export const CAMERA_ACCEPT = "image/*,.heic,.heif,image/heic,image/heif";

export function cameraInputProps() {
  return {
    type: "file" as const,
    accept: CAMERA_ACCEPT,
    capture: "environment" as const,
  };
}

export function libraryInputProps() {
  return {
    type: "file" as const,
    accept: CAMERA_ACCEPT,
    multiple: true as const,
  };
}

export function isImageFile(file: { type: string; name: string }): boolean {
  const type = (file.type || "").toLowerCase();
  if (type.startsWith("image/")) return true;
  if (/\.(heic|heif|jpe?g|png|webp|gif|bmp|tif{1,2})$/i.test(file.name)) return true;
  if (!type) return true;
  return false;
}

export function isHeicFile(file: { type: string; name: string }): boolean {
  const type = (file.type || "").toLowerCase();
  return type.includes("heic") || type.includes("heif") || /\.(heic|heif)$/i.test(file.name);
}

/**
 * Reset the file input so another shot can fire.
 * An empty list does not ingest and must not clear tiles already on the page.
 */
export function handleCameraChange(
  files: ArrayLike<File> | null | undefined,
  ingest: (files: File[]) => void,
  reset: () => void,
  onMiss?: () => void,
): boolean {
  const file = files && files.length > 0 ? files[0] : undefined;
  reset();
  if (!file || !isImageFile(file)) {
    onMiss?.();
    return false;
  }
  ingest([file]);
  return true;
}

export function imageFilesFromList(list: ArrayLike<File> | null | undefined): File[] {
  return Array.from(list ?? []).filter(isImageFile);
}

/**
 * Resume must not call takeCameraShot again when the pending JPEG is missing
 * or that hash is already a garment.
 */
export function resumeCameraAction(hasBlob: boolean, alreadySaved: boolean): "stop" | "ingest" {
  if (!hasBlob || alreadySaved) return "stop";
  return "ingest";
}

/** Stable hash of the small JPEG. Name and lastModified are not part of it. */
export async function cameraBytesHash(file: Blob): Promise<string> {
  const head = await file.slice(0, 64 * 1024).arrayBuffer();
  const meta = new TextEncoder().encode(`camera\0${file.size}\0`);
  const bytes = new Uint8Array(meta.byteLength + head.byteLength);
  bytes.set(meta, 0);
  bytes.set(new Uint8Array(head), meta.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

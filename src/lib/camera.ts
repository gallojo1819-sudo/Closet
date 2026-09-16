/** iOS Take photo vs Photo library. Tests must not touch closet.v6. */

export const HEIC_ERROR = "Couldn't read that photo — try JPEG";

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

/** Reset the input, then ingest the first image. Returns whether onChange produced a file. */
export function handleCameraChange(
  files: ArrayLike<File> | null | undefined,
  ingest: (files: File[]) => void,
  reset: () => void,
): boolean {
  reset();
  const file = files && files.length > 0 ? files[0] : undefined;
  if (!file || !isImageFile(file)) return false;
  ingest([file]);
  return true;
}

export function imageFilesFromList(list: ArrayLike<File> | null | undefined): File[] {
  return Array.from(list ?? []).filter(isImageFile);
}

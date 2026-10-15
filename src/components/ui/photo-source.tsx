import type { ChangeEvent, RefObject } from "react";
import {
  cameraInputProps,
  CHOOSE_PHOTOS_LABEL,
  libraryPickProps,
  TAKE_PHOTO_LABEL,
} from "@/lib/camera";

/**
 * The two hidden inputs behind a "Take photo" / "Choose from Photos" pair. One file either
 * way; the caller's buttons click the refs. The camera input carries capture="environment",
 * the library input carries no capture, so phones offer Photos as well as the camera.
 */
export function PhotoSourceInputs({
  camRef,
  libRef,
  onFile,
}: {
  camRef: RefObject<HTMLInputElement | null>;
  libRef: RefObject<HTMLInputElement | null>;
  onFile: (file: File) => void;
}) {
  const change = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onFile(file);
  };
  return (
    <>
      <input
        ref={camRef}
        {...cameraInputProps()}
        aria-label={TAKE_PHOTO_LABEL}
        hidden
        onChange={change}
      />
      <input
        ref={libRef}
        {...libraryPickProps()}
        aria-label={CHOOSE_PHOTOS_LABEL}
        hidden
        onChange={change}
      />
    </>
  );
}

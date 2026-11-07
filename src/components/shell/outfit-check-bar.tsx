import { useRef } from "react";
import { Camera } from "lucide-react";
import { PhotoSourceInputs } from "@/components/ui/photo-source";
import { CHECK_BUTTON_LABEL, CHECK_SIGN_IN_LABEL } from "@/lib/outfit-check-copy";

export type OutfitCheckAuth = "in" | "out" | "pending";

/**
 * The camera control beside Send. The two hidden inputs are the take-or-choose picker.
 * The button is a 44px target. Signed out and still-resolving sessions do not mount the
 * inputs and do not open the picker. The photo itself is not rendered here.
 */
export function OutfitCheckBar({
  pickerOpen,
  busy,
  notice,
  onToggle,
  onFile,
  auth = "in",
}: {
  pickerOpen: boolean;
  busy: boolean;
  notice?: string | null;
  onToggle: () => void;
  onFile: (file: File) => void;
  /** Missing auth stays the signed-in control so existing callers keep working. */
  auth?: OutfitCheckAuth;
}) {
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  if (auth === "pending") return null;
  const openPicker = (which: "cam" | "lib") => {
    if (auth !== "in") return;
    const node = which === "cam" ? camRef.current : libRef.current;
    node?.click();
  };
  if (auth === "out") {
    return (
      <button
        type="button"
        data-outfit-check-signed-out
        aria-label={CHECK_SIGN_IN_LABEL}
        disabled
        className="inline-flex h-11 min-h-[44px] items-center border border-hairline px-3 text-sm text-ink-soft opacity-60"
      >
        {CHECK_SIGN_IN_LABEL}
      </button>
    );
  }
  return (
    <>
      <button
        type="button"
        data-outfit-check
        aria-label={CHECK_BUTTON_LABEL}
        aria-expanded={pickerOpen}
        disabled={busy}
        onClick={() => {
          if (auth !== "in") return;
          onToggle();
        }}
        onKeyDown={(event) => {
          if (auth !== "in") {
            event.preventDefault();
          }
        }}
        className="inline-flex size-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center border border-hairline text-ink hover:border-hairline-strong disabled:opacity-40"
      >
        <Camera className="size-4" aria-hidden />
      </button>
      <PhotoSourceInputs camRef={camRef} libRef={libRef} onFile={onFile} />
      {pickerOpen ? (
        <div data-outfit-picker className="flex basis-full gap-2">
          <button
            type="button"
            className="micro h-11 min-h-[44px] flex-1 border border-hairline px-3 text-ink-soft hover:border-hairline-strong hover:text-ink"
            onClick={() => openPicker("cam")}
          >
            Take photo
          </button>
          <button
            type="button"
            className="micro h-11 min-h-[44px] flex-1 border border-hairline px-3 text-ink-soft hover:border-hairline-strong hover:text-ink"
            onClick={() => openPicker("lib")}
          >
            Choose from Photos
          </button>
        </div>
      ) : null}
      {notice ? (
        <p data-outfit-notice className="basis-full text-sm text-ink">
          {notice}
        </p>
      ) : null}
    </>
  );
}

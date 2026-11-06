import { useRef } from "react";
import { Camera } from "lucide-react";
import { PhotoSourceInputs } from "@/components/ui/photo-source";
import { CHECK_BUTTON_LABEL } from "@/lib/outfit-check-copy";

/**
 * The camera control beside Send. The two hidden inputs are the take-or-choose picker.
 * The button is a 44px target. The photo itself is not rendered here.
 */
export function OutfitCheckBar({
  pickerOpen,
  busy,
  notice,
  onToggle,
  onFile,
}: {
  pickerOpen: boolean;
  busy: boolean;
  notice?: string | null;
  onToggle: () => void;
  onFile: (file: File) => void;
}) {
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        data-outfit-check
        aria-label={CHECK_BUTTON_LABEL}
        aria-expanded={pickerOpen}
        disabled={busy}
        onClick={onToggle}
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
            onClick={() => camRef.current?.click()}
          >
            Take photo
          </button>
          <button
            type="button"
            className="micro h-11 min-h-[44px] flex-1 border border-hairline px-3 text-ink-soft hover:border-hairline-strong hover:text-ink"
            onClick={() => libRef.current?.click()}
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

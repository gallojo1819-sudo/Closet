import { useRef } from "react";
import { ClipboardPaste, Images, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhotoSourceInputs } from "@/components/ui/photo-source";
import { CHOOSE_PHOTOS_LABEL, TAKE_PHOTO_LABEL } from "@/lib/camera";

/** The One-piece tab's hangtag row: shoot the label, or pick a shot of it from Photos. */
export function HangtagSource({ busy, onFile }: { busy: boolean; onFile: (file: File) => void }) {
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <div className="mt-4 flex flex-col sm:flex-row gap-3 justify-center">
        <Button variant="ghost" onClick={() => camRef.current?.click()} disabled={busy}>
          <Tag className="size-4" />
          Hangtag · {TAKE_PHOTO_LABEL}
        </Button>
        <Button variant="ghost" onClick={() => libRef.current?.click()} disabled={busy}>
          <Images className="size-4" />
          Hangtag · {CHOOSE_PHOTOS_LABEL}
        </Button>
        <Button variant="ghost" disabled={busy} className="pointer-events-none opacity-70">
          <ClipboardPaste className="size-4" />
          Or paste
        </Button>
      </div>
      <PhotoSourceInputs camRef={camRef} libRef={libRef} onFile={onFile} />
    </>
  );
}

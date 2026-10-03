import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { classifyScan, printGarment } from "@/lib/ai";
import { dataUrlToBlob, imageKey, notifyImage, putImage, putThumb } from "@/lib/images";
import { readGarmentPhoto } from "@/lib/plate-pass";
import { judgeHeldPlate } from "@/lib/packshot-search";
import { OUTLINE_FAIL_MESSAGE, clampBox, coverRejected, cropToBox, holderCheckerText, type CropBox } from "@/lib/scan";
import { useCloset } from "@/lib/store";
import type { Garment } from "@/lib/types";
import { useImageSrc } from "@/lib/use-image";

const START: CropBox = { x: 0.18, y: 0.12, w: 0.64, h: 0.76 };

/** One box on the original. Confirm reprints that crop and runs the clean check. */
export function OutlineJacket({
  garment,
  onClose,
}: {
  garment: Garment;
  onClose: () => void;
}) {
  const display = useImageSrc(garment.imageSrc);
  const [photo, setPhoto] = useState<string | null>(null);
  const [box, setBox] = useState<CropBox>(START);
  const [line, setLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const shown = photo || display;

  useEffect(() => {
    let live = true;
    void readGarmentPhoto(garment.id, garment.imageSrc).then((next) => {
      if (live && next) setPhoto(next);
    });
    return () => {
      live = false;
    };
  }, [garment.id, garment.imageSrc]);

  useEffect(() => {
    if (!photo) return;
    let live = true;
    void (async () => {
      try {
        const scan = await classifyScan({ data: { image: photo } });
        const next = scan.ok ? scan.boxes[0]?.box : null;
        if (live && next) setBox(next);
      } catch {
        /* the centered box stays */
      }
    })();
    return () => {
      live = false;
    };
  }, [photo]);

  const drag = (mode: "move" | "resize") => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, box };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / Math.max(rect.width, 1);
      const dy = (ev.clientY - start.y) / Math.max(rect.height, 1);
      if (mode === "move") {
        setBox(
          clampBox({
            x: start.box.x + dx,
            y: start.box.y + dy,
            w: start.box.w,
            h: start.box.h,
          }),
        );
      } else {
        setBox(
          clampBox({
            x: start.box.x,
            y: start.box.y,
            w: Math.max(0.08, start.box.w + dx),
            h: Math.max(0.08, start.box.h + dy),
          }),
        );
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const confirm = async () => {
    if (!photo || busy) return;
    setBusy(true);
    setLine(null);
    try {
      const crop = await cropToBox(photo, box);
      if (!crop) {
        setLine(OUTLINE_FAIL_MESSAGE);
        return;
      }
      const printed = await printGarment({ data: { image: crop, held: true, retry: true } });
      const plate = printed.ok && printed.image ? printed.image : "";
      let checker = "";
      if (plate) {
        const verdict = await judgeHeldPlate({ data: { image: plate } }).catch(() => null);
        checker = holderCheckerText(verdict);
      }
      if (!plate || coverRejected(checker)) {
        setLine(OUTLINE_FAIL_MESSAGE);
        return;
      }
      const key = imageKey(garment.id, "c");
      await putImage(key, dataUrlToBlob(plate));
      await putThumb(garment.id, plate).catch(() => {});
      notifyImage(key);
      notifyImage(imageKey(garment.id, "t"));
      useCloset.getState().updateGarment(garment.id, {
        cutoutSrc: key,
        imageSource: "cutout",
        matteQuality: "clean",
        reprint: false,
        plated: true,
      });
      onClose();
    } catch {
      setLine(OUTLINE_FAIL_MESSAGE);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center md:items-center">
      <button type="button" className="absolute inset-0 bg-ink/40" aria-label="Close" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md border border-hairline bg-paper">
        <div
          ref={frameRef}
          className="relative aspect-page bg-paper-deep"
          style={{ touchAction: "none" }}
        >
          {shown ? (
            <img src={shown} alt="" className="h-full w-full object-contain" draggable={false} />
          ) : (
            <div className="h-full w-full paper-shimmer" />
          )}
          <div
            className="absolute border border-ink bg-ink/10"
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.w * 100}%`,
              height: `${box.h * 100}%`,
            }}
            onPointerDown={drag("move")}
          >
            <span
              className="absolute bottom-0 right-0 size-4 bg-ink"
              onPointerDown={drag("resize")}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2 p-4">
          <p className="text-sm">{garment.name}</p>
          {line ? <p className="micro text-accent">{line}</p> : null}
          <button
            type="button"
            disabled={busy || !photo}
            onClick={() => void confirm()}
            className="micro border border-hairline px-3 py-2 text-ink disabled:opacity-40"
          >
            {busy ? "Printing…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

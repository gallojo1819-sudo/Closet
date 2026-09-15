import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WornBox } from "@/lib/scan";

export function WornPicker({
  photo,
  boxes,
  busyId,
  doneIds,
  onTap,
  onDone,
}: {
  photo: string;
  boxes: WornBox[];
  busyId: string | null;
  doneIds: Set<string>;
  onTap: (box: WornBox) => void;
  onDone: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-ink text-paper">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative max-h-[100dvh] max-w-[100vw]">
          <img
            src={photo}
            alt=""
            className="max-h-[100dvh] max-w-[100vw] w-auto h-auto object-contain"
          />
          <div className="absolute inset-0 bg-ink/45" />
          {boxes.map((b) => {
            if (!b.box) return null;
            const done = doneIds.has(b.id);
            const busy = busyId === b.id;
            return (
              <button
                key={b.id}
                type="button"
                disabled={done || Boolean(busyId)}
                onClick={() => onTap(b)}
                className={cn(
                  "absolute border-2 text-left",
                  done ? "border-success" : "border-paper",
                )}
                style={{
                  left: `${b.box.x * 100}%`,
                  top: `${b.box.y * 100}%`,
                  width: `${b.box.w * 100}%`,
                  height: `${b.box.h * 100}%`,
                }}
              >
                <span className="absolute left-1 top-1 bg-paper text-ink micro px-2 py-0.5">
                  {busy ? "…" : b.chip}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-10 border-t border-paper/20 bg-ink/80 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <p className="micro text-paper/70">Tap the clothes. Not the face.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {boxes.map((b) => {
            const done = doneIds.has(b.id);
            const busy = busyId === b.id;
            return (
              <button
                key={b.id}
                type="button"
                disabled={done || Boolean(busyId)}
                onClick={() => onTap(b)}
                className="border border-paper/40 bg-paper px-3 py-2 text-sm text-ink disabled:opacity-40"
              >
                {busy ? <Loader2 className="inline size-3.5 animate-spin" /> : null}
                {busy ? " " : ""}
                {b.chip}
                {done ? " · in" : ""}
              </button>
            );
          })}
        </div>
        <div className="mt-3">
          <Button variant="nightGhost" onClick={onDone} disabled={Boolean(busyId)}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

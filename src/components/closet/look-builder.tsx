import { useMemo, useState } from "react";
import { FlatLay } from "@/components/closet/flat-lay";
import { GarmentImg } from "@/components/closet/gimg";
import { OnMeButton } from "@/components/closet/on-me";
import { lookbookPool } from "@/lib/lookbook";
import { nameLook } from "@/lib/look";
import { defaultOccasion, slotOf } from "@/lib/style";
import { useCloset } from "@/lib/store";
import type { Garment } from "@/lib/types";
import { cn, todayISO } from "@/lib/utils";

const SLOTS = [
  { id: "top", label: "Top" },
  { id: "bottom", label: "Bottom" },
  { id: "footwear", label: "Footwear" },
  { id: "outerwear", label: "Outer" },
] as const;

type SlotId = (typeof SLOTS)[number]["id"];

function inSlot(g: Garment, slot: SlotId): boolean {
  const s = slotOf(g);
  if (slot === "top") return s === "top" || s === "dress";
  return s === slot;
}

export function LookBuilder({ onClose }: { onClose?: () => void }) {
  const garmentsAll = useCloset((s) => s.garments);
  const drop = useCloset((s) => s.drop);
  const wearToday = useCloset((s) => s.wearToday);
  const saveLook = useCloset((s) => s.saveLook);
  const setDrop = useCloset((s) => s.setDrop);
  const [picked, setPicked] = useState<Partial<Record<SlotId, string>>>({});
  const [openSlot, setOpenSlot] = useState<SlotId | null>("top");

  const pool = useMemo(
    () => lookbookPool(garmentsAll.filter((g) => !g.archived)),
    [garmentsAll],
  );
  const byId = useMemo(() => {
    const m = new Map<string, Garment>();
    for (const g of pool) m.set(g.id, g);
    return m;
  }, [pool]);

  const pieces = SLOTS.map((s) => byId.get(picked[s.id] ?? ""))
    .filter((g): g is Garment => Boolean(g));
  const ids = pieces.map((g) => g.id);
  const ready = Boolean(picked.top && picked.bottom && picked.footwear);
  const lookName = nameLook(pieces);

  const fill = (slot: SlotId, id: string) => {
    const nextVal = picked[slot] === id ? undefined : id;
    const next = { ...picked, [slot]: nextVal };
    setPicked(next);
    const order: SlotId[] = ["top", "bottom", "footwear"];
    setOpenSlot(order.find((s) => !next[s]) ?? null);
  };

  const choices = openSlot ? pool.filter((g) => inSlot(g, openSlot)) : [];

  const useAsDrop = () => {
    if (!ready) return;
    setDrop({
      date: todayISO(),
      garmentIds: ids,
      worn: false,
      verdict: "pending",
      weather: drop?.weather,
      occasion: drop?.occasion ?? defaultOccasion(),
      moment: drop?.moment,
    });
    onClose?.();
  };

  return (
    <div className="border border-hairline bg-card p-4 md:p-5 space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="micro text-ink-soft">Play</p>
          <p className="font-editorial text-2xl tracking-tight">Make a look</p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="micro text-ink-soft hover:text-ink"
          >
            Close
          </button>
        )}
      </div>
      <p className="text-sm text-ink-soft">
        Tap a slot, then a plate you own. Nothing generated.
      </p>

      <div className="grid grid-cols-4 gap-2">
        {SLOTS.map((s) => {
          const g = byId.get(picked[s.id] ?? "");
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setOpenSlot(openSlot === s.id ? null : s.id)}
              className={cn(
                "border text-left",
                openSlot === s.id ? "border-ink" : "border-hairline",
              )}
            >
              <div className="bg-paper-deep aspect-page">
                {g ? (
                  <GarmentImg garment={g} className="h-full w-full object-contain p-[8%]" />
                ) : (
                  <span className="flex h-full items-center justify-center micro text-ink-soft">
                    {s.label}
                  </span>
                )}
              </div>
              <p className="micro px-1 py-1 text-ink-soft truncate">
                {g ? g.name : s.label}
              </p>
            </button>
          );
        })}
      </div>

      {openSlot && (
        <div>
          <p className="micro text-ink-soft mb-2">
            {SLOTS.find((s) => s.id === openSlot)?.label} from this closet
          </p>
          {choices.length === 0 ? (
            <p className="text-sm text-ink-soft">Nothing in that slot yet.</p>
          ) : (
            <ul className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-56 overflow-auto">
              {choices.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => fill(openSlot, g.id)}
                    className={cn(
                      "w-full border",
                      picked[openSlot] === g.id ? "border-ink" : "border-hairline",
                    )}
                  >
                    <div className="bg-paper-deep aspect-page">
                      <GarmentImg garment={g} className="h-full w-full object-contain p-[8%]" />
                    </div>
                    <p className="micro px-1 py-1 truncate">{g.name}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {pieces.length > 0 && <FlatLay pieces={pieces} className="max-w-xs" />}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!ready}
          onClick={() => wearToday(ids)}
          className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong disabled:opacity-40"
        >
          Wear this
        </button>
        <OnMeButton pieces={pieces} />
        <button
          type="button"
          disabled={!ready}
          onClick={() =>
            saveLook({
              name: lookName,
              occasion: drop?.occasion ?? "composed",
              garmentIds: ids,
              source: "manual",
            })
          }
          className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong disabled:opacity-40"
        >
          Save look
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={useAsDrop}
          className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong disabled:opacity-40"
        >
          Use as today’s drop
        </button>
      </div>
    </div>
  );
}

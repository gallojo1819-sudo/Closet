import { useMemo, useRef, useState } from "react";
import { FlatLay } from "@/components/closet/flat-lay";
import { GarmentImg } from "@/components/closet/gimg";
import { OnMeButton } from "@/components/closet/on-me";
import { lookbookPool } from "@/lib/lookbook";
import { lookOpinion, suggestLine } from "@/lib/look-opinion";
import { nameLook } from "@/lib/look";
import { pieceLabel } from "@/lib/piece-label";
import { slotOf, todayOccasion } from "@/lib/style";
import { useCloset } from "@/lib/store";
import { emptyTaste } from "@/lib/taste";
import type { Garment, Occasion, Season } from "@/lib/types";
import type { House } from "@/lib/houses";
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

export function LookBuilder({
  onClose,
  heading = "Suggest",
  occasion,
  season,
  house,
}: {
  onClose?: () => void;
  heading?: string;
  occasion?: Occasion;
  season?: Season;
  house?: House | null;
}) {
  const garmentsAll = useCloset((s) => s.garments);
  const drop = useCloset((s) => s.drop);
  const taste = useCloset((s) => s.taste) ?? emptyTaste();
  const wearToday = useCloset((s) => s.wearToday);
  const saveLook = useCloset((s) => s.saveLook);
  const setDrop = useCloset((s) => s.setDrop);
  const [picked, setPicked] = useState<Partial<Record<SlotId, string>>>({});
  const [openSlot, setOpenSlot] = useState<SlotId | null>("top");
  const [hover, setHover] = useState<{ slot: SlotId; id: string } | null>(null);
  const [changedSlot, setChangedSlot] = useState<SlotId | null>(null);
  const dragId = useRef<string | null>(null);

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
  const opinionOpts = {
    occasion: occasion ?? todayOccasion(drop),
    season,
    house,
    taste,
  };
  const opinion = lookOpinion(pieces, pool, opinionOpts);
  const hoverPieces = hover
    ? SLOTS.map((s) => byId.get((s.id === hover.slot ? hover.id : picked[s.id]) ?? "")).filter(
        (g): g is Garment => Boolean(g),
      )
    : null;
  const hoverOpinion = hoverPieces ? lookOpinion(hoverPieces, pool, opinionOpts) : null;
  const shown = hoverOpinion ?? opinion;
  const line = shown ? suggestLine(shown, pool) : null;
  const matched = shown?.headline === "This matches.";
  const ids = pieces.map((g) => g.id);
  const ready = Boolean(picked.top && picked.bottom && picked.footwear);
  const lookName = nameLook(pieces);

  const fill = (slot: SlotId, id: string) => {
    const nextVal = picked[slot] === id ? undefined : id;
    setChangedSlot(picked[slot] && nextVal && picked[slot] !== nextVal ? slot : null);
    const next = { ...picked, [slot]: nextVal };
    setPicked(next);
    setHover(null);
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
      occasion: todayOccasion(drop),
      moment: drop?.moment,
    });
    onClose?.();
  };

  return (
    <div className="border border-hairline bg-card p-4 md:p-5 space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="micro text-ink-soft">Play</p>
          <p className="font-editorial text-2xl tracking-tight">{heading}</p>
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
          const edge =
            g && opinion ? (matched ? "border-green-800" : "border-red-800") : openSlot === s.id ? "border-ink" : "border-hairline";
          return (
            <button
              key={s.id}
              type="button"
              data-changed={changedSlot === s.id ? "" : undefined}
              onClick={() => setOpenSlot(openSlot === s.id ? null : s.id)}
              onDragOver={(e) => {
                const id = dragId.current;
                if (!id || !byId.has(id)) return;
                e.preventDefault();
                setHover((cur) => (cur?.slot === s.id && cur.id === id ? cur : { slot: s.id, id }));
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = dragId.current;
                dragId.current = null;
                setHover(null);
                if (id && byId.has(id)) fill(s.id, id);
              }}
              className={cn("border-2 text-left", edge)}
            >
              <div className="bg-paper-deep aspect-page">
                {g ? (
                  <GarmentImg
                    key={g.id}
                    garment={g}
                    className="slot-crossfade h-full w-full object-contain p-[8%]"
                  />
                ) : (
                  <span className="flex h-full items-center justify-center micro text-ink-soft">
                    {s.label}
                  </span>
                )}
              </div>
              <p className="micro px-1 py-1 text-ink-soft truncate">
                {g ? pieceLabel(g, pool) : s.label}
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
                    draggable
                    onDragStart={(e) => {
                      dragId.current = g.id;
                      e.dataTransfer.setData("text/plain", g.id);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onDragEnd={() => {
                      dragId.current = null;
                      setHover(null);
                    }}
                    onClick={() => fill(openSlot, g.id)}
                    className={cn(
                      "w-full border",
                      picked[openSlot] === g.id ? "border-ink" : "border-hairline",
                    )}
                  >
                    <div className="bg-paper-deep aspect-page">
                      <GarmentImg garment={g} className="h-full w-full object-contain p-[8%]" />
                    </div>
                    <p className="micro px-1 py-1 truncate">{pieceLabel(g, pool)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {opinion?.swaps[0] && pool.some((g) => g.id === opinion.swaps[0]?.id) ? (
        <div className="flex gap-2">
          {pieces
            .filter((g) => inSlot(g, opinion.swaps[0]!.slot))
            .map((g) => (
              <div key={g.id} className="w-16 border-2 border-red-800">
                <GarmentImg garment={g} className="aspect-page w-full object-contain" />
              </div>
            ))}
          {pool
            .filter((g) => g.id === opinion.swaps[0]?.id)
            .map((g) => (
              <div key={g.id} data-changed="" className="w-16 border-2 border-green-800">
                <GarmentImg
                  key={g.id}
                  garment={g}
                  className="slot-crossfade aspect-page w-full object-contain"
                />
              </div>
            ))}
        </div>
      ) : null}

      {line && opinion?.swaps[0] && pool.some((g) => g.id === opinion.swaps[0]?.id) ? (
        <button
          type="button"
          onClick={() => fill(opinion.swaps[0]!.slot, opinion.swaps[0]!.id)}
          className="text-left text-sm text-ink underline"
        >
          {line}
        </button>
      ) : line ? (
        <p className="text-sm text-ink">{line}</p>
      ) : null}

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
              occasion: todayOccasion(drop),
              garmentIds: ids,
              source: "manual",
              lookbook: true,
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

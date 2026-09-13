import { useEffect, useMemo, useRef, useState } from "react";
import { GarmentImg } from "@/components/closet/gimg";
import { LookKit } from "@/components/closet/look-kit";
import { sheetPanelClass, useMdUp } from "@/components/closet/detail";
import { ensureLookOnMe, queueLookOnMe } from "@/components/closet/on-me";
import { dataUrlToBlob, getImage, lookOnMeKey } from "@/lib/images";
import { openRefPhotoDialog } from "@/components/shell/top-bar";
import { colorLine } from "@/lib/color";
import { nameLook, spreadTitle } from "@/lib/look";
import { comboKey, moreLikeThis } from "@/lib/lookbook";
import { slotOf } from "@/lib/style";
import { useCloset } from "@/lib/store";
import type { Garment, Look, Occasion } from "@/lib/types";
import { useImageSrc } from "@/lib/use-image";
import { cn } from "@/lib/utils";

type WearSlot = "top" | "bottom" | "footwear" | "outerwear";

function wearSlot(g: Garment): WearSlot | null {
  const s = slotOf(g);
  if (s === "top" || s === "dress") return "top";
  if (s === "bottom" || s === "footwear" || s === "outerwear") return s;
  return null;
}

export function LookSheet({
  look,
  pieces,
  book,
  closet,
  onClose,
  onWear,
  onOpenLook,
  getCard,
}: {
  look: Look;
  pieces: Garment[];
  book: Look[];
  closet: Garment[];
  onClose: () => void;
  onWear: () => void;
  onOpenLook: (look: Look) => void;
  getCard?: () => HTMLElement | null;
}) {
  const [ids, setIds] = useState(look.garmentIds);
  const [swapSlot, setSwapSlot] = useState<WearSlot | null>(null);
  const closetById = useMemo(() => new Map(closet.map((g) => [g.id, g])), [closet]);
  const activePieces = useMemo(
    () => ids.map((id) => closetById.get(id)).filter((g): g is Garment => Boolean(g)),
    [ids, closetById],
  );
  const extra = comboKey(activePieces.map((p) => p.id));
  const cacheKey = lookOnMeKey(look.id, extra);
  const liveSrc = useImageSrc(cacheKey);
  const cachedSrc = liveSrc;
  const [frame, setFrame] = useState<string | null>(null);
  const [showMe, setShowMe] = useState(false);
  const [dressing, setDressing] = useState(false);
  const [dressError, setDressError] = useState<string | null>(null);
  const [showAlts, setShowAlts] = useState(false);
  const [lockedIds, setLockedIds] = useState<string[]>([]);
  const gen = useRef(0);
  const piecesRef = useRef(activePieces);
  piecesRef.current = activePieces;
  const keepLook = useCloset((s) => s.keepLook);
  const looks = useCloset((s) => s.looks);
  const refPhoto = useCloset((s) => s.refPhoto);
  const md = useMdUp();
  const painted = frame || cachedSrc;
  const comboSaved = looks.some(
    (l) => l.source === "manual" && comboKey(l.garmentIds) === extra,
  );
  void getCard;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (frame) URL.revokeObjectURL(frame);
    };
  }, [frame]);

  useEffect(() => {
    if (cachedSrc) setShowMe(true);
  }, [cachedSrc]);

  useEffect(() => {
    gen.current += 1;
    const n = gen.current;
    setFrame(null);
    setDressError(null);
    setDressing(false);
    let live = true;
    void (async () => {
      const hit = await getImage(cacheKey);
      if (!live || n !== gen.current) return;
      if (hit) {
        setShowMe(true);
        return;
      }
      setShowMe(false);
    })();
    return () => {
      live = false;
    };
  }, [look.id, cacheKey]);

  useEffect(() => {
    setIds(look.garmentIds);
    setSwapSlot(null);
    setLockedIds((prev) => prev.filter((id) => look.garmentIds.includes(id)));
  }, [look.id]);

  useEffect(() => {
    if (activePieces.length < 2) return;
    void queueLookOnMe(look.id, activePieces, 45_000, look.occasion as Occasion);
  }, [look.id, extra]);

  const alts = showAlts ? moreLikeThis(look, book, closet, 3, lockedIds) : null;

  const runDress = () => {
    if (dressing) return;
    if (painted && !dressError) {
      setShowMe((v) => !v);
      return;
    }
    const n = gen.current;
    setDressing(true);
    setDressError(null);
    void (async () => {
      try {
        const image = await ensureLookOnMe(
          look.id,
          piecesRef.current,
          45_000,
          look.occasion as Occasion,
        );
        if (n !== gen.current) return;
        const url = URL.createObjectURL(dataUrlToBlob(image));
        setFrame((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        setShowMe(true);
      } catch (e) {
        if (n !== gen.current) return;
        const msg = e instanceof Error ? e.message : "Could not dress you.";
        setDressError(msg === "timeout" ? "Imagine timed out after 45s." : msg);
      } finally {
        if (n === gen.current) setDressing(false);
      }
    })();
  };

  const byId = new Map(closet.map((g) => [g.id, g]));
  const altPieces = (l: Look) =>
    l.garmentIds.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));

  return (
    <div className={cn("fixed inset-0 z-50", !md && "flex items-end")}>
      <button
        type="button"
        className={cn("absolute inset-0", md ? "bg-ink/10" : "bg-ink/30")}
        aria-label="Close"
        onClick={onClose}
      />
      <div className={sheetPanelClass(md)}>
        <div className="relative border-b border-hairline bg-paper aspect-[4/5] overflow-hidden">
          <LookKit pieces={activePieces} className="border-0" />
          {showMe && painted && (
            <img
              key={painted}
              src={painted}
              alt={look.name}
              className="on-you-glass absolute inset-0 z-10 h-full w-full object-contain bg-paper"
            />
          )}
        </div>
        <div className="p-4 flex flex-col gap-4">
          <div>
            <p>{spreadTitle(activePieces, look.occasion as Occasion)}</p>
            <p className="micro text-ink-soft">
              {colorLine(activePieces).replace(/\.$/, "") || look.occasion}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onWear}
              className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong"
            >
              Wear this
            </button>
            <button
              type="button"
              onClick={() =>
                keepLook(look.id, {
                  garmentIds: activePieces.map((g) => g.id),
                  name: nameLook(activePieces) || look.name,
                })
              }
              className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong"
            >
              {comboSaved || look.source === "manual" ? "Saved" : "Save look"}
            </button>
            {refPhoto ? (
              <button
                type="button"
                onClick={runDress}
                className={cn(
                  "micro border px-3 py-2",
                  showMe && painted
                    ? "border-ink bg-ink text-paper"
                    : "border-hairline text-ink-soft hover:border-hairline-strong",
                )}
              >
                {dressing ? "On you…" : "On you"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openRefPhotoDialog()}
                className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong"
              >
                Set Fit photo
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong"
            >
              Close
            </button>
          </div>
          {dressError && <p className="text-sm text-accent">{dressError}</p>}
          <ul className="flex gap-2 overflow-x-auto">
            {[
              ...activePieces,
              ...pieces.filter((g) => !ids.includes(g.id)),
            ].map((g) => {
              const on = ids.includes(g.id);
              const locked = lockedIds.includes(g.id);
              const slot = wearSlot(g);
              return (
                <li key={g.id} className="w-16 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (on) {
                        if (ids.length <= 2) return;
                        setIds((cur) => cur.filter((id) => id !== g.id));
                        setShowMe(false);
                      } else {
                        setIds((cur) => [...cur, g.id]);
                        setShowMe(false);
                      }
                    }}
                    className={cn(
                      "relative aspect-page w-full border border-hairline bg-paper overflow-hidden",
                      !on && "opacity-40",
                    )}
                    aria-label={on ? `Remove ${g.name}` : `Add ${g.name}`}
                  >
                    <GarmentImg
                      garment={g}
                      className="h-full w-full object-contain p-[8%]"
                    />
                    {locked && (
                      <span className="absolute left-1 top-1 micro bg-paper px-1 py-0.5 text-ink border border-hairline">
                        Lock
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setLockedIds((cur) =>
                        cur.includes(g.id) ? cur.filter((id) => id !== g.id) : [...cur, g.id],
                      )
                    }
                    className="micro mt-1 text-ink-soft hover:text-ink"
                  >
                    {locked ? "Unlock" : "Lock"}
                  </button>
                  {slot && on && (
                    <button
                      type="button"
                      onClick={() => setSwapSlot((cur) => (cur === slot ? null : slot))}
                      className="micro mt-1 block text-ink-soft hover:text-ink"
                    >
                      Swap
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {swapSlot && (
            <div className="flex flex-wrap gap-2 border border-hairline p-2">
              {closet
                .filter((g) => wearSlot(g) === swapSlot && !ids.includes(g.id))
                .slice(0, 24)
                .map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => {
                      const occupant = activePieces.find((x) => wearSlot(x) === swapSlot);
                      setIds((cur) => {
                        if (!occupant) return [...cur, g.id];
                        return cur.map((id) => (id === occupant.id ? g.id : id));
                      });
                      setSwapSlot(null);
                      setShowMe(false);
                    }}
                    className="w-14 shrink-0"
                    aria-label={g.name}
                  >
                    <div className="aspect-page border border-hairline bg-paper overflow-hidden">
                      <GarmentImg garment={g} className="h-full w-full object-contain p-[8%]" />
                    </div>
                  </button>
                ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowAlts(true)}
            className="micro self-start border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong"
          >
            More like this
          </button>
          {alts &&
            (alts.length === 0 ? (
              <p className="text-sm text-ink-soft">Nothing else in this register.</p>
            ) : (
              <ul className="grid grid-cols-3 gap-2">
                {alts.map((alt) => {
                  const shot = altPieces(alt);
                  return (
                    <li key={alt.id}>
                      <button
                        type="button"
                        onClick={() => onOpenLook(alt)}
                        className="block w-full text-left"
                        aria-label={alt.name}
                      >
                        <LookKit
                          pieces={shot}
                          className="pointer-events-none aspect-[4/5]"
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ))}
        </div>
      </div>
    </div>
  );
}

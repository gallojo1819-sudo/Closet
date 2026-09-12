import { useEffect, useLayoutEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { GarmentImg } from "@/components/closet/gimg";
import { OnMePanel } from "@/components/closet/on-me";
import { Button } from "@/components/ui/button";
import { aiStatus, recolorCover } from "@/lib/ai";
import {
  blobToDataUrl,
  dataUrlToBlob,
  getImage,
  imageKey,
  isIdbKey,
  putImage,
} from "@/lib/images";
import { costPerWear, money } from "@/lib/look";
import { PALETTE, nameWithColor } from "@/lib/color";
import { HOUSE_LABEL, daysIdle, housesOf } from "@/lib/style";
import { CATEGORIES, type Category, type Garment } from "@/lib/types";
import { useCloset } from "@/lib/store";
import { useImageSrc } from "@/lib/use-image";
import { cn, todayISO } from "@/lib/utils";

const COLOR_CHIPS = PALETTE;

async function coverDataUrl(src: string): Promise<string | null> {
  try {
    if (src.startsWith("data:")) return src;
    if (isIdbKey(src)) {
      const blob = await getImage(src);
      return blob ? blobToDataUrl(blob) : null;
    }
    const res = await fetch(src);
    if (!res.ok) return null;
    return blobToDataUrl(await res.blob());
  } catch {
    return null;
  }
}

function useMdUp() {
  const [md, setMd] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches,
  );
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)");
    const onChange = () => setMd(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return md;
}

/** Prefer right of the tile, then left, then over it. Clamp to the viewport. */
export function placeBesideTile(tile: DOMRect): {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
} {
  const pad = 12;
  const gap = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(tile.width * 2 + 16, vw - pad * 2);
  const maxHeight = Math.min(vh - pad * 2, Math.round(vh * 0.92));

  let left: number;
  if (tile.right + gap + width <= vw - pad) left = tile.right + gap;
  else if (tile.left - gap - width >= pad) left = tile.left - gap - width;
  else left = Math.min(Math.max(pad, tile.left), vw - pad - width);

  let top = tile.top;
  if (top + maxHeight > vh - pad) top = vh - pad - maxHeight;
  if (top < pad) top = pad;
  return { top, left, width, maxHeight };
}

export function GarmentDetail({
  garment,
  onClose,
  getTile,
}: {
  garment: Garment;
  onClose: () => void;
  getTile?: () => HTMLElement | null;
}) {
  const wearToday = useCloset((s) => s.wearToday);
  const removeGarment = useCloset((s) => s.removeGarment);
  const updateGarment = useCloset((s) => s.updateGarment);
  const worn = garment.wornOn.includes(todayISO());
  const [paid, setPaid] = useState(
    garment.paid != null ? String(garment.paid) : "",
  );
  const refPhoto = useCloset((s) => s.refPhoto);
  const [view, setView] = useState<"print" | "original" | "me">("print");
  const [name, setName] = useState(garment.name);
  const [color, setColor] = useState(garment.colors[0] ?? "");
  const [canPrint, setCanPrint] = useState(false);
  const [recoloring, setRecoloring] = useState(false);
  const [coverNote, setCoverNote] = useState<string | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
  const originalSrc = useImageSrc(garment.imageSrc);
  const usingOriginal = garment.cutoutSrc === garment.imageSrc;
  const cpw = costPerWear(garment);
  const md = useMdUp();
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!md) {
      setPos(null);
      return;
    }
    const place = () => {
      const el = getTile?.();
      if (!el) return;
      setPos(placeBesideTile(el.getBoundingClientRect()));
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [md, garment.id, getTile]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    aiStatus()
      .then((s) => setCanPrint(s.print))
      .catch(() => setCanPrint(false));
  }, []);

  const commitPaid = () => {
    const n = parseFloat(paid);
    const next = Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined;
    if (next !== garment.paid) updateGarment(garment.id, { paid: next });
    setPaid(next != null ? String(next) : "");
  };

  const commitName = () => {
    const next = name.trim();
    if (next && next !== garment.name) updateGarment(garment.id, { name: next });
    else setName(garment.name);
  };

  const commitColor = (raw: string) => {
    const next = raw.trim().toLowerCase();
    setColor(next);
    const named = next ? nameWithColor(garment.name, next) : garment.name;
    const patch: Partial<Garment> = {
      colors: next ? [next] : [],
    };
    if (named !== garment.name) {
      patch.name = named;
      setName(named);
    }
    if (
      (garment.colors[0] ?? "") !== next ||
      (patch.name && patch.name !== garment.name)
    ) {
      updateGarment(garment.id, patch);
    }
  };

  const updateCover = async () => {
    const next = color.trim().toLowerCase() || garment.colors[0] || "";
    if (!next) {
      setCoverError("Pick a color first.");
      return;
    }
    setRecoloring(true);
    setCoverError(null);
    setCoverNote(null);
    try {
      const image = await coverDataUrl(garment.cutoutSrc || garment.imageSrc);
      if (!image) throw new Error("Could not read the cover.");
      const res = await recolorCover({ data: { image, color: next } });
      if (!res.ok) throw new Error(res.error);
      const key = imageKey(garment.id, "c");
      await putImage(key, dataUrlToBlob(res.image));
      const named = nameWithColor(garment.name, next);
      updateGarment(garment.id, {
        cutoutSrc: key,
        colors: [next],
        ...(named !== garment.name ? { name: named } : {}),
      });
      if (named !== garment.name) setName(named);
      setView("print");
      setCoverNote("Cover updated — original photo unchanged.");
    } catch (e) {
      setCoverError(e instanceof Error ? e.message : "Could not recolor that cover.");
    } finally {
      setRecoloring(false);
    }
  };

  return (
    <div
      className={cn("fixed inset-0 z-50", !md && "flex items-end")}
    >
      <button
        type="button"
        className={cn(
          "absolute inset-0",
          md ? "bg-ink/10" : "bg-ink/30",
        )}
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative z-10 overflow-auto bg-paper border border-hairline",
          md ? "md:grid md:grid-cols-2" : "w-full max-h-[92dvh]",
        )}
        style={
          md && pos
            ? {
                position: "fixed",
                top: pos.top,
                left: pos.left,
                width: pos.width,
                maxHeight: pos.maxHeight,
              }
            : undefined
        }
      >
        <div>
          {view === "me" ? (
            <OnMePanel pieces={[garment]} onUsePaper={() => setView("print")} />
          ) : (
            <div className="bg-paper-deep aspect-page">
              {view === "print" ? (
                <GarmentImg
                  garment={garment}
                  className="h-full w-full object-contain p-[8%]"
                />
              ) : originalSrc ? (
                <img
                  src={originalSrc}
                  alt={garment.name}
                  className="h-full w-full object-contain p-[8%]"
                />
              ) : (
                <div className="h-full w-full" aria-hidden />
              )}
            </div>
          )}
          <div className="flex border-t border-hairline">
            {(["print", "original"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  "micro flex-1 py-2",
                  view === v ? "bg-ink text-paper" : "text-ink-soft",
                )}
              >
                {v === "print" ? "Cover" : "Original"}
              </button>
            ))}
            {refPhoto && (
              <button
                type="button"
                onClick={() => setView("me")}
                className={cn(
                  "micro flex-1 py-2",
                  view === "me" ? "bg-ink text-paper" : "text-ink-soft",
                )}
              >
                On me
              </button>
            )}
          </div>
          {!usingOriginal && view !== "me" && (
            <button
              type="button"
              onClick={() => {
                updateGarment(garment.id, { cutoutSrc: garment.imageSrc });
                setView("original");
              }}
              className="micro w-full py-2 text-ink-soft border-t border-hairline hover:text-ink"
            >
              Use my photo as cover — the extract lies
            </button>
          )}
        </div>
        <div className="p-6 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <select
              value={garment.category}
              onChange={(e) =>
                updateGarment(garment.id, {
                  category: e.target.value as Category,
                })
              }
              className="micro border border-hairline bg-card px-2 py-1 text-ink-soft"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            aria-label="Name"
            className="font-editorial text-3xl tracking-tight bg-transparent border-b border-transparent hover:border-hairline focus:border-hairline-strong focus:outline-none w-full"
          />
          {garment.demo && (
            <p className="text-sm text-ink-soft">
              Sample piece — not from your closet. Add a photo of the real thing
              to replace this look.
            </p>
          )}
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="micro text-ink-soft">Subtype</dt>
              <dd>{garment.subtype || "—"}</dd>
            </div>
            <div>
              <dt className="micro text-ink-soft">Material</dt>
              <dd>{garment.material || "—"}</dd>
            </div>
            <div className="col-span-2">
              <dt className="micro text-ink-soft">Color</dt>
              <dd className="mt-1 space-y-2">
                <div className="flex flex-wrap gap-1">
                  {COLOR_CHIPS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => commitColor(c)}
                      className={cn(
                        "micro border px-2 py-1",
                        (color || garment.colors[0] || "") === c
                          ? "border-ink bg-ink text-paper"
                          : "border-hairline text-ink-soft",
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <input
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  onBlur={() => commitColor(color)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  aria-label="Color"
                  placeholder="maroon"
                  className="h-9 w-40 border border-hairline bg-card px-2 text-sm"
                />
                {canPrint && (
                  <button
                    type="button"
                    disabled={recoloring}
                    onClick={() => void updateCover()}
                    className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong disabled:opacity-40 inline-flex items-center gap-2"
                  >
                    {recoloring && <Loader2 className="size-3 animate-spin" />}
                    {recoloring ? "Recoloring…" : "Update cover"}
                  </button>
                )}
                {coverNote && (
                  <p className="text-sm text-ink-soft">{coverNote}</p>
                )}
                {coverError && (
                  <p className="text-sm text-accent">{coverError}</p>
                )}
              </dd>
            </div>
            <div>
              <dt className="micro text-ink-soft">Fit</dt>
              <dd>{garment.fit || "regular"}</dd>
            </div>
            <div>
              <dt className="micro text-ink-soft">Worn</dt>
              <dd>
                {garment.wornOn.length} times
                {garment.wornOn.length === 0
                  ? " · never"
                  : ` · last ${daysIdle(garment)}d ago`}
              </dd>
            </div>
            <div>
              <dt className="micro text-ink-soft">House</dt>
              <dd>{housesOf(garment).map((h) => HOUSE_LABEL[h]).join(" · ")}</dd>
            </div>
          </dl>
          <div>
            <label className="block">
              <span className="micro text-ink-soft">What you paid</span>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="—"
                className="mt-1 h-10 w-32 border border-hairline bg-card px-3 text-sm"
                value={paid}
                onChange={(e) => setPaid(e.target.value)}
                onBlur={commitPaid}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </label>
            {cpw != null && (
              <p className="mt-1 text-sm text-ink-soft">
                {garment.wornOn.length === 0
                  ? `first wear ${money(garment.paid ?? 0)}`
                  : `cost per wear ${money(cpw)}`}
              </p>
            )}
          </div>
          {garment.notes && (
            <p className="text-sm text-ink-soft">{garment.notes}</p>
          )}
          <div className="mt-auto flex flex-wrap gap-2 pt-4">
            <Button onClick={() => wearToday([garment.id])} disabled={worn}>
              {worn ? "Worn today" : "I wore this"}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                removeGarment(garment.id);
                onClose();
              }}
            >
              Remove
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

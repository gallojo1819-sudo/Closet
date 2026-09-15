import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { GarmentImg } from "@/components/closet/gimg";
import { OnMePanel } from "@/components/closet/on-me";
import { Button } from "@/components/ui/button";
import { describeCover, readAiStatus, recolorCover } from "@/lib/ai";
import {
  coversSameSilhouette,
  notesWantGurkha,
  patchFromNotes,
  stillLooksLikeDrawstring,
} from "@/lib/describe";
import {
  blobToDataUrl,
  dataUrlToBlob,
  getImage,
  imageKey,
  isIdbKey,
  notifyImage,
  putImage,
  putThumb,
} from "@/lib/images";
import { costPerWear, money } from "@/lib/look";
import { PALETTE, nameWithColor } from "@/lib/color";
import { HOUSE_LABEL, daysIdle, housesOf } from "@/lib/style";
import { CATEGORIES, SEASONS, type Category, type Garment } from "@/lib/types";
import { seasonsOf } from "@/lib/season";
import { guessTuck, tuckOf } from "@/lib/tuck";
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

/** md+ centered card. Phone stays a bottom sheet. */
export function sheetPanelClass(md: boolean, extra?: string) {
  return cn(
    "relative z-10 overflow-auto bg-paper border border-hairline",
    md
      ? "fixed left-1/2 top-1/2 w-[min(100%-2rem,42rem)] max-w-2xl max-h-[90dvh] -translate-x-1/2 -translate-y-1/2"
      : "w-full max-h-[92dvh]",
    extra,
  );
}

export function useMdUp() {
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

/** Prefer next to the tile. If it won't fit, dead-center. Never below the fold. */
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
  const width = Math.min(720, Math.max(320, tile.width * 2 + 16), vw - pad * 2);
  const maxHeight = Math.min(vh - pad * 2, Math.round(vh * 0.9));

  const roomRight = tile.right + gap + width <= vw - pad;
  const roomLeft = tile.left - gap - width >= pad;
  if (roomRight || roomLeft) {
    let top = tile.top;
    if (top + maxHeight > vh - pad) top = vh - pad - maxHeight;
    if (top < pad) top = pad;
    return {
      top,
      left: roomRight ? tile.right + gap : tile.left - gap - width,
      width,
      maxHeight,
    };
  }
  return {
    top: Math.max(pad, (vh - maxHeight) / 2),
    left: Math.max(pad, (vw - width) / 2),
    width,
    maxHeight,
  };
}

export function GarmentDetail({
  garment,
  onClose,
  getTile,
  onLooks,
}: {
  garment: Garment;
  onClose: () => void;
  getTile?: () => HTMLElement | null;
  onLooks?: () => void;
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
  const [subtype, setSubtype] = useState(garment.subtype ?? "");
  const [notes, setNotes] = useState(garment.notes ?? "");
  const [color, setColor] = useState(garment.colors[0] ?? "");
  const [canPrint, setCanPrint] = useState(false);
  const [recoloring, setRecoloring] = useState(false);
  const [matching, setMatching] = useState(false);
  const [coverTick, setCoverTick] = useState(0);
  const [coverNote, setCoverNote] = useState<string | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
  const originalSrc = useImageSrc(garment.imageSrc);
  const usingOriginal = garment.cutoutSrc === garment.imageSrc;
  const cpw = costPerWear(garment);
  const md = useMdUp();
  void getTile;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    readAiStatus()
      .then((s) => setCanPrint(s.print))
      .catch(() => setCanPrint(false));
  }, []);

  useEffect(() => {
    setName(garment.name);
    setSubtype(garment.subtype ?? "");
    setNotes(garment.notes ?? "");
    setColor(garment.colors[0] ?? "");
    setCoverNote(null);
    setCoverError(null);
  }, [garment.id]);

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

  const commitSubtype = () => {
    const next = subtype.trim();
    if (next !== (garment.subtype ?? "")) {
      updateGarment(garment.id, { subtype: next });
    }
  };

  const commitNotes = () => {
    const patch = patchFromNotes(garment, notes);
    if (patch.subtype != null) setSubtype(patch.subtype);
    if (patch.name) setName(patch.name);
    const sameNotes = (patch.notes ?? "") === (garment.notes ?? "");
    const sameSub = (patch.subtype ?? garment.subtype) === garment.subtype;
    const sameName = !patch.name || patch.name === garment.name;
    const sameCat = !patch.category || patch.category === garment.category;
    if (/untuck|\btucked\b|\btuck in\b/.test(notes.toLowerCase())) {
      patch.tuck = guessTuck({
        name: garment.name,
        subtype: patch.subtype ?? garment.subtype,
        notes,
      });
    }
    if (sameNotes && sameSub && sameName && sameCat && !patch.tuck) return;
    if (canPrint && notes.trim()) {
      void matchCover();
      return;
    }
    updateGarment(garment.id, patch);
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
      void putThumb(garment.id, res.image).catch(() => {});
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

  const matchCover = async () => {
    const patch = patchFromNotes(garment, notes);
    if (patch.subtype != null) setSubtype(patch.subtype);
    if (patch.name) setName(patch.name);
    updateGarment(garment.id, patch);
    if (!(patch.notes ?? "").trim()) {
      setCoverError("Describe the make first.");
      return;
    }
    setMatching(true);
    setCoverError(null);
    setCoverNote(null);
    try {
      const origKey = imageKey(garment.id, "o");
      const original =
        (await coverDataUrl(origKey)) || (await coverDataUrl(garment.imageSrc));
      if (!original) throw new Error("Could not read the original photo.");
      const prevCover = await coverDataUrl(garment.cutoutSrc || garment.imageSrc);
      const res = await describeCover({
        data: { image: original, notes: patch.notes ?? notes },
      });
      if (!res.ok) throw new Error(res.error);
      const gurkha = notesWantGurkha(patch.notes ?? notes);
      if (gurkha) {
        if (await stillLooksLikeDrawstring(original, res.image)) {
          throw new Error("Cover still looks like a drawstring — try again.");
        }
      } else {
        const stillOriginal = await coversSameSilhouette(original, res.image);
        const stillPrev = prevCover
          ? await coversSameSilhouette(prevCover, res.image)
          : false;
        if (stillOriginal || stillPrev) {
          throw new Error("Cover came back the same silhouette. Sharpen the make.");
        }
      }
      const key = imageKey(garment.id, "c");
      await putImage(key, dataUrlToBlob(res.image));
      await putThumb(garment.id, res.image);
      notifyImage(key);
      notifyImage(imageKey(garment.id, "t"));
      updateGarment(garment.id, {
        ...patch,
        cutoutSrc: key,
      });
      setCoverTick((n) => n + 1);
      setView("print");
      setCoverNote("Cover updated — original photo unchanged.");
    } catch (e) {
      setCoverError(e instanceof Error ? e.message : "Could not match that cover.");
    } finally {
      setMatching(false);
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
      <div className={sheetPanelClass(md, md ? "md:grid md:grid-cols-2" : undefined)}>
        <div>
          {view === "me" ? (
            <OnMePanel pieces={[garment]} onUsePaper={() => setView("print")} />
          ) : (
            <div
              className="bg-paper-deep aspect-page"
              style={{ viewTransitionName: `piece-${garment.id}` }}
            >
              {view === "print" ? (
                <GarmentImg
                  key={`cover-${garment.id}-${coverTick}`}
                  garment={garment}
                  thumb={false}
                  eager
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
              <dd>
                <input
                  value={subtype}
                  onChange={(e) => setSubtype(e.target.value)}
                  onBlur={commitSubtype}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  aria-label="Subtype"
                  placeholder="gurkha"
                  className="mt-1 h-9 w-full border border-hairline bg-card px-2 text-sm"
                />
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="micro text-ink-soft">Tuck</dt>
              <dd className="mt-1 space-y-2">
                <div className="flex flex-wrap gap-1">
                  {(
                    [
                      ["in", "Tucked"],
                      ["out", "Untucked"],
                      ["either", "Either"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => updateGarment(garment.id, { tuck: id })}
                      className={cn(
                        "micro border px-2 py-1",
                        tuckOf(garment) === id
                          ? "border-ink bg-ink text-paper"
                          : "border-hairline text-ink-soft",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-sm text-ink-soft">
                  Ralph client tucks the oxford. Camp collar stays out.
                </p>
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="micro text-ink-soft">Season</dt>
              <dd className="mt-1 space-y-2">
                <div className="flex flex-wrap gap-1">
                  {SEASONS.map((s) => {
                    const on = seasonsOf(garment).includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          const cur = new Set(seasonsOf(garment));
                          if (cur.has(s.id)) cur.delete(s.id);
                          else cur.add(s.id);
                          updateGarment(garment.id, { seasons: [...cur] });
                        }}
                        className={cn(
                          "micro border px-2 py-1",
                          on
                            ? "border-ink bg-ink text-paper"
                            : "border-hairline text-ink-soft",
                        )}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </dd>
            </div>
            <div>
              <dt className="micro text-ink-soft">Material</dt>
              <dd>{garment.material || "—"}</dd>
            </div>
            <div className="col-span-2">
              <dt className="micro text-ink-soft">Style / make</dt>
              <dd className="mt-1 space-y-2">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  onBlur={commitNotes}
                  rows={3}
                  aria-label="Style / make"
                  placeholder="Gurkha. Extended waistband, side buckle, no belt, not a drawstring."
                  className="w-full border border-hairline bg-card px-2 py-2 text-sm leading-relaxed"
                />
                {canPrint && (
                  <button
                    type="button"
                    disabled={matching || recoloring}
                    onClick={() => void matchCover()}
                    className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong disabled:opacity-40 inline-flex items-center gap-2"
                  >
                    {matching && <Loader2 className="size-3 animate-spin" />}
                    {matching ? "Matching…" : "Match cover to this"}
                  </button>
                )}
                <p className="text-sm text-ink-soft">
                  Cover follows the description. Original photo stays.
                </p>
              </dd>
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
          <div className="mt-auto flex flex-wrap gap-2 pt-4">
            {onLooks && (
              <Button variant="ghost" onClick={onLooks}>
                5 looks with this
              </Button>
            )}
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

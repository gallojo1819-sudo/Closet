import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FlatLay } from "@/components/closet/flat-lay";
import { GarmentImg } from "@/components/closet/gimg";
import { placeBesideTile, useMdUp } from "@/components/closet/detail";
import { ensureLookOnMe } from "@/components/closet/on-me";
import { dataUrlToBlob, getImage, lookOnMeKey } from "@/lib/images";
import { moreLikeThis } from "@/lib/lookbook";
import { useCloset } from "@/lib/store";
import type { Garment, Look } from "@/lib/types";
import { useImageSrc } from "@/lib/use-image";
import { cn } from "@/lib/utils";

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
  const cacheKey = lookOnMeKey(look.id);
  const cachedSrc = useImageSrc(cacheKey);
  const [frame, setFrame] = useState<string | null>(null);
  const [showMe, setShowMe] = useState(false);
  const [dressing, setDressing] = useState(false);
  const [dressError, setDressError] = useState<string | null>(null);
  const [showAlts, setShowAlts] = useState(false);
  const gen = useRef(0);
  const piecesRef = useRef(pieces);
  piecesRef.current = pieces;
  const md = useMdUp();
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const painted = frame || cachedSrc;

  useLayoutEffect(() => {
    if (!md) {
      setPos(null);
      return;
    }
    const place = () => {
      const el = getCard?.();
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
  }, [md, look.id, getCard]);

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
      if (!useCloset.getState().refPhoto) return;
      setDressing(true);
      try {
        const image = await ensureLookOnMe(look.id, piecesRef.current);
        if (!live || n !== gen.current) return;
        const url = URL.createObjectURL(dataUrlToBlob(image));
        setFrame((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        setShowMe(true);
      } catch (e) {
        if (!live || n !== gen.current) return;
        const msg = e instanceof Error ? e.message : "Could not dress you.";
        setDressError(msg === "timeout" ? "Imagine timed out after 45s." : msg);
      } finally {
        if (live && n === gen.current) setDressing(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [look.id, cacheKey]);

  const alts = showAlts ? moreLikeThis(look, book, closet, 3) : null;

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
        const image = await ensureLookOnMe(look.id, piecesRef.current);
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
      <div
        className={cn(
          "relative z-10 overflow-auto bg-paper border border-hairline",
          md ? "" : "w-full max-h-[92dvh]",
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
        <div className="relative border-b border-hairline bg-paper aspect-[4/5] overflow-hidden">
          <FlatLay pieces={pieces} className="border-0" passive />
          {showMe && painted && (
            <img
              key={painted}
              src={painted}
              alt={look.name}
              className="on-you-glass absolute inset-0 z-10 h-full w-full object-cover bg-paper"
            />
          )}
        </div>
        <div className="p-4 flex flex-col gap-4">
          <div>
            <p>{look.name}</p>
            <p className="micro text-ink-soft">{look.occasion}</p>
          </div>
          <button
            type="button"
            onClick={runDress}
            className={cn(
              "micro border px-3 py-2 self-start",
              showMe && painted
                ? "border-ink bg-ink text-paper"
                : "border-hairline text-ink-soft hover:border-hairline-strong",
            )}
          >
            {dressing ? "On you…" : "On you"}
          </button>
          {dressError && <p className="text-sm text-accent">{dressError}</p>}
          <ul className="flex gap-2 overflow-x-auto">
            {pieces.map((g) => (
              <li key={g.id} className="w-16 shrink-0">
                <div className="aspect-page border border-hairline bg-paper-deep overflow-hidden">
                  <GarmentImg
                    garment={g}
                    className="h-full w-full object-contain p-[8%]"
                  />
                </div>
              </li>
            ))}
          </ul>
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
              onClick={() => setShowAlts(true)}
              className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong"
            >
              More like this
            </button>
            <button
              type="button"
              onClick={onClose}
              className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong"
            >
              Close
            </button>
          </div>
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
                        <FlatLay
                          pieces={shot}
                          className="pointer-events-none"
                          passive
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

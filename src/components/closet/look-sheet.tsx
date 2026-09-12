import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FlatLay } from "@/components/closet/flat-lay";
import { GarmentImg } from "@/components/closet/gimg";
import { placeBesideTile, useMdUp } from "@/components/closet/detail";
import { dressLook } from "@/components/closet/on-me";
import {
  dataUrlToBlob,
  deleteImage,
  getImage,
  lookOnMeKey,
  putImage,
} from "@/lib/images";
import { moreLikeThis } from "@/lib/lookbook";
import type { Garment, Look } from "@/lib/types";
import { useImageSrc } from "@/lib/use-image";
import { cn } from "@/lib/utils";

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      },
    );
  });
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
  const cacheKey = lookOnMeKey(look.id);
  const cachedSrc = useImageSrc(cacheKey);
  const [frame, setFrame] = useState<string | null>(null);
  const [showMe, setShowMe] = useState(false);
  const [dressing, setDressing] = useState(false);
  const [dressError, setDressError] = useState<string | null>(null);
  const [showAlts, setShowAlts] = useState(false);
  const gen = useRef(0);
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
    gen.current += 1;
    setShowMe(false);
    setDressing(false);
    setDressError(null);
    setFrame(null);
  }, [look.id]);

  const alts = showAlts ? moreLikeThis(look, book, closet, 3) : null;

  const paint = (dataUrl: string) => {
    const url = URL.createObjectURL(dataUrlToBlob(dataUrl));
    setFrame((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    setShowMe(true);
  };

  const runDress = (force = false) => {
    if (dressing) return;
    const n = gen.current;
    setDressing(true);
    setDressError(null);
    void (async () => {
      try {
        if (!force) {
          const hit = await getImage(cacheKey);
          if (n !== gen.current) return;
          if (hit) {
            setShowMe(true);
            return;
          }
        } else {
          await deleteImage(cacheKey);
        }
        const image = await withTimeout(dressLook(pieces), 45_000);
        if (n !== gen.current) return;
        await putImage(cacheKey, dataUrlToBlob(image));
        if (n !== gen.current) return;
        paint(image);
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
            onClick={() => {
              if (painted && !dressError) setShowMe((v) => !v);
              else runDress(Boolean(dressError));
            }}
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
          {alts && (
            alts.length === 0 ? (
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
            )
          )}
        </div>
      </div>
    </div>
  );
}

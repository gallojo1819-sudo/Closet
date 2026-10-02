import { useEffect, useRef } from "react";
import { requestCutout, requestThumb } from "@/lib/cloud/blobs";
import { isCloudSrc } from "@/lib/cloud/src";
import { backupPhotos } from "@/lib/cloud/sync";
import { imageKey, isIdbKey } from "@/lib/images";
import { hasCleanCover } from "@/lib/plate";
import { useImageSrc } from "@/lib/use-image";
import type { Garment } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Grid uses :t only. Drawer / Look kit / On you pass thumb={false} for :c. */
export function GarmentImg({
  garment,
  className,
  alt,
  thumb = true,
  eager = false,
  nudge = true,
}: {
  garment: Garment;
  className?: string;
  alt?: string;
  thumb?: boolean;
  eager?: boolean;
  nudge?: boolean;
}) {
  const clean = hasCleanCover(garment);
  const fullKey = clean ? garment.cutoutSrc : "";
  const cloudSrc = clean && isCloudSrc(garment.cutoutSrc) ? garment.cutoutSrc : "";
  const thumbKey = !clean
    ? ""
    : cloudSrc && !cloudSrc.endsWith("/o.jpg")
      ? cloudSrc
      : imageKey(garment.id, "t");
  const thumbSrc = useImageSrc(thumbKey);
  const fullSrc = useImageSrc(thumb ? "" : fullKey);
  const src = !clean ? "" : thumb ? thumbSrc : fullSrc || thumbSrc;
  const node = useRef<HTMLElement | null>(null);
  const phoneOnly = isIdbKey(garment.cutoutSrc) || isIdbKey(garment.imageSrc);
  const showChip =
    clean && nudge && phoneOnly && !isCloudSrc(garment.cutoutSrc) && !isCloudSrc(garment.imageSrc);

  useEffect(() => {
    if (!clean) return;
    if (!thumb) {
      requestCutout(garment.id, garment.cutoutSrc);
      return;
    }
    if (eager || thumbSrc) {
      if (!thumbSrc) requestThumb(garment.id);
      return;
    }
    const el = node.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) requestThumb(garment.id);
      },
      { rootMargin: "240px", threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [clean, garment.id, garment.cutoutSrc, thumb, eager, thumbSrc]);

  return (
    <div
      ref={(el) => {
        node.current = el;
      }}
      className={cn("relative", className)}
    >
      {src ? (
        <img
          src={src}
          alt={alt ?? garment.name}
          className="h-full w-full object-contain"
          loading={eager ? "eager" : "lazy"}
          decoding="async"
        />
      ) : (
        <div className="absolute inset-0 paper-shimmer" aria-hidden />
      )}
      {showChip && (
        <span
          className="absolute bottom-1 left-1 z-10 max-w-[calc(100%-0.5rem)] truncate micro bg-paper/95 px-1.5 py-0.5 border border-hairline text-ink-soft"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            backupPhotos();
          }}
        >
          On this phone — Backup
        </span>
      )}
    </div>
  );
}

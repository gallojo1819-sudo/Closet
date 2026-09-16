import { useEffect, useRef } from "react";
import { requestCutout, requestThumb } from "@/lib/cloud/blobs";
import { imageKey } from "@/lib/images";
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
}: {
  garment: Garment;
  className?: string;
  alt?: string;
  thumb?: boolean;
  eager?: boolean;
}) {
  const fullKey = garment.cutoutSrc || garment.imageSrc;
  const thumbKey = imageKey(garment.id, "t");
  const thumbSrc = useImageSrc(thumbKey);
  const fullSrc = useImageSrc(thumb ? "" : fullKey);
  const src = thumb ? thumbSrc : fullSrc || thumbSrc;
  const node = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!thumb) {
      requestCutout(garment.id);
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
  }, [garment.id, thumb, eager, thumbSrc]);

  if (!src) {
    return (
      <div
        ref={(el) => {
          node.current = el;
        }}
        className={cn("bg-paper", className)}
        aria-hidden
      />
    );
  }
  return (
    <img
      ref={(el) => {
        node.current = el;
      }}
      src={src}
      alt={alt ?? garment.name}
      className={className}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
    />
  );
}

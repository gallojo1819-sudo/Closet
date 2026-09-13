import { useEffect } from "react";
import { ensureThumb, imageKey } from "@/lib/images";
import { useImageSrc } from "@/lib/use-image";
import type { Garment } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The garment's own photo — thumb in grids, full cutout in detail. */
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
  const thumbSrc = useImageSrc(thumb ? thumbKey : "");
  const fullSrc = useImageSrc(fullKey);
  const src = thumb ? thumbSrc || fullSrc : fullSrc;

  useEffect(() => {
    if (!thumb || thumbSrc) return;
    void ensureThumb(garment.id, fullKey);
  }, [thumb, thumbSrc, garment.id, fullKey]);

  if (!src) return <div className={cn("bg-paper", className)} aria-hidden />;
  return (
    <img
      src={src}
      alt={alt ?? garment.name}
      className={className}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
    />
  );
}

import { useImageSrc } from "@/lib/use-image";
import type { Garment } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The garment's own photo — cutout first, resolving IDB keys to blob URLs. */
export function GarmentImg({
  garment,
  className,
  alt,
}: {
  garment: Garment;
  className?: string;
  alt?: string;
}) {
  const src = useImageSrc(garment.cutoutSrc || garment.imageSrc);
  if (!src) return <div className={cn("bg-paper-deep", className)} aria-hidden />;
  return <img src={src} alt={alt ?? garment.name} className={className} />;
}

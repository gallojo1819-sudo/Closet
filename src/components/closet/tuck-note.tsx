import { tuckMark } from "@/lib/tuck";
import type { Garment } from "@/lib/types";
import { cn } from "@/lib/utils";

/** "untucked", "tucked", or nothing. A knit worn in is nothing. */
export function TuckNote({
  d,
  lead,
  className,
}: {
  d: "in" | "out" | "none";
  lead: Garment | null;
  className?: string;
}) {
  const mark = tuckMark(d, lead);
  if (!mark) return null;
  return <p className={cn("micro text-ink-soft", className)}>{mark}</p>;
}

import { FlatLay } from "@/components/closet/flat-lay";
import { leadTop, lookTuckDecision } from "@/lib/look";
import { tuckMark } from "@/lib/tuck";
import type { Garment } from "@/lib/types";

/** One "N looks with this" card. The plate and the caption share one decision. */
export function HeroLookCard({
  pieces,
  name,
  occasion,
  habits = [],
}: {
  pieces: Garment[];
  name: string;
  occasion: string;
  habits?: readonly string[];
}) {
  const d = lookTuckDecision(pieces, occasion, habits);
  const lead = leadTop(pieces);
  const mark = tuckMark(d, lead);
  return (
    <>
      <FlatLay
        pieces={pieces}
        className="pointer-events-none"
        passive
        tuck={d}
        leadId={lead?.id}
      />
      <p className="mt-2 text-sm">{name}</p>
      <p className="micro text-ink-soft">
        {occasion}
        {mark ? ` · ${mark}` : ""}
      </p>
    </>
  );
}

import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { GarmentDetail } from "@/components/closet/detail";
import { GarmentTile } from "@/components/closet/tile";
import { useCloset } from "@/lib/store";
import { CATEGORIES, type Category } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/closet")({ component: ClosetPage });

function ClosetPage() {
  const garmentsAll = useCloset((s) => s.garments);
  const [filter, setFilter] = useState<"all" | Category>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const garments = useMemo(
    () => garmentsAll.filter((g) => !g.archived),
    [garmentsAll],
  );
  const list = useMemo(
    () => (filter === "all" ? garments : garments.filter((g) => g.category === filter)),
    [garments, filter],
  );
  const open = garments.find((g) => g.id === openId) ?? null;
  const showingDemo = garments.some((g) => g.demo);

  return (
    <div className="mx-auto max-w-6xl px-4 md:px-6 py-8 md:py-12 rise">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="micro text-ink-soft">The closet</p>
          <h1 className="mt-2 font-editorial text-4xl md:text-6xl tracking-tight">
            {garments.length} pieces
            <span className="italic text-accent"> on paper.</span>
          </h1>
        </div>
        <Link
          to="/add"
          className="inline-flex h-11 items-center bg-accent px-4 text-sm text-paper"
        >
          Add a piece
        </Link>
      </div>
      {showingDemo && (
        <p className="mt-6 max-w-xl text-sm text-ink-soft border border-hairline bg-card px-4 py-3">
          Sample wardrobe for the look of the grid. Add a photo of something you
          own — we keep that picture, and the samples step aside.
        </p>
      )}
      <div className="mt-8 flex gap-2 overflow-x-auto pb-2">
        {(["all", ...CATEGORIES] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setFilter(c)}
            className={cn(
              "micro shrink-0 border px-3 py-2",
              filter === c
                ? "border-ink bg-ink text-paper"
                : "border-hairline text-ink-soft",
            )}
          >
            {c}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="mt-16 text-ink-soft">
          Nothing in this drawer. Photograph a piece on a plain surface.
        </p>
      ) : (
        <ul className="mt-8 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8">
          {list.map((g, i) => (
            <li
              key={g.id}
              className="rise"
              style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
            >
              <GarmentTile garment={g} onClick={() => setOpenId(g.id)} />
            </li>
          ))}
        </ul>
      )}
      {open && <GarmentDetail garment={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}

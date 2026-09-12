import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FlatLay } from "@/components/closet/flat-lay";
import { LookBuilder } from "@/components/closet/look-builder";
import { OnMeButton } from "@/components/closet/on-me";
import { lookbookPool, lookbookStats } from "@/lib/lookbook";
import { slotOf } from "@/lib/style";
import { useCloset } from "@/lib/store";
import type { Garment } from "@/lib/types";

export const Route = createFileRoute("/lookbook")({ component: LookbookPage });

function LookbookPage() {
  const hydrated = useCloset((s) => s.hydrated);
  const garmentsAll = useCloset((s) => s.garments);
  const looksAll = useCloset((s) => s.looks);
  const ensureLookbook = useCloset((s) => s.ensureLookbook);
  const wearToday = useCloset((s) => s.wearToday);
  const saveLook = useCloset((s) => s.saveLook);
  const [play, setPlay] = useState(false);

  useEffect(() => {
    if (!hydrated || garmentsAll.length === 0) return;
    ensureLookbook();
  }, [hydrated, garmentsAll, ensureLookbook]);

  const garments = useMemo(
    () => garmentsAll.filter((g) => !g.archived),
    [garmentsAll],
  );
  const byId = useMemo(() => {
    const m = new Map<string, Garment>();
    for (const g of garments) m.set(g.id, g);
    return m;
  }, [garments]);
  const book = useMemo(
    () => looksAll.filter((l) => l.lookbook),
    [looksAll],
  );
  const pool = lookbookPool(garments);
  const canBuild = ["top", "bottom", "footwear"].every((slot) =>
    pool.some((g) => slotOf(g) === slot || (slot === "top" && slotOf(g) === "dress")),
  );
  const stats = lookbookStats(book, garments);

  return (
    <div className="mx-auto max-w-6xl px-4 md:px-6 py-8 md:py-12 rise">
      <p className="micro text-ink-soft">Lookbook</p>
      <h1 className="mt-2 font-editorial text-4xl md:text-6xl tracking-tight">
        Lookbook
      </h1>
      <p className="mt-3 text-ink-soft max-w-xl">
        Best outfits from this closet. Updates when you add.
      </p>
      {book.length > 0 && (
        <p className="mt-3 micro text-ink-soft">
          {stats.looks} looks · {stats.pieces} pieces
          {stats.everyPieceUsed ? " · every piece used." : "."}
        </p>
      )}
      <button
        type="button"
        onClick={() => setPlay((v) => !v)}
        className="mt-4 micro text-ink-soft hover:text-ink"
      >
        {play ? "Close builder" : "Make a look"}
      </button>
      {play && (
        <div className="mt-4">
          <LookBuilder onClose={() => setPlay(false)} />
        </div>
      )}

      {hydrated && garments.length === 0 ? (
        <div className="mt-10 border border-hairline bg-card px-4 py-5">
          <p className="text-sm text-ink-soft">
            Lookbook is this closet. Add pieces on Add — don’t re-upload here.
          </p>
          <Link
            to="/add"
            className="mt-4 inline-flex h-11 items-center bg-accent px-4 text-sm text-paper"
          >
            Add a piece
          </Link>
        </div>
      ) : !canBuild ? (
        <div className="mt-10 border border-hairline bg-card px-4 py-5">
          <p className="text-sm text-ink-soft">
            Need a top, a bottom, and shoes.
          </p>
          <Link
            to="/add"
            className="mt-4 inline-flex h-11 items-center bg-accent px-4 text-sm text-paper"
          >
            Add a piece
          </Link>
        </div>
      ) : (
        <ul className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {book.map((look) => {
            const pieces = look.garmentIds
              .map((id) => byId.get(id))
              .filter((g): g is Garment => Boolean(g));
            if (pieces.length < 3) return null;
            return (
              <li key={look.id}>
                <FlatLay pieces={pieces} />
                <p className="mt-3">{look.name}</p>
                <p className="micro text-ink-soft">{look.occasion}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => wearToday(look.garmentIds)}
                    className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong"
                  >
                    Wear this
                  </button>
                  <OnMeButton pieces={pieces} />
                  <button
                    type="button"
                    onClick={() =>
                      saveLook({
                        name: look.name,
                        occasion: look.occasion,
                        garmentIds: look.garmentIds,
                        source: "manual",
                      })
                    }
                    className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong"
                  >
                    Save
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

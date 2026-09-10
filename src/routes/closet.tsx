import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { GarmentDetail } from "@/components/closet/detail";
import { GarmentTile } from "@/components/closet/tile";
import { daysIdle } from "@/lib/style";
import { useCloset } from "@/lib/store";
import { CATEGORIES, type Category } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/closet")({ component: ClosetPage });

type Filter = "all" | "waiting" | Category;

function ClosetPage() {
  const garmentsAll = useCloset((s) => s.garments);
  const importCloset = useCloset((s) => s.importCloset);
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const exportCloset = () => {
    const s = useCloset.getState();
    const payload = {
      v: 1,
      garments: s.garments,
      looks: s.looks,
      journal: s.journal,
      avoid: s.avoid,
      drop: s.drop,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "closet-joe.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImportFile = async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.garments)) throw new Error("bad file");
      importCloset({
        garments: data.garments,
        looks: Array.isArray(data.looks) ? data.looks : [],
        journal: Array.isArray(data.journal) ? data.journal : [],
        avoid: data.avoid && typeof data.avoid === "object" ? data.avoid : {},
        drop: data.drop ?? null,
      });
      setOpenId(null);
    } catch {
      setImportError("That file is not a closet export.");
    }
  };

  const garments = useMemo(
    () => garmentsAll.filter((g) => !g.archived),
    [garmentsAll],
  );
  const waiting = useMemo(
    () => garments.filter((g) => daysIdle(g) >= 21),
    [garments],
  );
  const list = useMemo(() => {
    if (filter === "all") return garments;
    if (filter === "waiting") return waiting;
    return garments.filter((g) => g.category === filter);
  }, [garments, waiting, filter]);
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
          {garments.length === 0 && (
            <p className="mt-3 text-sm text-ink-soft">
              Nothing in here yet. The grid is yours once you photograph a piece.
            </p>
          )}
          {waiting.length > 0 && (
            <p className="mt-3 text-sm text-ink-soft">
              {waiting.length} sitting idle. Wear them, don’t buy more.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={exportCloset}
            className="micro border border-hairline px-3 h-11 text-ink-soft hover:border-hairline-strong"
          >
            Export
          </button>
          <button
            type="button"
            onClick={() => importRef.current?.click()}
            className="micro border border-hairline px-3 h-11 text-ink-soft hover:border-hairline-strong"
          >
            Import
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              void onImportFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Link
            to="/add"
            className="inline-flex h-11 items-center bg-accent px-4 text-sm text-paper"
          >
            Add a piece
          </Link>
        </div>
      </div>
      {importError && (
        <p className="mt-4 max-w-xl text-sm text-accent border border-accent/40 bg-card px-4 py-3">
          {importError}
        </p>
      )}
      {showingDemo && (
        <p className="mt-6 max-w-xl text-sm text-ink-soft border border-hairline bg-card px-4 py-3">
          Sample wardrobe for the look of the grid. Add a photo of something you
          own — we keep that picture, and the samples step aside.
        </p>
      )}
      <div className="mt-8 flex gap-2 overflow-x-auto pb-2">
        {(["all", "waiting", ...CATEGORIES] as const).map((c) => (
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
            {c === "waiting" ? `waiting (${waiting.length})` : c}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="mt-16 text-ink-soft">
          {filter === "waiting"
            ? "Everything has been out recently."
            : "Nothing in this drawer. Photograph a piece on a plain surface."}
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
      {open && (
        <GarmentDetail key={open.id} garment={open} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}

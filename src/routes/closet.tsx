import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { GarmentDetail } from "@/components/closet/detail";
import { IdleMount } from "@/components/closet/idle-mount";
import { GarmentTile } from "@/components/closet/tile";
import {
  blobToDataUrl,
  getImage,
  imageKey,
  isIdbKey,
  stashDataUrl,
} from "@/lib/images";
import { daysIdle } from "@/lib/style";
import { useCloset } from "@/lib/store";
import { CATEGORIES, type Category, type Garment } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/closet")({ component: ClosetPage });

type Filter = "all" | "waiting" | Category;

/** Backup files carry pixels as data URLs; the live store carries IDB keys. */
async function embedSrc(src: string): Promise<string> {
  if (!isIdbKey(src)) return src;
  const blob = await getImage(src);
  return blob ? blobToDataUrl(blob) : src;
}

function ClosetPage() {
  const hydrated = useCloset((s) => s.hydrated);
  const garmentsAll = useCloset((s) => s.garments);
  const importCloset = useCloset((s) => s.importCloset);
  const setRefPhoto = useCloset((s) => s.setRefPhoto);
  const removeGarment = useCloset((s) => s.removeGarment);
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const importRef = useRef<HTMLInputElement>(null);
  const tileEls = useRef(new Map<string, HTMLElement>());

  const exportCloset = async () => {
    setBusy(true);
    try {
      const s = useCloset.getState();
      const garments = await Promise.all(
        s.garments.map(async (g) => ({
          ...g,
          imageSrc: await embedSrc(g.imageSrc),
          cutoutSrc: await embedSrc(g.cutoutSrc),
        })),
      );
      const payload = {
        v: 2,
        garments,
        looks: s.looks,
        journal: s.journal,
        avoid: s.avoid,
        drop: s.drop,
        refPhoto: s.refPhoto ? await embedSrc(s.refPhoto) : null,
      };
      const blob = new Blob([JSON.stringify(payload)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "closet-joe.json";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  const onImportFile = async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    setBusy(true);
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.garments)) throw new Error("bad file");
      const garments: Garment[] = [];
      for (const g of data.garments as Garment[]) {
        const imageSrc = await stashDataUrl(imageKey(g.id, "o"), g.imageSrc);
        const cutoutSrc = await stashDataUrl(imageKey(g.id, "c"), g.cutoutSrc);
        garments.push({ ...g, imageSrc, cutoutSrc });
      }
      importCloset({
        garments,
        looks: Array.isArray(data.looks) ? data.looks : [],
        journal: Array.isArray(data.journal) ? data.journal : [],
        avoid: data.avoid && typeof data.avoid === "object" ? data.avoid : {},
        drop: data.drop ?? null,
      });
      if (typeof data.refPhoto === "string" && data.refPhoto.startsWith("data:")) {
        setRefPhoto(await stashDataUrl("idb:me:ref", data.refPhoto));
      }
      setOpenId(null);
    } catch {
      setImportError("That file is not a closet export.");
    } finally {
      setBusy(false);
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
  const selectedCount = selected.size;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (openId) {
        setOpenId(null);
        return;
      }
      if (!selecting) return;
      setSelecting(false);
      setSelected(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, openId]);

  const getOpenTile = useCallback(
    () => (openId ? tileEls.current.get(openId) ?? null : null),
    [openId],
  );

  const exitSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const toggleSelected = (id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(list.map((g) => g.id)));
  };

  const deleteSelected = () => {
    const n = selected.size;
    if (!n) return;
    const noun = n === 1 ? "piece" : "pieces";
    if (!confirm(`Remove ${n} ${noun} and their photos?`)) return;
    for (const id of selected) removeGarment(id);
    exitSelect();
  };

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
          {hydrated && garments.length === 0 && (
            <p className="mt-2 micro text-ink-soft">
              This URL’s closet is empty. localhost and Vercel are different closets. Open closet-ten-hazel.vercel.app if you uploaded there.
            </p>
          )}
          {waiting.length > 0 && (
            <p className="mt-3 text-sm text-ink-soft">
              {waiting.length} sitting idle. Wear them, don’t buy more.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {selecting ? (
            <>
              <button
                type="button"
                onClick={selectAll}
                disabled={list.length === 0}
                className="micro border border-hairline px-3 h-11 text-ink-soft hover:border-hairline-strong disabled:opacity-40"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={deleteSelected}
                disabled={selectedCount === 0}
                className="micro border border-hairline px-3 h-11 text-accent hover:border-hairline-strong disabled:opacity-40"
              >
                Delete {selectedCount}
              </button>
              <button
                type="button"
                onClick={exitSelect}
                className="micro border border-hairline px-3 h-11 text-ink-soft hover:border-hairline-strong"
              >
                Done
              </button>
            </>
          ) : (
            garments.length > 0 && (
              <button
                type="button"
                onClick={() => setSelecting(true)}
                className="micro border border-hairline px-3 h-11 text-ink-soft hover:border-hairline-strong"
              >
                Select
              </button>
            )
          )}
          <button
            type="button"
            onClick={() => void exportCloset()}
            disabled={busy}
            className="micro border border-hairline px-3 h-11 text-ink-soft hover:border-hairline-strong disabled:opacity-40"
          >
            {busy ? "Working…" : "Export"}
          </button>
          <button
            type="button"
            onClick={() => importRef.current?.click()}
            disabled={busy}
            className="micro border border-hairline px-3 h-11 text-ink-soft hover:border-hairline-strong disabled:opacity-40"
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
              ref={(el) => {
                if (el) tileEls.current.set(g.id, el);
                else tileEls.current.delete(g.id);
              }}
            >
              <IdleMount
                index={i}
                always={24}
                placeholder={
                  <div className="aspect-page border border-hairline bg-paper-deep" />
                }
              >
              <GarmentTile
                garment={g}
                selecting={selecting}
                selected={selected.has(g.id) || openId === g.id}
                onClick={() => {
                  if (selecting) {
                    toggleSelected(g.id);
                    return;
                  }
                  setOpenId((cur) => (cur === g.id ? null : g.id));
                }}
              />
              </IdleMount>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <GarmentDetail
          key={open.id}
          garment={open}
          getTile={getOpenTile}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

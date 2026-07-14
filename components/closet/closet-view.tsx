"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Shirt,
  CopyCheck,
  X,
  Trash2,
  Wand2,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CATEGORIES,
  type Category,
  type GarmentRow,
} from "@/lib/garments/types";
import {
  updateGarment,
  deleteGarment,
  mergeDuplicate,
  keepBoth,
  regenerateCutout,
  retryAllFailedCutouts,
  type GarmentEdit,
} from "@/app/(app)/closet/actions";

export type EnrichedGarment = GarmentRow & {
  thumbUrl: string | null;
  cutoutUrl: string | null;
};

// ---------------------------------------------------------------------------
// Filter pills — a fixed catalog taxonomy. Each maps to garment categories;
// OUTFITS is a real tab that (for now) renders an empty state.
// ---------------------------------------------------------------------------
type PillKey =
  | "all"
  | "top"
  | "outerwear"
  | "bottom"
  | "accessory"
  | "footwear"
  | "outfits";

const PILLS: { key: PillKey; label: string; cats?: Category[] }[] = [
  { key: "all", label: "All" },
  { key: "top", label: "Tops", cats: ["top"] },
  { key: "outerwear", label: "Jackets", cats: ["outerwear"] },
  { key: "bottom", label: "Bottoms", cats: ["bottom"] },
  { key: "accessory", label: "Accessories", cats: ["accessory"] },
  { key: "footwear", label: "Shoes", cats: ["footwear"] },
  { key: "outfits", label: "Outfits" },
];

const CATEGORY_LABELS: Record<Category, string> = {
  top: "Top",
  bottom: "Bottom",
  outerwear: "Outerwear",
  dress: "Dress",
  footwear: "Footwear",
  accessory: "Accessory",
  other: "Other",
};

// Shared light-theme input styling for the product detail.
const inputClass =
  "flex h-10 w-full rounded-lg border border-neutral-300 bg-white/70 px-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-1 focus-visible:ring-offset-cream";

// ---------------------------------------------------------------------------
// Catalog cell — a garment floating on the cream field.
// ---------------------------------------------------------------------------
function GarmentImage({ g }: { g: EnrichedGarment }) {
  // Verified cutout → floats, object-contain. Photo-only (failed/hold) → real
  // cropped photo filling a soft rounded frame so it reads as a product, not an
  // error.
  if (g.cutoutUrl) {
    return (
      <Image
        src={g.cutoutUrl}
        alt={g.subtype ?? g.category}
        fill
        sizes="(max-width: 640px) 45vw, 200px"
        className="object-contain p-2"
        unoptimized
      />
    );
  }
  if (g.thumbUrl) {
    return (
      <Image
        src={g.thumbUrl}
        alt={g.subtype ?? g.category}
        fill
        sizes="(max-width: 640px) 45vw, 200px"
        className="rounded-2xl object-cover"
        unoptimized
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center rounded-2xl bg-black/[0.04]">
      <Shirt className="size-6 text-neutral-400" aria-hidden />
    </div>
  );
}

function GarmentCell({
  g,
  onOpen,
  onDuplicate,
}: {
  g: EnrichedGarment;
  onOpen: () => void;
  onDuplicate: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
    >
      <div className="relative aspect-square w-full">
        <div className="absolute inset-0 transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100">
          <GarmentImage g={g} />
        </div>
        {g.possible_duplicate_of && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onDuplicate();
              }
            }}
            className="absolute left-1.5 top-1.5 inline-flex cursor-pointer items-center gap-1 rounded-full bg-neutral-900 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
          >
            <CopyCheck className="size-2.5" aria-hidden /> Dup
          </span>
        )}
      </div>
      <div className="px-1 pt-2">
        <p className="truncate font-ui text-[13px] text-neutral-800">
          {g.subtype ?? CATEGORY_LABELS[g.category]}
        </p>
        <p className="truncate font-ui text-[10px] uppercase tracking-[0.12em] text-neutral-400">
          {g.colors[0] ?? g.pattern ?? CATEGORY_LABELS[g.category]}
        </p>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------
function Overlay({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex justify-center bg-black/40 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-svh w-full flex-col overflow-y-auto bg-cream text-neutral-900 sm:max-h-[90vh] sm:max-w-lg sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function DetailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="font-ui text-[11px] uppercase tracking-[0.14em] text-neutral-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function ProductDetail({
  garment,
  onClose,
  onDone,
}: {
  garment: EnrichedGarment;
  onClose: () => void;
  onDone: () => void;
}) {
  const [category, setCategory] = useState<Category>(garment.category);
  const [subtype, setSubtype] = useState(garment.subtype ?? "");
  const [colors, setColors] = useState(garment.colors.join(", "));
  const [pattern, setPattern] = useState(garment.pattern ?? "");
  const [material, setMaterial] = useState(garment.material ?? "");
  const [brand, setBrand] = useState(garment.brand ?? "");
  const [formality, setFormality] = useState(
    garment.formality != null ? String(garment.formality) : "",
  );
  const [warmth, setWarmth] = useState(
    garment.warmth != null ? String(garment.warmth) : "",
  );
  const [seasons, setSeasons] = useState(garment.seasons.join(", "));
  const [notes, setNotes] = useState(garment.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const splitList = (s: string) =>
    s.split(",").map((x) => x.trim()).filter(Boolean);
  const parseRating = (s: string): number | null => {
    const n = Number(s);
    return s.trim() === "" || !Number.isFinite(n) ? null : n;
  };

  const save = () => {
    setError(null);
    const edit: GarmentEdit = {
      category,
      subtype: subtype || null,
      colors: splitList(colors),
      pattern: pattern || null,
      material: material || null,
      brand: brand || null,
      formality: parseRating(formality),
      warmth: parseRating(warmth),
      seasons: splitList(seasons),
      notes: notes || null,
    };
    startTransition(async () => {
      const res = await updateGarment(garment.id, edit);
      if (!res.ok) return setError(res.error);
      onDone();
    });
  };

  const remove = () => {
    if (!confirm("Delete this garment? This cannot be undone.")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteGarment(garment.id);
      if (!res.ok) return setError(res.error);
      onDone();
    });
  };

  const regenerate = () => {
    setError(null);
    startTransition(async () => {
      const res = await regenerateCutout(garment.id);
      if (!res.ok) return setError(res.error);
      onDone();
    });
  };

  return (
    <Overlay onClose={onClose}>
      {/* Product hero */}
      <div className="relative">
        <div className="relative aspect-square w-full bg-cream">
          <GarmentImage g={garment} />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex size-9 items-center justify-center rounded-full bg-white/70 text-neutral-700 backdrop-blur hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>

      <div className="space-y-5 px-5 pb-6 pt-4">
        <div>
          <p className="font-ui text-[11px] uppercase tracking-[0.16em] text-neutral-400">
            {CATEGORY_LABELS[category]}
          </p>
          <h2 className="mt-0.5 font-display text-2xl leading-tight text-neutral-900">
            {subtype || CATEGORY_LABELS[category]}
          </h2>
        </div>

        <DetailField label="Category">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
            className={inputClass}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </DetailField>

        <DetailField label="Name / subtype">
          <input className={inputClass} value={subtype} onChange={(e) => setSubtype(e.target.value)} />
        </DetailField>

        <DetailField label="Colors">
          <input className={inputClass} value={colors} onChange={(e) => setColors(e.target.value)} />
        </DetailField>

        <div className="grid grid-cols-2 gap-3">
          <DetailField label="Pattern">
            <input className={inputClass} value={pattern} onChange={(e) => setPattern(e.target.value)} />
          </DetailField>
          <DetailField label="Material">
            <input className={inputClass} value={material} onChange={(e) => setMaterial(e.target.value)} />
          </DetailField>
        </div>

        <DetailField label="Brand">
          <input className={inputClass} value={brand} onChange={(e) => setBrand(e.target.value)} />
        </DetailField>

        <div className="grid grid-cols-2 gap-3">
          <DetailField label="Formality (1–5)">
            <input type="number" min={1} max={5} className={inputClass} value={formality} onChange={(e) => setFormality(e.target.value)} />
          </DetailField>
          <DetailField label="Warmth (1–5)">
            <input type="number" min={1} max={5} className={inputClass} value={warmth} onChange={(e) => setWarmth(e.target.value)} />
          </DetailField>
        </div>

        <DetailField label="Seasons">
          <input className={inputClass} value={seasons} onChange={(e) => setSeasons(e.target.value)} />
        </DetailField>

        <DetailField label="Notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className={cn(inputClass, "h-auto py-2")}
          />
        </DetailField>

        {garment.status !== "hold" && (
          <div className="rounded-xl bg-black/[0.04] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-ui text-sm font-medium text-neutral-800">Cutout</p>
                <p className="truncate font-ui text-xs text-neutral-500">
                  {garment.status === "cutout_ready"
                    ? "Ready — regenerate to redo it."
                    : garment.status === "cutout_failed"
                      ? "Last attempt failed — try again."
                      : "Not generated yet."}
                </p>
              </div>
              <button
                type="button"
                onClick={regenerate}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 px-3 py-1.5 font-ui text-xs uppercase tracking-wide text-neutral-800 hover:bg-white/60 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
              >
                <Wand2 className="size-3.5" aria-hidden /> Regenerate
              </button>
            </div>
          </div>
        )}

        {error && <p className="font-ui text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            aria-label="Delete garment"
            className="flex size-10 items-center justify-center rounded-full text-red-600 hover:bg-red-500/10 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
          >
            <Trash2 className="size-5" aria-hidden />
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-full border border-neutral-300 px-5 py-2.5 font-ui text-sm text-neutral-800 hover:bg-white/60 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-full bg-neutral-900 px-6 py-2.5 font-ui text-sm text-cream hover:bg-neutral-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function DupAttrs({ g }: { g: EnrichedGarment }) {
  return (
    <div className="space-y-1 font-ui text-xs text-neutral-500">
      <p className="text-sm font-medium text-neutral-900">
        {g.subtype ?? CATEGORY_LABELS[g.category]}
      </p>
      {g.colors.length > 0 && <p>Colors: {g.colors.join(", ")}</p>}
      {g.brand && <p>Brand: {g.brand}</p>}
      {g.material && <p>Material: {g.material}</p>}
    </div>
  );
}

function DedupModal({
  incoming,
  existing,
  onClose,
  onDone,
}: {
  incoming: EnrichedGarment;
  existing: EnrichedGarment | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const merge = () => {
    if (!confirm("Merge into the existing garment? The new one will be deleted."))
      return;
    setError(null);
    startTransition(async () => {
      const res = await mergeDuplicate(incoming.id);
      if (!res.ok) return setError(res.error);
      onDone();
    });
  };
  const keep = () => {
    setError(null);
    startTransition(async () => {
      const res = await keepBoth(incoming.id);
      if (!res.ok) return setError(res.error);
      onDone();
    });
  };

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between px-5 pt-5">
        <h2 className="font-display text-xl text-neutral-900">Possible duplicate</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-neutral-500 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 px-5 py-5">
        <div className="space-y-2">
          <p className="font-ui text-[10px] uppercase tracking-[0.14em] text-neutral-400">New</p>
          <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-white/50">
            <GarmentImage g={incoming} />
          </div>
          <DupAttrs g={incoming} />
        </div>
        <div className="space-y-2">
          <p className="font-ui text-[10px] uppercase tracking-[0.14em] text-neutral-400">Existing</p>
          <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-white/50">
            {existing ? (
              <GarmentImage g={existing} />
            ) : (
              <div className="flex h-full w-full items-center justify-center font-ui text-xs text-neutral-400">
                Not found
              </div>
            )}
          </div>
          {existing && <DupAttrs g={existing} />}
        </div>
      </div>

      {error && <p className="px-5 font-ui text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-2 px-5 pb-6 pt-1">
        <button
          type="button"
          onClick={keep}
          disabled={pending}
          className="flex-1 rounded-full border border-neutral-300 px-4 py-2.5 font-ui text-sm text-neutral-800 hover:bg-white/60 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
        >
          Keep both
        </button>
        <button
          type="button"
          onClick={merge}
          disabled={pending || !existing}
          className="flex-1 rounded-full bg-neutral-900 px-4 py-2.5 font-ui text-sm text-cream hover:bg-neutral-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
        >
          Merge into existing
        </button>
      </div>
    </Overlay>
  );
}

// ---------------------------------------------------------------------------
// Main catalog
// ---------------------------------------------------------------------------
export function ClosetView({
  garments,
  pendingCutouts,
  failedCutouts,
}: {
  garments: EnrichedGarment[];
  pendingCutouts: number;
  failedCutouts: number;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<PillKey>("all");
  const [editId, setEditId] = useState<string | null>(null);
  const [dupId, setDupId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runDone, setRunDone] = useState(0);
  const [runTotal, setRunTotal] = useState(0);
  const [pausedMsg, setPausedMsg] = useState<string | null>(null);
  const [retrying, startRetry] = useTransition();

  const byId = useMemo(() => new Map(garments.map((g) => [g.id, g])), [garments]);

  const main = useMemo(() => garments.filter((g) => g.status !== "hold"), [garments]);
  const hold = useMemo(() => garments.filter((g) => g.status === "hold"), [garments]);

  const activePill = PILLS.find((p) => p.key === filter)!;
  const shown = useMemo(() => {
    if (filter === "outfits") return [];
    if (!activePill.cats) return main;
    return main.filter((g) => activePill.cats!.includes(g.category));
  }, [filter, activePill, main]);

  const editing = editId ? byId.get(editId) : undefined;
  const duplicating = dupId ? byId.get(dupId) : undefined;

  const runCutouts = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setPausedMsg(null);
    setRunDone(0);
    let total = Math.max(pendingCutouts, 1);
    setRunTotal(total);
    let done = 0;
    for (let i = 0; i < 200; i++) {
      let body:
        | { processed?: unknown[]; remaining?: number; paused?: boolean; pause?: { message?: string } }
        | null = null;
      try {
        const res = await fetch("/api/cutouts/process", { method: "POST" });
        if (!res.ok) break;
        body = await res.json();
      } catch {
        break;
      }
      const processedNow = body?.processed?.length ?? 0;
      const remaining = body?.remaining ?? 0;
      done += processedNow;
      if (done + remaining > total) {
        total = done + remaining;
        setRunTotal(total);
      }
      setRunDone(done);
      if (body?.paused) {
        setPausedMsg(body.pause?.message ?? "Cutouts paused: Gemini quota/billing issue.");
        break;
      }
      if (remaining === 0 || processedNow === 0) break;
    }
    setRunning(false);
    router.refresh();
  }, [running, pendingCutouts, router]);

  const retryFailed = () => {
    startRetry(async () => {
      const res = await retryAllFailedCutouts();
      if (res.ok) await runCutouts();
    });
  };

  const refresh = () => {
    setEditId(null);
    setDupId(null);
    router.refresh();
  };

  return (
    <div className="min-h-svh bg-cream font-ui text-neutral-900">
      {/* Header + sticky pills */}
      <div className="mx-auto max-w-7xl px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] sm:px-6">
        <p className="font-ui text-[11px] uppercase tracking-[0.22em] text-neutral-500">
          {shown.length} {shown.length === 1 ? "piece" : "pieces"}
        </p>
        <h1 className="mt-1 font-display text-3xl text-neutral-900">Closet</h1>
      </div>

      <div className="sticky top-0 z-30 mt-4 bg-cream/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex gap-2 overflow-x-auto py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {PILLS.map((p) => {
              const active = p.key === filter;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setFilter(p.key)}
                  className={cn(
                    "shrink-0 rounded-full px-4 py-1.5 font-ui text-[11px] uppercase tracking-[0.14em] transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 focus-visible:ring-offset-cream",
                    active
                      ? "bg-neutral-900 text-cream"
                      : "border border-neutral-300 text-neutral-600 hover:border-neutral-500 hover:text-neutral-900",
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-7xl px-4 pb-28 pt-2 sm:px-6">
        {(pendingCutouts > 0 || running || failedCutouts > 0 || pausedMsg) && (
          <div className="mb-6 space-y-3">
            {pausedMsg && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 font-ui text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {pausedMsg} Nothing was marked failed — try again once
                  billing/quota recovers.
                </span>
              </div>
            )}
            {(pendingCutouts > 0 || running) && (
              <button
                type="button"
                onClick={runCutouts}
                disabled={running}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-neutral-900 px-5 py-3 font-ui text-sm text-cream hover:bg-neutral-800 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
              >
                {running ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Generating cutouts… {runDone} of {runTotal}
                  </>
                ) : (
                  <>
                    <Wand2 className="size-4" aria-hidden /> Generate cutouts ({pendingCutouts} pending)
                  </>
                )}
              </button>
            )}
            {failedCutouts > 0 && (
              <button
                type="button"
                onClick={retryFailed}
                disabled={retrying || running}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-neutral-300 px-5 py-3 font-ui text-sm text-neutral-800 hover:bg-white/60 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
              >
                {retrying ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden /> Re-queuing…
                  </>
                ) : (
                  <>
                    <Wand2 className="size-4" aria-hidden /> Retry all failed cutouts ({failedCutouts})
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {filter === "outfits" ? (
          <div className="py-24 text-center">
            <p className="font-display text-xl text-neutral-700">No outfits yet</p>
            <p className="mt-2 font-ui text-sm text-neutral-500">
              Saved looks will appear here.
            </p>
          </div>
        ) : shown.length === 0 ? (
          <div className="py-24 text-center">
            <Shirt className="mx-auto mb-3 size-8 text-neutral-400" aria-hidden />
            <p className="font-ui text-sm text-neutral-500">
              {main.length === 0
                ? "Your wardrobe is empty. Add a few photos to get started."
                : "Nothing in this category yet."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
            {shown.map((g) => (
              <GarmentCell
                key={g.id}
                g={g}
                onOpen={() => setEditId(g.id)}
                onDuplicate={() => setDupId(g.id)}
              />
            ))}
          </div>
        )}

        {/* Needs review — photo-only items too obscured to cut out. */}
        {hold.length > 0 && (
          <details className="mt-12 border-t border-neutral-300/70 pt-6">
            <summary className="cursor-pointer font-ui text-[11px] uppercase tracking-[0.16em] text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900">
              Needs review ({hold.length})
            </summary>
            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
              {hold.map((g) => (
                <GarmentCell
                  key={g.id}
                  g={g}
                  onOpen={() => setEditId(g.id)}
                  onDuplicate={() => setDupId(g.id)}
                />
              ))}
            </div>
          </details>
        )}
      </div>

      {editing && (
        <ProductDetail
          key={editing.id}
          garment={editing}
          onClose={() => setEditId(null)}
          onDone={refresh}
        />
      )}
      {duplicating && (
        <DedupModal
          key={duplicating.id}
          incoming={duplicating}
          existing={
            duplicating.possible_duplicate_of
              ? byId.get(duplicating.possible_duplicate_of)
              : undefined
          }
          onClose={() => setDupId(null)}
          onDone={refresh}
        />
      )}
    </div>
  );
}

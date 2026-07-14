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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  type GarmentEdit,
} from "@/app/(app)/closet/actions";

export type EnrichedGarment = GarmentRow & {
  thumbUrl: string | null;
  cutoutUrl: string | null;
};

const CATEGORY_LABELS: Record<Category, string> = {
  top: "Tops",
  bottom: "Bottoms",
  outerwear: "Outerwear",
  dress: "Dresses",
  footwear: "Footwear",
  accessory: "Accessories",
  other: "Other",
};

function Thumb({ g, className }: { g: EnrichedGarment; className?: string }) {
  if (g.thumbUrl) {
    return (
      <Image
        src={g.thumbUrl}
        alt={g.subtype ?? g.category}
        fill
        sizes="(max-width: 448px) 45vw, 200px"
        className={cn("object-cover", className)}
        unoptimized
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-neutral-800">
      <Shirt className="size-6 text-neutral-600" aria-hidden />
    </div>
  );
}

/** Ready cutout renders as a product shot on a light card; else the thumb. */
function CardImage({ g }: { g: EnrichedGarment }) {
  if (g.cutoutUrl) {
    return (
      <div className="relative h-full w-full bg-neutral-100">
        <Image
          src={g.cutoutUrl}
          alt={g.subtype ?? g.category}
          fill
          sizes="(max-width: 448px) 45vw, 200px"
          className="object-contain p-2"
          unoptimized
        />
      </div>
    );
  }
  return <Thumb g={g} />;
}

function GarmentCard({
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
      className="group flex flex-col overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/50 text-left transition-colors hover:border-neutral-600"
    >
      <div className="relative aspect-square w-full">
        <CardImage g={g} />
        {g.status === "cutout_failed" && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-red-500/90 px-2 py-0.5 text-[10px] font-medium text-red-950">
            <AlertTriangle className="size-3" aria-hidden /> Cutout failed
          </span>
        )}
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
            className="absolute left-2 top-2 inline-flex cursor-pointer items-center gap-1 rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-medium text-amber-950 hover:bg-amber-400"
          >
            <CopyCheck className="size-3" aria-hidden /> Possible duplicate
          </span>
        )}
      </div>
      <div className="px-2.5 py-2">
        <p className="truncate text-sm font-medium text-neutral-200">
          {g.subtype ?? CATEGORY_LABELS[g.category]}
        </p>
        <p className="truncate text-xs text-neutral-500">
          {g.colors.length ? g.colors.join(", ") : g.pattern ?? "—"}
        </p>
      </div>
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-neutral-400">{label}</Label>
      {children}
    </div>
  );
}

function EditSheet({
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
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
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
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDone();
    });
  };

  const remove = () => {
    if (!confirm("Delete this garment? This cannot be undone.")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteGarment(garment.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDone();
    });
  };

  const regenerate = () => {
    setError(null);
    startTransition(async () => {
      const res = await regenerateCutout(garment.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDone();
    });
  };

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <h2 className="text-base font-semibold">Edit garment</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-neutral-400 hover:text-neutral-200"
          aria-label="Close"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>

      <div className="space-y-4 overflow-y-auto px-4 py-4">
        <Field label="Category">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c} className="bg-neutral-900">
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Subtype">
          <Input value={subtype} onChange={(e) => setSubtype(e.target.value)} />
        </Field>

        <Field label="Colors (comma-separated)">
          <Input value={colors} onChange={(e) => setColors(e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Pattern">
            <Input value={pattern} onChange={(e) => setPattern(e.target.value)} />
          </Field>
          <Field label="Material">
            <Input
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Brand">
          <Input value={brand} onChange={(e) => setBrand(e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Formality (1–5)">
            <Input
              type="number"
              min={1}
              max={5}
              value={formality}
              onChange={(e) => setFormality(e.target.value)}
            />
          </Field>
          <Field label="Warmth (1–5)">
            <Input
              type="number"
              min={1}
              max={5}
              value={warmth}
              onChange={(e) => setWarmth(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Seasons (comma-separated)">
          <Input value={seasons} onChange={(e) => setSeasons(e.target.value)} />
        </Field>

        <Field label="Notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          />
        </Field>

        {garment.status !== "hold" && (
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-200">Cutout</p>
                <p className="truncate text-xs text-neutral-500">
                  {garment.status === "cutout_ready"
                    ? "Ready — regenerate to redo it."
                    : garment.status === "cutout_failed"
                      ? "Last attempt failed — try again."
                      : "Not generated yet."}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={regenerate}
                disabled={pending}
              >
                <Wand2 aria-hidden /> Regenerate
              </Button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      <div className="flex items-center gap-2 border-t border-neutral-800 px-4 py-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={remove}
          disabled={pending}
          aria-label="Delete garment"
          className="text-red-400 hover:text-red-300"
        >
          <Trash2 aria-hidden />
        </Button>
        <div className="flex-1" />
        <Button variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </Overlay>
  );
}

function DupAttrs({ g }: { g: EnrichedGarment }) {
  return (
    <div className="space-y-1 text-xs text-neutral-400">
      <p className="text-sm font-medium text-neutral-200">
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
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDone();
    });
  };

  const keep = () => {
    setError(null);
    startTransition(async () => {
      const res = await keepBoth(incoming.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDone();
    });
  };

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <h2 className="text-base font-semibold">Possible duplicate</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-neutral-400 hover:text-neutral-200"
          aria-label="Close"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>

      <div className="space-y-4 px-4 py-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-neutral-500">
              New
            </p>
            <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-neutral-800">
              <Thumb g={incoming} />
            </div>
            <DupAttrs g={incoming} />
          </div>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-neutral-500">
              Existing
            </p>
            <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-neutral-800">
              {existing ? (
                <Thumb g={existing} />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-neutral-800 text-xs text-neutral-500">
                  Not found
                </div>
              )}
            </div>
            {existing && <DupAttrs g={existing} />}
          </div>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      <div className="flex items-center gap-2 border-t border-neutral-800 px-4 py-3">
        <Button
          variant="outline"
          className="flex-1"
          onClick={keep}
          disabled={pending}
        >
          Keep both
        </Button>
        <Button
          className="flex-1"
          onClick={merge}
          disabled={pending || !existing}
        >
          Merge into existing
        </Button>
      </div>
    </Overlay>
  );
}

function Overlay({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-md flex-col rounded-t-2xl border border-neutral-800 bg-neutral-950 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function ClosetView({
  garments,
  pendingCutouts,
}: {
  garments: EnrichedGarment[];
  pendingCutouts: number;
}) {
  const router = useRouter();
  const [editId, setEditId] = useState<string | null>(null);
  const [dupId, setDupId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runDone, setRunDone] = useState(0);
  const [runTotal, setRunTotal] = useState(0);

  // Drain the cutout queue by polling the worker until it reports empty.
  const runCutouts = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setRunDone(0);
    let total = Math.max(pendingCutouts, 1);
    setRunTotal(total);
    let done = 0;
    for (let i = 0; i < 200; i++) {
      let body: { processed?: unknown[]; remaining?: number } | null = null;
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
      // Empty queue, or nothing moved (stuck) — stop.
      if (remaining === 0 || processedNow === 0) break;
    }
    setRunning(false);
    router.refresh();
  }, [running, pendingCutouts, router]);

  const byId = useMemo(
    () => new Map(garments.map((g) => [g.id, g])),
    [garments],
  );

  const { grouped, hold } = useMemo(() => {
    const main = garments.filter((g) => g.status !== "hold");
    const holdItems = garments.filter((g) => g.status === "hold");
    const groups: { category: Category; items: EnrichedGarment[] }[] = [];
    for (const c of CATEGORIES) {
      const items = main.filter((g) => g.category === c);
      if (items.length) groups.push({ category: c, items });
    }
    return { grouped: groups, hold: holdItems };
  }, [garments]);

  const editing = editId ? byId.get(editId) : undefined;
  const duplicating = dupId ? byId.get(dupId) : undefined;

  const refresh = () => {
    setEditId(null);
    setDupId(null);
    router.refresh();
  };

  return (
    <section className="space-y-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Your Closet</h1>
        <span className="text-sm text-neutral-500">
          {garments.length} {garments.length === 1 ? "item" : "items"}
        </span>
      </div>

      {(pendingCutouts > 0 || running) && (
        <Button
          type="button"
          onClick={runCutouts}
          disabled={running}
          className="w-full"
        >
          {running ? (
            <>
              <Loader2 className="animate-spin" aria-hidden /> Generating cutouts…{" "}
              {runDone} of {runTotal}
            </>
          ) : (
            <>
              <Wand2 aria-hidden /> Generate cutouts ({pendingCutouts} pending)
            </>
          )}
        </Button>
      )}

      {garments.length === 0 && (
        <div className="rounded-2xl border border-dashed border-neutral-800 px-6 py-16 text-center">
          <Shirt className="mx-auto mb-3 size-8 text-neutral-600" aria-hidden />
          <p className="text-sm text-neutral-400">
            Your wardrobe is empty. Add a few photos to get started.
          </p>
        </div>
      )}

      {grouped.map(({ category, items }) => (
        <div key={category} className="space-y-3">
          <h2 className="text-sm font-medium text-neutral-400">
            {CATEGORY_LABELS[category]}{" "}
            <span className="text-neutral-600">({items.length})</span>
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {items.map((g) => (
              <GarmentCard
                key={g.id}
                g={g}
                onOpen={() => setEditId(g.id)}
                onDuplicate={() => setDupId(g.id)}
              />
            ))}
          </div>
        </div>
      ))}

      {hold.length > 0 && (
        <details className="rounded-xl border border-neutral-800 bg-neutral-900/40">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-neutral-300">
            Needs review{" "}
            <span className="text-neutral-600">({hold.length})</span>
          </summary>
          <div className="grid grid-cols-2 gap-3 px-4 pb-4">
            {hold.map((g) => (
              <GarmentCard
                key={g.id}
                g={g}
                onOpen={() => setEditId(g.id)}
                onDuplicate={() => setDupId(g.id)}
              />
            ))}
          </div>
        </details>
      )}

      {editing && (
        <EditSheet
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
    </section>
  );
}

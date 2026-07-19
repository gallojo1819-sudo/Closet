"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Shirt,
  CopyCheck,
  X,
  Trash2,
  Plus,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  Sparkles,
  Search,
  Tag,
  Link2,
  Camera,
  BadgeCheck,
  ExternalLink,
  ScanSearch,
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
  generateAiPreview,
  applyProduct,
  type GarmentEdit,
  type ApplyCandidate,
} from "@/app/(app)/closet/actions";

export type EnrichedGarment = GarmentRow & {
  thumbUrl: string | null;
  cutoutUrl: string | null;
  officialUrl: string | null;
};

// A product candidate as returned by /api/products/identify.
interface Candidate {
  product_name: string;
  brand: string | null;
  retailer: string | null;
  price: string | null;
  product_url: string | null;
  image_url: string | null;
  retailer_product_id: string | null;
  match_reason: string;
}

// ---------------------------------------------------------------------------
// Category filter pills (a fixed catalog taxonomy) + a source filter for
// finding exactly what needs upgrading.
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

type SourceKey = "any" | "official" | "photo" | "cutout";
const SOURCE_FILTERS: { key: SourceKey; label: string }[] = [
  { key: "any", label: "Any source" },
  { key: "official", label: "Verified" },
  { key: "photo", label: "Photo only" },
  { key: "cutout", label: "AI preview" },
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

const inputClass =
  "flex h-10 w-full rounded-lg border border-neutral-300 bg-white/70 px-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-1 focus-visible:ring-offset-cream";

// The one place display-image priority is decided: official > segmented/cutout >
// photo. Only 'official' and 'segmented'/'cutout' float on the field; 'photo' is
// a real cropped photo that fills a soft frame.
function pickDisplay(
  g: EnrichedGarment,
): { url: string; float: boolean } | null {
  if (g.image_source === "official" && g.officialUrl) {
    return { url: g.officialUrl, float: true };
  }
  if (
    (g.image_source === "segmented" || g.image_source === "cutout") &&
    g.cutoutUrl
  ) {
    return { url: g.cutoutUrl, float: true };
  }
  if (g.thumbUrl) return { url: g.thumbUrl, float: false };
  return null;
}

// One 4:5 frame for every source — fixed footprint (zero layout shift), cream
// dissolve fill, and a soft "seat" (hairline inset ring + a low bottom shadow)
// so a full-bleed photo and a floating cutout sit at the same visual weight.
const FRAME_CLASS =
  "relative aspect-[4/5] w-full overflow-hidden rounded-2xl bg-cream shadow-[inset_0_0_0_1px_rgba(26,26,26,0.05),0_3px_10px_-2px_rgba(26,26,26,0.08)]";

// ---------------------------------------------------------------------------
// Catalog cell image — fills the 4:5 frame it's placed in.
//   photo  → object-cover (honest, edge-to-edge) + a photos-only calming scrim
//   else   → object-contain at ~88% (floats on cream), ragged edges grounded
// ---------------------------------------------------------------------------
function GarmentImage({ g }: { g: EnrichedGarment }) {
  const display = pickDisplay(g);
  if (!display) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black/[0.035]">
        <Shirt className="size-7 text-neutral-400" aria-hidden />
      </div>
    );
  }
  const isPhoto = g.image_source === "photo";
  return (
    <>
      <Image
        src={display.url}
        alt={g.product_name ?? g.subtype ?? g.category}
        fill
        sizes="(max-width: 640px) 45vw, 200px"
        className={display.float ? "object-contain p-[6%]" : "object-cover"}
        unoptimized
      />
      {isPhoto && <div className="photo-scrim absolute inset-0" aria-hidden />}
    </>
  );
}

// A quiet corner badge marking an AI-generated preview so it can never be
// mistaken for the real garment.
function AiBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-neutral-900/85 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-cream backdrop-blur",
        className,
      )}
    >
      <Sparkles className="size-2.5" aria-hidden /> AI
    </span>
  );
}

function cellSubtitle(g: EnrichedGarment): string {
  switch (g.image_source) {
    case "official":
      return g.brand ?? g.product_name ?? "Verified";
    case "cutout":
      return "AI preview";
    case "photo":
      return "Photo only";
    default:
      return g.colors[0] ?? g.pattern ?? CATEGORY_LABELS[g.category];
  }
}

function GarmentCell({
  g,
  onOpen,
  onDuplicate,
  index = 0,
}: {
  g: EnrichedGarment;
  onOpen: () => void;
  onDuplicate: () => void;
  index?: number;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}
      className="reveal-up group flex flex-col rounded-2xl text-left transition-transform duration-100 active:scale-[0.98] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
    >
      <div className={FRAME_CLASS}>
        <div className="absolute inset-0 transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100">
          <GarmentImage g={g} />
        </div>
        {g.image_source === "cutout" && (
          <AiBadge className="absolute right-2 top-2" />
        )}
        {g.image_source === "official" && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-neutral-800 shadow-[inset_0_0_0_1px_rgba(26,26,26,0.08)] backdrop-blur">
            <BadgeCheck className="size-2.5" aria-hidden /> Verified
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
            className="absolute left-2 top-2 inline-flex cursor-pointer items-center gap-1 rounded-full bg-neutral-900 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
          >
            <CopyCheck className="size-2.5" aria-hidden /> Dup
          </span>
        )}
      </div>
      <div className="px-0.5 pt-3">
        <p className="truncate font-display text-[20px] font-medium leading-[1.15] text-neutral-900">
          {g.product_name ?? g.subtype ?? CATEGORY_LABELS[g.category]}
        </p>
        <p className="truncate pt-1 font-ui text-[11px] uppercase tracking-[0.12em] text-neutral-400">
          {cellSubtitle(g)}
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
      className="overlay-in fixed inset-0 z-[60] flex justify-center bg-black/40 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="panel-in flex max-h-svh w-full flex-col overflow-y-auto bg-cream text-neutral-900 sm:max-h-[90vh] sm:max-w-lg sm:rounded-3xl"
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

// ---------------------------------------------------------------------------
// Identify panel — the four input methods + candidate picker.
// ---------------------------------------------------------------------------
type Method = "reference" | "url" | "name" | "caretag";
const METHOD_TABS: { key: Method; label: string; icon: typeof Tag }[] = [
  { key: "reference", label: "Brand + ref", icon: Tag },
  { key: "url", label: "URL", icon: Link2 },
  { key: "name", label: "Brand + name", icon: Search },
  { key: "caretag", label: "Care tag", icon: Camera },
];

function IdentifyPanel({
  garment,
  onApplied,
}: {
  garment: EnrichedGarment;
  onApplied: () => void;
}) {
  const [method, setMethod] = useState<Method>("reference");
  const [brand, setBrand] = useState(garment.brand ?? "");
  const [reference, setReference] = useState(garment.retailer_product_id ?? "");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [tagNote, setTagNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [applyingIdx, setApplyingIdx] = useState<number | null>(null);
  const [, startApply] = useTransition();
  const tagRef = useRef<HTMLInputElement>(null);

  const readTag = useCallback(async (file: File) => {
    setError(null);
    setTagNote(null);
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/products/caretag", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? "Could not read that label.");
        return;
      }
      const r = body.reading ?? {};
      setBrand(r.brand ?? "");
      setReference(r.style_code ?? "");
      setMethod("reference");
      const got = [
        r.brand && `brand “${r.brand}”`,
        r.style_code && `style ${r.style_code}`,
        r.size && `size ${r.size}`,
        r.material && r.material,
      ].filter(Boolean);
      setTagNote(
        got.length
          ? `Read from tag: ${got.join(", ")}. Review, then search.`
          : "Nothing legible on that tag — enter what you can and search.",
      );
    } catch {
      setError("Could not read that label. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  const search = useCallback(async () => {
    setError(null);
    setCandidates(null);
    setLoading(true);
    try {
      const res = await fetch("/api/products/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          garmentId: garment.id,
          method,
          brand,
          reference,
          name,
          url,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? "Lookup failed.");
        return;
      }
      setCandidates((body.candidates ?? []) as Candidate[]);
    } catch {
      setError("Lookup failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [garment.id, method, brand, reference, name, url]);

  const apply = (c: Candidate, idx: number) => {
    setError(null);
    setApplyingIdx(idx);
    const payload: ApplyCandidate = {
      product_name: c.product_name,
      brand: c.brand,
      retailer: c.retailer,
      retailer_product_id: c.retailer_product_id,
      size: null,
      product_url: c.product_url,
      image_url: c.image_url,
    };
    startApply(async () => {
      const res = await applyProduct(garment.id, payload);
      setApplyingIdx(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onApplied();
    });
  };

  return (
    <div className="space-y-3 rounded-xl bg-black/[0.04] p-3">
      <div className="flex items-center gap-2">
        <ScanSearch className="size-4 text-neutral-700" aria-hidden />
        <p className="font-ui text-sm font-medium text-neutral-800">
          Identify this piece
        </p>
      </div>
      <p className="font-ui text-xs text-neutral-500">
        Match it to the real product for the official image, brand, and name.
        Nothing is applied until you pick a result.
      </p>

      {/* Method tabs */}
      <div className="flex flex-wrap gap-1.5">
        {METHOD_TABS.map((t) => {
          const active = t.key === method;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setMethod(t.key);
                setCandidates(null);
                setError(null);
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-ui text-[11px] uppercase tracking-wide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900",
                active
                  ? "bg-neutral-900 text-cream"
                  : "border border-neutral-300 text-neutral-600 hover:border-neutral-500",
              )}
            >
              <Icon className="size-3" aria-hidden /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Method inputs */}
      {method === "reference" && (
        <div className="grid grid-cols-2 gap-2">
          <input
            className={inputClass}
            placeholder="Brand"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Reference / style no."
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>
      )}
      {method === "name" && (
        <div className="grid grid-cols-2 gap-2">
          <input
            className={inputClass}
            placeholder="Brand"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Product name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      )}
      {method === "url" && (
        <input
          className={inputClass}
          placeholder="https://brand.com/product/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      )}
      {method === "caretag" && (
        <div>
          <button
            type="button"
            onClick={() => tagRef.current?.click()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-full border border-neutral-300 px-4 py-2 font-ui text-xs uppercase tracking-wide text-neutral-800 hover:bg-white/60 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
          >
            <Camera className="size-3.5" aria-hidden /> Photograph the tag
          </button>
          <input
            ref={tagRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) readTag(f);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {tagNote && (
        <p className="font-ui text-xs text-neutral-600">{tagNote}</p>
      )}

      {method !== "caretag" && (
        <button
          type="button"
          onClick={search}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full bg-neutral-900 px-4 py-2 font-ui text-xs uppercase tracking-wide text-cream hover:bg-neutral-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
        >
          {loading ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> Searching…
            </>
          ) : (
            <>
              <Search className="size-3.5" aria-hidden /> Find product
            </>
          )}
        </button>
      )}
      {loading && method === "caretag" && (
        <p className="inline-flex items-center gap-1.5 font-ui text-xs text-neutral-600">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Reading tag…
        </p>
      )}

      {error && <p className="font-ui text-sm text-red-600">{error}</p>}

      {/* Candidates */}
      {candidates && candidates.length === 0 && (
        <p className="font-ui text-sm text-neutral-600">
          No confident match found — nothing applied. Try the reference number,
          the product URL, or a re-shoot.
        </p>
      )}
      {candidates && candidates.length > 0 && (
        <ul className="space-y-2">
          {candidates.map((c, i) => (
            <li
              key={`${c.product_url ?? c.product_name}-${i}`}
              className="flex gap-3 rounded-xl border border-neutral-200 bg-white/60 p-2.5"
            >
              <div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-black/[0.04]">
                {c.image_url ? (
                  <Image
                    src={c.image_url}
                    alt={c.product_name}
                    fill
                    sizes="64px"
                    className="object-contain"
                    unoptimized
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Shirt className="size-5 text-neutral-400" aria-hidden />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-ui text-sm font-medium text-neutral-900">
                  {c.product_name}
                </p>
                <p className="truncate font-ui text-xs text-neutral-500">
                  {[c.brand, c.retailer, c.price].filter(Boolean).join(" · ")}
                </p>
                {c.match_reason && (
                  <p className="mt-0.5 line-clamp-2 font-ui text-[11px] text-neutral-500">
                    {c.match_reason}
                  </p>
                )}
                <div className="mt-1.5 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => apply(c, i)}
                    disabled={applyingIdx !== null || !c.image_url}
                    className="inline-flex items-center gap-1 rounded-full bg-neutral-900 px-3 py-1 font-ui text-[11px] uppercase tracking-wide text-cream hover:bg-neutral-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                  >
                    {applyingIdx === i ? (
                      <>
                        <Loader2 className="size-3 animate-spin" aria-hidden /> Applying…
                      </>
                    ) : (
                      <>
                        <BadgeCheck className="size-3" aria-hidden /> Use this
                      </>
                    )}
                  </button>
                  {c.product_url && (
                    <a
                      href={c.product_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-ui text-[11px] text-neutral-500 hover:text-neutral-900"
                    >
                      <ExternalLink className="size-3" aria-hidden /> View
                    </a>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
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
  const [genRunning, setGenRunning] = useState(false);

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

  // Explicit AI preview — enqueue, then drain the worker for just this garment.
  const generatePreview = async () => {
    if (genRunning) return;
    setError(null);
    setGenRunning(true);
    const res = await generateAiPreview(garment.id);
    if (!res.ok) {
      setError(res.error);
      setGenRunning(false);
      return;
    }
    for (let i = 0; i < 60; i++) {
      let body:
        | { processed?: unknown[]; remaining?: number; paused?: boolean; pause?: { message?: string } }
        | null = null;
      try {
        const r = await fetch("/api/cutouts/process", { method: "POST" });
        if (!r.ok) break;
        body = await r.json();
      } catch {
        break;
      }
      if (body?.paused) {
        setError(body.pause?.message ?? "AI preview paused: quota/billing issue.");
        break;
      }
      if ((body?.remaining ?? 0) === 0 || (body?.processed?.length ?? 0) === 0) break;
    }
    setGenRunning(false);
    onDone();
  };

  const isOfficial = garment.image_source === "official";

  return (
    <Overlay onClose={onClose}>
      {/* Product hero — same 4:5 frame + treatment as the grid, one system */}
      <div className="relative">
        <div className="relative aspect-[4/5] w-full overflow-hidden bg-cream">
          <GarmentImage g={garment} />
          {garment.image_source === "cutout" && (
            <AiBadge className="absolute left-3 top-3" />
          )}
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
          {isOfficial ? (
            <>
              <h2 className="mt-0.5 font-display text-2xl leading-tight text-neutral-900">
                {garment.brand ? `${garment.brand} — ` : ""}
                {garment.product_name ?? (subtype || CATEGORY_LABELS[category])}
              </h2>
              <div className="mt-1 flex items-center gap-2 font-ui text-xs text-neutral-500">
                <span className="inline-flex items-center gap-1 text-neutral-700">
                  <BadgeCheck className="size-3.5" aria-hidden /> Verified
                </span>
                {garment.product_url && (
                  <a
                    href={garment.product_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 hover:text-neutral-900"
                  >
                    <ExternalLink className="size-3" aria-hidden /> Product page
                  </a>
                )}
              </div>
            </>
          ) : (
            <h2 className="mt-0.5 font-display text-2xl leading-tight text-neutral-900">
              {subtype || CATEGORY_LABELS[category]}
            </h2>
          )}
        </div>

        {/* Identify panel */}
        {!isOfficial && (
          <IdentifyPanel garment={garment} onApplied={onDone} />
        )}

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

        {/* AI preview — explicit, clearly not a real photo. Offered only when the
            display is a plain photo or an existing AI cutout; official and
            segmented garments already show real imagery. */}
        {(garment.image_source === "photo" || garment.image_source === "cutout") &&
          garment.status !== "hold" && (
          <div className="rounded-xl border border-dashed border-neutral-300 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-ui text-sm font-medium text-neutral-800">
                  AI preview
                </p>
                <p className="font-ui text-xs text-neutral-500">
                  {garment.image_source === "cutout"
                    ? "Showing an AI-generated preview — not a real photo. Identify or re-shoot to replace it."
                    : "Generate an AI approximation — not a real photo. Best to identify the product instead."}
                </p>
              </div>
              <button
                type="button"
                onClick={generatePreview}
                disabled={genRunning || pending}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-neutral-300 px-3 py-1.5 font-ui text-xs uppercase tracking-wide text-neutral-800 hover:bg-white/60 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
              >
                {genRunning ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" aria-hidden /> Generating…
                  </>
                ) : (
                  <>
                    <Sparkles className="size-3.5" aria-hidden /> AI preview
                  </>
                )}
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
        {g.product_name ?? g.subtype ?? CATEGORY_LABELS[g.category]}
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
          <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl bg-cream shadow-[inset_0_0_0_1px_rgba(26,26,26,0.05)]">
            <GarmentImage g={incoming} />
          </div>
          <DupAttrs g={incoming} />
        </div>
        <div className="space-y-2">
          <p className="font-ui text-[10px] uppercase tracking-[0.14em] text-neutral-400">Existing</p>
          <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl bg-cream shadow-[inset_0_0_0_1px_rgba(26,26,26,0.05)]">
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
  resegmentCandidates,
  unauditedCutouts,
  sourcing,
}: {
  garments: EnrichedGarment[];
  pendingCutouts: number;
  resegmentCandidates: number;
  unauditedCutouts: number;
  sourcing: { official: number; segmented: number; photo: number; cutout: number };
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<PillKey>("all");
  const [source, setSource] = useState<SourceKey>("any");
  const [editId, setEditId] = useState<string | null>(null);
  const [dupId, setDupId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runDone, setRunDone] = useState(0);
  const [runTotal, setRunTotal] = useState(0);
  const [pausedMsg, setPausedMsg] = useState<string | null>(null);
  const [resegging, setResegging] = useState(false);
  const [resegDone, setResegDone] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [verifyDemoted, setVerifyDemoted] = useState(0);

  const byId = useMemo(() => new Map(garments.map((g) => [g.id, g])), [garments]);

  const main = useMemo(() => garments.filter((g) => g.status !== "hold"), [garments]);
  const hold = useMemo(() => garments.filter((g) => g.status === "hold"), [garments]);

  const activePill = PILLS.find((p) => p.key === filter)!;
  const shown = useMemo(() => {
    if (filter === "outfits") return [];
    let list = activePill.cats
      ? main.filter((g) => activePill.cats!.includes(g.category))
      : main;
    if (source !== "any") list = list.filter((g) => g.image_source === source);
    return list;
  }, [filter, activePill, main, source]);

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
        setPausedMsg(body.pause?.message ?? "AI previews paused: quota/billing issue.");
        break;
      }
      if (remaining === 0 || processedNow === 0) break;
    }
    setRunning(false);
    router.refresh();
  }, [running, pendingCutouts, router]);

  // Try to recover real segmented pixels for old photo / AI garments.
  const resegment = useCallback(async () => {
    if (resegging) return;
    setResegging(true);
    setResegDone(0);
    let done = 0;
    for (let i = 0; i < 200; i++) {
      let body: { segmented?: number; remaining?: number } | null = null;
      try {
        const res = await fetch("/api/segment/run", { method: "POST" });
        if (!res.ok) break;
        body = await res.json();
      } catch {
        break;
      }
      done += body?.segmented ?? 0;
      setResegDone(done);
      if ((body?.remaining ?? 0) === 0) break;
    }
    setResegging(false);
    router.refresh();
  }, [resegging, router]);

  // Audit already-generated cutouts against their source; demote fabrications.
  const reverify = useCallback(async () => {
    if (verifying) return;
    setVerifying(true);
    setPausedMsg(null);
    setVerifyDemoted(0);
    let demoted = 0;
    for (let i = 0; i < 200; i++) {
      let body:
        | { demoted?: number; remaining?: number; paused?: boolean; pause?: { message?: string } }
        | null = null;
      try {
        const res = await fetch("/api/cutouts/reverify", { method: "POST" });
        if (!res.ok) break;
        body = await res.json();
      } catch {
        break;
      }
      demoted += body?.demoted ?? 0;
      setVerifyDemoted(demoted);
      if (body?.paused) {
        setPausedMsg(body.pause?.message ?? "Re-verify paused: Claude quota/billing issue.");
        break;
      }
      if ((body?.remaining ?? 0) === 0) break;
    }
    setVerifying(false);
    router.refresh();
  }, [verifying, router]);

  const refresh = () => {
    setEditId(null);
    setDupId(null);
    router.refresh();
  };

  const busy = running || resegging || verifying;

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
          {/* Source filter — find exactly what needs upgrading. */}
          <div className="flex gap-2 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {SOURCE_FILTERS.map((s) => {
              const active = s.key === source;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSource(s.key)}
                  className={cn(
                    "shrink-0 rounded-full px-3 py-1 font-ui text-[10px] uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900",
                    active
                      ? "bg-neutral-800 text-cream"
                      : "border border-neutral-200 text-neutral-500 hover:border-neutral-400 hover:text-neutral-800",
                  )}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-7xl px-4 pb-28 pt-2 sm:px-6">
        {/* Sourcing mix — best to worst. */}
        {(sourcing.official > 0 ||
          sourcing.segmented > 0 ||
          sourcing.photo > 0 ||
          sourcing.cutout > 0) && (
          <p className="mb-4 font-ui text-[11px] uppercase tracking-[0.16em] text-neutral-400">
            Sourced · {sourcing.official} official · {sourcing.segmented} segmented ·{" "}
            {sourcing.photo} photo · {sourcing.cutout} AI
          </p>
        )}

        {(pendingCutouts > 0 ||
          running ||
          resegmentCandidates > 0 ||
          resegging ||
          unauditedCutouts > 0 ||
          verifying ||
          pausedMsg) && (
          <div className="mb-6 space-y-3">
            {pausedMsg && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 font-ui text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {pausedMsg} Nothing was demoted or marked failed — try again
                  once billing/quota recovers.
                </span>
              </div>
            )}
            {(pendingCutouts > 0 || running) && (
              <button
                type="button"
                onClick={runCutouts}
                disabled={busy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-neutral-300 px-5 py-3 font-ui text-sm text-neutral-800 hover:bg-white/60 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
              >
                {running ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Generating AI previews… {runDone} of {runTotal}
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" aria-hidden /> Resume AI previews ({pendingCutouts})
                  </>
                )}
              </button>
            )}
            {resegmentCandidates > 0 && (
              <button
                type="button"
                onClick={resegment}
                disabled={busy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-neutral-900 px-5 py-3 font-ui text-sm text-cream hover:bg-neutral-800 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
              >
                {resegging ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden /> Finding real pixels…{" "}
                    {resegDone > 0 ? `${resegDone} recovered` : ""}
                  </>
                ) : (
                  <>
                    <ScanSearch className="size-4" aria-hidden /> Find real pixels ({resegmentCandidates})
                  </>
                )}
              </button>
            )}
            {unauditedCutouts > 0 && (
              <button
                type="button"
                onClick={reverify}
                disabled={busy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-neutral-300 px-5 py-3 font-ui text-sm text-neutral-800 hover:bg-white/60 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
              >
                {verifying ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden /> Re-verifying…{" "}
                    {verifyDemoted > 0 ? `${verifyDemoted} demoted` : ""}
                  </>
                ) : (
                  <>
                    <ShieldCheck className="size-4" aria-hidden /> Re-verify AI cutouts ({unauditedCutouts})
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
          main.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-28 text-center">
              <p className="font-display text-2xl leading-tight text-neutral-800">
                Your closet is empty
              </p>
              <p className="mt-2 max-w-xs font-ui text-sm text-neutral-500">
                Add a few photos and they’ll appear here as a catalog — one clean
                piece per card.
              </p>
              <Link
                href="/add"
                className="mt-7 inline-flex items-center gap-2 rounded-full bg-neutral-900 px-6 py-3 font-ui text-sm text-cream transition-transform duration-100 hover:bg-neutral-800 active:scale-[0.98] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
              >
                <Plus className="size-4" aria-hidden /> Add garments
              </Link>
            </div>
          ) : (
            <div className="py-24 text-center">
              <Shirt className="mx-auto mb-3 size-8 text-neutral-400" aria-hidden />
              <p className="font-ui text-sm text-neutral-500">
                Nothing matches these filters yet.
              </p>
            </div>
          )
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-6 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
            {shown.map((g, i) => (
              <GarmentCell
                key={g.id}
                g={g}
                index={i}
                onOpen={() => setEditId(g.id)}
                onDuplicate={() => setDupId(g.id)}
              />
            ))}
          </div>
        )}

        {/* Needs review — photo-only items too obscured to place in the catalog. */}
        {hold.length > 0 && (
          <details className="mt-12 border-t border-neutral-300/70 pt-6">
            <summary className="cursor-pointer font-ui text-[11px] uppercase tracking-[0.16em] text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900">
              Needs review ({hold.length})
            </summary>
            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-6 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
              {hold.map((g, i) => (
                <GarmentCell
                  key={g.id}
                  g={g}
                  index={i}
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

import { parseCloudSrc } from "../cloud/src.ts";
import { isHoodiePiece, isMidlayer, slotOf } from "../style.ts";
import type { Category, Garment } from "../types.ts";

/** Joe's closet_meta account. The migrator refuses any other uid. */
export const PHASE0_UID = "5d458205-b3ca-433a-8b75-4c0a2bbfa1ee";

export const OUTFIT_SLOTS = ["top", "bottom", "footwear", "outer", "accessory", "mid"] as const;
export type OutfitSlot = (typeof OUTFIT_SLOTS)[number];

export type BlobGarment = {
  id: string;
  name?: string;
  category?: string;
  subtype?: string;
  colors?: string[];
  material?: string;
  brand?: string;
  notes?: string;
  formality?: number;
  warmth?: number;
  seasons?: string[];
  imageSrc?: string;
  cutoutSrc?: string;
  imageSource?: string;
  fit?: string;
  tuck?: string;
  wornOn?: string[];
  fileHash?: string;
  archived?: boolean;
  demo?: boolean;
  paid?: number;
  createdAt?: string;
};

export type BlobLook = {
  id: string;
  name?: string;
  occasion?: string;
  garmentIds?: string[];
  source?: string;
  lookbook?: boolean;
  recipeId?: string;
  createdAt?: string;
};

export type BlobJournal = {
  date: string;
  garmentIds?: string[];
  verdict?: string;
  occasion?: string;
};

export type ClosetBlob = {
  garments: BlobGarment[];
  looks: BlobLook[];
  journal: BlobJournal[];
  avoid?: Record<string, number>;
};

export type GarmentV2Row = {
  user_id: string;
  legacy_id: string;
  status: "in_closet";
  name: string;
  category: string;
  subcategory: string;
  colors: string[];
  pattern: null;
  fabric: string;
  weight: null;
  formality: number | null;
  warmth: number | null;
  seasons: string[];
  occasions: string[];
  house_fit: Record<string, never>;
  fit: string | null;
  tuck: string | null;
  brand: string;
  notes: string;
  paid_cents: number | null;
  image_path: string | null;
  cutout_path: string | null;
  thumb_path: string | null;
  image_source: string | null;
  phash: null;
  ai_raw: BlobGarment;
  ai_confidence: null;
  version: 1;
  deleted_at: null;
};

export type OutfitV2Row = {
  user_id: string;
  legacy_id: string;
  name: string;
  occasion: string;
  source: string;
  recipe_id: string | null;
  lookbook: boolean;
  version: 1;
  created_at: string | null;
};

export type OutfitItemRow = {
  user_id: string;
  outfit_legacy_id: string;
  garment_legacy_id: string;
  slot: OutfitSlot;
  position: number;
};

export type WearRow = {
  user_id: string;
  garment_legacy_id: string;
  worn_on: string;
  occasion: string | null;
};

export type FeedbackRow = {
  user_id: string;
  garment_legacy_id: string;
  kind: "skip";
  occurred_on: string | null;
  source: "journal" | "avoid";
};

export type DroppedLook = {
  id: string;
  missingIds: string[];
  resolved: number;
};

export type MigrateResult = {
  user_id: string;
  garments: GarmentV2Row[];
  outfits: OutfitV2Row[];
  items: OutfitItemRow[];
  wear: WearRow[];
  feedback: FeedbackRow[];
  droppedLooks: DroppedLook[];
  imagePaths: string[];
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Storage path inside closet-images. sb: is not an img src. */
export function storagePath(src: string | undefined): string | null {
  const parsed = parseCloudSrc(src);
  return parsed?.path ?? null;
}

export function thumbSibling(path: string | null): string | null {
  if (!path) return null;
  return path.replace(/\/[oct]\.jpg$/, "/t.jpg");
}

/**
 * Outfit slot. Hoodie stays top. Cardigan / fleece is mid, not outer.
 * Does not invent a garment.
 */
export function outfitSlot(g: Pick<Garment, "name" | "subtype" | "category">): OutfitSlot | null {
  const piece = g as Garment;
  if (isMidlayer(piece) && !isHoodiePiece(piece)) return "mid";
  const slot = slotOf(piece);
  if (slot === "outerwear") return "outer";
  if (slot === "top" || slot === "bottom" || slot === "footwear" || slot === "accessory") return slot;
  if (slot === "dress") return "top";
  if (
    g.category === "top" ||
    g.category === "bottom" ||
    g.category === "footwear" ||
    g.category === "accessory"
  ) {
    return g.category;
  }
  if (g.category === "outerwear") return "outer";
  return null;
}

export function liveBlobGarments(garments: BlobGarment[]): BlobGarment[] {
  return garments.filter((g) => g.archived !== true && g.demo !== true && g.id);
}

function asGarment(g: BlobGarment): Garment {
  return {
    id: g.id,
    name: g.name ?? "",
    category: (g.category ?? "other") as Category,
    subtype: g.subtype ?? "",
    colors: g.colors ?? [],
    material: g.material ?? "",
    brand: g.brand ?? "",
    notes: g.notes ?? "",
    formality: (g.formality ?? 3) as Garment["formality"],
    warmth: (g.warmth ?? 3) as Garment["warmth"],
    seasons: g.seasons ?? [],
    imageSrc: g.imageSrc ?? "",
    cutoutSrc: g.cutoutSrc ?? "",
    imageSource: (g.imageSource ?? "photo") as Garment["imageSource"],
    matteQuality: "ok",
    demo: g.demo === true,
    wornOn: g.wornOn ?? [],
    archived: g.archived === true,
    createdAt: g.createdAt ?? "",
    fit: g.fit as Garment["fit"],
    tuck: g.tuck as Garment["tuck"],
  };
}

function garmentRow(userId: string, g: BlobGarment): GarmentV2Row {
  const image = storagePath(g.imageSrc);
  const cutout = storagePath(g.cutoutSrc);
  const thumb = thumbSibling(image ?? cutout);
  return {
    user_id: userId,
    legacy_id: g.id,
    status: "in_closet",
    name: g.name ?? "",
    category: g.category ?? "other",
    subcategory: g.subtype ?? "",
    colors: [...(g.colors ?? [])],
    pattern: null,
    fabric: g.material ?? "",
    weight: null,
    formality: typeof g.formality === "number" ? g.formality : null,
    warmth: typeof g.warmth === "number" ? g.warmth : null,
    seasons: [...(g.seasons ?? [])],
    occasions: [],
    house_fit: {},
    fit: g.fit ?? null,
    tuck: g.tuck ?? null,
    brand: g.brand ?? "",
    notes: g.notes ?? "",
    paid_cents: null,
    image_path: image,
    cutout_path: cutout,
    thumb_path: thumb,
    image_source: g.imageSource ?? null,
    phash: null,
    ai_raw: g,
    ai_confidence: null,
    version: 1,
    deleted_at: null,
  };
}

/**
 * One-shot copy of a closet_meta blob into row plans.
 * Does not write. Does not invent ids. Empty seasons stay empty.
 */
export function migrateClosetMeta(blob: ClosetBlob, userId: string): MigrateResult {
  if (userId !== PHASE0_UID) {
    throw new Error("phase 0 migrates only joe@prereal.com");
  }
  const live = liveBlobGarments(blob.garments);
  const liveIds = new Set(live.map((g) => g.id));
  const byId = new Map(live.map((g) => [g.id, g]));
  const garments = live.map((g) => garmentRow(userId, g));
  const imagePaths = [
    ...new Set(
      garments.flatMap((g) => [g.image_path, g.cutout_path, g.thumb_path].filter((p): p is string => !!p)),
    ),
  ];

  const outfits: OutfitV2Row[] = [];
  const items: OutfitItemRow[] = [];
  const droppedLooks: DroppedLook[] = [];

  for (const look of blob.looks) {
    const ids = look.garmentIds ?? [];
    const missingIds = [...new Set(ids.filter((id) => !liveIds.has(id)))];
    const resolved = ids.filter((id) => liveIds.has(id));
    const uniqueResolved = [...new Set(resolved)];
    if (uniqueResolved.length < 2) {
      droppedLooks.push({ id: look.id, missingIds, resolved: uniqueResolved.length });
      continue;
    }
    outfits.push({
      user_id: userId,
      legacy_id: look.id,
      name: look.name ?? "",
      occasion: look.occasion ?? "",
      source: look.source ?? "ai",
      recipe_id: look.recipeId ?? null,
      lookbook: look.lookbook === true,
      version: 1,
      created_at: look.createdAt ?? null,
    });
    let position = 0;
    const seen = new Set<string>();
    for (const id of ids) {
      if (!liveIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      const g = byId.get(id)!;
      const slot = outfitSlot(asGarment(g));
      if (!slot) continue;
      items.push({
        user_id: userId,
        outfit_legacy_id: look.id,
        garment_legacy_id: id,
        slot,
        position,
      });
      position += 1;
    }
  }

  const wearKeys = new Set<string>();
  const wear: WearRow[] = [];
  const addWear = (id: string, day: string, occasion: string | null) => {
    if (!liveIds.has(id) || !DAY.test(day)) return;
    const key = `${id}|${day}`;
    if (wearKeys.has(key)) return;
    wearKeys.add(key);
    wear.push({
      user_id: userId,
      garment_legacy_id: id,
      worn_on: day,
      occasion,
    });
  };
  for (const g of live) {
    for (const day of g.wornOn ?? []) addWear(g.id, day, null);
  }
  for (const entry of blob.journal) {
    if (entry.verdict !== "worn") continue;
    for (const id of entry.garmentIds ?? []) addWear(id, entry.date, entry.occasion ?? null);
  }

  const feedback: FeedbackRow[] = [];
  const skipKeys = new Set<string>();
  for (const entry of blob.journal) {
    if (entry.verdict !== "skipped") continue;
    for (const id of entry.garmentIds ?? []) {
      if (!liveIds.has(id)) continue;
      const key = `journal|${id}|${entry.date}`;
      if (skipKeys.has(key)) continue;
      skipKeys.add(key);
      feedback.push({
        user_id: userId,
        garment_legacy_id: id,
        kind: "skip",
        occurred_on: DAY.test(entry.date) ? entry.date : null,
        source: "journal",
      });
    }
  }
  for (const id of Object.keys(blob.avoid ?? {})) {
    if (!liveIds.has(id)) continue;
    const key = `avoid|${id}`;
    if (skipKeys.has(key)) continue;
    skipKeys.add(key);
    feedback.push({
      user_id: userId,
      garment_legacy_id: id,
      kind: "skip",
      occurred_on: null,
      source: "avoid",
    });
  }

  return {
    user_id: userId,
    garments,
    outfits,
    items,
    wear,
    feedback,
    droppedLooks,
    imagePaths,
  };
}

/** Paths that are not already in storage. A miss is a 404 — do not load. */
export function imageHeadFailures(paths: string[], existing: Set<string>): string[] {
  return paths.filter((path) => !existing.has(path));
}

/** The v2 rows describe the same garments and the same looks, nothing added. */
export function migrationMatchesBlob(blob: ClosetBlob, result: MigrateResult): boolean {
  const live = liveBlobGarments(blob.garments);
  if (result.garments.length !== live.length) return false;
  const ids = new Set(result.garments.map((g) => g.legacy_id));
  if (live.some((g) => !ids.has(g.id))) return false;
  if (result.outfits.length + result.droppedLooks.length !== blob.looks.length) return false;
  if (result.garments.some((g) => g.status !== "in_closet")) return false;
  if (result.garments.some((g) => g.seasons.length !== (live.find((x) => x.id === g.legacy_id)?.seasons ?? []).length)) {
    return false;
  }
  return true;
}

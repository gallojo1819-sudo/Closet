// Shared garment/vision types for the ingest pipeline and closet UI.

export const CATEGORIES = [
  "top",
  "bottom",
  "outerwear",
  "dress",
  "footwear",
  "accessory",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const GARMENT_STATUSES = [
  "pending",
  "tagged",
  "cutout_ready",
  "cutout_failed",
  "cutout_rejected",
  "hold",
] as const;
export type GarmentStatus = (typeof GARMENT_STATUSES)[number];

export type Confidence = "high" | "medium" | "low";

/** Normalized [left, top, right, bottom], floats in 0..1 on the upright image. */
export type Bbox = [number, number, number, number];

/** One item as returned by the vision inventory model. */
export interface VisionItem {
  category: Category;
  subtype: string | null;
  colors: string[];
  pattern: string | null;
  material: string | null;
  /** Only set when a brand is clearly legible; never guessed. */
  brand: string | null;
  formality: number | null;
  warmth: number | null;
  seasons: string[];
  bbox: Bbox | null;
  observed: Record<string, unknown>;
  unknowns: string[];
  confidence: Confidence;
  notes: string | null;
}

/** A garments row as read by the closet UI (subset of columns it renders). */
export interface GarmentRow {
  id: string;
  status: GarmentStatus;
  category: Category;
  subtype: string | null;
  colors: string[];
  pattern: string | null;
  material: string | null;
  brand: string | null;
  formality: number | null;
  warmth: number | null;
  seasons: string[];
  notes: string | null;
  thumb_path: string | null;
  cutout_path: string | null;
  image_source: ImageSource;
  possible_duplicate_of: string | null;
  created_at: string;
  // Product identification (Round B4). Filled only when a garment is matched to
  // a real manufacturer product; brand_verified gates the "verified" filter.
  product_name: string | null;
  retailer: string | null;
  retailer_product_id: string | null;
  size: string | null;
  product_url: string | null;
  product_image_path: string | null;
  brand_verified: boolean;
}

export const IMAGE_SOURCES = ["segmented", "cutout", "photo", "official"] as const;
export type ImageSource = (typeof IMAGE_SOURCES)[number];

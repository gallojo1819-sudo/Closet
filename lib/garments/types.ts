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
  possible_duplicate_of: string | null;
  created_at: string;
}

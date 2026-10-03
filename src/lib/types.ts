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

export const IMAGE_SOURCES = [
  "official",
  "segmented",
  "cutout",
  "photo",
] as const;

export type ImageSource = (typeof IMAGE_SOURCES)[number];

export type Tuck = "in" | "out" | "either";

export type Garment = {
  id: string;
  name: string;
  category: Category;
  subtype: string;
  colors: string[];
  material: string;
  brand: string;
  notes: string;
  formality: 1 | 2 | 3 | 4 | 5;
  warmth: 1 | 2 | 3 | 4 | 5;
  seasons: string[];
  imageSrc: string;
  cutoutSrc: string;
  imageSource: ImageSource;
  matteQuality: "clean" | "ok" | "busy";
  /** Plate was refused. The grid shows paper, not the phone photo. Absent on old rows. */
  reprint?: boolean;
  /** A real plate was saved. Absent until then. A camera filename is not this. */
  plated?: boolean;
  demo: boolean;
  wornOn: string[];
  paid?: number;
  fit?: "slim" | "regular" | "relaxed";
  /** How the shirt is worn. Missing on old closet.v6 garments → guessTuck. */
  tuck?: Tuck;
  productUrl?: string;
  /** Fingerprint of the source File so a dump cannot add the same JPEG twice. */
  fileHash?: string;
  archived: boolean;
  createdAt: string;
};

export type Look = {
  id: string;
  name: string;
  occasion: string;
  garmentIds: string[];
  source: "ai" | "manual";
  /** Auto Lookbook entry. Rebuilds may replace these; never wipe source "manual". */
  lookbook?: boolean;
  /** Quiet recipe stamp. Manual looks may omit. */
  recipeId?: string;
  /** Critic hid this look. It stays in the saved array. */
  rejected?: boolean;
  /** Closest-fill note. Hard house looks omit it. */
  gap?: string;
  /** House is off for this occasion or season. The card is the gate, not an outfit. */
  gate?: { occasion: string; season: string; text: string };
  /** Shown when a house has fewer than three legal looks. */
  needsPieces?: boolean;
  /** Required jacket had no uncapped legal outer. The card stays, without a jacket. */
  demoted?: "JKT-COV-1";
  createdAt: string;
};

export type StylistMessage = {
  id: string;
  role: "user" | "stylist";
  text: string;
  lookId?: string;
  garmentIds?: string[];
  /** Draft stays on the message so a reload still shows Save and Wear. */
  draftName?: string;
  draftOccasion?: Occasion;
  /** Quiet technique name under the reply. Absent when none was used. */
  technique?: string;
  createdAt: string;
};

export type WeatherSnap = {
  f: number;
  label: string;
  code: number;
  /** True only when a weather service returned this temperature. */
  measured?: boolean;
};

export const OCCASIONS = [
  { id: "weekday", label: "Weekday" },
  { id: "out", label: "Out" },
  { id: "weekend", label: "Weekend" },
  { id: "comfy", label: "Comfy" },
  { id: "travel", label: "Travel" },
] as const;

export type Occasion = (typeof OCCASIONS)[number]["id"];

/** Old closet.v6 client/dinner become Out. */
export function mapOccasion(raw?: string | null): Occasion {
  if (raw === "client" || raw === "dinner") return "out";
  if (
    raw === "weekday" ||
    raw === "out" ||
    raw === "weekend" ||
    raw === "comfy" ||
    raw === "travel"
  ) {
    return raw;
  }
  return "weekday";
}

export const SEASONS = [
  { id: "spring", label: "Spring" },
  { id: "summer", label: "Summer" },
  { id: "fall", label: "Fall" },
  { id: "winter", label: "Winter" },
] as const;

export type Season = (typeof SEASONS)[number]["id"];

export type Moment = "morning" | "day" | "evening";

export type DailyDrop = {
  date: string;
  garmentIds: string[];
  worn: boolean;
  verdict?: "pending" | "worn" | "skipped";
  weather?: WeatherSnap;
  occasion?: Occasion;
  moment?: Moment;
  /** Piece ids pinned on Today. Survive skip / occasion / reroll. */
  lockedIds?: string[];
  /** Quiet line when a lock forced the rest of the look to move. */
  lockNote?: string | null;
};

export type WearEntry = {
  date: string;
  garmentIds: string[];
  verdict: "worn" | "skipped";
  occasion?: Occasion;
};



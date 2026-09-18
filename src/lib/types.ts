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
  createdAt: string;
};

export type StylistMessage = {
  id: string;
  role: "user" | "stylist";
  text: string;
  lookId?: string;
  garmentIds?: string[];
  createdAt: string;
};

export type WeatherSnap = {
  f: number;
  label: string;
  code: number;
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



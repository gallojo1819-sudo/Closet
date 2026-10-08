import { SEASONS, type Garment, type Season } from "./types.ts";

export type { Season };
export { SEASONS };

const SEASON_IDS = new Set<string>(SEASONS.map((s) => s.id));

export function isSeason(raw: string): raw is Season {
  return SEASON_IDS.has(raw);
}

function blobOf(g: Pick<Garment, "name" | "subtype" | "material" | "notes">): string {
  return `${g.subtype} ${g.name} ${g.material} ${g.notes ?? ""}`.toLowerCase();
}

export function isLinenCampPiece(g: Garment): boolean {
  const b = blobOf(g);
  return /linen/.test(b) || /camp/.test(b);
}

export function isOvercoatPiece(g: Garment): boolean {
  const b = blobOf(g);
  if (/overcoat|topcoat|shearling/.test(b)) return true;
  if (/parka|puffer/.test(b) && g.warmth >= 4) return true;
  return /coat\b/.test(b) && g.warmth >= 4 && !/blazer|sport\s*coats?/.test(b);
}

function fromField(g: Garment): Season[] {
  const out: Season[] = [];
  for (const raw of g.seasons ?? []) {
    const id = String(raw).toLowerCase();
    if (isSeason(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Fabric and warmth first. User chips live on garment.seasons and win via seasonsOf. */
export function guessSeason(g: Garment): Season[] {
  const b = blobOf(g);
  if (/linen/.test(b) || /camp/.test(b) || g.warmth <= 2) return ["summer"];
  if (
    /overcoat|shearling/.test(b) ||
    g.warmth >= 4 ||
    /flannel/.test(b) ||
    /heavy\s*cashmere/.test(b)
  ) {
    return ["winter"];
  }
  if (/blazer/.test(b) || /merino/.test(b) || /chino/.test(b) || g.warmth === 3) {
    return ["fall", "spring"];
  }
  const listed = fromField(g);
  if (listed.length) return listed;
  return ["fall", "spring"];
}

/** User chips win when seasons[] is set. Empty → every season. */
export function seasonsOf(g: Garment): Season[] {
  const listed = fromField(g);
  if (listed.length) return listed;
  return ["spring", "summer", "fall", "winter"];
}

/** The season chips beside Auto. While Auto is on, the season it resolved is Auto's chip, not a twin. */
export function seasonChipRow(
  chip: "auto" | Season,
  autoSeason: Season,
): readonly { id: Season; label: string }[] {
  if (chip !== "auto") return SEASONS;
  return SEASONS.filter((s) => s.id !== autoSeason);
}

/** Auto names the season it resolved. October, mild, is "Auto · Fall". */
export function seasonControlLabel(
  chip: "auto" | Season,
  date = new Date(),
  weatherF?: number | null,
): string {
  const id = chip === "auto" ? seasonFromWeather(weatherF, date) : chip;
  const label = SEASONS.find((s) => s.id === id)?.label ?? "Fall";
  return chip === "auto" ? `Auto · ${label}` : label;
}

/**
 * A measured temperature wins: ≥75 summer, <55 winter.
 * No temperature means the month. September through November is fall.
 */
export function seasonFromWeather(f?: number | null, d = new Date()): Season {
  if (f != null && Number.isFinite(f)) {
    if (f >= 75) return "summer";
    if (f < 55) return "winter";
  }
  const m = d.getMonth();
  if (m >= 2 && m <= 4) return "spring";
  if (m >= 8 && m <= 10) return "fall";
  if (m >= 5 && m <= 7) return "summer";
  return "winter";
}

export function seasonWarmth(season: Season): number {
  if (season === "summer") return 2;
  if (season === "winter") return 4;
  return 3;
}

export function weatherForSeason(season: Season): { f: number; label: string; code: number } {
  if (season === "summer") return { f: 78, label: "Warm", code: 0 };
  if (season === "winter") return { f: 40, label: "Cold", code: 3 };
  if (season === "spring") return { f: 62, label: "Mild", code: 2 };
  return { f: 64, label: "Mild", code: 2 };
}

/**
 * Summer shirts the record does not describe. Same id-table pattern as the jacket classification.
 * g_zh2l854ghu1t: Green herringbone knit shirt, a short-sleeve camp-collar shirt filed as a plain shirt.
 */
export const SUMMER_SHIRTS: readonly string[] = ["g_zh2l854ghu1t"];
const SUMMER_SHIRT_IDS = new Set<string>(SUMMER_SHIRTS);

/** A camp, bowling, resort, or short-sleeve shirt, or a top the user chipped summer-only. */
export function isSummerShirt(g: Garment): boolean {
  if (SUMMER_SHIRT_IDS.has(g.id)) return true;
  const b = `${g.name} ${g.subtype}`.toLowerCase();
  if (/\bcamp\b|\bbowling\b|\bresort\b/.test(b)) return true;
  if (/short[- ]?sleeved?\b/.test(b) && /\bshirts?\b/.test(b)) return true;
  return isSummerOnly(g);
}

function isLayerTop(g: Garment): boolean {
  const b = blobOf(g);
  if (/\b(hoodies?|sweatshirts?)\b/.test(b)) return true;
  return g.category === "top" || g.category === "dress";
}

function isSummerOnly(g: Garment): boolean {
  const s = seasonsOf(g);
  return s.length > 0 && s.every((x) => x === "summer");
}

function isWinterOnly(g: Garment): boolean {
  const s = seasonsOf(g);
  return s.length > 0 && s.every((x) => x === "winter");
}

/** Linen July with overcoat January is never a look. */
export function lookMixesSolstice(pieces: Garment[]): boolean {
  return pieces.some(isSummerOnly) && pieces.some(isWinterOnly);
}

/**
 * Hard clashes only: linen-only top in winter, overcoat in summer, shorts in winter,
 * and a summer shirt as a top in fall or winter, whatever is layered over it.
 * Fall + knit/chino/loafer/oxford always passes.
 */
export function lookFitsSeason(pieces: Garment[], season: Season): boolean {
  if (pieces.length < 2) return false;
  if (lookMixesSolstice(pieces)) return false;
  if (season === "summer" && pieces.some(isOvercoatPiece)) return false;
  if ((season === "fall" || season === "winter") && pieces.filter(isLayerTop).some(isSummerShirt)) {
    return false;
  }
  if (season === "winter") {
    if (pieces.some((g) => /\bshorts?\b/.test(blobOf(g)))) return false;
    const tops = pieces.filter(isLayerTop);
    if (
      tops.length > 0 &&
      tops.every((g) => isLinenCampPiece(g) || isSummerOnly(g))
    ) {
      return false;
    }
  }
  return true;
}

export function seasonRank(pieces: Garment[], season: Season): number {
  if (!lookFitsSeason(pieces, season)) return -1;
  const target = seasonWarmth(season);
  return pieces.filter((g) => g.category !== "accessory" && Math.abs(g.warmth - target) <= 1)
    .length;
}

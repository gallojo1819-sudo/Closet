import library from "./library.json" with { type: "json" };
import { brandHits } from "../house-profiles/evaluate.ts";
import { jacketInfo, jacketRequired, wearSlot } from "../stylist/jackets.ts";
import { isHeavyCable, slotOf } from "../style.ts";
import { isLegal } from "../stylist/legal.ts";
import type { Garment, Occasion, Season } from "../types.ts";
import { usualFromCloset } from "./usual.ts";

type Detector = (typeof library.detectors)[number];
type Role = "top" | "bottom" | "footwear" | "outer";

export type WayOutfit = {
  occasion: Occasion;
  pieces: Garment[];
  wear: number;
};

export type WayRank = {
  id: string;
  title: string;
  count: number;
  reasons: string[];
  score: number;
  outfits: WayOutfit[];
  usual?: boolean;
};

const CAP = 4;

function cloth(g: Garment): string {
  return `${g.name} ${g.subtype} ${g.material ?? ""} ${g.notes ?? ""} ${(g.colors ?? []).join(" ")}`.toLowerCase();
}

/** The word, or that word plus a single trailing s. "AMI" does not match "Amiri". */
export function phraseHits(text: string, phrase: string): boolean {
  const esc = phrase
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\s+/g, "\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc}s?(?![\\p{L}\\p{N}])`, "iu").test(text);
}

function hasPhrase(text: string, phrase: string): boolean {
  return phraseHits(text, phrase);
}

function anyPhrase(text: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => hasPhrase(text, phrase));
}

function materialOf(g: Garment): string {
  return (g.material ?? "").toLowerCase();
}

function isStoreBrand(brand: string): boolean {
  const b = brand.trim();
  if (!b) return false;
  return library.stores.some((store) => brandHits(b, [store]) && b.toLowerCase() === store.toLowerCase());
}

function brandTrips(g: Garment, detector: Detector): boolean {
  const brand = g.brand ?? "";
  if (!brand.trim() || isStoreBrand(brand)) return false;
  if (brandHits(brand, ["Pini Parma"])) {
    if (detector.id === "fine_knit_loafer") return /knit|wool|cashmere|merino/.test(materialOf(g) + cloth(g));
    if (detector.id === "linen_soft") return /linen/.test(materialOf(g));
    return false;
  }
  if (brandHits(brand, ["Loro Piana", "Brunello"])) {
    if (detector.id === "linen_soft") return /linen/.test(materialOf(g));
    if (detector.id === "flannel_cashmere") return /cashmere|flannel/.test(materialOf(g));
    return false;
  }
  if (brandHits(brand, ["Ferragamo"])) {
    const shoe = roleOf(g) === "footwear";
    if (!shoe) return false;
    if (detector.id === "glossy_formal") return true;
    if (detector.id === "flannel_cashmere") return /cashmere|flannel|suede|wool/.test(materialOf(g) + cloth(g));
    return false;
  }
  return brandHits(brand, detector.brands);
}

export function roleOf(g: Garment): Role | null {
  const worn = wearSlot(g);
  const knit = /knit|sweater|cable/.test(cloth(g));
  if (worn === "mid") return null;
  if (worn === "outer" || slotOf(g) === "outerwear") {
    if (knit) return null;
    return "outer";
  }
  const slot = slotOf(g);
  if (slot === "top" || slot === "dress") return "top";
  if (slot === "bottom") return "bottom";
  if (slot === "footwear") return "footwear";
  return null;
}

function isJean(g: Garment): boolean {
  return roleOf(g) === "bottom" && /\bjeans?\b/.test(cloth(g)) && !/jacket|shirt|trucker/.test(cloth(g));
}

function isDenim(g: Garment): boolean {
  return /denim|\bjeans?\b|selvedge|chambray/.test(cloth(g));
}

function chunkyKnit(g: Garment): boolean {
  if (isHeavyCable(g)) return true;
  return /knit|cable|sweater/.test(cloth(g)) && (g.warmth ?? 0) >= 4;
}

function isSportCoat(g: Garment): boolean {
  const info = jacketInfo(g);
  if (info.class === "sport_coat_soft" || info.class === "sport_coat_structured") return true;
  return /sport coat|sportcoat|blazer/.test(cloth(g));
}

function linenCloth(g: Garment): boolean {
  return /linen/.test(materialOf(g));
}

function flannelCloth(g: Garment): boolean {
  return /flannel/.test(cloth(g));
}

/** Hard blocks. A penalty is not enough. */
export function hardBlock(pieces: Garment[], detector?: Detector): string | null {
  if (pieces.some(linenCloth) && pieces.some(flannelCloth)) return "Linen and flannel never share a look.";
  if (pieces.some(isSportCoat) && pieces.some(chunkyKnit)) {
    return "A sport coat takes a shirt or a fine knit, never a chunky cable.";
  }
  const blackTrouser = pieces.some(
    (g) => roleOf(g) === "bottom" && /black/.test(cloth(g)) && /trouser/.test(cloth(g)) && !isJean(g),
  );
  const brownShoe = pieces.some((g) => roleOf(g) === "footwear" && /brown|tan/.test(cloth(g)));
  if (blackTrouser && brownShoe) return "No black trousers with brown shoes.";
  const winterCloth = pieces.some(
    (g) =>
      brandHits(g.brand ?? "", ["Loro Piana", "Brunello"]) && /cashmere|flannel/.test(materialOf(g)),
  );
  const summerWeight = pieces.some((g) => linenCloth(g) || (g.seasons?.length === 1 && g.seasons[0] === "summer"));
  if (winterCloth && summerWeight) {
    return "This cloth is built for winter; the other piece is summer weight. Keep the cloth and swap the other piece.";
  }
  if (detector && pieces.some(isDenim) && pieces.filter(isDenim).length >= 2 && !detector.denim_on_denim) {
    return "Denim on denim is legal only in western work.";
  }
  const rows = detector ? [detector] : library.detectors;
  for (const row of rows) {
    const hit = detectorFail(pieces, row);
    if (hit) return hit;
  }
  return null;
}

function detectorFail(pieces: Garment[], detector: Detector): string | null {
  const text = pieces.map(cloth).join(" | ");
  if (detector.id === "western_work" && /polo/.test(text) && /pink/.test(text) && /white/.test(text) && /sneaker/.test(text)) {
    return detector.fail;
  }
  if (detector.id === "ivy_prep" && /hoodie|graphic/.test(text) && /blazer|sport coat/.test(text)) return detector.fail;
  if (detector.id === "country_stable" && /\bcords?\b|corduroy/.test(text) && (/linen/.test(text) || /\bcamp\b/.test(text))) {
    return detector.fail;
  }
  if (detector.id === "glossy_formal" && /suit trouser|dress trouser/.test(text) && /sneaker/.test(text)) return detector.fail;
  if (
    detector.id === "shrunken_suit" &&
    /cropped trouser|crop trouser/.test(text) &&
    (/chunky|dad sneaker|platform/.test(text) || /overcoat|topcoat|long coat/.test(text))
  ) {
    return detector.fail;
  }
  if (detector.id === "fine_knit_loafer" && /camp/.test(text) && (/blazer|sport coat/.test(text) || /\bboots?\b/.test(text))) {
    return detector.fail;
  }
  if (detector.id === "henley_denim" && /pastel|lavender|lilac|mint|peach|\bpink\b|graphic|print/.test(text)) {
    return detector.fail;
  }
  if (detector.id === "linen_soft" && /linen/.test(text) && (/flannel|\bcords?\b|corduroy|\bboots?\b/.test(text))) {
    return detector.fail;
  }
  if (
    detector.id === "flannel_cashmere" &&
    ((/cable|chunky/.test(text) && /sport coat|blazer/.test(text)) || /puffer/.test(text) || /gym|running shoe/.test(text))
  ) {
    return detector.fail;
  }
  if (detector.id === "clean_city" && /western belt|trophy buckle/.test(text) && /roper/.test(text)) return detector.fail;
  if (detector.id === "boxy_tonal" && /athletic|running sneaker|\brunner\b/.test(text) && /pleat/.test(text)) return detector.fail;
  if (detector.id === "print_plain") {
    const printed = pieces.filter((g) => /print|jacquard|embroidered|paisley/.test(cloth(g)));
    if (printed.length >= 2 || (printed.length === 1 && /graphic/.test(text))) return detector.fail;
  }
  if (detector.id === "graphic_street" && /graphic|hoodie/.test(text) && (/sport coat|blazer|cashmere/.test(text))) {
    return detector.fail;
  }
  if (detector.id === "worn_paris" && /dress shirt/.test(text) && /\btie\b/.test(text) && /jean/.test(text)) return detector.fail;
  if (detector.id === "soft_outdoor" && /fleece/.test(text) && (/dress shirt|oxford|button-down|sport coat|blazer/.test(text))) {
    return detector.fail;
  }
  return null;
}

export function garmentTrips(g: Garment, id: string): boolean {
  const detector = library.detectors.find((row) => row.id === id);
  if (!detector) return false;
  return trips(detector, g);
}

function trips(detector: Detector, g: Garment): boolean {
  const role = roleOf(g);
  if (!role) return false;
  if (brandTrips(g, detector)) return true;
  const text = cloth(g);
  if (role === "bottom" && isJean(g)) return true;
  if ((role === "top" || role === "outer") && anyPhrase(text, detector.top)) {
    if (detector.id === "fine_knit_loafer" && chunkyKnit(g)) return false;
    return true;
  }
  if (role === "outer" && anyPhrase(text, detector.outer)) return true;
  if (role === "bottom" && anyPhrase(text, detector.bottom)) {
    if (/flannel/.test(text) && /trouser/.test(text) && detector.top.some((phrase) => /flannel/.test(phrase))) return false;
    return true;
  }
  if (role === "footwear" && anyPhrase(text, detector.shoe)) return true;
  if (linenCloth(g) && detector.id === "linen_soft" && (role === "top" || role === "bottom")) return true;
  return false;
}

function wearOf(g: Garment): number {
  return g.wornOn?.length ?? 0;
}

function inSeason(detector: Detector, season: Season, month?: number): boolean {
  if (month != null && detector.months?.includes(month)) return true;
  if (month != null && detector.months && !detector.months.includes(month)) return false;
  return detector.seasons.includes(season);
}

function finiteTemp(n: unknown): number | undefined {
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function outfitsFor(
  detector: Detector,
  garments: Garment[],
  opts: { occasion: Occasion; season: Season; weatherF?: number },
): { pieces: Garment[]; wear: number }[] {
  const tops = garments.filter((g) => (roleOf(g) === "top" || roleOf(g) === "outer") && trips(detector, g));
  const bottoms = garments.filter((g) => roleOf(g) === "bottom" && trips(detector, g));
  const shoes = garments.filter((g) => roleOf(g) === "footwear" && trips(detector, g));
  const jackets = garments.filter((g) => roleOf(g) === "outer");
  const weatherF = finiteTemp(opts.weatherF);
  const ctx = {
    occasion: opts.occasion,
    season: opts.season,
    ...(weatherF !== undefined ? { weatherF } : {}),
  };
  const need = jacketRequired(opts.occasion, opts.season, weatherF);
  const found: { pieces: Garment[]; wear: number }[] = [];
  const seen = new Set<string>();
  let tries = 0;
  for (const top of tops) {
    for (const bottom of bottoms) {
      if (found.length >= 3) break;
      for (const shoe of shoes) {
        if (found.length >= 3 || tries >= 400) break;
        tries += 1;
        if (top.id === bottom.id || top.id === shoe.id || bottom.id === shoe.id) continue;
        const core = [top, bottom, shoe];
        const candidates: Garment[][] = need ? [] : [core];
        for (const jacket of jackets) {
          if (core.some((g) => g.id === jacket.id)) continue;
          candidates.push([...core, jacket]);
        }
        for (const pieces of candidates) {
          if (hardBlock(pieces, detector)) continue;
          if (!isLegal(pieces, ctx)) continue;
          const key = pieces
            .map((g) => g.id)
            .sort()
            .join("|");
          if (seen.has(key)) continue;
          seen.add(key);
          found.push({ pieces, wear: pieces.reduce((sum, g) => sum + wearOf(g), 0) });
          break;
        }
      }
    }
  }
  found.sort((a, b) => b.wear - a.wear || a.pieces[0]!.id.localeCompare(b.pieces[0]!.id));
  return found;
}

function scoreOf(rows: { wear: number }[]): number {
  return rows.reduce((sum, row) => sum + Math.max(1, row.wear), 0);
}

function yourUsual(
  garments: Garment[],
  opts: { occasion: Occasion; season: Season; weatherF?: number },
): WayRank {
  const built = usualFromCloset(garments, opts);
  const outfits: WayOutfit[] = built.looks.slice(0, 3).map((pieces) => ({
    occasion: opts.occasion,
    pieces,
    wear: pieces.reduce((sum, g) => sum + wearOf(g), 0),
  }));
  return {
    id: "your_usual",
    title: "Your usual",
    count: built.looks.length,
    reasons: built.looks.length ? ["Most-worn legal outfits."] : [built.reason],
    score: scoreOf(outfits),
    outfits,
    usual: true,
  };
}

/** At most four ways with at least three legal looks for the occasion on screen. */
export function rankWays(
  garments: Garment[],
  opts: { season: Season; occasion?: Occasion; month?: number; weatherF?: number },
): WayRank[] {
  const occasion = opts.occasion ?? "weekday";
  const weatherF = finiteTemp(opts.weatherF);
  const live = garments.filter((g) => !g.archived);
  const page = { occasion, season: opts.season, ...(weatherF !== undefined ? { weatherF } : {}) };
  const ranked = library.detectors.map((detector) => {
    const rows = outfitsFor(detector, live, page);
    return {
      detector,
      rows,
      inSeason: inSeason(detector, opts.season, opts.month),
      score: scoreOf(rows),
    };
  });
  const ready = ranked.filter((row) => row.rows.length >= 3 && row.detector.occasions.includes(occasion));
  const seasonFirst = [
    ...ready.filter((row) => row.inSeason).sort((a, b) => b.score - a.score),
    ...ready.filter((row) => !row.inSeason).sort((a, b) => b.score - a.score),
  ].slice(0, CAP);
  if (!seasonFirst.length) return [yourUsual(live, page)];
  return seasonFirst.map(({ detector, rows, score }) => ({
    id: detector.id,
    title: detector.title,
    count: rows.length,
    reasons: [`${rows.length} complete looks.`],
    score,
    outfits: rows.slice(0, 3).map((row) => ({ occasion, pieces: row.pieces, wear: row.wear })),
  }));
}

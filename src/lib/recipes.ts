/**
 * Look recipes. House fingerprints stay hard; recipes pick the jacket, quota, and rotation.
 * Never invent a camel overcoat. Pool is livePool plates only.
 */
import {
  axesDiffer,
  bottomType,
  garmentBlob,
  lookPrint,
  shoeFamily,
  topType,
  type House,
  type LookPrint,
  type ShoeFamily,
} from "./houses.ts";
import type { Garment, Occasion } from "./types.ts";
import { recipeOuterIssue } from "./stylist/row.ts";

export type RecipeId =
  | "WD_PREP_OCBD"
  | "WD_POLO_CLEAN"
  | "WD_KNIT_CITY"
  | "WD_TEXTURE"
  | "WD_SOFT_ITALIAN"
  | "OUT_BLAZER_DINNER"
  | "OUT_FALONI_HEAT"
  | "OUT_ITALIAN_TONAL"
  | "OUT_COLD_CITY"
  | "WE_ALD_STREET"
  | "WE_CHORE_IVY"
  | "WE_SWEET_STABLE"
  | "WE_DENIM_LAYER"
  | "WE_PREP_SOFT"
  | "TR_KNIT_SOFT"
  | "TR_SHIRT_LAYER"
  | "TR_COLD"
  | "CF_HOODIE"
  | "CF_TEE"
  | "CF_FLEECE"
  | "WD_WESTERN_UNDER_NAVY"
  | "WD_CHORE_CRISP"
  | "WD_DOUBLE_COLLAR"
  | "OUT_TONAL_BROWN"
  | "OUT_IVORY_DB_DENIM"
  | "OUT_SUEDE_SELVEDGE"
  | "OUT_KNITPOLO_WHITE_PLEAT"
  | "WE_DOUBLE_DENIM"
  | "WE_SQUARZI_SUEDE"
  | "WE_FIELD_WHITE_SHIRT"
  | "WE_CHAMBRAY_ROLLED"
  | "WD_DENIM_UNDER_CHORE"
  | "WD_RRL_FIELD"
  | "WD_RRL_SUEDE"
  | "WD_RRL_DENIM"
  | "WE_RRL_CHORE"
  | "WE_RRL_DENIM"
  | "CF_LOAMY_FLEECE";

export type OuterWant =
  | "blazer"
  | "soft"
  | "chore"
  | "field"
  | "denim"
  | "suede"
  | "cold"
  | "none"
  | "optional_blazer";

export type Recipe = {
  id: RecipeId;
  occasions: Occasion[];
  houses: House[];
  outer: OuterWant;
  outerRequired: boolean;
  top: (g: Garment) => boolean;
  bottom: (g: Garment) => boolean;
  shoe: (g: Garment) => boolean;
  /** Extra plate check. Absent plate skips the recipe; it does not empty the chapter. */
  ready?: (pool: Garment[]) => boolean;
  /** Card note when this recipe is skipped. Never a shop line. */
  gap?: string;
};

/** Woven oxford / button-down / dress / gingham / poplin — not polo/hoodie/tee/fleece/sweater. */
export function isButtonDown(g: Garment): boolean {
  const b = garmentBlob(g);
  if (/hoodie|\btee\b|t-shirt|fleece|\bpolo\b|rugby|sweater|cable|hoodie/.test(b) && !/oxford|\bocbd\b|button[- ]?down|gingham|poplin/.test(b)) {
    return false;
  }
  return /oxford|\bocbd\b|button[- ]?down|dress shirt|gingham|poplin/.test(b);
}

export function isCreamCable(g: Garment): boolean {
  const b = garmentBlob(g);
  return /cable/.test(b) && /cream|ivory|ecru/.test(`${b} ${g.colors.join(" ")}`);
}

function isPiquePolo(g: Garment): boolean {
  return topType(g) === "pique_polo";
}

function isKnitCity(g: Garment): boolean {
  const t = topType(g);
  return t === "merino" || t === "cashmere_top" || t === "cable" || t === "italian_knit_polo" || t === "turtleneck";
}

function isChinoTrouser(g: Garment): boolean {
  const t = bottomType(g);
  return t === "chino" || t === "khaki" || t === "trouser" || t === "cord";
}

function isJean(g: Garment): boolean {
  return bottomType(g) === "jean";
}

function isLoaferish(g: Garment): boolean {
  const s = shoeFamily(g);
  return s === "penny_loafer" || s === "suede_loafer" || s === "boat" || s === "derby";
}

function isSneakerish(g: Garment): boolean {
  const s = shoeFamily(g);
  return s === "leather_sneaker" || s === "suede_sneaker" || s === "nb990" || s === "white_court";
}

/** Denim shirt or a work shirt. Not an oxford. */
function isRrlTop(g: Garment): boolean {
  const b = garmentBlob(g);
  if (/oxford|\bocbd\b/.test(b) && !/work shirt|chambray|western|pearl/.test(b)) return false;
  return (
    (/denim/.test(b) && /shirt/.test(b)) ||
    /work shirt|western|pearl\s*snap|chambray|flannel/.test(b)
  );
}

function isRrlShoe(g: Garment): boolean {
  const s = shoeFamily(g);
  return s === "boot" || s === "chelsea";
}

function isDadSneaker(g: Garment): boolean {
  const s = shoeFamily(g);
  return s === "leather_sneaker" || s === "suede_sneaker" || s === "nb990";
}

export const RECIPES: Recipe[] = [
  {
    id: "WD_PREP_OCBD",
    occasions: ["weekday", "travel"],
    houses: ["polo"],
    outer: "optional_blazer",
    outerRequired: false,
    top: isButtonDown,
    bottom: isChinoTrouser,
    shoe: isLoaferish,
  },
  {
    id: "WD_POLO_CLEAN",
    occasions: ["weekday"],
    houses: ["polo"],
    outer: "none",
    outerRequired: false,
    top: isPiquePolo,
    bottom: isChinoTrouser,
    shoe: (g) => isLoaferish(g) || shoeFamily(g) === "boat",
  },
  {
    id: "WD_KNIT_CITY",
    occasions: ["weekday", "out"],
    houses: ["polo", "purple", "italianWinter"],
    outer: "optional_blazer",
    outerRequired: false,
    top: isKnitCity,
    bottom: isChinoTrouser,
    shoe: isLoaferish,
  },
  {
    id: "WD_TEXTURE",
    occasions: ["weekday"],
    houses: ["polo", "sweetStable"],
    outer: "soft",
    outerRequired: false,
    top: (g) => topType(g) === "gingham" || isButtonDown(g),
    bottom: (g) => bottomType(g) === "cord" || isChinoTrouser(g),
    shoe: isLoaferish,
  },
  {
    id: "WD_SOFT_ITALIAN",
    occasions: ["weekday", "out"],
    houses: ["purple", "italianSummer", "italianWinter", "faloni"],
    outer: "soft",
    outerRequired: false,
    top: (g) => {
      const t = topType(g);
      return t === "italian_knit_polo" || t === "merino" || t === "cashmere_top" || t === "linen_portofino";
    },
    bottom: isChinoTrouser,
    shoe: (g) => shoeFamily(g) === "suede_loafer" || shoeFamily(g) === "penny_loafer" || shoeFamily(g) === "summer_walk",
  },
  {
    id: "OUT_BLAZER_DINNER",
    occasions: ["out"],
    houses: ["polo", "purple", "italianWinter"],
    outer: "blazer",
    outerRequired: true,
    top: (g) => isButtonDown(g) || isKnitCity(g) || isPiquePolo(g),
    bottom: isChinoTrouser,
    shoe: isLoaferish,
  },
  {
    id: "OUT_FALONI_HEAT",
    occasions: ["out", "weekend"],
    houses: ["faloni"],
    outer: "none",
    outerRequired: false,
    top: (g) => {
      const t = topType(g);
      return t === "camp" || t === "linen_portofino" || t === "italian_knit_polo";
    },
    bottom: (g) => bottomType(g) === "linen" || isChinoTrouser(g),
    shoe: (g) => shoeFamily(g) === "driving_mule" || shoeFamily(g) === "suede_loafer",
  },
  {
    id: "OUT_ITALIAN_TONAL",
    occasions: ["out", "weekday"],
    houses: ["italianSummer", "purple"],
    outer: "soft",
    outerRequired: false,
    top: (g) => {
      const t = topType(g);
      return t === "merino" || t === "italian_knit_polo" || t === "cashmere_top" || t === "camp";
    },
    bottom: isChinoTrouser,
    shoe: (g) => shoeFamily(g) === "suede_loafer" || shoeFamily(g) === "summer_walk",
  },
  {
    id: "OUT_COLD_CITY",
    occasions: ["out", "weekday"],
    houses: ["italianWinter", "purple", "polo"],
    outer: "cold",
    outerRequired: true,
    top: (g) => {
      const t = topType(g);
      return t === "merino" || t === "turtleneck" || t === "cashmere_top";
    },
    bottom: isChinoTrouser,
    shoe: (g) => isLoaferish(g) || shoeFamily(g) === "chelsea",
  },
  {
    id: "WE_ALD_STREET",
    occasions: ["weekend", "weekday"],
    houses: ["ald"],
    outer: "chore",
    outerRequired: false,
    top: (g) => {
      const t = topType(g);
      return t === "rugby" || t === "oversized_oxford" || t === "hoodie";
    },
    bottom: (g) => isJean(g) || bottomType(g) === "chino",
    shoe: (g) => shoeFamily(g) === "nb990" || isDadSneaker(g),
  },
  {
    id: "WE_CHORE_IVY",
    occasions: ["weekend"],
    houses: ["polo"],
    outer: "chore",
    outerRequired: false,
    top: (g) => isButtonDown(g) || isPiquePolo(g) || topType(g) === "work_shirt",
    bottom: (g) => isJean(g) || isChinoTrouser(g),
    shoe: (g) => isSneakerish(g) || isLoaferish(g),
  },
  {
    id: "WE_SWEET_STABLE",
    occasions: ["weekend", "comfy"],
    houses: ["sweetStable"],
    outer: "none",
    outerRequired: false,
    top: (g) => topType(g) === "fair_isle" || topType(g) === "gingham",
    bottom: (g) => bottomType(g) === "cord" || isChinoTrouser(g),
    shoe: (g) => shoeFamily(g) === "boot" || shoeFamily(g) === "suede_sneaker" || isLoaferish(g),
  },
  {
    id: "WE_DENIM_LAYER",
    occasions: ["weekend"],
    houses: ["ald"],
    outer: "denim",
    outerRequired: false,
    top: (g) => topType(g) === "work_shirt" || topType(g) === "tee" || topType(g) === "hoodie",
    bottom: isJean,
    shoe: (g) => isSneakerish(g) || shoeFamily(g) === "boot",
  },
  {
    id: "WE_PREP_SOFT",
    occasions: ["weekend"],
    houses: ["polo"],
    outer: "field",
    outerRequired: false,
    top: (g) => isPiquePolo(g) || isButtonDown(g) || topType(g) === "camp",
    bottom: isChinoTrouser,
    shoe: (g) => isSneakerish(g) || isLoaferish(g),
  },
  {
    id: "TR_KNIT_SOFT",
    occasions: ["travel"],
    houses: ["polo", "purple"],
    outer: "soft",
    outerRequired: false,
    top: isKnitCity,
    bottom: isChinoTrouser,
    shoe: (g) => isSneakerish(g) || isLoaferish(g),
  },
  {
    id: "TR_SHIRT_LAYER",
    occasions: ["travel", "weekday"],
    houses: ["polo"],
    outer: "soft",
    outerRequired: false,
    top: (g) => isButtonDown(g) || isPiquePolo(g),
    bottom: isChinoTrouser,
    shoe: (g) => isLoaferish(g) || isSneakerish(g),
  },
  {
    id: "TR_COLD",
    occasions: ["travel", "weekday"],
    houses: ["italianWinter", "polo", "purple"],
    outer: "cold",
    outerRequired: true,
    top: isKnitCity,
    bottom: isChinoTrouser,
    shoe: (g) => isLoaferish(g) || shoeFamily(g) === "boot" || shoeFamily(g) === "chelsea",
  },
  {
    id: "CF_HOODIE",
    occasions: ["comfy", "weekend"],
    houses: ["ald", "sweetStable"],
    outer: "none",
    outerRequired: false,
    top: (g) => topType(g) === "hoodie",
    bottom: (g) => isJean(g) || bottomType(g) === "chino",
    shoe: isSneakerish,
  },
  {
    id: "CF_TEE",
    occasions: ["comfy"],
    houses: ["ald", "fiveFourFive"],
    outer: "none",
    outerRequired: false,
    top: (g) => topType(g) === "tee" || topType(g) === "light_cashmere_tee",
    bottom: (g) => isJean(g) || bottomType(g) === "chino",
    shoe: isSneakerish,
  },
  {
    id: "CF_FLEECE",
    occasions: ["comfy"],
    houses: ["polo", "sweetStable"],
    outer: "none",
    outerRequired: false,
    top: (g) => /fleece|quarter[- ]?zip/.test(garmentBlob(g)),
    bottom: (g) => isJean(g) || bottomType(g) === "chino",
    shoe: isSneakerish,
  },
  {
    id: "WD_WESTERN_UNDER_NAVY",
    occasions: ["weekday"],
    houses: ["polo"],
    outer: "blazer",
    outerRequired: true,
    top: (g) => /western|work shirt|pearl/.test(garmentBlob(g)),
    bottom: (g) => isJean(g) || isChinoTrouser(g),
    shoe: (g) => shoeFamily(g) === "boot" || isLoaferish(g),
    ready: (pool) => pool.some((g) => /navy/.test(garmentBlob(g)) && /blazer/.test(garmentBlob(g))),
    gap: "No navy blazer — closest plates",
  },
  {
    id: "WD_CHORE_CRISP",
    occasions: ["weekday"],
    houses: ["polo"],
    outer: "chore",
    outerRequired: true,
    top: isButtonDown,
    bottom: isChinoTrouser,
    shoe: isLoaferish,
    ready: (pool) => pool.some((g) => /\bchore\b/.test(garmentBlob(g))),
    gap: "No chore coat — closest plates",
  },
  {
    id: "WD_DOUBLE_COLLAR",
    occasions: ["weekday"],
    houses: ["polo", "purple"],
    outer: "optional_blazer",
    outerRequired: false,
    top: isButtonDown,
    bottom: isChinoTrouser,
    shoe: isLoaferish,
    ready: (pool) =>
      pool.some(isButtonDown) &&
      pool.some((g) => /knit|sweater|merino/.test(garmentBlob(g))),
  },
  {
    id: "WD_DENIM_UNDER_CHORE",
    occasions: ["weekday"],
    houses: ["rrl"],
    outer: "chore",
    outerRequired: true,
    top: isRrlTop,
    bottom: isJean,
    shoe: isRrlShoe,
    ready: (pool) => pool.some((g) => /\bchore\b/.test(garmentBlob(g))),
    gap: "No chore coat — closest plates",
  },
  {
    id: "WD_RRL_FIELD",
    occasions: ["weekday"],
    houses: ["rrl"],
    outer: "field",
    outerRequired: true,
    top: isRrlTop,
    bottom: isJean,
    shoe: isRrlShoe,
    ready: (pool) => pool.some((g) => /\bfield\b/.test(garmentBlob(g))),
    gap: "No field jacket — closest plates",
  },
  {
    id: "WD_RRL_SUEDE",
    occasions: ["weekday"],
    houses: ["rrl"],
    outer: "suede",
    outerRequired: true,
    top: isRrlTop,
    bottom: isJean,
    shoe: isRrlShoe,
    ready: (pool) => pool.some((g) => /suede/.test(garmentBlob(g)) && /jacket|coat/.test(garmentBlob(g))),
    gap: "No suede jacket — closest plates",
  },
  {
    id: "WD_RRL_DENIM",
    occasions: ["weekday"],
    houses: ["rrl"],
    outer: "denim",
    outerRequired: true,
    top: isRrlTop,
    bottom: isJean,
    shoe: isRrlShoe,
    ready: (pool) => pool.some((g) => /trucker|denim jacket/.test(garmentBlob(g))),
    gap: "No denim jacket — closest plates",
  },
  {
    id: "WE_RRL_CHORE",
    occasions: ["weekend"],
    houses: ["rrl"],
    outer: "chore",
    outerRequired: false,
    top: isRrlTop,
    bottom: isJean,
    shoe: isRrlShoe,
  },
  {
    id: "WE_RRL_DENIM",
    occasions: ["weekend"],
    houses: ["rrl"],
    outer: "denim",
    outerRequired: true,
    top: isRrlTop,
    bottom: isJean,
    shoe: isRrlShoe,
    ready: (pool) => pool.some((g) => /trucker|denim jacket/.test(garmentBlob(g))),
    gap: "No denim jacket — closest plates",
  },
  {
    id: "OUT_TONAL_BROWN",
    occasions: ["out"],
    houses: ["italianWinter", "polo"],
    outer: "suede",
    outerRequired: true,
    top: (g) => isKnitCity(g),
    bottom: (g) => isChinoTrouser(g) && /brown|tan|camel/.test(garmentBlob(g)),
    shoe: (g) => shoeFamily(g) === "suede_loafer",
    ready: (pool) => pool.some((g) => /suede/.test(garmentBlob(g)) && /brown|tan/.test(garmentBlob(g))),
    gap: "No brown suede — closest plates",
  },
  {
    id: "OUT_IVORY_DB_DENIM",
    occasions: ["out"],
    houses: ["italianWinter", "polo"],
    outer: "blazer",
    outerRequired: true,
    top: (g) => /denim/.test(garmentBlob(g)) && /shirt/.test(garmentBlob(g)),
    bottom: isJean,
    shoe: isLoaferish,
    ready: (pool) =>
      pool.some((g) => /ivory|cream/.test(garmentBlob(g)) && /double/.test(garmentBlob(g)) && /blazer/.test(garmentBlob(g))),
    gap: "No ivory double blazer — closest plates",
  },
  {
    id: "OUT_SUEDE_SELVEDGE",
    occasions: ["out"],
    houses: ["rrl"],
    outer: "suede",
    outerRequired: true,
    top: (g) => topType(g) === "work_shirt" || /denim/.test(garmentBlob(g)),
    bottom: (g) => isJean(g),
    shoe: isRrlShoe,
    ready: (pool) => pool.some((g) => /selvedge|suede/.test(garmentBlob(g))),
    gap: "No suede outer — closest plates",
  },
  {
    id: "OUT_KNITPOLO_WHITE_PLEAT",
    occasions: ["out"],
    houses: ["italianSummer", "faloni"],
    outer: "none",
    outerRequired: false,
    top: (g) => topType(g) === "italian_knit_polo",
    bottom: (g) => /white|ivory|cream/.test(garmentBlob(g)) && /pleat|trouser/.test(garmentBlob(g)),
    shoe: isLoaferish,
    ready: (pool) => pool.some((g) => /white|ivory/.test(garmentBlob(g)) && /trouser|pleat/.test(garmentBlob(g))),
    gap: "No white trouser — closest plates",
  },
  {
    id: "WE_DOUBLE_DENIM",
    occasions: ["weekend"],
    houses: ["ald"],
    outer: "denim",
    outerRequired: true,
    top: (g) => /denim/.test(garmentBlob(g)) && /shirt/.test(garmentBlob(g)),
    bottom: isJean,
    shoe: (g) => isSneakerish(g) || shoeFamily(g) === "boot",
    ready: (pool) => pool.some((g) => /trucker|denim jacket/.test(garmentBlob(g))),
    gap: "No denim trucker — closest plates",
  },
  {
    id: "WE_SQUARZI_SUEDE",
    occasions: ["weekend"],
    houses: ["sweetStable", "italianSummer"],
    outer: "suede",
    outerRequired: true,
    top: (g) => topType(g) === "fair_isle" || isKnitCity(g),
    bottom: (g) => bottomType(g) === "cord" || isChinoTrouser(g),
    shoe: (g) => shoeFamily(g) === "suede_loafer",
    ready: (pool) => pool.some((g) => /suede/.test(garmentBlob(g))),
    gap: "No suede — closest plates",
  },
  {
    id: "WE_FIELD_WHITE_SHIRT",
    occasions: ["weekend"],
    houses: ["sweetStable"],
    outer: "field",
    outerRequired: true,
    top: (g) => isButtonDown(g) && /white|ivory|cream/.test(garmentBlob(g)),
    bottom: (g) => isJean(g) || isChinoTrouser(g),
    shoe: (g) => shoeFamily(g) === "boot" || isLoaferish(g),
    ready: (pool) => pool.some((g) => /\bfield\b/.test(garmentBlob(g))),
    gap: "No field jacket — closest plates",
  },
  {
    id: "WE_CHAMBRAY_ROLLED",
    occasions: ["weekend"],
    houses: ["ald", "polo"],
    outer: "none",
    outerRequired: false,
    top: (g) => /chambray/.test(garmentBlob(g)),
    bottom: isJean,
    shoe: (g) => isLoaferish(g) || isSneakerish(g),
    ready: (pool) => pool.some((g) => /chambray/.test(garmentBlob(g))),
    gap: "No chambray — closest plates",
  },
  {
    id: "CF_LOAMY_FLEECE",
    occasions: ["comfy"],
    houses: [],
    outer: "none",
    outerRequired: false,
    top: (g) => /fleece|quarter[- ]?zip/.test(garmentBlob(g)),
    bottom: (g) => isJean(g) || isChinoTrouser(g),
    shoe: isSneakerish,
    ready: (pool) => pool.some((g) => /fleece/.test(garmentBlob(g))),
    gap: "No fleece — closest plates",
  },
];

export type ChapterTrack = {
  usedTops: Set<string>;
  usedBottoms: Set<string>;
  usedShoes: Set<string>;
  usedOuters: Set<string>;
  usedRecipes: Set<RecipeId>;
  recentShoeIds: string[];
  recentShoeFamilies: ShoeFamily[];
  lastPrint?: LookPrint;
  lastRecipe?: RecipeId;
  creamCableUsed: boolean;
  buttonDowns: number;
  index: number;
};

export function emptyChapter(): ChapterTrack {
  return {
    usedTops: new Set(),
    usedBottoms: new Set(),
    usedShoes: new Set(),
    usedOuters: new Set(),
    usedRecipes: new Set(),
    recentShoeIds: [],
    recentShoeFamilies: [],
    creamCableUsed: false,
    buttonDowns: 0,
    index: 0,
  };
}

function slotish(g: Garment): string {
  const t = topType(g);
  if (t !== "other") return "top";
  return g.category;
}

export function noteChapterLook(
  track: ChapterTrack,
  pieces: Garment[],
  recipeId: RecipeId | undefined,
  occasion?: Occasion,
): void {
  const print = lookPrint(pieces, occasion);
  for (const g of pieces) {
    if (isButtonDown(g)) track.buttonDowns += 1;
    if (g.category === "top" || slotish(g) === "top") {
      track.usedTops.add(g.id);
      if (isCreamCable(g)) track.creamCableUsed = true;
    }
    if (g.category === "bottom") track.usedBottoms.add(g.id);
    if (g.category === "footwear") {
      track.usedShoes.add(g.id);
      track.recentShoeIds = [...track.recentShoeIds, g.id].slice(-3);
      track.recentShoeFamilies = [...track.recentShoeFamilies, shoeFamily(g)].slice(-3);
    }
    if (g.category === "outerwear") track.usedOuters.add(g.id);
  }
  if (recipeId) {
    track.usedRecipes.add(recipeId);
    track.lastRecipe = recipeId;
  }
  track.lastPrint = print;
  track.index += 1;
}

function poolHasOuter(pool: Garment[], want: OuterWant): boolean {
  const hit = (re: RegExp) => pool.some((g) => re.test(garmentBlob(g)));
  if (want === "none" || want === "optional_blazer") return true;
  if (want === "blazer") return hit(/blazer|sport\s*coat/);
  if (want === "chore") return hit(/\bchore\b/);
  if (want === "field") return hit(/\bfield\b/);
  if (want === "denim") return hit(/trucker|denim jacket/);
  if (want === "suede") return hit(/suede|shearling/);
  if (want === "cold") return hit(/blazer|shearling|\bcoat\b/);
  if (want === "soft") return hit(/chore|\bfield\b|trucker|suede|shearling|denim jacket/);
  return true;
}

/** Skip a recipe whose shirt, shoe, or jacket is not in the pool. */
export function recipeFitsPool(r: Recipe, pool: Garment[]): boolean {
  if (!pool.some(r.top) || !pool.some(r.bottom) || !pool.some(r.shoe)) return false;
  if (r.outerRequired && !poolHasOuter(pool, r.outer)) return false;
  if (r.ready && !r.ready(pool)) return false;
  return true;
}

/** Quota shrinks to the button-downs he actually owns. */
export function scaledButtonDownQuota(pool: Garment[], want: number): number {
  const have = pool.filter(isButtonDown).length;
  return Math.min(want, Math.max(0, have));
}

/**
 * One card note when a preferred plate is not in the pool.
 * The recipe is skipped. The chapter stays. Never a shop line.
 */
export function plateGapNote(
  pool: Garment[],
  occasion?: Occasion,
  house?: House | "all" | null,
): string | null {
  const list = occasion ? recipesFor(occasion, house) : RECIPES;
  const has = (re: RegExp) => pool.some((g) => re.test(garmentBlob(g)));
  for (const r of list) {
    if (!r.gap || recipeFitsPool(r, pool)) continue;
    const slots = pool.some(r.top) && pool.some(r.bottom) && pool.some(r.shoe);
    const plateMiss =
      (r.ready && !r.ready(pool)) || (r.outerRequired && !poolHasOuter(pool, r.outer));
    if (slots && plateMiss) return r.gap;
  }
  const cold = list.find((r) => r.id === "OUT_COLD_CITY" || r.id === "TR_COLD");
  if (
    cold &&
    !recipeFitsPool(cold, pool) &&
    !has(/turtleneck|rollneck/) &&
    !has(/merino|cashmere/)
  ) {
    return "No turtleneck — closest plates";
  }
  const ald = list.find((r) => r.id === "WE_ALD_STREET");
  if (ald && !recipeFitsPool(ald, pool)) {
    if (!has(/\brugby\b/) && !pool.some((g) => topType(g) === "oversized_oxford" || topType(g) === "hoodie")) {
      return "No rugby — closest plates";
    }
    if (!has(/\b990\b/) && !pool.some(isDadSneaker)) return "No 990 — closest plates";
  }
  return null;
}

export function recipesFor(
  occasion: Occasion,
  house?: House | "all" | null,
): Recipe[] {
  return RECIPES.filter((r) => {
    if (!r.occasions.includes(occasion)) return false;
    if (!house || house === "all") return true;
    return r.houses.includes(house) || r.houses.length === 0;
  });
}

function chooseRecipe(list: Recipe[], track?: ChapterTrack): Recipe {
  const fresh = track ? list.filter((r) => !track.usedRecipes.has(r.id)) : list;
  const pickFrom = fresh.length ? fresh : list;
  if (track?.lastRecipe) {
    const rotated = pickFrom.filter((r) => r.id !== track.lastRecipe);
    if (rotated.length) return rotated[track.index % rotated.length]!;
  }
  return pickFrom[track ? track.index % pickFrom.length : 0]!;
}

export function pickRecipe(
  occasion: Occasion,
  pool: Garment[],
  opts?: { house?: House | "all" | null; track?: ChapterTrack },
): Recipe {
  const house = opts?.house && opts.house !== "all" ? opts.house : undefined;
  const track = opts?.track;
  if (house === "rrl") {
    const owned = RECIPES.filter((r) => r.houses.includes("rrl"));
    const forOcc = owned.filter((r) => r.occasions.includes(occasion));
    const fit = forOcc.filter((r) => recipeFitsPool(r, pool));
    const list = fit.length ? fit : forOcc.length ? forOcc : owned;
    return chooseRecipe(list, track);
  }
  let list = recipesFor(occasion, house).filter((r) => recipeFitsPool(r, pool));
  if (!list.length && house) {
    list = RECIPES.filter((r) => r.houses.includes(house) && recipeFitsPool(r, pool));
  }
  if (!list.length) {
    list = RECIPES.filter((r) => r.occasions.includes(occasion) && recipeFitsPool(r, pool));
  }
  if (!list.length) list = RECIPES.filter((r) => recipeFitsPool(r, pool));
  if (!list.length) list = RECIPES.filter((r) => r.occasions.includes(occasion));
  if (!list.length) list = [...RECIPES];
  if (occasion === "weekday" && (!house || house === "polo")) {
    const needPrep = !track || track.index % 3 === 0;
    if (needPrep) {
      const prep = list.find((r) => r.id === "WD_PREP_OCBD");
      if (prep) return prep;
    }
  }
  return chooseRecipe(list, track);
}

export function recipeScore(pieces: Garment[], r: Recipe): number {
  const tops = pieces.filter((g) => g.category === "top" || g.category === "dress");
  const bots = pieces.filter((g) => g.category === "bottom");
  const shoes = pieces.filter((g) => g.category === "footwear");
  let n = 0;
  if (tops.some(r.top)) n += 3;
  if (bots.some(r.bottom)) n += 2;
  if (shoes.some(r.shoe)) n += 2;
  return n;
}

const OCCASION_PREFIX: Record<Occasion, string> = {
  weekday: "WD_",
  out: "OUT_",
  weekend: "WE_",
  travel: "TR_",
  comfy: "CF_",
};

export function matchRecipe(
  pieces: Garment[],
  occasion: Occasion,
  house?: House | "all" | null,
): RecipeId | undefined {
  const outer = pieces.find((g) => g.category === "outerwear");
  const outerName = outer ? `${outer.name} ${outer.subtype}` : undefined;
  const sameOccasion = (id: string) => id.startsWith(OCCASION_PREFIX[occasion]);
  const showsPromise = (id: string) => recipeOuterIssue(id, outerName) == null;
  const rrlOnly = house === "rrl";
  const list = (
    rrlOnly
      ? RECIPES.filter((r) => r.houses.includes("rrl") && r.occasions.includes(occasion))
      : recipesFor(occasion, house)
  ).filter((r) => sameOccasion(r.id) && showsPromise(r.id));
  let best: Recipe | undefined;
  let bestN = 0;
  for (const r of list) {
    const n = recipeScore(pieces, r);
    if (n > bestN) {
      best = r;
      bestN = n;
    }
  }
  if (best && bestN >= 3) return best.id;
  if (rrlOnly) return undefined;
  const any = RECIPES.filter((r) => r.occasions.includes(occasion) && sameOccasion(r.id) && showsPromise(r.id));
  for (const r of any) {
    const n = recipeScore(pieces, r);
    if (n > bestN) {
      best = r;
      bestN = n;
    }
  }
  return best && bestN >= 3 ? best.id : undefined;
}

/** Same-house regenerate: different recipe_id AND ≥3 axes of the seven. */
export function recipeAxesDiffer(
  a: LookPrint,
  b: LookPrint,
  recipeA?: string,
  recipeB?: string,
): number {
  let n = axesDiffer(a, b);
  if (recipeA && recipeB && recipeA !== recipeB) n += 1;
  return n;
}

export function recipeById(id: RecipeId | string | undefined): Recipe | undefined {
  if (!id) return undefined;
  return RECIPES.find((r) => r.id === id);
}

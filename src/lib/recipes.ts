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
  | "CF_FLEECE";

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
    houses: ["polo", "rrl"],
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
    houses: ["rrl", "ald"],
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
    if (g.category === "top" || slotish(g) === "top") {
      track.usedTops.add(g.id);
      if (isCreamCable(g)) track.creamCableUsed = true;
      if (isButtonDown(g)) track.buttonDowns += 1;
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

function recipeFitsPool(r: Recipe, pool: Garment[]): boolean {
  return pool.some(r.top) && pool.some(r.bottom) && pool.some(r.shoe);
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

export function pickRecipe(
  occasion: Occasion,
  pool: Garment[],
  opts?: { house?: House | "all" | null; track?: ChapterTrack },
): Recipe {
  const house = opts?.house && opts.house !== "all" ? opts.house : undefined;
  const track = opts?.track;
  let list = recipesFor(occasion, house).filter((r) => recipeFitsPool(r, pool));
  if (!list.length && house) {
    list = RECIPES.filter((r) => r.houses.includes(house) && recipeFitsPool(r, pool));
  }
  if (!list.length) {
    list = RECIPES.filter((r) => r.occasions.includes(occasion) && recipeFitsPool(r, pool));
  }
  if (!list.length) list = [...RECIPES];
  if (occasion === "weekday" && (!house || house === "polo")) {
    const needPrep = !track || track.index % 3 === 0;
    if (needPrep) {
      const prep = list.find((r) => r.id === "WD_PREP_OCBD");
      if (prep) return prep;
    }
  }
  const fresh = track ? list.filter((r) => !track.usedRecipes.has(r.id)) : list;
  const pickFrom = fresh.length ? fresh : list;
  if (track?.lastRecipe) {
    const rotated = pickFrom.filter((r) => r.id !== track.lastRecipe);
    if (rotated.length) return rotated[track.index % rotated.length]!;
  }
  return pickFrom[track ? track.index % pickFrom.length : 0]!;
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

export function matchRecipe(
  pieces: Garment[],
  occasion: Occasion,
  house?: House | "all" | null,
): RecipeId | undefined {
  const list = recipesFor(occasion, house);
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
  const any = RECIPES.filter((r) => r.occasions.includes(occasion));
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

import { isFakeName } from "./rack.ts";
import type { Category } from "./types.ts";

/** First naming wait. A miss retries once for twice this long, then asks for a name. */
export const CAMERA_TAG_MS = 12_000;

/** Second attempt after a timeout or an empty tag. Longer than the first. */
export const NAMING_RETRY_MS = CAMERA_TAG_MS * 2;

/**
 * Added to the tag prompt. A jacket is outerwear. The outline guess must not
 * rename a camera shot.
 */
export const CAMERA_TAG_RULES =
  "A jacket, blazer, coat, chore coat, field jacket, bomber, trucker, overshirt, or trench is outerwear, never a top. A hoodie or sweatshirt stays a top. A shirt, polo, tee, or knit is a top. Trousers are a bottom. Shoes are footwear. A pair of shoes is ONE item, count 1. Name the garment in the photo, not the room. One clear jacket is that jacket, outerwear, person false, count 1. If a person is wearing the clothes, set person true and count to the garments you can see. Do not name the person. Do not invent a garment that is not in the photo. If several garments are visible, set count to how many and do not save the frame as one top. If the inside label is readable, set brand to the word printed on it. If it is not readable, brand is empty. Do not invent a brand.";

const OUTER_WORDS = ["jacket", "blazer", "coat", "bomber", "chore", "field", "trucker", "trench", "overshirt"];

const CATEGORIES = new Set<Category>([
  "top",
  "bottom",
  "outerwear",
  "dress",
  "footwear",
  "accessory",
  "other",
]);

export type CameraPatch = {
  name: string;
  category: Category;
  subtype: string;
  colors: string[];
  material: string;
  brand: string;
};

export type CameraTag = {
  ok?: boolean;
  name?: string;
  category?: string;
  subtype?: string;
  colors?: string[];
  material?: string;
  brand?: string;
  count?: number;
  /** A person in the frame is not one top. */
  person?: boolean;
} | null;

export type CameraTagDecision =
  | { action: "keep" }
  | { action: "update"; patch: CameraPatch }
  | { action: "worn"; fallback: CameraPatch | null };

export function textSaysOuter(name: string, subtype: string): boolean {
  const text = `${name} ${subtype}`.toLowerCase();
  return OUTER_WORDS.some((word) => text.includes(word));
}

export function textSaysHoodie(name: string, subtype: string): boolean {
  const text = `${name} ${subtype}`.toLowerCase();
  return text.includes("hoodie") || text.includes("sweatshirt");
}

const FOOTWEAR_WORDS = /\b(shoes?|loafers?|mules?|sneakers?|trainers?|boots?|booties|oxfords? shoes?|derbys?|derbies|brogues?|sandals?|espadrilles?|slippers?)\b/;
const BOTTOM_WORDS = /\b(pants?|chinos?|jeans?|trousers?|shorts?|cords?|corduroys|joggers?|sweatpants?|track pants?|gurkha)\b/;
const DRESS_WORDS = /\b(dress|gown)\b/;
const ACCESSORY_WORDS = /\b(belts?|scarf|scarves|hats?|caps?|beanies?|gloves?|bags?|ties?|socks?|watch|sunglasses|wallet)\b/;
/** Knits, sweats, shirts, tees: every top word the Add flow has seen. */
const TOP_WORDS =
  /\b(knits?|knitwear|sweaters?|cardigans?|crewnecks?|crew ?necks?|turtlenecks?|rollnecks?|jumpers?|pullovers?|merino|cashmere|cable|fleece|half[- ]?zips?|quarter[- ]?zips?|polos?|rugby|rugbys|shirts?|oxfords?|t-shirts?|tees?|henleys?|vests?|tanks?|blouses?|hoodies?|sweatshirts?|tops?)\b/;

/** The model's own category words, when it did not answer from the fixed list. */
const MODEL_CATEGORY: Record<string, Category> = {
  tops: "top",
  shirt: "top",
  shirts: "top",
  knit: "top",
  knits: "top",
  knitwear: "top",
  sweater: "top",
  sweaters: "top",
  sweatshirt: "top",
  hoodie: "top",
  tee: "top",
  polo: "top",
  bottoms: "bottom",
  trousers: "bottom",
  pants: "bottom",
  jeans: "bottom",
  shorts: "bottom",
  shoes: "footwear",
  shoe: "footwear",
  sneakers: "footwear",
  boots: "footwear",
  loafers: "footwear",
  jacket: "outerwear",
  jackets: "outerwear",
  coat: "outerwear",
  coats: "outerwear",
  outer: "outerwear",
  dresses: "dress",
  accessories: "accessory",
};

/**
 * Category from the words alone (name, subtype, a real note). Shoes and bottoms first, so
 * "boot cut jeans" is a bottom; a hoodie is a top even next to a jacket word; then jackets,
 * then every knit / sweat / shirt word. Null when nothing names a slot.
 */
export function wordsCategory(text: string): Category | null {
  const t = text.toLowerCase();
  const bottom = BOTTOM_WORDS.test(t);
  const outer = OUTER_WORDS.some((word) => t.includes(word));
  if (FOOTWEAR_WORDS.test(t) && !bottom && !outer) return "footwear";
  if (bottom && !outer) return "bottom";
  if (/\b(hoodies?|sweatshirts?)\b/.test(t)) return "top";
  if (outer) return "outerwear";
  if (DRESS_WORDS.test(t)) return "dress";
  if (TOP_WORDS.test(t)) return "top";
  if (ACCESSORY_WORDS.test(t)) return "accessory";
  return null;
}

/**
 * Jacket words win over a model that said top. A hoodie stays a top. A model answer outside
 * the list ("knitwear", "trousers") maps to the slot it names; when it answered "other" or
 * nothing, the garment's own words decide (a cream knit is a top, not Other).
 */
export function cameraPieceCategory(name: string, subtype: string, model: string): Category {
  if (textSaysHoodie(name, subtype) && !textSaysOuter(name, subtype)) return "top";
  if (textSaysOuter(name, subtype)) return "outerwear";
  const modelWord = model.trim().toLowerCase();
  const listed = CATEGORIES.has(modelWord as Category) ? (modelWord as Category) : null;
  if (listed && listed !== "other") return listed;
  const mapped = MODEL_CATEGORY[modelWord];
  if (mapped) return mapped;
  return wordsCategory(`${name} ${subtype}`) ?? "other";
}

function legibleBrand(brand: string): string {
  const b = brand.trim().slice(0, 40);
  if (!b || /^(unknown|n\/a|none|null|unbranded)$/i.test(b)) return "";
  if (isFakeName(b)) return "";
  return b;
}

function patchFrom(tag: {
  name: string;
  category?: string;
  subtype?: string;
  colors?: string[];
  material?: string;
  brand?: string;
}): CameraPatch {
  const name = tag.name.trim().slice(0, 48);
  const subtype = (tag.subtype ?? "").trim().slice(0, 40);
  return {
    name,
    subtype,
    category: cameraPieceCategory(name, subtype, tag.category ?? "other"),
    colors: (tag.colors ?? []).filter((c) => typeof c === "string").slice(0, 4),
    material: (tag.material ?? "").trim().slice(0, 32),
    brand: legibleBrand(tag.brand ?? ""),
  };
}

function patchIsFootwear(patch: CameraPatch): boolean {
  if (patch.category === "footwear") return true;
  return wordsCategory(`${patch.name} ${patch.subtype}`) === "footwear";
}

/**
 * After the shrunk tile is already saved as New piece.
 * Timeout, failure, or an empty name keeps that piece.
 * count > 1 is the worn picker, not one top.
 * A pair of shoes is one piece: footwear stays an update even when count is 2.
 */
export function decideCameraTag(tag: CameraTag): CameraTagDecision {
  if (!tag || tag.ok !== true) return { action: "keep" };
  const name = (tag.name ?? "").trim();
  if (!name || isFakeName(name)) return { action: "keep" };
  const patch = patchFrom({ ...tag, name });
  const footwear = patchIsFootwear(patch);
  const count = footwear ? 1 : typeof tag.count === "number" && tag.count > 1 ? tag.count : 1;
  const oneJacket = !footwear && count === 1 && textSaysOuter(patch.name, patch.subtype);
  if (count > 1 || (tag.person === true && !oneJacket && !footwear)) {
    return {
      action: "worn",
      fallback: textSaysOuter(patch.name, patch.subtype) || footwear ? patch : null,
    };
  }
  return { action: "update", patch };
}

export type NamingOutcome =
  | { step: "apply"; patch: CameraPatch }
  | { step: "worn" }
  | { step: "ask" };

/**
 * One read, then one longer retry when the tag times out, is empty, or has no
 * fallback. A worn frame with two or more boxes is the worn picker, not a miss.
 * Two misses ask for a name instead of leaving "New piece".
 */
export async function nameWithRetry(opts: {
  read: (ms: number) => Promise<CameraTagDecision>;
  countWorn?: (decision: Extract<CameraTagDecision, { action: "worn" }>) => Promise<number>;
  firstMs?: number;
  retryMs?: number;
}): Promise<NamingOutcome> {
  const firstMs = opts.firstMs ?? CAMERA_TAG_MS;
  const retryMs = opts.retryMs ?? NAMING_RETRY_MS;
  const once = async (ms: number, attempt: 0 | 1): Promise<NamingOutcome | { step: "retry" }> => {
    const decision = await opts.read(ms);
    switch (decision.action) {
      case "update":
        return { step: "apply", patch: decision.patch };
      case "worn": {
        const boxes = opts.countWorn ? await opts.countWorn(decision) : 0;
        if (boxes >= 2) return { step: "worn" };
        if (decision.fallback) return { step: "apply", patch: decision.fallback };
        break;
      }
      case "keep":
        break;
      default: {
        const neverAction: never = decision;
        return neverAction;
      }
    }
    if (attempt === 0) return { step: "retry" };
    return { step: "ask" };
  };
  const first = await once(firstMs, 0);
  if (first.step !== "retry") return first;
  const second = await once(retryMs, 1);
  if (second.step === "retry") return { step: "ask" };
  return second;
}

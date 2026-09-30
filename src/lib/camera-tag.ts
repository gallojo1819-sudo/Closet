import { isFakeName } from "./rack.ts";
import type { Category } from "./types.ts";

/** Camera naming waits this long, then keeps “New piece”. */
export const CAMERA_TAG_MS = 12_000;

/**
 * Added to the tag prompt. A jacket is outerwear. The outline guess must not
 * rename a camera shot.
 */
export const CAMERA_TAG_RULES =
  "A jacket, blazer, coat, chore coat, field jacket, bomber, trucker, overshirt, or trench is outerwear, never a top. A hoodie or sweatshirt stays a top. A shirt, polo, tee, or knit is a top. Trousers are a bottom. Shoes are footwear. Name the garment in the photo, not the room. One clear jacket is that jacket, outerwear, person false, count 1. If a person is wearing the clothes, set person true and count to the garments you can see. Do not name the person. Do not invent a garment that is not in the photo. If several garments are visible, set count to how many and do not save the frame as one top. If the inside label is readable, set brand to the word printed on it. If it is not readable, brand is empty. Do not invent a brand.";

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

/** Jacket words win over a model that said top. A hoodie stays a top. */
export function cameraPieceCategory(name: string, subtype: string, model: string): Category {
  if (textSaysHoodie(name, subtype) && !textSaysOuter(name, subtype)) return "top";
  if (textSaysOuter(name, subtype)) return "outerwear";
  return CATEGORIES.has(model as Category) ? (model as Category) : "other";
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

/**
 * After the shrunk tile is already saved as New piece.
 * Timeout, failure, or an empty name keeps that piece.
 * count > 1 is the worn picker, not one top.
 */
export function decideCameraTag(tag: CameraTag): CameraTagDecision {
  if (!tag || tag.ok !== true) return { action: "keep" };
  const name = (tag.name ?? "").trim();
  if (!name || isFakeName(name)) return { action: "keep" };
  const patch = patchFrom({ ...tag, name });
  const count = typeof tag.count === "number" && tag.count > 1 ? tag.count : 1;
  const oneJacket = count === 1 && textSaysOuter(patch.name, patch.subtype);
  if (count > 1 || (tag.person === true && !oneJacket)) {
    return {
      action: "worn",
      fallback: textSaysOuter(patch.name, patch.subtype) ? patch : null,
    };
  }
  return { action: "update", patch };
}

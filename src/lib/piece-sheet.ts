import { wordsCategory } from "./camera-tag.ts";
import { notesWantGurkha } from "./describe.ts";
import { NEW_PIECE_NAME } from "./ingest.ts";
import type { Category, Garment } from "./types.ts";

/** A piece still called "New piece", or still filed as other. */
export function isFreshPiece(g: { name: string; category: Category }): boolean {
  return g.name.trim() === NEW_PIECE_NAME || g.category === "other";
}

const SUBTYPE_WORD: Partial<Record<Category, RegExp>> = {
  footwear:
    /\b(loafers|loafer|mules|mule|sneakers|sneaker|trainers|trainer|boots|booties|boot|derbies|derby|brogues|brogue|sandals|sandal|espadrilles|espadrille|slippers|slipper|oxfords|shoes|shoe)\b/i,
  bottom: /\b(gurkha|chinos|chino|jeans|jean|trousers|trouser|shorts|cords|corduroys|joggers|sweatpants)\b/i,
  top: /\b(hoodies|hoodie|sweatshirts|sweatshirt|t-shirts|t-shirt|tees|tee|polos|polo|oxfords|oxford|shirts|shirt|sweaters|sweater|cardigans|cardigan|knits|knit|henleys|henley|rugbys|rugby)\b/i,
  outerwear:
    /\b(overshirts|overshirt|blazers|blazer|jackets|jacket|coats|coat|bombers|bomber|trench|parkas|parka)\b/i,
  dress: /\b(gowns|gown|dresses|dress)\b/i,
  accessory: /\b(sunglasses|belts|belt|caps|cap|beanies|beanie|scarves|scarf|ties|tie|watches|watch)\b/i,
};

/** The garment noun in a short name. Empty when the words do not name one. */
export function subtypeFromName(name: string, category: Category): string {
  const re = SUBTYPE_WORD[category];
  const matched = re ? name.match(re) : null;
  return matched?.[1]?.toLowerCase() ?? "";
}

export type NameOffer = { name: string; category: Category; subtype: string };

/**
 * Style / make text that is really a garment name, on a piece still called "New piece" or other.
 * A construction note (a gurkha line, a sentence) is not a name.
 */
export function nameOfferFromNotes(g: { name: string; category: Category }, notes: string): NameOffer | null {
  if (!isFreshPiece(g)) return null;
  const text = notes.trim().replace(/^["'“”]+|["'“”]+$/g, "");
  if (!text || text.length > 48) return null;
  if (/[.!?]/.test(text)) return null;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 8) return null;
  if (notesWantGurkha(text)) return null;
  const category = wordsCategory(text);
  if (!category || category === "other") return null;
  return { name: text, category, subtype: subtypeFromName(text, category) };
}

/** Blur of Style / make. A fresh piece never matches the cover; that stays on the button. */
export function notesBlurPlan(opts: {
  fresh: boolean;
  canPrint: boolean;
  notes: string;
  unchanged: boolean;
  offer: boolean;
}): "idle" | "match" | "save" {
  if (opts.unchanged && !opts.offer) return "idle";
  if (opts.fresh) return "save";
  if (opts.canPrint && opts.notes.trim()) return "match";
  return "save";
}

/** The category the select writes. The value is the one the user picked. */
export function categoryWrite(category: Category, needsCategory: boolean | undefined): Partial<Garment> {
  if (needsCategory && category !== "other") return { category, needsCategory: false };
  return { category };
}

/** The field shows the store, unless this input is the one being typed in. */
export function shownField(stored: string, draft: string, focused: boolean): string {
  return focused ? draft : stored;
}

/** The first Remove tap asks. The piece is tombstoned only from the confirm. */
export function removeTap(confirmed: boolean): { confirm: boolean; remove: boolean } {
  if (!confirmed) return { confirm: true, remove: false };
  return { confirm: false, remove: true };
}

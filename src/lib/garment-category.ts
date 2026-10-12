import { wordsCategory } from "./camera-tag.ts";
import { styleNotes } from "./garment-notes.ts";
import type { Category } from "./types.ts";

/**
 * The category a piece shows and filters under. A stored "other" that the words name (a cream
 * knit, a cardigan, a crewneck, a pair of loafers) is re-derived at read; stored rows are not
 * rewritten. Any other stored category stands.
 */
export function derivedCategory(g: {
  category: Category;
  name: string;
  subtype?: string;
  notes?: string;
}): Category {
  if (g.category !== "other") return g.category;
  const text = `${g.name} ${g.subtype ?? ""} ${styleNotes(g.notes)}`;
  return wordsCategory(text) ?? "other";
}

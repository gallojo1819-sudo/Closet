import { canonicalize, PALETTE, type PaletteColor } from "./color.ts";

/**
 * Colour words the tagger and the name use that the palette does not spell: mapped to the
 * nearest palette name for the write path and the display. `canonicalize` itself is left as
 * it is (the engine's harmony scores read it, and its outputs are pinned by a snapshot).
 */
const LOOSE: Record<string, PaletteColor> = {
  blue: "navy",
  "dark blue": "navy",
  "deep blue": "navy",
  "midnight": "navy",
  "midnight blue": "navy",
  indigo: "navy",
  "royal blue": "navy",
  "marine": "navy",
  "sky blue": "light blue",
  "pale blue": "light blue",
  "baby blue": "light blue",
  "powder blue": "light blue",
  "ice blue": "light blue",
  "washed blue": "light blue",
  "light grey": "grey",
  "light gray": "grey",
  "heather grey": "grey",
  "heather gray": "grey",
  silver: "grey",
  "dark grey": "charcoal",
  "dark gray": "charcoal",
  "dark brown": "chocolate",
  "light brown": "tan",
  sand: "beige",
  stone: "beige",
  ecru: "cream",
  oatmeal: "cream",
  bone: "ivory",
  "off white": "ivory",
  "army green": "olive",
  "military green": "olive",
  "dark green": "forest",
  "hunter green": "forest",
  "bottle green": "forest",
  oxblood: "burgundy",
  "dark red": "burgundy",
  mustard: "gold",
};

/** Palette name for a colour word, loosely. Null when it names nothing in the palette. */
export function looseColor(raw: string | undefined | null): PaletteColor | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ");
  return canonicalize(s) ?? LOOSE[s] ?? null;
}

/** The colour a name leads with ("Navy trousers", "Light blue oxford"), or null. */
export function nameLeadColor(name: string | undefined | null): PaletteColor | null {
  const words = (name ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const two = words.length >= 2 ? looseColor(`${words[0]} ${words[1]}`) : null;
  if (two && words.length > 2) return two;
  const one = looseColor(words[0]);
  if (one && words.length > 1) return one;
  return null;
}

/** Stored colours with their loose palette names, deduped, order kept. */
export function looseColors(colors: readonly string[] | undefined | null): string[] {
  const out: string[] = [];
  for (const raw of colors ?? []) {
    const name = looseColor(raw) ?? raw.trim().toLowerCase();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * The colours to show and to write for a named piece: the name's leading colour first, then
 * the stored ones. A plate named "Navy trousers" whose pixels were read as light blue shows
 * navy. The stored array is returned as is when the name agrees or names no colour.
 */
export function colorsForName(name: string, colors: readonly string[]): string[] {
  const lead = nameLeadColor(name);
  if (!lead) return [...colors];
  const first = colors[0];
  if (first && looseColor(first) === lead) return [...colors];
  return [lead, ...colors.filter((c) => looseColor(c) !== lead)];
}

/** Display-time colours for a piece: see colorsForName. */
export function shownColors(g: { name: string; colors: readonly string[] }): string[] {
  return colorsForName(g.name, g.colors);
}

/** True when the stored first colour disagrees with the name's lead colour. */
export function colorsDisagree(name: string, colors: readonly string[]): boolean {
  const lead = nameLeadColor(name);
  if (!lead) return false;
  const first = colors[0];
  return Boolean(first) && looseColor(first) !== lead;
}

export { PALETTE };

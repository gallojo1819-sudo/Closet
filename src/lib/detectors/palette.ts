/**
 * Detector colour rows. The nine legacy palettes are the approved color.json
 * rows. The six pending rows stay proposed: COL-4 uses the proposal intersected
 * with the closest approved row. print_plain drops red until Joe approves it.
 */
import type { Garment } from "../types.ts";
import { paletteFamilies, evaluateColorWithPalette, type ColorResult } from "../stylist/colorChip.ts";
import { slottedPieces } from "../stylist/legal.ts";
import library from "./library.json" with { type: "json" };

const LEGACY: Record<string, string> = {
  western_work: "rrl",
  ivy_prep: "polo",
  country_stable: "sweetstable",
  glossy_formal: "purple",
  fine_knit_loafer: "faloni",
  henley_denim: "545",
  linen_soft: "italiansummer",
  flannel_cashmere: "italianwinter",
  clean_city: "ald",
};

const APPROVED_ORDER = [
  "rrl",
  "polo",
  "ald",
  "faloni",
  "545",
  "sweetstable",
  "italiansummer",
  "italianwinter",
  "purple",
];

const FAMILY: Record<string, string> = {
  navy: "blue",
  burgundy: "red",
  wine: "red",
  olive: "green",
  sage: "green",
  ochre: "brown",
  sand: "cream",
  oat: "cream",
  stone: "cream",
  ivory: "cream",
  "washed blue": "blue",
  grey: "grey",
  gray: "grey",
  black: "black",
  cream: "cream",
  red: "red",
  green: "green",
  brown: "brown",
  blue: "blue",
  pink: "pink",
  yellow: "yellow",
};

const PENDING: Record<string, string[]> = {
  shrunken_suit: ["grey", "navy", "cream"],
  boxy_tonal: ["black", "grey", "stone"],
  print_plain: ["olive", "burgundy", "ochre", "cream"],
  graphic_street: ["black", "cream", "red", "grey"],
  worn_paris: ["black", "sand", "washed blue", "grey"],
  soft_outdoor: ["oat", "green", "brown", "grey"],
};

function familiesOf(words: string[], dropRed: boolean): Set<string> {
  const out = new Set<string>();
  for (const word of words) {
    const fam = FAMILY[word.toLowerCase()] ?? word.toLowerCase();
    if (dropRed && fam === "red") continue;
    out.add(fam);
  }
  return out;
}

function closest(proposed: Set<string>): Set<string> {
  let best = new Set<string>();
  let bestN = -1;
  for (const key of APPROVED_ORDER) {
    const row = paletteFamilies(key);
    const overlap = new Set([...proposed].filter((fam) => row.has(fam)));
    if (overlap.size > bestN) {
      bestN = overlap.size;
      best = overlap;
    }
  }
  return best;
}

function keyOf(id: string): string {
  if (LEGACY[id] || PENDING[id]) return id;
  const row = (library.cells as { id: string; key: string }[]).find((cell) => cell.id === id || cell.key === id);
  return row?.key ?? id;
}

export function detectorPalette(id: string): Set<string> {
  const key = keyOf(id);
  const legacy = LEGACY[key];
  if (legacy) return paletteFamilies(legacy);
  const words = PENDING[key];
  if (!words) return new Set();
  return closest(familiesOf(words, key === "print_plain"));
}

export function detectorColor(pieces: Garment[], color: string, id: string): ColorResult {
  const key = keyOf(id);
  const row = (library.cells as { key: string; title: string }[]).find((cell) => cell.key === key);
  return evaluateColorWithPalette(slottedPieces(pieces), color, detectorPalette(key), row?.title ?? key);
}

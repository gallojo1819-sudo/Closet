/**
 * The label a piece shows. Display only: nothing here writes garment.name.
 *
 * The name shown (displayName) is the stored name, its colour and pattern words with it, unless
 * the stored name is one the app cannot trust: a placeholder ("New piece", a bare category
 * word, an "other"), a filename or shop text (isFakeName), or the old renamer's default
 * "Cream knit" on a piece with no cream tagged (nameFromPixels once defaulted its lead colour
 * to Cream and its kind to knit, and that write reached stored names). Such a name is set aside
 * and the label is built from the fields the record holds: the first tagged colour, the pattern
 * word in the subtype or notes, the material, then the subtype (else the category's word).
 * With no colour, pattern or material the piece is "Unnamed <kind>", flagged by isFakeName.
 *
 * When other pieces in the pool show the same name, each gets a suffix unique within that
 * same-name group, a real word before anything else: a colour the name does not say, the
 * material, the subtype, the fit, the pattern word. Members still sharing the plain name are
 * told apart by the tagged formality or warmth, then the day the piece was added, and only
 * when every field is the same by "· 2", "· 3" in a stable order (createdAt, then id). Maker
 * text is never a label (no house names in Closet).
 */
import { isFakeName, patternWord } from "./rack.ts";
import type { Garment } from "./types.ts";

type Named = Pick<Garment, "id" | "name" | "colors" | "material" | "subtype" | "fit" | "createdAt"> &
  Partial<Pick<Garment, "category" | "notes" | "formality" | "warmth">>;

const CATEGORY_WORD: Record<string, string> = {
  top: "top",
  bottom: "trousers",
  outerwear: "jacket",
  footwear: "shoes",
  dress: "dress",
  accessory: "accessory",
  other: "piece",
};

/** A stored name that says nothing about the piece: a kind word alone, or the app's placeholders. */
const BARE_WORD =
  /^(?:top|tops|bottom|bottoms|outerwear|footwear|dress|accessory|accessories|other|shoes?|trousers|pants|jacket|shirt|knit|sweater|piece|item|garment|new piece|untitled|unnamed)$/i;

/** The old renamer's defaults: lead colour "Cream", kind "knit" (nameFromPixels before Oct 14 2026). */
const OLD_DEFAULT = /^cream knit$/i;

function norm(s: string | undefined | null): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * True when the stored name cannot be shown as the piece's name: a placeholder, a bare kind
 * word, a filename, shop text, or the old renamer's "Cream knit" on a piece with no cream
 * tagged. A real name that happens to read "Cream knit" with cream among its colours stands.
 */
export function isUntrustedName(g: Pick<Named, "name" | "colors">): boolean {
  const name = norm(g.name);
  if (!name) return true;
  if (BARE_WORD.test(name)) return true;
  if (isFakeName(name)) return true;
  if (OLD_DEFAULT.test(name) && !(g.colors ?? []).some((c) => norm(c) === "cream")) return true;
  return false;
}

function kindOf(g: Named): string {
  const sub = norm(g.subtype);
  if (sub && !isFakeName(sub) && !/\bpiece\b/.test(sub) && !BARE_WORD.test(sub)) return sub;
  if (sub && BARE_WORD.test(sub) && !/^(?:other|piece|item|garment|new piece|untitled|unnamed)$/.test(sub)) return sub;
  return CATEGORY_WORD[g.category ?? ""] ?? "piece";
}

/** A name from the record's fields alone: colour, pattern, material, kind; "Unnamed <kind>" with none. */
export function nameFromFields(g: Named): string {
  const kind = kindOf(g);
  const colour = norm((g.colors ?? []).find((c) => norm(c)));
  const pattern = patternWord(`${g.subtype ?? ""} ${g.notes ?? ""}`) ?? "";
  const material = norm(g.material);
  const words: string[] = [];
  if (colour) words.push(colour);
  if (pattern && !kind.includes(pattern)) words.push(pattern);
  if (material && !kind.includes(material) && material !== colour) words.push(material);
  if (!words.length) return `Unnamed ${kind}`;
  words.push(kind);
  const joined = words.join(" ");
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/** The name a piece shows: the stored name when it can be trusted, else one from its fields. */
export function displayName(g: Named): string {
  return isUntrustedName(g) ? nameFromFields(g) : g.name.trim();
}

function nameKey(g: Named): string {
  return norm(displayName(g));
}

/** Suffix candidates from the fields a reader can see on the piece, lowercased, none already said by the name. */
function primary(g: Named): string[] {
  const name = nameKey(g);
  const raw = [...(g.colors ?? []), g.material, g.subtype, g.fit, patternWord(`${g.subtype ?? ""} ${g.notes ?? ""}`)];
  const out: string[] = [];
  for (const token of raw) {
    const low = norm(token);
    if (!low || low === name || name.includes(low) || out.includes(low)) continue;
    out.push(low);
  }
  return out;
}

const FORMALITY_WORD: Record<number, string> = { 1: "lounge", 2: "casual", 3: "smart", 4: "dressy", 5: "formal" };
const WARMTH_WORD: Record<number, string> = { 1: "sheer", 2: "light", 3: "midweight", 4: "warm", 5: "heavy" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The day the piece was added, as "added Oct 10"; nothing for a date that does not parse. */
function addedWord(g: Named): string | null {
  const d = new Date(g.createdAt);
  if (!g.createdAt || Number.isNaN(d.getTime())) return null;
  return `added ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** The tagged attributes a reader cannot see on the piece, used only to tell same-name pieces apart. */
function secondary(g: Named): string[] {
  const out: string[] = [];
  const formality = typeof g.formality === "number" ? FORMALITY_WORD[g.formality] : undefined;
  const warmth = typeof g.warmth === "number" ? WARMTH_WORD[g.warmth] : undefined;
  if (formality) out.push(formality);
  if (warmth) out.push(warmth);
  const added = addedWord(g);
  if (added) out.push(added);
  return out;
}

function sameNameGroup(g: Named, pool: readonly Named[]): Named[] {
  const key = nameKey(g);
  const group = pool.filter((other) => nameKey(other) === key);
  if (!group.some((other) => other.id === g.id)) group.push(g);
  return group.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** The first token of `mine` held by exactly one member of `among`. */
function uniqueIn(mine: readonly string[], among: readonly Named[], tokensOf: (g: Named) => string[]): string | null {
  const holders = new Map<string, number>();
  for (const member of among) for (const token of new Set(tokensOf(member))) holders.set(token, (holders.get(token) ?? 0) + 1);
  return mine.find((token) => holders.get(token) === 1) ?? null;
}

/**
 * The suffix for `g` within its same-name group, or null for the plain name. A primary token
 * held by exactly one member is that member's. Members with none are told apart by a secondary
 * token unique among them; of those still alike, the first keeps the plain name and the rest
 * take their ordinal.
 */
function suffixFor(g: Named, group: readonly Named[]): string | null {
  if (group.length < 2) return null;
  const own = uniqueIn(primary(g), group, primary);
  if (own) return own;
  const plain = group.filter((member) => !uniqueIn(primary(member), group, primary));
  if (plain.length < 2) return null;
  const second = uniqueIn(secondary(g), plain, secondary);
  if (second) return second;
  const alike = plain.filter((member) => !uniqueIn(secondary(member), plain, secondary));
  const at = alike.findIndex((member) => member.id === g.id);
  return at <= 0 ? null : String(at + 1);
}

/** The label: the shown name, with a group-unique suffix when the pool shows the same name. */
export function pieceLabel(g: Named, pool: readonly Named[]): string {
  const suffix = suffixFor(g, sameNameGroup(g, pool));
  const name = displayName(g);
  return suffix ? `${name} · ${suffix}` : name;
}

/** True when the label falls back to an ordinal: every field the label layer reads is the same. */
export function labelIsOrdinal(g: Named, pool: readonly Named[]): boolean {
  return /^\d+$/.test(suffixFor(g, sameNameGroup(g, pool)) ?? "");
}

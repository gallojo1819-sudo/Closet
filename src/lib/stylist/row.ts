/**
 * Row rules XC-REP-1..4, XC-REC-1, and the cross-chip checks.
 * Caps and recipe tokens are read from the stylist JSON and _cross_chip.json.
 */
import { CROSS } from "../house-profiles/load.ts";
import { hasText } from "../house-profiles/evaluate.ts";
import rules from "./data/2026-09-30-proposed-stylist-rules.json" with { type: "json" };

export type SlotLook = { top?: string; bottom?: string; shoe?: string; outer?: string; recipeId?: string };

type RowRule = {
  id: string;
  logic?: {
    max_chips_per_top_or_bottom_plate?: number;
    max_chips_per_shoe_plate?: number;
    exempt_plates?: string[];
    top_max?: number;
    bottom_max?: number;
    shoe_max?: number;
    recipe_token_to_outer_keywords?: Record<string, string[]>;
  };
};

const ROW = Object.fromEntries((rules.row_level_rules as RowRule[]).map((r) => [r.id, r])) as Record<string, RowRule>;

export const DOMINANT = new Set(Object.keys((CROSS.dominance_global as { plates: Record<string, unknown> }).plates));

export function repCaps() {
  const a = ROW["XC-REP-1"]?.logic ?? {};
  const b = ROW["XC-REP-3"]?.logic ?? {};
  return {
    chipTopBottom: a.max_chips_per_top_or_bottom_plate ?? 2,
    chipShoe: a.max_chips_per_shoe_plate ?? 3,
    exempt: new Set(a.exempt_plates ?? b.exempt_plates ?? []),
    topMax: b.top_max ?? 2,
    bottomMax: b.bottom_max ?? 2,
    shoeMax: b.shoe_max ?? 3,
  };
}

export function coreKey(l: SlotLook): string {
  return `${l.top ?? ""}|${l.bottom ?? ""}|${l.shoe ?? ""}`;
}

export function topBottomKey(l: SlotLook): string {
  return `${l.top ?? ""}|${l.bottom ?? ""}`;
}

/** CROSS-1: identical cores across chips. */
export function cross1Fails(rows: SlotLook[][]): boolean {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const look of row) {
      const k = coreKey(look);
      if (!k.replace(/\|/g, "")) continue;
      if (seen.has(k)) return true;
      seen.add(k);
    }
  }
  return false;
}

/** CROSS-3: a house row must not equal the ALL row. */
export function cross3Fails(house: SlotLook[], all: SlotLook[]): boolean {
  if (!house.length || house.length !== all.length) return false;
  return house.every((l, i) => coreKey(l) === coreKey(all[i]!));
}

/** XC-REP-1: too many chips share one plate. */
export function rep1Fails(plate: string, chipCount: number, slot: "top" | "bottom" | "shoe"): boolean {
  const caps = repCaps();
  if (caps.exempt.has(plate)) return false;
  const max = slot === "shoe" ? caps.chipShoe : caps.chipTopBottom;
  return chipCount > max;
}

/** XC-REP-2: shared top and bottom. */
export function rep2Fails(a: SlotLook, b: SlotLook): boolean {
  return Boolean(a.top && a.bottom && a.top === b.top && a.bottom === b.bottom);
}

/** XC-REP-3 inside one row. */
export function rep3Fails(looks: SlotLook[]): string[] {
  const caps = repCaps();
  const count = (slot: "top" | "bottom" | "shoe", max: number) => {
    const n = new Map<string, number>();
    const bad: string[] = [];
    for (const l of looks) {
      const id = l[slot];
      if (!id || caps.exempt.has(id)) continue;
      n.set(id, (n.get(id) ?? 0) + 1);
    }
    for (const [id, c] of n) if (c > max) bad.push(id);
    return bad;
  };
  return [
    ...count("top", caps.topMax),
    ...count("bottom", caps.bottomMax),
    ...count("shoe", caps.shoeMax),
  ];
}

/** XC-REP-4: two season rows for the same house must differ. */
export function rep4Same(a: SlotLook[], b: SlotLook[]): boolean {
  if (!a.length || a.length !== b.length) return false;
  const ka = a.map(coreKey).join("||");
  const kb = b.map(coreKey).join("||");
  return ka === kb;
}

const TOKENS = () => ROW["XC-REC-1"]?.logic?.recipe_token_to_outer_keywords ?? {};

export function promisedTokens(recipeId: string | undefined): string[] {
  if (!recipeId) return [];
  const parts = new Set(recipeId.split("_"));
  return Object.keys(TOKENS()).filter((t) => parts.has(t));
}

/** hard = recipe promises an outer and the card has none. relabel = a different outer is on the card. */
export function recipeOuterIssue(
  recipeId: string | undefined,
  outerName: string | undefined,
): "hard" | "relabel" | null {
  const tokens = promisedTokens(recipeId);
  if (!tokens.length) return null;
  const map = TOKENS();
  if (!outerName) return "hard";
  const ok = tokens.some((t) => hasText(outerName.toLowerCase(), map[t] ?? []));
  return ok ? null : "relabel";
}

export function mustDifferPairs(): { a: string; b: string; slot_rule: string }[] {
  return (CROSS.must_differ_pairs as { a: string; b: string; slot_rule: string }[]) ?? [];
}

export function violatesMustDiffer(aHouse: string, bHouse: string, a: SlotLook, b: SlotLook): boolean {
  const pair = mustDifferPairs().find(
    (p) => (p.a === aHouse && p.b === bHouse) || (p.a === bHouse && p.b === aHouse),
  );
  if (!pair) return false;
  const text = pair.slot_rule;
  if (/\bshoe:/.test(text) && a.shoe && a.shoe === b.shoe) return true;
  if (/\btop:/.test(text) && /\bbottom:/.test(text) && (a.top === b.top || a.bottom === b.bottom)) return true;
  return false;
}

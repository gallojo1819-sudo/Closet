import library from "./library.json" with { type: "json" };

type OuterScore = { kinds?: string[]; occasions?: string[]; colors?: string; delta: number };
type Climate = { above_f?: number; below_f?: number; occasions?: string[]; delta: number };
type ClothRule = { kind: string; id?: string; severity?: "hard" | "soft"; delta?: number; text?: string };
type JacketDefault = { id: string; seasons?: string[] };

type Spec = {
  code: string;
  profile_key: string;
  fw_code: string;
  weekday_prep?: boolean;
  prep_recipe?: string;
  button_down_quota?: boolean;
  recipe_lock?: string;
  skip_shirt_trouser_bonus?: boolean;
  outer_required?: boolean;
  outer_off_above_f?: number;
  drop_mid_above_f?: number;
  /** Regular zip knit with no fleece may sit under a sport coat. */
  zip_knit_exempt?: boolean;
  outer_score?: OuterScore[];
  climate?: Climate[];
  jacket_defaults?: JacketDefault[];
  rules?: ClothRule[];
};

const table = library.behavior as unknown as Record<string, Spec | string[]>;

function specs(): Spec[] {
  return Object.entries(table)
    .filter(([key]) => key !== "superseded_hits")
    .map(([, value]) => value as Spec);
}

function lookup(key: string): Spec | null {
  const direct = table[key];
  if (direct && !Array.isArray(direct)) return direct;
  const row = library.detectors.find((d) => d.id === key || d.legacy_id === key);
  if (row?.legacy_id) {
    const via = table[row.legacy_id];
    if (via && !Array.isArray(via)) return via;
  }
  return specs().find((spec) => spec.code === key || spec.profile_key === key) ?? null;
}

export function specFor(id?: string | null): Spec | null {
  if (!id) return null;
  const key = id.trim();
  if (!key || key === "all") return null;
  return lookup(key) ?? (key === key.toLowerCase() ? null : lookup(key.toLowerCase()));
}

export function recipeLocksToOwn(house?: string | null): boolean {
  return specFor(house)?.recipe_lock === "own";
}

export function usesWeekdayPrep(house?: string | null): boolean {
  if (!house || house === "all") return true;
  return Boolean(specFor(house)?.weekday_prep);
}

export function prepRecipeId(): string {
  return specFor("polo")?.prep_recipe ?? "WD_PREP_OCBD";
}

export function wantsButtonDownQuota(house?: string | null): boolean {
  if (!house || house === "all") return true;
  return Boolean(specFor(house)?.button_down_quota);
}

export function skipsShirtTrouserBonus(house?: string | null): boolean {
  return Boolean(specFor(house)?.skip_shirt_trouser_bonus);
}

/** False means the jacket stays off. True means it is required. Null defers. */
export function outerForce(house: string | null | undefined, f: number): boolean | null {
  const spec = specFor(house);
  if (!spec) return null;
  if (spec.outer_off_above_f != null && f > spec.outer_off_above_f) return false;
  if (spec.outer_required) return true;
  return null;
}

export function dropsMidlayerInHeat(house: string | null | undefined, f: number): boolean {
  const cap = specFor(house)?.drop_mid_above_f;
  return cap != null && f > cap;
}

export function outerScoreDelta(house: string | null | undefined, kind: string, blob: string, occasion: string): number {
  const rules = specFor(house)?.outer_score ?? [];
  let score = 0;
  for (const rule of rules) {
    if (rule.kinds && !rule.kinds.includes(kind)) continue;
    if (rule.occasions && !rule.occasions.includes(occasion)) continue;
    if (rule.colors && !new RegExp(rule.colors).test(blob)) continue;
    score += rule.delta;
  }
  return score;
}

export function climateDelta(houseIds: readonly string[], f: number, occasion: string): number {
  // One shared line counts once. The weekend bonus is the same line on two houses.
  const seen = new Set<string>();
  let score = 0;
  for (const id of houseIds) {
    for (const rule of specFor(id)?.climate ?? []) {
      if (rule.above_f != null && !(f > rule.above_f)) continue;
      if (rule.below_f != null && !(f < rule.below_f)) continue;
      if (rule.occasions && !rule.occasions.includes(occasion)) continue;
      const key = `${rule.above_f ?? ""}|${rule.below_f ?? ""}|${(rule.occasions ?? []).join(",")}|${rule.delta}`;
      if (seen.has(key)) continue;
      seen.add(key);
      score += rule.delta;
    }
  }
  return score;
}

export function zipKnitExempt(house?: string | null): boolean {
  return Boolean(specFor(house)?.zip_knit_exempt);
}

export function codeOf(house?: string | null): string {
  const spec = specFor(house);
  if (spec) return spec.code;
  return (house ?? "").trim().toLowerCase();
}

export function profileKey(house?: string | null): string | null {
  return specFor(house)?.profile_key ?? null;
}

export function fwCodes(): string[] {
  return specs().map((spec) => spec.fw_code);
}

export function jacketDefaults(): Record<string, JacketDefault[]> {
  const out: Record<string, JacketDefault[]> = {};
  for (const spec of specs()) {
    if (spec.jacket_defaults?.length) out[spec.code] = spec.jacket_defaults;
  }
  return out;
}

export function ruleKinds(house?: string | null): ClothRule[] {
  return specFor(house)?.rules ?? [];
}

export function supersededHit(id: string): boolean {
  const list = table.superseded_hits;
  return Array.isArray(list) && list.includes(id);
}

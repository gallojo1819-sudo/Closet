/**
 * color.json COL-1..COL-6. Canonical names come from color-value-map.json
 * and the alias map stored on color.json. A shoe is never the only carrier.
 */
import { COLOR_PROFILE, HOUSE_BY_CODE } from "../house-profiles/load.ts";
import type { Plate } from "../house-profiles/evaluate.ts";
import cmap from "./data/color-value-map.json" with { type: "json" };

type Rule = { id: string; rule: string; severity?: string; delta?: number; empty_state_copy?: string };

const RULES = COLOR_PROFILE.proposed_rules as Rule[];
const PALETTE = COLOR_PROFILE.house_palette_matrix as Record<string, string[]>;

const COL3 = RULES.find((r) => r.id === "COL-3")?.rule ?? "";
const ACCENTS = new Set(
  (COL3.match(/\(([^)]+)\)/)?.[1] ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);
const NEUTRAL_RAW = (COL3.match(/neutral \(([^)]+)\)/)?.[1] ?? "")
  .split(",")
  .flatMap((s) => s.split("/"))
  .map((s) => s.trim().toLowerCase())
  .filter((s) => s && s !== "denim blue");

export type ColorResult = {
  passed: boolean;
  hardFails: string[];
  soft: [string, number][];
  note: string | null;
};

function ruleText(id: string): string {
  return RULES.find((r) => r.id === id)?.rule ?? "";
}

function aliasMap(): Record<string, string[]> {
  const fromRule = (RULES.find((r) => r.id === "COL-1") as { map?: Record<string, string[]> } | undefined)?.map;
  return fromRule ?? {};
}

export function canonTokens(raw: string): string[] {
  const r = raw.toLowerCase().trim();
  const mapped = aliasMap()[r];
  if (mapped) return mapped;
  const aliases = (cmap.raw_aliases as Record<string, string[]>)[r];
  return aliases ?? [r];
}

function familyOf(token: string): string | null {
  const info = (cmap.colors as Record<string, { family?: string }>)[token];
  return info?.family ?? null;
}

function paletteKey(house: string): string {
  if (PALETTE[house]) return house;
  const short = Object.entries(HOUSE_BY_CODE).find(([, code]) => code === house)?.[0];
  return short ?? house.toLowerCase();
}

function paletteFamilies(house: string): Set<string> {
  const row = PALETTE[paletteKey(house)] ?? [];
  return new Set(row.map((s) => s.split("(")[0]!.trim().toLowerCase()));
}

function leadPieces(ps: Partial<Record<string, Plate>>): Plate[] {
  return [ps.top, ps.outer, ps.bottom].filter((g): g is Plate => Boolean(g));
}

function carries(g: Plate | undefined, want: string): boolean {
  if (!g?.colors?.length) return false;
  const tokens = canonTokens(g.colors[0] ?? "");
  return tokens.includes(want) || tokens.some((t) => familyOf(t) === want);
}

function textureKind(g: Plate): string {
  const blob = `${g.name ?? ""} ${g.subtype ?? ""} ${g.material ?? ""}`.toLowerCase();
  if (/knit|sweater|cable|merino|wool/.test(blob)) return "knit";
  if (/suede/.test(blob)) return "suede";
  if (/cord/.test(blob)) return "cord";
  if (/denim|jean/.test(blob)) return "denim";
  if (/linen/.test(blob)) return "linen";
  return (g.material ?? "other").toLowerCase();
}

function neutralPiece(g: Plate): boolean {
  if ((g.material ?? "").toLowerCase() === "denim" || /jean|denim/.test(`${g.name} ${g.subtype}`)) return true;
  const tokens = canonTokens(g.colors?.[0] ?? "");
  return tokens.some((t) => NEUTRAL_RAW.includes(t) || NEUTRAL_RAW.includes(familyOf(t) ?? ""));
}

export function colorEmptyCopy(houseLabel: string, color: string, houseKey: string): string {
  const tmpl =
    (RULES.find((r) => r.id === "COL-4") as { empty_state_copy?: string } | undefined)?.empty_state_copy ??
    "No {House} look in {color}.";
  const palette = (PALETTE[paletteKey(houseKey)] ?? []).join(", ");
  return tmpl
    .replaceAll("{House}", houseLabel)
    .replaceAll("{color}", color)
    .replaceAll("{palette}", palette)
    .replaceAll("{closest family}", palette.split(",")[0]?.trim() || "a house colour");
}

export function evaluateColor(
  ps: Partial<Record<string, Plate>>,
  color: string,
  house?: string | null,
): ColorResult {
  const want = canonTokens(color)[0] || color.toLowerCase().trim();
  const hard: string[] = [];
  const soft: [string, number][] = [];
  const leads = leadPieces(ps);
  const leadHit = leads.some((g) => carries(g, want));
  const shoeHit = carries(ps.shoe, want);
  if (!leadHit) hard.push("COL-2");
  if (!leadHit && shoeHit) hard.push("COL-6");
  const accent = ACCENTS.has(want) || ACCENTS.has(familyOf(want) ?? "");
  if (accent) {
    const others = Object.values(ps).filter((g): g is Plate => Boolean(g) && !carries(g, want));
    if (others.some((g) => !neutralPiece(g))) hard.push("COL-3");
  }
  let note: string | null = null;
  if (house) {
    const fam = familyOf(want) ?? want;
    const allowed = paletteFamilies(house);
    if (!allowed.has(fam) && !allowed.has(want)) {
      hard.push("COL-4");
      note = colorEmptyCopy(house, color, house);
    }
  }
  const fam = familyOf(want) ?? want;
  const core = [ps.top, ps.bottom, ps.shoe].filter((g): g is Plate => Boolean(g));
  const same = core.filter((g) => (familyOf(canonTokens(g.colors?.[0] ?? "")[0] ?? "") ?? "") === fam);
  if (same.length >= 2) {
    const kinds = new Set(same.map(textureKind));
    if (kinds.size < 2) soft.push(["COL-5", Number((RULES.find((r) => r.id === "COL-5") as { delta?: number })?.delta ?? -10)]);
  }
  void ruleText;
  return { passed: hard.length === 0, hardFails: [...new Set(hard)].sort(), soft, note };
}

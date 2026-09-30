/**
 * Audit the five Lookbook contexts on the 2026-09-30 plate fixture.
 * Prints card counts and hard-fail counts. Writes in_<occ>_<season>.json
 * for an external house check.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HOUSES } from "../src/lib/houses.ts";
import { buildReshuffleRow } from "../src/lib/lookbook.ts";
import type { Garment, Look, Occasion, Season } from "../src/lib/types.ts";
import { explain } from "../src/lib/stylist/legal.ts";
import platesFile from "../src/lib/stylist/__tests__/fixtures/plates-2026-09-30.json" with { type: "json" };

const DELETED = new Set(["g_37e5eqjwgd3d", "g_c6qdv5c3gkor", "g_x0ro1mg2gu0a"]);
const CONTEXTS: [Occasion, Season][] = [
  ["weekday", "fall"],
  ["out", "fall"],
  ["weekend", "fall"],
  ["weekday", "winter"],
  ["weekend", "summer"],
];

type Raw = {
  id: string;
  name?: string | null;
  category?: string;
  subtype?: string;
  material?: string;
  colors?: string[];
  brand?: string;
  fit?: string | null;
  warmth?: number;
  archived?: boolean;
  tombstone?: boolean;
};

function garment(p: Raw): Garment {
  const warmth = Math.min(5, Math.max(1, p.warmth ?? 3)) as Garment["warmth"];
  const fit = p.fit === "slim" || p.fit === "relaxed" || p.fit === "regular" ? p.fit : "regular";
  return {
    id: p.id,
    name: p.name ?? "",
    category: (p.category ?? "top") as Garment["category"],
    subtype: p.subtype ?? "",
    colors: p.colors ?? [],
    material: p.material ?? "",
    brand: p.brand ?? "",
    notes: "",
    formality: 3,
    warmth,
    seasons: [],
    imageSrc: "",
    cutoutSrc: "",
    imageSource: "photo",
    matteQuality: "ok",
    demo: false,
    wornOn: [],
    fit,
    archived: Boolean(p.archived || p.tombstone),
    createdAt: "2026-09-30T00:00:00.000Z",
  };
}

const RACK = (platesFile.plates as Raw[])
  .filter((p) => p.id && !p.tombstone && !p.archived && !DELETED.has(p.id))
  .map(garment);
const BY = new Map(RACK.map((g) => [g.id, g]));

function named(id: string | undefined) {
  if (!id) return undefined;
  const g = BY.get(id);
  return { id, name: g?.name ?? id };
}

function slotId(look: Look, category: string): string | undefined {
  return look.garmentIds.find((id) => BY.get(id)?.category === category);
}

const ruleCounts = new Map<string, number>();
let outfits = 0;
let gates = 0;
const lines: string[] = [];
const outDir = join(dirname(fileURLToPath(import.meta.url)), "house-check-out");
mkdirSync(outDir, { recursive: true });

for (const [occ, season] of CONTEXTS) {
  const chips: Record<string, unknown> = {};
  let contextOutfits = 0;
  let contextGates = 0;
  const bump = (id: string) => ruleCounts.set(id, (ruleCounts.get(id) ?? 0) + 1);

  const take = (label: string, row: Look[], house?: string) => {
    const gate = row.find((l) => l.gate);
    const cards = row.filter((l) => l.garmentIds.length >= 3 && !l.gate && !l.needsPieces).slice(0, 3);
    if (gate && house) {
      contextGates += 1;
      chips[label] = { status: "gate", gate: gate.gate, looks: [] };
      return;
    }
    const looks = cards.map((look) => {
      const pieces = look.garmentIds.map((id) => BY.get(id)).filter((g): g is Garment => Boolean(g));
      const why = explain(pieces, { house: house as never, occasion: occ, season, color: label === "color" ? "brown" : null });
      const hard = why.hits.filter((h) => h.severity === "hard").map((h) => h.id);
      const houseHard = why.house && !why.house.passed ? why.house.hardFails : [];
      for (const id of [...hard, ...houseHard]) bump(id);
      for (const id of look.garmentIds) if (DELETED.has(id)) bump("DELETED");
      const top = named(slotId(look, "top") ?? slotId(look, "dress"));
      const bottom = named(slotId(look, "bottom"));
      const shoe = named(slotId(look, "footwear"));
      const outer = named(slotId(look, "outerwear"));
      return {
        top,
        bottom,
        shoe,
        ...(outer ? { outer } : {}),
        recipeId: look.recipeId ?? null,
        hardFails: [...new Set([...hard, ...houseHard])],
      };
    });
    contextOutfits += looks.length;
    chips[label] = { status: looks.length >= 3 ? "ok" : "short", looks };
  };

  for (const house of HOUSES) {
    take(house, buildReshuffleRow(RACK, occ, { house, season, cap: 8 }), house);
  }
  take("all", buildReshuffleRow(RACK, occ, { season, cap: 8 }));
  take("color", buildReshuffleRow(RACK, occ, { season, color: "brown", cap: 8 }));
  outfits += contextOutfits;
  gates += contextGates;
  lines.push(`${occ}/${season} houseCards=${contextOutfits} gates=${contextGates}`);
  writeFileSync(
    join(outDir, `in_${occ}_${season}.json`),
    JSON.stringify({ occasion: occ, season, chips }, null, 2),
  );
}

lines.push(`total houseCards=${outfits} gates=${gates}`);
const rules = [...ruleCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
if (!rules.length) lines.push("hard-fails: 0");
for (const [id, n] of rules) lines.push(`${id} ${n}`);
console.log(lines.join("\n"));

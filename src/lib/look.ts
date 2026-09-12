import type { Garment, Moment, Occasion, WeatherSnap } from "./types.ts";
import { colorLine } from "./color.ts";
import {
  HOUSE_LABEL,
  daysIdle,
  isCampCollar,
  isFairIsle,
  isHoodiePiece,
  lookHouses,
  slotOf,
} from "./style.ts";

const ORDER: Garment["category"][] = [
  "top",
  "dress",
  "bottom",
  "outerwear",
  "footwear",
  "accessory",
  "other",
];

export function costPerWear(g: Garment): number | null {
  if (g.paid == null || !(g.paid > 0)) return null;
  return g.paid / Math.max(g.wornOn.length, 1);
}

export function money(n: number): string {
  const v = Math.round(n * 100) / 100;
  return `$${Number.isInteger(v) ? v.toLocaleString("en-US") : v.toFixed(2)}`;
}

export function sortLook(pieces: Garment[]): Garment[] {
  return [...pieces].sort((a, b) => {
    const sa = ORDER.indexOf((slotOf(a) ?? a.category) as Garment["category"]);
    const sb = ORDER.indexOf((slotOf(b) ?? b.category) as Garment["category"]);
    return (sa < 0 ? 99 : sa) - (sb < 0 ? 99 : sb);
  });
}

function blobOf(g: Garment): string {
  return `${g.subtype} ${g.name}`.toLowerCase();
}

function isTrueOuter(g: Garment): boolean {
  const b = blobOf(g);
  if (isHoodiePiece(g)) return false;
  return /\b(coats?|bombers?|jackets?|blazers?|parkas?|trench|shearlings?|overshirts?)\b/.test(b);
}

function isLayerTop(g: Garment): boolean {
  const s = slotOf(g);
  if (s === "top" || s === "dress") return true;
  if (isHoodiePiece(g)) return true;
  return false;
}

/** Camp collar / oxford / knit beats hoodie. One top only. */
function pickTop(tops: Garment[]): Garment | undefined {
  if (!tops.length) return undefined;
  const camp = tops.find(isCampCollar);
  if (camp) return camp;
  const shirt = tops.find((g) => /oxford|polo|linen/.test(blobOf(g)) && !isHoodiePiece(g));
  if (shirt) return shirt;
  const knit = tops.find(
    (g) =>
      (isFairIsle(g) || /knit|\bsweaters?\b|merino|cable|crewneck/.test(blobOf(g))) &&
      !isHoodiePiece(g),
  );
  if (knit) return knit;
  return tops.find((g) => !isHoodiePiece(g)) ?? tops[0];
}

/**
 * Cutouts for Imagine: at most one top, one bottom, one footwear,
 * one true outer. Hoodie is not a coat. Extra hoodies stay on paper.
 */
export function layersForOnMe(pieces: Garment[]): Garment[] {
  const sorted = sortLook(pieces);
  const bottoms = sorted.filter((g) => slotOf(g) === "bottom");
  const feet = sorted.filter((g) => slotOf(g) === "footwear");
  const tops = sorted.filter(isLayerTop);
  const outers = sorted.filter(isTrueOuter);

  const top = pickTop(tops);
  const bottom = bottoms[0];
  const shoe = feet[0];
  const outer = outers.find((g) => g.id !== top?.id);

  return [top, bottom, shoe, outer].filter((g): g is Garment => Boolean(g)).slice(0, 4);
}

export function nameLook(pieces: Garment[]): string {
  const sorted = sortLook(pieces);
  if (sorted.length === 0) return "Nothing on the rack";
  if (sorted.length === 1) return sorted[0]!.name;
  return `${sorted[0]!.name} · ${sorted[1]!.name}`;
}

export function dropNote(
  pieces: Garment[],
  weather?: WeatherSnap,
  occasion?: Occasion,
  moment?: Moment,
): string {
  void weather;
  void occasion;
  void moment;
  const house = lookHouses(pieces)[0];
  const label = house ? HOUSE_LABEL[house] : "";
  return colorLine(pieces, label) || (label ? label : "From the closet.");
}

export function neglectedPiece(
  garments: Garment[],
  dropIds: string[],
): Garment | null {
  const used = new Set(dropIds);
  const pool = garments.filter(
    (g) => !g.archived && !used.has(g.id) && daysIdle(g) >= 21,
  );
  if (!pool.length) return null;
  return [...pool].sort((a, b) => daysIdle(b) - daysIdle(a))[0] ?? null;
}

export function alternatives(
  garments: Garment[],
  current: Garment,
  dropIds: string[],
): Garment[] {
  const used = new Set(dropIds);
  const slot = slotOf(current) ?? current.category;
  return garments
    .filter(
      (g) =>
        !g.archived &&
        (!g.demo || current.demo) &&
        (slotOf(g) ?? g.category) === slot &&
        g.id !== current.id &&
        !used.has(g.id),
    )
    .sort((a, b) => daysIdle(b) - daysIdle(a));
}

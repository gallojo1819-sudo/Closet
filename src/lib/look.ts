import type { Garment, Moment, Occasion, Season, WeatherSnap } from "./types.ts";
import { colorLine } from "./color.ts";
import {
  HOUSE_LABEL,
  daysIdle,
  isCampCollar,
  isFairIsle,
  isHoodiePiece,
  isTrueOuter,
  lookHouses,
  slotOf,
} from "./style.ts";
import { houseFingerprintOk, type House } from "./houses.ts";

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
  const wearCount = [top, bottom, shoe].filter(Boolean).length;
  const outer =
    wearCount >= 3 && pieces.length >= 4
      ? outers.find((g) => g.id !== top?.id)
      : undefined;

  return [top, bottom, shoe, outer].filter((g): g is Garment => Boolean(g)).slice(0, 4);
}

/** Band for a plate already chosen for the look. Category wins over a jacket-ish name. */
export function kitBand(g: Garment): "top" | "jacket" | "bottom" | "shoe" | null {
  if (g.category === "top" || g.category === "dress") return "top";
  if (g.category === "bottom") return "bottom";
  if (g.category === "footwear") return "shoe";
  const s = slotOf(g);
  if (s === "top" || s === "dress") return "top";
  if (s === "bottom") return "bottom";
  if (s === "footwear") return "shoe";
  if (s === "outerwear" || g.category === "outerwear") return "jacket";
  return null;
}

/** One band each for the top, bottom, shoe, and the outer when the look has one. */
export function kitCells(pieces: Garment[]): Garment[] {
  const top = pieces.find((g) => kitBand(g) === "top");
  const bottom = pieces.find((g) => kitBand(g) === "bottom");
  const outer = pieces.find((g) => kitBand(g) === "jacket");
  const shoe = pieces.find((g) => kitBand(g) === "shoe");
  return [top, bottom, outer, shoe].filter((g): g is Garment => Boolean(g));
}

export function nameLook(pieces: Garment[]): string {
  const sorted = sortLook(pieces);
  if (sorted.length === 0) return "Nothing on the rack";
  if (sorted.length === 1) return sorted[0]!.name;
  return `${sorted[0]!.name} · ${sorted[1]!.name}`;
}

/** Editorial card title — palette + the chip's house, or a short occasion line. Not a SKU dump. */
export function spreadTitle(
  pieces: Garment[],
  occasion?: Occasion,
  house?: House | "all" | null,
  season?: Season,
): string {
  const note = dropNote(pieces, undefined, occasion, undefined, house, season).replace(/\.$/, "");
  if (note) return note;
  if (occasion === "weekend") return "Saturday market";
  if (occasion === "weekday") return "Quiet office";
  if (occasion === "comfy") return "Off duty";
  return nameLook(pieces);
}

export function spreadMicro(
  pieces: Garment[],
  occasion?: Occasion,
  season?: string,
): string {
  const n = Math.max(kitCells(pieces).length, pieces.filter((g) => slotOf(g) !== "accessory").length);
  const occ = occasion ? occasion.toUpperCase() : "";
  const sea = season ? season.toUpperCase() : "";
  return [occ, sea, `${n} pieces`].filter(Boolean).join(" · ");
}

/** Core + belt/cap for the lay. */
export function spreadPieces(pieces: Garment[]): Garment[] {
  const core = kitCells(pieces);
  const acc = pieces.filter((g) => {
    const s = slotOf(g) ?? g.category;
    return s === "accessory" && !core.some((c) => c.id === g.id);
  });
  return [...core, ...acc];
}

export function dropNote(
  pieces: Garment[],
  weather?: WeatherSnap,
  occasion?: Occasion,
  moment?: Moment,
  house?: House | "all" | null,
  season?: Season,
): string {
  void weather;
  void moment;
  const occ = occasion ?? "weekday";
  let label = "";
  if (house && house !== "all") {
    label = HOUSE_LABEL[house];
  } else {
    const named = lookHouses(pieces, occ, season)[0];
    if (named && houseFingerprintOk(pieces, named, occ, undefined, season)) label = HOUSE_LABEL[named];
  }
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

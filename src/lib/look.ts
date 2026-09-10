import type { Garment, WeatherSnap } from "./types";

const ORDER: Garment["category"][] = [
  "top",
  "dress",
  "bottom",
  "outerwear",
  "footwear",
  "accessory",
  "other",
];

export function sortLook(pieces: Garment[]): Garment[] {
  return [...pieces].sort(
    (a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category),
  );
}

export function nameLook(pieces: Garment[]): string {
  const sorted = sortLook(pieces);
  if (sorted.length === 0) return "Nothing on the rack";
  if (sorted.length === 1) return sorted[0]!.name;
  return `${sorted[0]!.name} · ${sorted[1]!.name}`;
}

export function dropNote(pieces: Garment[], weather?: WeatherSnap): string {
  const f = weather?.f ?? 68;
  const sky = (weather?.label ?? "fair").toLowerCase();
  const coat = pieces.find((g) => g.category === "outerwear");
  const top = pieces.find((g) => g.category === "top" || g.category === "dress");
  const shoes = pieces.find((g) => g.category === "footwear");

  if (f < 55 && coat) {
    return `${f}° and ${sky}. The ${coat.name.toLowerCase()} is doing the work.`;
  }
  if (f > 78) {
    return `${f}°. Keep it light — nothing that traps heat.`;
  }
  if (coat) {
    return `${f}° and ${sky}. ${coat.name} over ${top ? top.name.toLowerCase() : "the rest"}.`;
  }
  if (top && shoes) {
    return `${f}° and ${sky}. ${top.name} and ${shoes.name.toLowerCase()} — nothing you don't own.`;
  }
  return `${f}°. Built from the closet, not a catalog.`;
}

export function neglectedPiece(
  garments: Garment[],
  dropIds: string[],
): Garment | null {
  const used = new Set(dropIds);
  const pool = garments.filter((g) => !g.archived && !used.has(g.id));
  if (!pool.length) return null;
  const last = (g: Garment) => g.wornOn.at(-1) ?? "0000-00-00";
  return [...pool].sort((a, b) => last(a).localeCompare(last(b)))[0] ?? null;
}

export function alternatives(
  garments: Garment[],
  current: Garment,
  dropIds: string[],
): Garment[] {
  const used = new Set(dropIds);
  return garments.filter(
    (g) =>
      !g.archived &&
      g.category === current.category &&
      g.id !== current.id &&
      !used.has(g.id),
  );
}

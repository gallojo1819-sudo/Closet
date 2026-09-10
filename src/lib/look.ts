import type { Garment, Moment, Occasion, WeatherSnap } from "./types";
import { HOUSE_LABEL, daysIdle, lookHouses } from "./style";

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

export function dropNote(
  pieces: Garment[],
  weather?: WeatherSnap,
  occasion?: Occasion,
  moment?: Moment,
): string {
  const f = weather?.f ?? 68;
  const sky = (weather?.label ?? "fair").toLowerCase();
  const houses = lookHouses(pieces)
    .slice(0, 2)
    .map((h) => HOUSE_LABEL[h])
    .join(" × ");
  const sitting = [...pieces].sort((a, b) => daysIdle(b) - daysIdle(a))[0];
  const idle = sitting ? daysIdle(sitting) : 0;
  const when = [occasion, moment].filter(Boolean).join(" · ");
  const head = when ? `${when}. ` : "";

  if (idle >= 21 && sitting) {
    return `${head}${f}° ${sky}. Putting the ${sitting.name.toLowerCase()} back in — it has sat ${idle} days. ${houses}.`;
  }
  if (f < 55) {
    return `${head}${f}°. Coat weather. ${houses || "From the closet"}.`;
  }
  if (f > 78) {
    return `${head}${f}°. Keep it light. ${houses}.`;
  }
  return `${head}${f}° ${sky}. ${houses || "Built from what you own"}.`;
}

export function neglectedPiece(
  garments: Garment[],
  dropIds: string[],
): Garment | null {
  const used = new Set(dropIds);
  const pool = garments.filter((g) => !g.archived && !used.has(g.id));
  if (!pool.length) return null;
  return [...pool].sort((a, b) => daysIdle(b) - daysIdle(a))[0] ?? null;
}

export function alternatives(
  garments: Garment[],
  current: Garment,
  dropIds: string[],
): Garment[] {
  const used = new Set(dropIds);
  return garments
    .filter(
      (g) =>
        !g.archived &&
        g.category === current.category &&
        g.id !== current.id &&
        !used.has(g.id),
    )
    .sort((a, b) => daysIdle(b) - daysIdle(a));
}

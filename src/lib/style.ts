import type { Garment, Moment, Occasion, WeatherSnap } from "./types";
import { todayISO } from "./utils";

export type { Moment, Occasion };
export type House = "prep" | "italian" | "street";

export const HOUSE_LABEL: Record<House, string> = {
  prep: "Ralph Lauren",
  italian: "Italian",
  street: "Street",
};

export function defaultOccasion(d = new Date()): Occasion {
  const day = d.getDay();
  return day === 0 || day === 6 ? "weekend" : "weekday";
}

export function momentOfDay(d = new Date()): Moment {
  const h = d.getHours();
  if (h < 11) return "morning";
  if (h >= 17) return "evening";
  return "day";
}

export function daysIdle(g: Garment, today = todayISO()): number {
  const last = g.wornOn.at(-1);
  if (!last) return 120;
  const ms = Date.parse(today) - Date.parse(last);
  if (!Number.isFinite(ms)) return 120;
  return Math.max(0, Math.round(ms / 86_400_000));
}

export function housesOf(g: Garment): House[] {
  const blob = `${g.subtype} ${g.name} ${g.material}`.toLowerCase();
  const houses = new Set<House>();
  if (/oxford|polo|chino|loafer|cable|navy cap|belt/.test(blob)) houses.add("prep");
  if (/knit|merino|wool|camel|trouser|loafer|overcoat|linen/.test(blob)) houses.add("italian");
  if (/sneaker|tee|t-shirt|jean|denim|hoodie|cap|overshirt/.test(blob)) houses.add("street");
  if (g.formality >= 4) houses.add("italian");
  if (g.formality <= 2) houses.add("street");
  if (g.formality === 3) houses.add("prep");
  if (houses.size === 0) houses.add("prep");
  return [...houses];
}

function formalityTarget(occasion: Occasion, moment: Moment): number {
  if (occasion === "client") return 4;
  if (occasion === "dinner") return moment === "evening" ? 4 : 3;
  if (occasion === "weekend" || occasion === "travel") return 2;
  return 3;
}

export function pickLook(
  garments: Garment[],
  opts: { weather?: WeatherSnap; occasion: Occasion; moment: Moment },
): string[] {
  const active = garments.filter((g) => !g.archived);
  const by = (cat: Garment["category"]) => active.filter((g) => g.category === cat);
  const f = opts.weather?.f ?? 68;
  const cool = f < 62;
  const warm = f > 78;
  const target = formalityTarget(opts.occasion, opts.moment);

  const score = (g: Garment) => {
    let s = 0;
    s += 4 - Math.abs(g.formality - target);
    if (cool) s += g.warmth;
    if (warm) s += 6 - g.warmth;
    if (g.wornOn.at(-1) === todayISO()) s -= 6;
    s += Math.min(daysIdle(g), 90) / 12;
    if (opts.occasion === "client" || opts.occasion === "dinner") {
      if (g.subtype === "sneakers") s -= 2;
      if (g.subtype === "loafers" || g.subtype === "trousers") s += 1.5;
    }
    if (opts.occasion === "weekend" || opts.occasion === "travel") {
      if (g.subtype === "sneakers" || g.subtype === "jeans") s += 1.2;
    }
    return s + Math.random() * 0.35;
  };

  const best = (list: Garment[]) =>
    [...list].sort((a, b) => score(b) - score(a))[0];

  const ids: string[] = [];
  const top = best(by("top"));
  const bottom = best(by("bottom"));
  const dress = best(by("dress"));
  const shoes = best(by("footwear"));
  if (dress && (!top || score(dress) > score(top))) {
    ids.push(dress.id);
  } else if (top) {
    ids.push(top.id);
    if (bottom) ids.push(bottom.id);
  }
  if (shoes) ids.push(shoes.id);
  if (cool || opts.moment === "morning") {
    const outer = best(by("outerwear"));
    if (outer && !(warm && outer.warmth >= 5)) ids.push(outer.id);
  }
  const acc = by("accessory");
  const belt = acc.find((a) => a.subtype === "belt");
  if (belt && shoes?.subtype === "loafers") ids.push(belt.id);

  const used = new Set(ids);
  const idle = [...active]
    .filter((g) => !used.has(g.id) && daysIdle(g) >= 21)
    .sort((a, b) => daysIdle(b) - daysIdle(a));
  const candidate = idle[0];
  if (candidate) {
    const slot = ids.findIndex((id) => {
      const g = active.find((x) => x.id === id);
      return g?.category === candidate.category;
    });
    if (slot >= 0) ids[slot] = candidate.id;
    else if (candidate.category === "accessory" || candidate.category === "outerwear") {
      ids.push(candidate.id);
    }
  }

  return ids;
}

export function lookHouses(pieces: Garment[]): House[] {
  const counts: Record<House, number> = { prep: 0, italian: 0, street: 0 };
  for (const g of pieces) {
    for (const h of housesOf(g)) counts[h] += 1;
  }
  return (Object.keys(counts) as House[])
    .filter((h) => counts[h] > 0)
    .sort((a, b) => counts[b] - counts[a]);
}

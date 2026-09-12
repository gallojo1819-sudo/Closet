import type { Garment, Moment, Occasion, WeatherSnap } from "./types.ts";
import { todayISO } from "./utils.ts";

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
  const last = g.wornOn.at(-1) ?? g.createdAt.slice(0, 10);
  if (!last) return 0;
  const ms = Date.parse(today) - Date.parse(last);
  if (!Number.isFinite(ms)) return 0;
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
  if (occasion === "dinner") return 4;
  if (occasion === "weekend" || occasion === "travel") return 2;
  void moment;
  return 3;
}

function blobOf(g: Garment): string {
  return `${g.subtype} ${g.name} ${g.notes ?? ""}`.toLowerCase();
}

/** Occasion briefs: mixed houses, not costume. Penalties beat idle. */
function occasionScore(g: Garment, occasion: Occasion): number {
  const b = blobOf(g);
  const sneaker = /sneaker|trainer/.test(b);
  const gym = /gym|runner|running|athletic/.test(b);
  const tee = /\btee\b|t-shirt|hoodie/.test(b);
  const jean = /\bjeans?\b|denim/.test(b);
  const cargo = /cargo/.test(b);
  const oxford = /oxford/.test(b);
  const polo = /polo/.test(b);
  const loafer = /loafer/.test(b);
  const trouser = /trouser/.test(b);
  const knit = /knit|sweater|merino/.test(b);
  const overshirt = /overshirt/.test(b);
  const distressed = /distress|ripped|destroyed/.test(b);
  let s = 0;
  if (occasion === "client") {
    if (sneaker || tee || gym) s -= 5;
    if (jean || distressed) s -= 4;
    if (trouser || oxford || loafer) s += 3;
  } else if (occasion === "dinner") {
    if (gym || (sneaker && gym)) s -= 5;
    if (sneaker) s -= 3.5;
    if (cargo) s -= 5;
    if (jean) s -= 2.5;
    if (tee) s -= 2;
    if (loafer) s += 2.5;
    if (trouser) s += 2;
    if (oxford) s += 1.5;
  } else if (occasion === "weekend") {
    if (jean || sneaker || polo) s += 1.5;
  } else if (occasion === "travel") {
    if (knit || overshirt || sneaker || loafer) s += 1.5;
  }
  return s;
}

const KNOWN_SLOTS = [
  "top",
  "bottom",
  "outerwear",
  "dress",
  "footwear",
  "accessory",
] as const;

type Slot = (typeof KNOWN_SLOTS)[number];

/**
 * Wear slot for pickLook. Name/subtype win when they name a garment
 * (a loafer tagged "bottom" is still footwear). True unknowns stay out
 * so they are never parked on the legs.
 */
export function slotOf(g: Garment): Slot | null {
  const blob = `${g.subtype} ${g.name}`.toLowerCase();
  const footwear = /\b(shoes?|loafers?|mules?|sneakers?|boots?|booties)\b/.test(blob);
  const bottom = /\b(pants?|chinos?|jeans?|trousers?|shorts?)\b/.test(blob);
  const top = /\b(t-shirts?|tees?|shirts?|oxfords?|polos?|knits?|sweaters?)\b/.test(blob);
  const outer = /\b(jackets?|coats?|overshirts?)\b/.test(blob);
  // "boot cut jeans" is bottom; a lone "loafer" is never pants.
  if (footwear && !bottom) return "footwear";
  if (bottom) return "bottom";
  if (top) return "top";
  if (outer) return "outerwear";
  if ((KNOWN_SLOTS as readonly string[]).includes(g.category)) {
    return g.category as Slot;
  }
  return null;
}

export function pickLook(
  garments: Garment[],
  opts: {
    weather?: WeatherSnap;
    occasion: Occasion;
    moment: Moment;
    avoid?: Record<string, number>;
    recentWorn?: string[];
    /** Last drop's ids — one reroll only, scored −8. Avoid still caps separately. */
    previousIds?: string[];
  },
): string[] {
  const real = garments.filter((g) => !g.archived && !g.demo);
  // Real closet only. Samples fill Today only when nothing real is on the rack.
  const pool = real.length ? real : garments.filter((g) => !g.archived);
  const by = (slot: Slot) => pool.filter((g) => slotOf(g) === slot);
  const f = opts.weather?.f ?? 68;
  const cool = f < 62;
  const warm = f > 78;
  const target = formalityTarget(opts.occasion, opts.moment);

  const avoid = opts.avoid ?? {};
  const recent = new Set(opts.recentWorn ?? []);
  const previous = new Set(opts.previousIds ?? []);
  const score = (g: Garment) => {
    let s = 0;
    s += 4 - Math.abs(g.formality - target);
    if (cool) s += g.warmth;
    if (warm) s += 6 - g.warmth;
    if (g.wornOn.at(-1) === todayISO()) s -= 6;
    if (recent.has(g.id) && slotOf(g) !== "accessory") s -= 2.5;
    s -= Math.min(avoid[g.id] ?? 0, 4) * 1.6;
    if (previous.has(g.id)) s -= 8;
    s += Math.min(daysIdle(g), 90) / 10;
    s += occasionScore(g, opts.occasion);
    return s + Math.random() * 0.25;
  };

  const best = (list: Garment[]) =>
    [...list].sort((a, b) => score(b) - score(a))[0];

  const ids: string[] = [];
  const top = best(by("top"));
  const bottom = best(by("bottom"));
  const shoes = best(by("footwear"));
  // Weekday look is top + bottom + footwear. Empty slots are omitted, never invented.
  if (top) {
    ids.push(top.id);
  } else {
    // No shirt/oxford/polo/tee/knit in the pool — a dress may stand in.
    const dress = best(by("dress"));
    if (dress) ids.push(dress.id);
  }
  if (bottom) {
    ids.push(bottom.id);
  }
  // else: no pant/chino/jean/trouser inferred — omit rather than put loafers on the legs.
  if (shoes) {
    ids.push(shoes.id);
  }
  // else: no shoe/loafer/mule/sneaker/boot inferred — omit.
  if (cool) {
    // Outerwear only when it's actually cool, not on a warm morning.
    const outer = best(by("outerwear"));
    if (outer && !(warm && outer.warmth >= 5)) ids.push(outer.id);
  }
  const acc = by("accessory");
  const belt = acc.find((a) => a.subtype === "belt");
  if (
    belt &&
    shoes &&
    /loafer/.test(`${shoes.subtype} ${shoes.name}`.toLowerCase())
  ) {
    ids.push(belt.id);
  }

  const used = new Set(ids);
  const idle = [...pool]
    .filter((g) => !used.has(g.id) && !previous.has(g.id) && daysIdle(g) >= 21)
    .sort((a, b) => daysIdle(b) - daysIdle(a));
  const candidate = idle[0];
  if (candidate) {
    const candSlot = slotOf(candidate);
    const slot = ids.findIndex((id) => {
      const g = pool.find((x) => x.id === id);
      return g && slotOf(g) === candSlot;
    });
    if (slot >= 0) {
      const occupant = pool.find((x) => x.id === ids[slot]);
      // Don't swap a dinner trouser for idle jeans. Client/dinner stay brief-driven.
      const formal = opts.occasion === "client" || opts.occasion === "dinner";
      if (occupant && daysIdle(occupant) < 21 && !formal) ids[slot] = candidate.id;
    } else if (candSlot === "accessory" || candSlot === "outerwear") {
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

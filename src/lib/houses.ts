/**
 * House chips. Legality is the approved profile evaluator, not a phrase list.
 * Look-print axes below are for variety only. They do not decide a house.
 */
import { APPROVED } from "./house-profiles/load.ts";
import {
  assignSlots,
  evaluatePlates,
  pieceBanned,
  scorePlates,
  sig,
  slotOfPlate,
  type Plate,
} from "./house-profiles/evaluate.ts";
import { resolveTuck } from "./tuck.ts";
import type { Garment, Occasion, Season } from "./types.ts";

export type House =
  | "polo"
  | "purple"
  | "rrl"
  | "ald"
  | "faloni"
  | "fiveFourFive"
  | "sweetStable"
  | "italianSummer"
  | "italianWinter";

export const HOUSE_LABEL: Record<House, string> = {
  polo: "Polo",
  purple: "Purple",
  rrl: "RRL",
  ald: "ALD",
  faloni: "Faloni",
  fiveFourFive: "545",
  sweetStable: "SweetStable",
  italianSummer: "ItalianSummer",
  italianWinter: "ItalianWinter",
};

export const HOUSE_CHIPS: { id: House; label: string }[] = [
  { id: "polo", label: "Polo" },
  { id: "purple", label: "Purple" },
  { id: "rrl", label: "RRL" },
  { id: "ald", label: "ALD" },
  { id: "faloni", label: "Faloni" },
  { id: "fiveFourFive", label: "545" },
  { id: "sweetStable", label: "SweetStable" },
  { id: "italianSummer", label: "ItalianSummer" },
  { id: "italianWinter", label: "ItalianWinter" },
];

/** All-chip rank: Polo last. */
export const HOUSES: House[] = [
  "ald",
  "faloni",
  "fiveFourFive",
  "purple",
  "rrl",
  "sweetStable",
  "italianSummer",
  "italianWinter",
  "polo",
];

export function mapHouse(raw?: string | null): House | "all" {
  if (!raw || raw === "all") return "all";
  if (raw === "ralph") return "polo";
  if ((HOUSE_CHIPS as { id: string }[]).some((h) => h.id === raw)) return raw as House;
  return "all";
}

export type TopType =
  | "oxford"
  | "pique_polo"
  | "cable"
  | "rugby"
  | "oversized_oxford"
  | "camp"
  | "linen_portofino"
  | "italian_knit_polo"
  | "sangallo"
  | "serafino"
  | "bowling"
  | "light_cashmere_tee"
  | "fair_isle"
  | "gingham"
  | "work_shirt"
  | "merino"
  | "turtleneck"
  | "cashmere_top"
  | "hoodie"
  | "tee"
  | "other";

export type ShoeFamily =
  | "penny_loafer"
  | "leather_sneaker"
  | "boat"
  | "suede_loafer"
  | "chelsea"
  | "nb990"
  | "driving_mule"
  | "white_court"
  | "boot"
  | "suede_sneaker"
  | "summer_walk"
  | "derby"
  | "other";

export type BottomType =
  | "chino"
  | "khaki"
  | "jean"
  | "cord"
  | "linen"
  | "flannel"
  | "drawstring"
  | "trouser"
  | "other";

export type PaletteLane =
  | "navy_blue"
  | "camel_charcoal_loden"
  | "sand_cream_ocean"
  | "beige_ivory_tobacco"
  | "other";

export type OuterAttitude =
  | "navy_blazer"
  | "unconstructed"
  | "overcoat"
  | "chore"
  | "field"
  | "denim"
  | "suede"
  | "camel_jacket"
  | "none";

export type LookPrint = {
  top_type: TopType;
  bottom_type: BottomType;
  shoe_family: ShoeFamily;
  tuck: "in" | "out" | "none";
  palette_lane: PaletteLane;
  outer_attitude: OuterAttitude;
};

export function garmentBlob(g: Garment): string {
  return `${g.name} ${g.subtype} ${g.notes ?? ""} ${g.colors.join(" ")} ${g.material}`.toLowerCase();
}

function slotOf(g: Garment): string {
  const b = garmentBlob(g);
  if (/loafer|mule|sneaker|boot|derby|chelsea|boat|990|991|993/.test(b) || g.category === "footwear") {
    if (g.category === "bottom" && /trouser|chino|jean|cord/.test(b) && !/loafer|sneaker|boot/.test(b)) {
      return "bottom";
    }
    if (g.category === "footwear" || /loafer|mule|sneaker|boot|990/.test(b)) return "footwear";
  }
  if (/\b(hoodies?|sweatshirts?)\b/.test(b)) return "top";
  if (
    /\b(cardigans?|fleece|vests?)\b/.test(b) ||
    /zip[- ]?(up)?\s*(sweater|knit)/.test(b)
  ) {
    return "top";
  }
  if (/\b(jackets?|blazers?|coats?|bombers?|chore|field|trucker|trench)\b/.test(b)) return "outerwear";
  if (g.category === "dress") return "dress";
  if (g.category === "outerwear") return "outerwear";
  if (g.category === "bottom") return "bottom";
  if (g.category === "top") return "top";
  if (g.category === "accessory") return "accessory";
  return g.category;
}

export function topType(g: Garment): TopType {
  const b = garmentBlob(g);
  if (/sangallo/.test(b)) return "sangallo";
  if (/serafino/.test(b)) return "serafino";
  if (/bowling/.test(b)) return "bowling";
  if (/fair\s*isle/.test(b)) return "fair_isle";
  if (/gingham/.test(b)) return "gingham";
  if (/rugby/.test(b)) return "rugby";
  if (/oxford/.test(b) && /oversized/.test(b)) return "oversized_oxford";
  if (/\bocbd\b|oxford/.test(b)) return "oxford";
  if (/camp/.test(b)) return "camp";
  if (/portofino/.test(b)) return "linen_portofino";
  if (/polo/.test(b) && /linen|silk|italian|knit polo/.test(b)) return "italian_knit_polo";
  if (/piqu[eé]/.test(b) || (/polo/.test(b) && !/rugby/.test(b))) return "pique_polo";
  if (/cable/.test(b)) return "cable";
  if (/turtleneck|rollneck|funnel/.test(b)) return "turtleneck";
  if (/merino/.test(b)) return "merino";
  if (/cashmere/.test(b) && /\btee\b|t-shirt|crew/.test(b)) return "light_cashmere_tee";
  if (/cashmere/.test(b)) return "cashmere_top";
  if (/work shirt|selvedge|chambray/.test(b)) return "work_shirt";
  if (/hoodie/.test(b)) return "hoodie";
  if (/\btee\b|t-shirt/.test(b)) return "tee";
  return "other";
}

export function shoeFamily(g: Garment): ShoeFamily {
  const b = garmentBlob(g);
  if (/\b990\b|\b991\b|\b993\b|new balance/.test(b) || /new balance/i.test(g.brand ?? "")) return "nb990";
  if (/summer walk/.test(b) || (/loafer/.test(b) && /white[- ]sole/.test(b))) return "summer_walk";
  if (/mule|driving/.test(b)) return "driving_mule";
  if (/chelsea/.test(b)) return "chelsea";
  if (/boat|deck/.test(b)) return "boat";
  if (/derby/.test(b)) return "derby";
  if (/boot/.test(b)) return "boot";
  if (/court/.test(b)) return "white_court";
  if (/sneaker/.test(b) && /white|ivory/.test(b) && /court|leather/.test(b)) return "white_court";
  if (/suede/.test(b) && /sneaker/.test(b)) return "suede_sneaker";
  if (/suede/.test(b) && /loafer/.test(b)) return "suede_loafer";
  if (/loafer|penny/.test(b)) return "penny_loafer";
  if (/leather/.test(b) && /sneaker/.test(b)) return "leather_sneaker";
  if (/sneaker/.test(b)) return "leather_sneaker";
  return "other";
}

export function bottomType(g: Garment): BottomType {
  const b = garmentBlob(g);
  if (/cord/.test(b)) return "cord";
  if (/drawstring/.test(b)) return "drawstring";
  if (/flannel/.test(b)) return "flannel";
  if (/linen/.test(b)) return "linen";
  if (/\bjeans?\b|denim|selvedge/.test(b)) return "jean";
  if (/khaki/.test(b)) return "khaki";
  if (/chino/.test(b)) return "chino";
  if (/trouser/.test(b)) return "trouser";
  return "other";
}

function paletteLane(pieces: Garment[]): PaletteLane {
  const b = pieces.map(garmentBlob).join(" ");
  if (/camel|charcoal|loden/.test(b)) return "camel_charcoal_loden";
  if (/sand|cream|ocean|sky/.test(b) && !/navy oxford/.test(b)) return "sand_cream_ocean";
  if (/beige|ivory|tobacco|ecru/.test(b)) return "beige_ivory_tobacco";
  if (/navy|blue/.test(b)) return "navy_blue";
  return "other";
}

function outerAttitude(pieces: Garment[]): OuterAttitude {
  const outers = pieces.filter((g) => slotOf(g) === "outerwear");
  if (!outers.length) return "none";
  const b = outers.map(garmentBlob).join(" ");
  if (/overcoat|topcoat/.test(b) && !/blazer|sport\s*coats?/.test(b)) return "overcoat";
  if (/shearling|suede/.test(b) && /jacket|coat|bomber/.test(b)) return "suede";
  if (/chore/.test(b)) return "chore";
  if (/field/.test(b)) return "field";
  if (/trucker|denim jacket|\bdenim\b/.test(b) && /jacket|trucker/.test(b)) return "denim";
  if (/camel/.test(b) && /overcoat|topcoat/.test(b)) return "camel_jacket";
  if (/navy/.test(b) && /blazer|sport\s*coats?/.test(b)) return "navy_blazer";
  if (/unconstructed|unlined|shirt-jacket|overshirt/.test(b)) return "unconstructed";
  if (/blazer|sport\s*coats?/.test(b) && /taupe|ivory|cord|beige|cream/.test(b)) return "unconstructed";
  if (/blazer|sport\s*coats?/.test(b) && !/navy/.test(b)) return "unconstructed";
  if (/blazer|sport\s*coats?/.test(b)) return "navy_blazer";
  return "unconstructed";
}

function topsOf(pieces: Garment[]): Garment[] {
  return pieces.filter((g) => {
    const s = slotOf(g);
    return s === "top" || s === "dress";
  });
}

function bottomsOf(pieces: Garment[]): Garment[] {
  return pieces.filter((g) => slotOf(g) === "bottom");
}

function shoesOf(pieces: Garment[]): Garment[] {
  return pieces.filter((g) => slotOf(g) === "footwear");
}

export function lookPrint(pieces: Garment[], occasion?: Occasion): LookPrint {
  const top = topsOf(pieces)[0];
  const bot = bottomsOf(pieces)[0];
  const shoe = shoesOf(pieces)[0];
  const tt = top ? topType(top) : "other";
  let tuck: LookPrint["tuck"] = top ? resolveTuck(top, occasion, pieces) : "none";
  if (
    tt === "rugby" ||
    tt === "oversized_oxford" ||
    tt === "camp" ||
    tt === "sangallo" ||
    tt === "serafino" ||
    tt === "bowling"
  ) {
    tuck = "out";
  }
  if (tt === "oxford") tuck = "in";
  return {
    top_type: tt,
    bottom_type: bot ? bottomType(bot) : "other",
    shoe_family: shoe ? shoeFamily(shoe) : "other",
    tuck,
    palette_lane: paletteLane(pieces),
    outer_attitude: outerAttitude(pieces),
  };
}

export function isPoloDefaultSilhouette(print: LookPrint): boolean {
  const bot = print.bottom_type === "chino" || print.bottom_type === "khaki";
  return print.top_type === "oxford" && bot && print.shoe_family === "penny_loafer";
}

export function axesDiffer(a: LookPrint, b: LookPrint): number {
  let n = 0;
  if (a.top_type !== b.top_type) n += 1;
  if (a.bottom_type !== b.bottom_type) n += 1;
  if (a.shoe_family !== b.shoe_family) n += 1;
  if (a.tuck !== b.tuck) n += 1;
  if (a.palette_lane !== b.palette_lane) n += 1;
  if (a.outer_attitude !== b.outer_attitude) n += 1;
  return n;
}

export type HouseBrief = {
  signals: string[];
  shoes: string[];
  jackets: string[];
  requireOwned: string[];
  gap?: string;
  cardNote?: string;
  gap_note?: string;
  card_note?: string;
};

function asPlate(g: Garment): Plate {
  const category = g.category === "dress" ? "top" : g.category;
  return {
    id: g.id,
    name: g.name,
    category,
    subtype: g.subtype,
    material: g.material,
    colors: g.colors,
    brand: g.brand,
    fit: g.fit,
    warmth: g.warmth,
  };
}

function ctxOf(occasion?: string, season?: string) {
  return { occasion, season };
}

function profile(house: House) {
  return APPROVED[house];
}

/** Approved profile for a chip. Callers that still read gap/card notes use the JSON fields. */
export function houseProfile(house: House): HouseBrief {
  const p = profile(house) as {
    gap_note?: string;
    card_note?: string;
    allowed?: { shoe?: string[]; outer?: string[] };
  };
  return {
    signals: [],
    shoes: p?.allowed?.shoe ?? [],
    jackets: p?.allowed?.outer ?? [],
    requireOwned: [],
    gap: p?.gap_note,
    cardNote: p?.card_note,
    gap_note: p?.gap_note,
    card_note: p?.card_note,
  };
}

/** Phrase matching is gone. House legality is evaluate(). */
export function profilePhraseHits(
  _pieces: Garment[],
  _phrase: string,
  _occasion?: Occasion,
  _print?: LookPrint,
): boolean {
  return false;
}

export function houseKill(
  pieces: Garment[],
  house: House,
  occasion: Occasion,
  _pool?: Garment[],
  season?: Season,
): string | null {
  const ev = evaluatePlates(profile(house) as never, assignSlots(pieces.map(asPlate)), ctxOf(occasion, season));
  return ev.passed ? null : ev.hardFails[0] ?? "fail";
}

export function housePieceBanned(pieces: Garment[], house: House, occasion?: Occasion, season?: Season): boolean {
  const p = profile(house);
  return pieces.some((g) => pieceBanned(asPlate(g), p as never, ctxOf(occasion, season)));
}

export function houseFingerprintOk(
  pieces: Garment[],
  house: House,
  occasion: Occasion,
  _pool?: Garment[],
  season?: Season,
): boolean {
  const ev = evaluatePlates(profile(house) as never, assignSlots(pieces.map(asPlate)), ctxOf(occasion, season));
  return ev.passed;
}

export function isHardHouseLook(
  pieces: Garment[],
  house: House,
  occasion: Occasion,
  pool?: Garment[],
  season?: Season,
): boolean {
  return houseFingerprintOk(pieces, house, occasion, pool, season);
}

export function stylistHouseBrief(house: House): string {
  const p = profile(house) as { card_note?: string; gap_note?: string; label?: string };
  return [`HOUSE ${HOUSE_LABEL[house]}`, p?.card_note ? `Card: ${p.card_note}` : "", p?.gap_note ? `GAP: ${p.gap_note}` : ""]
    .filter(Boolean)
    .join("\n");
}

export function appendHouseGap(
  text: string,
  house: House | null | undefined,
  garments: Garment[],
  occasion?: Occasion,
): string {
  if (!house) return text;
  const gap = houseGapNote(house, garments, occasion);
  if (!gap) return text;
  if (text.toLowerCase().includes(gap.toLowerCase())) return text;
  if (/^MISSING:/im.test(text)) return text;
  return `${text}\nMISSING: ${gap}`;
}

/** Highest-scoring house whose approved profile passes. Polo is last. Null when none pass. */
export function leadHouse(pieces: Garment[], occasion: Occasion = "weekday", season?: Season): House | null {
  let best: House | null = null;
  let bestN = Number.NEGATIVE_INFINITY;
  for (const h of HOUSES) {
    const scored = scorePlates(profile(h) as never, assignSlots(pieces.map(asPlate)), ctxOf(occasion, season));
    if (!scored.eval.passed) continue;
    const n = h === "polo" ? scored.score - 0.01 : scored.score;
    if (n > bestN) {
      best = h;
      bestN = n;
    }
  }
  return best;
}

export function housesOf(g: Garment): House[] {
  const plate = asPlate(g);
  const slot = slotOfPlate(plate);
  const out: House[] = [];
  for (const h of HOUSES) {
    const p = profile(h) as unknown as { keywords: Record<string, never>; allowed?: Record<string, string[]> };
    const allowed = p.allowed?.[slot];
    if (!allowed?.length) continue;
    if (pieceBanned(plate, p as never, {})) continue;
    if (allowed.some((sid) => sig(plate, sid, p.keywords))) out.push(h);
  }
  return out;
}

export function lookHouses(pieces: Garment[], occasion: Occasion = "weekday", season?: Season): House[] {
  const h = leadHouse(pieces, occasion, season);
  return h ? [h] : [];
}

export function houseFromPrompt(prompt: string): House | null {
  const p = prompt.toLowerCase();
  if (/\bald\b/.test(p)) return "ald";
  if (/faloni/.test(p)) return "faloni";
  if (/\b545\b|five\s*four/.test(p)) return "fiveFourFive";
  if (/sweet\s*stable/.test(p)) return "sweetStable";
  if (/italian\s*summer/.test(p)) return "italianSummer";
  if (/italian\s*winter/.test(p)) return "italianWinter";
  if (/\brrl\b|double\s*rl/.test(p)) return "rrl";
  if (/purple label|purple/.test(p) && /ralph|label|polo/.test(p)) return "purple";
  if (/\bpurple\b/.test(p) && !/polo/.test(p)) return "purple";
  if (/\bpolo\b/.test(p) && !/rugby|knit polo/.test(p)) return "polo";
  return null;
}

export function houseGapNote(house: House, _garments: Garment[], _occasion?: Occasion): string | null {
  const note = (profile(house) as { gap_note?: string }).gap_note;
  return note?.trim() ? note : null;
}

export function houseLegalCombo(
  pieces: Garment[],
  house: House | "all" | undefined,
  occasion: Occasion,
  previous?: Garment[],
  pool?: Garment[],
  season?: Season,
): boolean {
  if (!house || house === "all") return true;
  if (!houseFingerprintOk(pieces, house, occasion, pool, season)) return false;
  if (previous && previous.length >= 3) {
    const a = lookPrint(previous, occasion);
    const b = lookPrint(pieces, occasion);
    if (axesDiffer(a, b) < 3) return false;
  }
  return true;
}

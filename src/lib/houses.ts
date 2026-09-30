/**
 * Hard house fingerprints. Tokens from name/subtype/notes/colors — never a shop.
 * PoloDefault is last for All. A selected house never falls back to oxford+chino+penny.
 */
import { HOUSE_PROFILES, type HouseProfile } from "./house-profiles/index.ts";
import { resolveTuck } from "./tuck.ts";
import type { Garment, Occasion } from "./types.ts";

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
  if (/\b990\b|\b991\b|\b993\b|new balance/.test(b)) return "nb990";
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
  if (/drawstring|gurkha/.test(b)) return "drawstring";
  if (/cord/.test(b)) return "cord";
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

export function houseProfile(house: House): HouseProfile {
  return HOUSE_PROFILES[house];
}

/** One profile phrase. "a or b" hits if either side hits. The words are the JSON, not a second rule list. */
export function profilePhraseHits(
  pieces: Garment[],
  phrase: string,
  occasion?: Occasion,
  print: LookPrint = lookPrint(pieces, occasion),
): boolean {
  const raw = phrase.trim().toLowerCase();
  if (!raw) return false;
  if (raw === "pink polo as the only top") return atomHits(raw, print, pieces);
  if (raw.includes(" and ")) {
    return raw.split(" and ").every((part) => profilePhraseHits(pieces, part.trim(), occasion, print));
  }
  return raw.split(" or ").some((part) => atomHits(part.trim(), print, pieces));
}

function atomHits(phrase: string, print: LookPrint, pieces: Garment[]): boolean {
  const tops = topsOf(pieces);
  const shoes = shoesOf(pieces);
  const outers = pieces.filter((g) => slotOf(g) === "outerwear");
  const outerBlob = outers.map(garmentBlob).join(" ");
  const blob = pieces.map(garmentBlob).join(" ");
  switch (phrase) {
    case "oxford":
      return print.top_type === "oxford";
    case "polo":
    case "pique polo":
      return print.top_type === "pique_polo";
    case "cable":
      return print.top_type === "cable";
    case "rugby":
      return print.top_type === "rugby";
    case "oversized oxford":
      return print.top_type === "oversized_oxford";
    case "camp":
      return print.top_type === "camp";
    case "portofino":
      return print.top_type === "linen_portofino";
    case "italian knit polo":
      return print.top_type === "italian_knit_polo";
    case "sangallo":
      return print.top_type === "sangallo";
    case "serafino":
      return print.top_type === "serafino";
    case "bowling":
      return print.top_type === "bowling";
    case "light cashmere tee":
      return print.top_type === "light_cashmere_tee";
    case "fair isle":
      return print.top_type === "fair_isle";
    case "gingham":
      return print.top_type === "gingham";
    case "work shirt":
      return tops.some((g) => /work shirt|western|pearl\s*snap/.test(garmentBlob(g)));
    case "western":
      return /western|cowboy/.test(blob);
    case "pearl-snap":
    case "pearl snap":
      return /pearl\s*snap/.test(blob);
    case "chambray":
      return /chambray/.test(blob);
    case "flannel shirt":
      return tops.some((g) => /flannel/.test(garmentBlob(g)));
    case "selvedge":
      return /selvedge/.test(blob);
    case "jean":
    case "jeans":
      return pieces.some(
        (g) => slotOf(g) === "bottom" && (bottomType(g) === "jean" || /jean|denim|selvedge/.test(garmentBlob(g))),
      );
    case "denim":
      return pieces.some((g) => slotOf(g) === "bottom" && /denim|selvedge|\bjeans?\b/.test(garmentBlob(g)));
    case "cord":
      return pieces.some((g) => slotOf(g) === "bottom" && bottomType(g) === "cord");
    case "chino":
      return print.bottom_type === "chino" || print.bottom_type === "khaki";
    case "linen":
      return print.bottom_type === "linen" || (print.top_type === "linen_portofino");
    case "drawstring":
      return print.bottom_type === "drawstring";
    case "flannel":
      return print.bottom_type === "flannel" || /flannel/.test(blob);
    case "trouser":
      return print.bottom_type === "trouser" || print.bottom_type === "flannel";
    case "pleated dress trousers":
    case "pleated trousers":
      return pieces.some(
        (g) => /pleat/.test(garmentBlob(g)) && /trouser/.test(garmentBlob(g)) && bottomType(g) !== "jean",
      );
    case "penny loafer":
      return shoes.some((g) => shoeFamily(g) === "penny_loafer");
    case "tassel loafer":
      return /tassel/.test(blob) && /loafer/.test(blob);
    case "suede loafer":
      return shoes.some((g) => shoeFamily(g) === "suede_loafer");
    case "loafer":
      return shoes.some((g) => {
        const fam = shoeFamily(g);
        return fam === "penny_loafer" || fam === "suede_loafer";
      });
    case "driving mule":
      return shoes.some((g) => shoeFamily(g) === "driving_mule");
    case "boot":
      return shoes.some((g) => shoeFamily(g) === "boot");
    case "chelsea":
      return shoes.some((g) => shoeFamily(g) === "chelsea");
    case "990":
      return shoes.some((g) => shoeFamily(g) === "nb990");
    case "leather sneaker":
      return shoes.some((g) => shoeFamily(g) === "leather_sneaker");
    case "boat":
      return shoes.some((g) => shoeFamily(g) === "boat");
    case "white court":
    case "court sneaker":
      return shoes.some((g) => shoeFamily(g) === "white_court" || /court/.test(garmentBlob(g)));
    case "fashion sneaker":
      return shoes.some((g) => {
        const b = garmentBlob(g);
        if (!/sneaker/.test(b)) return false;
        if (/court|\b990\b|\bboot/.test(b)) return false;
        const fam = shoeFamily(g);
        return fam === "leather_sneaker" || fam === "suede_sneaker" || /fashion/.test(b);
      });
    case "not summer shoe":
      return print.shoe_family !== "summer_walk" && print.shoe_family !== "suede_loafer";
    case "summer walk":
      return shoes.some((g) => shoeFamily(g) === "summer_walk");
    case "derby":
      return shoes.some((g) => shoeFamily(g) === "derby");
    case "suede sneaker":
      return shoes.some((g) => shoeFamily(g) === "suede_sneaker");
    case "chore jacket":
    case "chore":
      return print.outer_attitude === "chore" || /\bchore\b/.test(outerBlob);
    case "denim jacket":
      return print.outer_attitude === "denim" || /denim jacket|trucker/.test(outerBlob);
    case "suede jacket":
      return print.outer_attitude === "suede" || (/suede|shearling/.test(outerBlob) && /jacket|coat/.test(outerBlob));
    case "field jacket":
    case "field":
      return print.outer_attitude === "field" || /\bfield\b/.test(outerBlob);
    case "navy blazer":
      return print.outer_attitude === "navy_blazer" || (/navy/.test(outerBlob) && /blazer/.test(outerBlob));
    case "blazer":
      return /blazer/.test(outerBlob);
    case "unconstructed":
      return print.outer_attitude === "unconstructed";
    case "no jacket":
      return print.outer_attitude === "none";
    case "overcoat":
      return print.outer_attitude === "overcoat" || /overcoat|topcoat/.test(outerBlob);
    case "camel jacket":
      return print.outer_attitude === "camel_jacket";
    case "cashmere":
      return print.top_type === "cashmere_top" || /cashmere/.test(blob);
    case "merino":
      return print.top_type === "merino";
    case "turtleneck":
      return print.top_type === "turtleneck";
    case "untucked":
      return print.tuck === "out";
    case "tucked oxford":
      return print.top_type === "oxford" && print.tuck === "in";
    case "camel":
    case "charcoal":
    case "loden":
    case "beige":
    case "ivory":
    case "tobacco":
    case "sand":
    case "cream":
    case "ocean":
      return new RegExp(`\\b${phrase}\\b`).test(blob);
    case "pink polo as the only top": {
      if (tops.length !== 1) return false;
      const only = tops[0]!;
      return topType(only) === "pique_polo" && /pink/.test(garmentBlob(only));
    }
    default:
      return new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(blob);
  }
}

function scoreProfile(
  pieces: Garment[],
  house: House,
  occasion: Occasion | undefined,
  print: LookPrint,
): { required: number; forbidden: number } {
  const profile = HOUSE_PROFILES[house];
  let required = 0;
  let forbidden = 0;
  for (const signal of profile.signals) {
    if (profilePhraseHits(pieces, signal, occasion, print)) required += 1;
  }
  for (const ban of profile.banned) {
    if (profilePhraseHits(pieces, ban, occasion, print)) forbidden += 1;
  }
  if (
    profile.anchors.length > 0 &&
    !profile.anchors.some((anchor) => profilePhraseHits(pieces, anchor, occasion, print))
  ) {
    forbidden += 1;
  }
  return { required, forbidden };
}

function hits(pieces: Garment[], house: House, occasion?: Occasion): { required: number; forbidden: number } {
  return scoreProfile(pieces, house, occasion, lookPrint(pieces, occasion));
}

function westernCount(pieces: Garment[]): number {
  return pieces.filter((g) => /western|cowboy|bolo|pearl\s*snap/.test(garmentBlob(g))).length;
}

function killWhen(when: string, pieces: Garment[], occasion: Occasion): boolean {
  const print = lookPrint(pieces, occasion);
  const top = topsOf(pieces)[0];
  const shoe = shoesOf(pieces)[0];
  const topB = top ? garmentBlob(top) : "";
  const shoeB = shoe ? garmentBlob(shoe) : "";
  const khaki = print.bottom_type === "khaki" || print.bottom_type === "chino";
  switch (when) {
    case "gym-sneaker":
      return Boolean(shoe && /990|jordan|\baj4\b|gym|runner/.test(shoeB));
    case "polo-default":
      return isPoloDefaultSilhouette(print);
    case "blue-ocbd":
      return (
        print.top_type === "oxford" &&
        /navy|blue/.test(topB) &&
        khaki &&
        print.shoe_family === "penny_loafer"
      );
    case "navy-polo-chino-boat":
      return (
        print.top_type === "pique_polo" &&
        khaki &&
        (print.shoe_family === "boat" || print.shoe_family === "penny_loafer")
      );
    case "faloni-twin":
      return (
        (print.top_type === "camp" || print.top_type === "linen_portofino") &&
        print.shoe_family === "driving_mule"
      );
    case "needs-sangallo-or-court":
      return (
        print.top_type !== "sangallo" &&
        print.top_type !== "serafino" &&
        print.top_type !== "bowling" &&
        print.top_type !== "light_cashmere_tee" &&
        print.shoe_family !== "white_court"
      );
    case "cable-jean-sneaker":
      return print.top_type === "cable" && print.bottom_type === "jean" && /sneaker/.test(shoeB);
    case "navy-blazer-chino-penny":
      return print.outer_attitude === "navy_blazer" && khaki && print.shoe_family === "penny_loafer";
    case "overcoat-tee-court":
      return print.outer_attitude === "overcoat" && print.shoe_family === "white_court" && print.top_type === "tee";
    case "rugby-blazer":
      return (
        pieces.some((g) => /rugby/.test(garmentBlob(g))) &&
        pieces.some((g) => /blazer/.test(garmentBlob(g)))
      );
    case "western-max":
      return westernCount(pieces) > 1;
    case "unless-summer-shoe":
      return print.shoe_family !== "summer_walk" && print.shoe_family !== "suede_loafer";
    default:
      return false;
  }
}

/** Kill rules live on the profile. The closet supplies which `when` applies. */
export function houseKill(pieces: Garment[], house: House, occasion: Occasion, _pool?: Garment[]): string | null {
  for (const kill of HOUSE_PROFILES[house].kills) {
    if (killWhen(kill.when, pieces, occasion)) return kill.message;
  }
  return null;
}

export function housePieceBanned(pieces: Garment[], house: House, occasion?: Occasion): boolean {
  return HOUSE_PROFILES[house].banned.some((ban) => profilePhraseHits(pieces, ban, occasion));
}

const fingerprintCache = new Map<string, boolean>();

export function houseFingerprintOk(
  pieces: Garment[],
  house: House,
  occasion: Occasion,
  pool?: Garment[],
): boolean {
  const key = `${house}|${occasion}|${pieces.map((p) => p.id).sort().join("\0")}`;
  const cached = fingerprintCache.get(key);
  if (cached !== undefined) return cached;
  const profile = HOUSE_PROFILES[house];
  const { required, forbidden } = hits(pieces, house, occasion);
  const ok =
    forbidden === 0 &&
    required >= profile.minSignals &&
    !houseKill(pieces, house, occasion, pool);
  if (fingerprintCache.size > 20000) fingerprintCache.clear();
  fingerprintCache.set(key, ok);
  return ok;
}

/** Hard row look: fingerprint, and every requireOwned token the closet actually has. */
export function isHardHouseLook(
  pieces: Garment[],
  house: House,
  occasion: Occasion,
  pool?: Garment[],
): boolean {
  if (!houseFingerprintOk(pieces, house, occasion, pool)) return false;
  const profile = HOUSE_PROFILES[house];
  const rack = pool ?? pieces;
  for (const token of profile.requireOwned) {
    if (!profilePhraseHits(rack, token, occasion)) return false;
    if (!profilePhraseHits(pieces, token, occasion)) return false;
  }
  return true;
}

export function stylistHouseBrief(house: House): string {
  const profile = HOUSE_PROFILES[house];
  return [
    `HOUSE ${HOUSE_LABEL[house]}`,
    `Signals: ${profile.signals.join("; ")}`,
    `Banned: ${profile.banned.join("; ")}`,
    `Jackets: ${profile.jackets.join(", ") || "none"}`,
    `Shoes: ${profile.shoes.join(", ")}`,
    profile.cardNote ? `Card: ${profile.cardNote}` : "",
    profile.gap ? `GAP: ${profile.gap}` : "",
  ]
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

/** Polo last. Never PoloDefault when another house claims the look. */
export function leadHouse(pieces: Garment[], occasion: Occasion = "weekday"): House {
  let best: House | null = null;
  let bestN = 0;
  for (const h of HOUSES) {
    if (h === "polo") continue;
    if (houseKill(pieces, h, occasion)) continue;
    const { required, forbidden } = hits(pieces, h, occasion);
    if (forbidden > 0 || required < HOUSE_PROFILES[h].minSignals) continue;
    if (required > bestN) {
      best = h;
      bestN = required;
    }
  }
  if (best) return best;
  return "polo";
}

const housesOfCache = new Map<string, House[]>();

export function housesOf(g: Garment): House[] {
  const key = `${g.id}|${g.name}|${g.subtype}|${g.notes ?? ""}|${g.colors.join(",")}|${g.material}`;
  const cached = housesOfCache.get(key);
  if (cached) return cached;
  const fake: Garment[] = [g];
  const print = lookPrint(fake);
  const out: House[] = [];
  for (const h of HOUSES) {
    const { required, forbidden } = scoreProfile(fake, h, undefined, print);
    if (forbidden === 0 && required >= 1) out.push(h);
  }
  if (housesOfCache.size > 4000) housesOfCache.clear();
  housesOfCache.set(key, out);
  return out;
}

export function lookHouses(pieces: Garment[], occasion: Occasion = "weekday"): House[] {
  const h = leadHouse(pieces, occasion);
  return [h];
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

export function houseGapNote(house: House, garments: Garment[], occasion?: Occasion): string | null {
  const profile = HOUSE_PROFILES[house];
  if (occasion === "weekday" && profile.occasionNote) return profile.occasionNote;
  for (const hole of profile.holes) {
    if (!profilePhraseHits(garments, hole.missing, occasion)) return hole.note;
  }
  return null;
}

export function houseLegalCombo(
  pieces: Garment[],
  house: House | "all" | undefined,
  occasion: Occasion,
  previous?: Garment[],
  pool?: Garment[],
): boolean {
  if (!house || house === "all") {
    const h = leadHouse(pieces, occasion);
    if (h !== "polo" && !houseFingerprintOk(pieces, h, occasion, pool)) {
      return houseFingerprintOk(pieces, "polo", occasion, pool);
    }
    return true;
  }
  if (!houseFingerprintOk(pieces, house, occasion, pool)) return false;
  if (previous && previous.length >= 3) {
    const a = lookPrint(previous, occasion);
    const b = lookPrint(pieces, occasion);
    if (axesDiffer(a, b) < 3) return false;
    if (house !== "polo" && axesDiffer(b, {
      top_type: "oxford",
      bottom_type: "chino",
      shoe_family: "penny_loafer",
      tuck: "in",
      palette_lane: "navy_blue",
      outer_attitude: "none",
    }) < 3) {
      return false;
    }
  }
  return true;
}

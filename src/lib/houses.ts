/**
 * Hard house fingerprints. Tokens from name/subtype/notes/colors — never a shop.
 * PoloDefault is last for All. A selected house never falls back to oxford+chino+penny.
 */
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

const POLO_TOP: TopType[] = ["oxford", "pique_polo", "cable"];
const POLO_SHOE: ShoeFamily[] = ["penny_loafer", "leather_sneaker", "boat"];

function hits(print: LookPrint, house: House, pool?: Garment[]): { required: number; forbidden: number } {
  let required = 0;
  let forbidden = 0;
  if (house === "polo") {
    if (POLO_TOP.includes(print.top_type)) required += 1;
    if (POLO_SHOE.includes(print.shoe_family)) required += 1;
    if (print.top_type === "oxford" && print.tuck === "in") required += 1;
    if (print.shoe_family === "nb990" || print.shoe_family === "driving_mule") forbidden += 1;
    if (print.top_type === "sangallo" || print.top_type === "fair_isle") forbidden += 1;
  }
  if (house === "purple") {
    if (print.top_type === "cashmere_top" || print.outer_attitude === "camel_jacket" || print.outer_attitude === "unconstructed") {
      required += 1;
    }
    if (print.shoe_family === "suede_loafer" || print.shoe_family === "chelsea") required += 1;
    if (print.palette_lane === "camel_charcoal_loden" || print.palette_lane === "beige_ivory_tobacco") {
      required += 1;
    }
    if (print.top_type === "rugby" || print.top_type === "fair_isle" || print.top_type === "sangallo") {
      forbidden += 1;
    }
    if (print.shoe_family === "nb990" || print.shoe_family === "boat") forbidden += 1;
    if (isPoloDefaultSilhouette(print)) forbidden += 1;
  }
  if (house === "rrl") {
    if (
      print.top_type === "work_shirt" ||
      print.bottom_type === "jean" ||
      print.outer_attitude === "chore" ||
      print.outer_attitude === "denim" ||
      print.outer_attitude === "suede" ||
      print.shoe_family === "boot"
    ) {
      required += 1;
    }
    if (print.bottom_type === "jean") required += 1;
    if (print.shoe_family === "boot") required += 1;
    if (print.shoe_family === "driving_mule" || print.shoe_family === "summer_walk") forbidden += 1;
    if (print.outer_attitude === "navy_blazer") forbidden += 1;
  }
  if (house === "ald") {
    if (print.top_type === "rugby" || print.top_type === "oversized_oxford") required += 1;
    if (print.shoe_family === "nb990") required += 1;
    if (print.tuck === "out") required += 1;
    if (print.bottom_type === "jean") required += 1;
    if (print.outer_attitude === "navy_blazer") forbidden += 1;
    if (print.top_type === "rugby" && print.shoe_family === "penny_loafer") forbidden += 1;
    if (print.shoe_family === "penny_loafer") forbidden += 1;
    if (print.shoe_family !== "nb990") {
      const has990 = (pool ?? []).some((g) => shoeFamily(g) === "nb990");
      const dad =
        print.shoe_family === "leather_sneaker" || print.shoe_family === "suede_sneaker";
      if (has990 || !pool?.length || !dad) forbidden += 1;
    }
  }
  if (house === "faloni") {
    if (
      print.top_type === "camp" ||
      print.top_type === "linen_portofino" ||
      print.top_type === "italian_knit_polo"
    ) {
      required += 1;
    }
    if (print.shoe_family === "driving_mule" || print.shoe_family === "suede_loafer") required += 1;
    if (print.tuck === "out") required += 1;
    if (print.palette_lane === "sand_cream_ocean" || print.palette_lane === "beige_ivory_tobacco") {
      required += 1;
    }
    if (print.shoe_family === "nb990") forbidden += 1;
    if (print.top_type === "rugby" || print.top_type === "fair_isle" || print.top_type === "sangallo") {
      forbidden += 1;
    }
    if (print.outer_attitude === "navy_blazer") forbidden += 1;
  }
  if (house === "fiveFourFive") {
    if (
      print.top_type === "sangallo" ||
      print.top_type === "serafino" ||
      print.top_type === "bowling" ||
      print.top_type === "light_cashmere_tee"
    ) {
      required += 1;
    }
    if (print.shoe_family === "white_court") required += 2;
    else if (print.shoe_family === "driving_mule" || print.shoe_family === "penny_loafer" || print.shoe_family === "suede_loafer") {
      required += 1;
    }
    if (print.tuck === "out") required += 1;
    if (print.top_type === "oxford") forbidden += 1;
    if (print.shoe_family === "nb990") forbidden += 1;
    if (print.top_type === "fair_isle" || print.top_type === "rugby") forbidden += 1;
    if (print.outer_attitude === "overcoat" || print.outer_attitude === "camel_jacket") forbidden += 1;
  }
  if (house === "sweetStable") {
    if (print.top_type === "fair_isle" || print.top_type === "gingham") required += 1;
    if (print.bottom_type === "cord") required += 1;
    if (print.shoe_family === "boot" || print.shoe_family === "suede_sneaker") required += 1;
    if (print.shoe_family === "driving_mule" || print.shoe_family === "nb990") forbidden += 1;
    if (print.top_type === "camp" || print.top_type === "sangallo") forbidden += 1;
  }
  if (house === "italianSummer") {
    if (print.shoe_family === "driving_mule" && print.outer_attitude === "none") forbidden += 1;
    if (print.shoe_family !== "summer_walk" && print.shoe_family !== "suede_loafer") forbidden += 1;
    if (print.shoe_family === "summer_walk" || print.shoe_family === "suede_loafer") required += 1;
    if (
      print.bottom_type === "chino" ||
      print.bottom_type === "linen" ||
      print.bottom_type === "drawstring"
    ) {
      required += 1;
    }
    if (print.outer_attitude === "unconstructed" || print.outer_attitude === "none") required += 1;
    if (
      print.palette_lane === "beige_ivory_tobacco" ||
      print.palette_lane === "sand_cream_ocean"
    ) {
      required += 1;
    }
    if (print.shoe_family === "nb990" || print.shoe_family === "boot") forbidden += 1;
    if (print.top_type === "rugby" || print.top_type === "fair_isle") forbidden += 1;
  }
  if (house === "italianWinter") {
    if (print.top_type === "merino" || print.top_type === "turtleneck") required += 1;
    if (print.bottom_type === "flannel" || print.bottom_type === "trouser") required += 1;
    if (
      print.shoe_family === "suede_loafer" ||
      print.shoe_family === "derby" ||
      print.shoe_family === "chelsea"
    ) {
      required += 1;
    }
    if (
      print.outer_attitude === "overcoat" ||
      print.outer_attitude === "suede" ||
      print.outer_attitude === "navy_blazer" ||
      print.outer_attitude === "unconstructed"
    ) {
      required += 1;
    }
    if (print.top_type === "camp" || print.bottom_type === "linen") forbidden += 1;
    if (print.shoe_family === "driving_mule" || print.shoe_family === "nb990" || print.shoe_family === "white_court") {
      forbidden += 1;
    }
    if (print.top_type === "fair_isle") forbidden += 1;
  }
  return { required, forbidden };
}

function westernCount(pieces: Garment[]): number {
  return pieces.filter((g) => /western|cowboy|bolo|pearl\s*snap/.test(garmentBlob(g))).length;
}

/** Kill rules 1–10. */
export function houseKill(pieces: Garment[], house: House, occasion: Occasion, pool?: Garment[]): string | null {
  const print = lookPrint(pieces, occasion);
  const top = topsOf(pieces)[0];
  const shoe = shoesOf(pieces)[0];
  const topB = top ? garmentBlob(top) : "";
  const khaki = print.bottom_type === "khaki" || print.bottom_type === "chino";
  const ocbdKhakiPenny =
    print.top_type === "oxford" &&
    /navy|blue/.test(topB) &&
    khaki &&
    print.shoe_family === "penny_loafer";

  if (house === "polo" && shoe && /990|jordan|\baj4\b|gym|runner/.test(garmentBlob(shoe))) {
    return "Polo is not a gym sneaker";
  }
  if (house !== "polo" && ocbdKhakiPenny) return "Non-Polo cannot be OCBD + khaki + penny";
  if (house === "ald") {
    const rugbyOrOver = print.top_type === "rugby" || print.top_type === "oversized_oxford";
    const has990 = (pool ?? []).some((g) => shoeFamily(g) === "nb990");
    const dad =
      print.shoe_family === "leather_sneaker" || print.shoe_family === "suede_sneaker";
    const shoeOk =
      print.shoe_family === "nb990" || ((!has990 && (pool?.length ?? 0) > 0) && dad);
    if (!(shoeOk && rugbyOrOver && print.tuck === "out")) {
      return "ALD needs 990 and rugby/oversized untuck";
    }
  }
  if (house === "faloni") {
    if (print.top_type === "pique_polo" && khaki && (print.shoe_family === "boat" || print.shoe_family === "penny_loafer")) {
      return "Faloni is not navy polo + chino + boat";
    }
  }
  if (house === "fiveFourFive") {
    const faloniTwin =
      (print.top_type === "camp" || print.top_type === "linen_portofino") &&
      print.shoe_family === "driving_mule";
    if (faloniTwin) return "545 cannot twin Faloni linen + mule";
    if (
      print.top_type !== "sangallo" &&
      print.top_type !== "serafino" &&
      print.top_type !== "bowling" &&
      print.top_type !== "light_cashmere_tee" &&
      print.shoe_family !== "white_court"
    ) {
      return "545 needs sangallo/serafino or white court";
    }
  }
  if (house === "italianSummer") {
    if (print.outer_attitude === "navy_blazer" && khaki && print.shoe_family === "penny_loafer") {
      return "Italian summer is not structured navy blazer + chino + penny";
    }
  }
  if (house === "sweetStable" && occasion === "weekday") return "Sweet Stable is weekend only";
  if (house === "purple") {
    if (print.top_type === "cable" && print.bottom_type === "jean" && /sneaker/.test(shoe ? garmentBlob(shoe) : "")) {
      return "Purple is not cable + jean + sneaker";
    }
  }
  if (house === "rrl") {
    const signal =
      print.top_type === "work_shirt" ||
      print.outer_attitude === "chore" ||
      print.shoe_family === "boot" ||
      /selvedge|indigo/.test(pieces.map(garmentBlob).join(" "));
    if (!signal) return "RRL needs work/indigo/chore/boot";
    if (westernCount(pieces) > 1) return "RRL max one western signal";
    if (isPoloDefaultSilhouette(print)) return "RRL is not Polo + darker jean";
  }
  if (house === "italianWinter") {
    if (print.outer_attitude === "overcoat" && print.shoe_family === "white_court" && print.top_type === "tee") {
      return "Italian winter overcoat is not white sneaker + tee";
    }
  }
  if (house !== "polo" && isPoloDefaultSilhouette(print)) {
    return "House switch cannot recolor PoloDefault";
  }
  return null;
}

export function houseFingerprintOk(
  pieces: Garment[],
  house: House,
  occasion: Occasion,
  pool?: Garment[],
): boolean {
  if (house === "sweetStable" && occasion === "weekday") return false;
  const print = lookPrint(pieces, occasion);
  const { required, forbidden } = hits(print, house, pool);
  if (forbidden > 0) return false;
  if (required < 2) return false;
  if (houseKill(pieces, house, occasion, pool)) return false;
  return true;
}

/** Polo last. Never PoloDefault when another house claims the look. */
export function leadHouse(pieces: Garment[], occasion: Occasion = "weekday"): House {
  const print = lookPrint(pieces, occasion);
  let best: House | null = null;
  let bestN = 0;
  for (const h of HOUSES) {
    if (h === "polo") continue;
    if (houseKill(pieces, h, occasion)) continue;
    const { required, forbidden } = hits(print, h, pieces);
    if (forbidden > 0 || required < 2) continue;
    if (required > bestN) {
      best = h;
      bestN = required;
    }
  }
  if (best) return best;
  return "polo";
}

export function housesOf(g: Garment): House[] {
  const fake: Garment[] = [g];
  const out: House[] = [];
  for (const h of HOUSES) {
    const print = lookPrint(fake);
    const { required, forbidden } = hits(print, h);
    if (forbidden === 0 && required >= 1) out.push(h);
  }
  return out.length ? out : [];
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

export function houseGapNote(house: House, garments: Garment[]): string | null {
  const shoes = garments.filter((g) => slotOf(g) === "footwear");
  const tops = garments.filter((g) => slotOf(g) === "top" || slotOf(g) === "dress");
  const outers = garments.filter((g) => slotOf(g) === "outerwear");
  if (house === "ald") {
    if (!shoes.some((g) => shoeFamily(g) === "nb990")) return "No 990s for ALD — dad sneaker";
    if (!tops.some((g) => topType(g) === "rugby" || topType(g) === "oversized_oxford")) {
      return "No rugby for ALD";
    }
  }
  if (house === "faloni") {
    if (!shoes.some((g) => shoeFamily(g) === "driving_mule" || shoeFamily(g) === "suede_loafer")) {
      return "No mule/suede loafer for Faloni";
    }
  }
  if (house === "fiveFourFive") {
    const sangallo = tops.some((g) => topType(g) === "sangallo" || topType(g) === "serafino");
    const court = shoes.some((g) => shoeFamily(g) === "white_court");
    if (!sangallo && !court) return "No sangallo or white court for 545";
  }
  if (house === "sweetStable") {
    if (!tops.some((g) => topType(g) === "fair_isle" || topType(g) === "gingham")) {
      return "No fair isle for Sweet Stable";
    }
  }
  if (house === "italianSummer") {
    if (!shoes.some((g) => shoeFamily(g) === "summer_walk" || shoeFamily(g) === "suede_loafer")) {
      return "No Summer Walk / suede loafer";
    }
  }
  if (house === "rrl") {
    if (
      !tops.some((g) => topType(g) === "work_shirt") &&
      !shoes.some((g) => shoeFamily(g) === "boot")
    ) {
      return "No work shirt/boot for RRL";
    }
  }
  if (house === "italianWinter") {
    const coat = outers.some((g) => /overcoat|topcoat/.test(garmentBlob(g)));
    if (!coat) return "No overcoat — shearling or blazer over merino";
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

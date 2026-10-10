/**
 * A lookbook cell is open only when this closet can dress it.
 * Keyword trips are not the predicate. Slots, gates, and isLegal are.
 */
import library from "./library.json" with { type: "json" };
import { comboKey, lookFitsOccasion } from "../lookbook.ts";
import { livePool } from "../rack.ts";
import { lookFitsSeason, seasonsOf, type Season } from "../season.ts";
import { slotOf } from "../style.ts";
import { DELETED_SNEAKERS, isLegal } from "../stylist/legal.ts";
import { jacketRequired } from "../stylist/jackets.ts";
import type { Garment, Look, Occasion } from "../types.ts";
import { todayISO } from "../utils.ts";
import { detectorColor } from "./palette.ts";
import { usualFromCloset } from "./usual.ts";

export const OCCASION_ORDER: Occasion[] = ["weekday", "out", "weekend", "travel", "comfy"];

const CAP = 4;
const BUCKET = 14;
const ATTEMPT_CAP = 4000;
const STORE_CAP = 24;
const DELETED = new Set<string>(DELETED_SNEAKERS);

type SlotName = "top" | "bottom" | "shoe" | "layer";
type Grade = "core" | "compatible" | "no";

type Cell = {
  id: string;
  key: string;
  title: string;
  required: string[];
  minCore: number;
  tonal: boolean;
  tuck: string;
  occasionOff: string[];
  seasonOff: string[];
  ban: string[];
  fails: string[];
  /** Pieces that make the way what its title says. At least `min` of these slots must hit. */
  anchors?: { min: number; any: Partial<Record<SlotName, string[]>> };
  slots: Record<SlotName, { core: string[]; compatible: string[] }>;
};

const CELLS = library.cells as Cell[];

export type CellContext = {
  occasion?: Occasion | string;
  season?: Season | string;
  color?: string | null;
  pool?: Garment[];
  weatherF?: number;
  /** visibleDetectors(pool, this context), when the caller already has it. */
  ways?: Way[];
};

export type Way = {
  id: string;
  title: string;
  pieces: Garment[];
  looks: Partial<Record<Occasion, Garment[][]>>;
  counts: Record<Occasion, number>;
  usual?: boolean;
  /** Why the fallback has no looks. Never a bare heading. */
  reason?: string;
};

type Built = {
  cell: Cell;
  looks: Record<Occasion, Garment[][]>;
};

const BOOKS = new Map<string, Built[]>();

function textOf(g: Garment): string {
  return `${g.name} ${g.subtype} ${g.material} ${g.notes ?? ""} ${(g.colors ?? []).join(" ")} ${g.fit ?? ""}`.toLowerCase();
}

function has(g: Garment, re: RegExp): boolean {
  return re.test(textOf(g));
}

function sneaker(g: Garment): boolean {
  return has(g, /sneaker|trainer/);
}

function loafer(g: Garment): boolean {
  return has(g, /loafer|\bpenny\b/);
}

function bootish(g: Garment): boolean {
  return has(g, /\bboots?\b|chelsea|chukka|roper/) && !sneaker(g);
}

function blazer(g: Garment): boolean {
  return has(g, /blazer|sport\s?coat/);
}

function suede(g: Garment): boolean {
  return /suede/.test((g.material ?? "").toLowerCase()) || has(g, /suede/);
}

function denimCloth(g: Garment): boolean {
  return has(g, /denim|\bjeans?\b|chambray|selvedge/);
}

function badSneaker(g: Garment): boolean {
  return has(g, /gym|runner|running|athletic|retro|chunky|dad|trail/);
}

function plainLoafer(g: Garment): boolean {
  return loafer(g) && !suede(g) && !has(g, /tassel|woven|bit/) && !sneaker(g);
}

function denimBottom(g: Garment): boolean {
  return has(g, /\bjeans?\b|denim|selvedge/) && !has(g, /jacket|shirt|trucker|overshirt/);
}

const PHRASE: Record<string, (g: Garment) => boolean> = {
  "denim chambray": (g) => has(g, /chambray/),
  "western snap": (g) => has(g, /western|pearl\s*snap|snap shirt/),
  "flannel check": (g) => has(g, /flannel/),
  henley: (g) => has(g, /henley|serafino/),
  "plain tee": (g) => has(g, /\btee\b|t-shirt|t shirt/) && !has(g, /graphic|logo/),
  "selvedge or raw": (g) => denimBottom(g) && has(g, /selvedge|raw|rigid/),
  "dark denim": (g) => denimBottom(g) && has(g, /dark|indigo|black|navy|raw|rinse/),
  denim: (g) => denimBottom(g),
  "work chino": (g) => has(g, /chino/) && has(g, /work|canvas|fatigue|carpenter|officer/),
  boot: (g) => bootish(g),
  chore: (g) => has(g, /chore/),
  waxed: (g) => has(g, /waxed/),
  "denim trucker": (g) => has(g, /trucker|denim jacket/),
  field: (g) => has(g, /field/),
  shearling: (g) => has(g, /shearling|sherpa/),
  plaid: (g) => has(g, /plaid/),
  "zip knit": (g) => has(g, /zip/) && has(g, /knit|sweater|quarter/),
  oxford: (g) => has(g, /oxford|button-down|button down|\bocbd\b/) && !blazer(g),
  cable: (g) => has(g, /\bcable\b/) && !blazer(g),
  rugby: (g) => has(g, /rugby/),
  "pique polo": (g) => has(g, /pique/) && has(g, /\bpolos?\b/),
  pique: (g) => has(g, /pique/),
  "solid crew": (g) => has(g, /crew/) && !has(g, /graphic|hoodie/),
  collegiate: (g) => has(g, /collegiate|letterman|varsity/),
  gingham: (g) => has(g, /gingham/),
  "knit polo": (g) => has(g, /\bpolos?\b/) && has(g, /knit|merino/),
  chino: (g) => has(g, /chino/) && !has(g, /cord/),
  "light trouser": (g) => has(g, /gurkha|trouser/) && !denimBottom(g),
  cord: (g) => has(g, /\bcords?\b|corduroy/) && !has(g, /jacket|blazer/),
  "penny or boat": (g) => has(g, /penny|boat/),
  "plain leather loafer": (g) => plainLoafer(g),
  tassel: (g) => has(g, /tassel/) && (loafer(g) || !sneaker(g)),
  "suede loafer": (g) => suede(g) && loafer(g),
  "clean leather sneaker": (g) => sneaker(g) && !suede(g) && !badSneaker(g),
  "navy blazer": (g) => blazer(g) && has(g, /navy/),
  "any blazer": (g) => blazer(g),
  cardigan: (g) => has(g, /cardigan/),
  "chore-weight": (g) => has(g, /chore/),
  varsity: (g) => has(g, /varsity|letterman/),
  "fair isle": (g) => has(g, /fair\s*isle|fairisle|fair-isle/),
  "country knit": (g) => has(g, /fair\s*isle|fairisle|shetland|country knit|aran/),
  chelsea: (g) => has(g, /chelsea/),
  chukka: (g) => has(g, /chukka/),
  suede: (g) => suede(g) && !sneaker(g),
  "plain loafer": (g) => plainLoafer(g),
  plain: (g) => plainLoafer(g) || (!has(g, /print|jacquard|paisley|graphic/) && !sneaker(g) && slotOf(g) === "bottom"),
  "dark suede sneaker": (g) => suede(g) && sneaker(g) && has(g, /dark|black|brown|navy/),
  "cord jacket": (g) => has(g, /cord/) && has(g, /jacket|blazer/),
  "spread-collar dress shirt": (g) => has(g, /spread[- ]collar/) && has(g, /shirt/) && !blazer(g),
  "fine knit": (g) => has(g, /fine knit|merino|cashmere/) && !has(g, /chunky|\bcable\b/) && !blazer(g),
  turtleneck: (g) => has(g, /turtleneck|roll neck|mock neck/),
  "suit trouser": (g) => has(g, /suit trouser|dress trouser|tuxedo trouser/),
  pinstripe: (g) => has(g, /pinstripe|chalkstripe/),
  tailored: (g) => has(g, /tailored|suit trouser|dress trouser/),
  wool: (g) => has(g, /wool/) && has(g, /trouser|pant/) && !blazer(g),
  "calf dress": (g) => has(g, /calf/) && !sneaker(g),
  "polished loafer": (g) => loafer(g) && !suede(g),
  "suit jacket": (g) => has(g, /suit/) && has(g, /jacket/),
  "four-bar trim": (g) => has(g, /four[- ]bar|4-bar/),
  polo: (g) => has(g, /\bpolos?\b/) && !has(g, /graphic/),
  "cropped trouser": (g) => has(g, /crop/) && has(g, /trouser/),
  "grey wool": (g) => has(g, /grey|gray/) && has(g, /wool/) && has(g, /trouser|pant|suit/),
  brogue: (g) => has(g, /brogue/),
  polished: (g) => loafer(g) && !suede(g),
  calf: (g) => has(g, /calf/) && !sneaker(g),
  "short narrow jacket": (g) => has(g, /short|cropped|shrunken|narrow/) && has(g, /jacket/),
  "linen shirt": (g) => has(g, /linen/) && has(g, /shirt|camp|top/) && !blazer(g) && slotOf(g) !== "bottom",
  "short-sleeve knit polo": (g) => has(g, /\bpolos?\b/) && has(g, /knit/) && has(g, /short/),
  camp: (g) => has(g, /\bcamp\b/),
  resort: (g) => has(g, /resort|\bcamp\b/),
  linen: (g) => has(g, /linen/) && !blazer(g),
  pleated: (g) => has(g, /pleat/),
  "light or ecru denim": (g) => denimBottom(g) && has(g, /light|ecru|cream|white/),
  woven: (g) => has(g, /woven/) && !sneaker(g),
  mule: (g) => has(g, /mule/),
  "suede jacket or bomber": (g) => suede(g) && has(g, /jacket|bomber/),
  unstructured: (g) => has(g, /unstructured/),
  casual: (g) => has(g, /\bcasual\b/),
  "wide or regular denim": (g) => denimBottom(g) && !has(g, /skinny/),
  "relaxed or dark trouser": (g) => {
    const said = `${g.name} ${g.subtype} ${g.material}`.toLowerCase();
    return /trouser/.test(said) && /relaxed|dark|black|navy|charcoal/.test(said) && !/pleat/.test(said);
  },
  "plain leather or woven loafer": (g) => plainLoafer(g) || (has(g, /woven/) && loafer(g)),
  leather: (g) => has(g, /leather/) && has(g, /jacket|bomber/) && !loafer(g) && !sneaker(g),
  "flannel trouser": (g) => has(g, /flannel/) && has(g, /trouser|pant/),
  "dark suede": (g) => suede(g) && !sneaker(g) && has(g, /dark|black|brown|navy/),
  "spread collar": (g) => has(g, /spread[- ]collar/),
  "soft wool blazer": (g) => blazer(g) && has(g, /wool/) && has(g, /soft|unstructured/),
  overcoat: (g) => has(g, /overcoat|topcoat|long coat/),
  "plain sweatshirt": (g) => has(g, /sweatshirt/) && !has(g, /graphic|logo/),
  overshirt: (g) => has(g, /overshirt/),
  "straight jean": (g) => denimBottom(g) && !has(g, /wide|flare|bootcut|skinny/),
  "suede sneaker": (g) => suede(g) && sneaker(g),
  "any loafer": (g) => loafer(g),
  "any sneaker": (g) => sneaker(g),
  "wool jacket": (g) => has(g, /wool/) && has(g, /jacket/) && !blazer(g),
  trucker: (g) => has(g, /trucker/),
  fleece: (g) => has(g, /fleece/),
  boxy: (g) => has(g, /boxy|dropped shoulder/),
  "relaxed oxford": (g) => has(g, /oxford/) && has(g, /relaxed/) && !blazer(g),
  "gradient knit": (g) => has(g, /gradient/) && has(g, /knit|sweater/),
  "wide pleated": (g) => has(g, /pleat/) && has(g, /wide|trouser|pant/),
  "minimal derby": (g) => has(g, /derby/),
  derby: (g) => has(g, /derby/),
  "oversized blazer": (g) => blazer(g) && has(g, /oversized|boxy/),
  pattern: (g) => has(g, /print|jacquard|paisley|pattern/),
  "rich texture": (g) => has(g, /jacquard|boucl[eé]|embroider|texture/),
  "soft blazer": (g) => blazer(g) && has(g, /soft|unstructured|cord|linen|cotton/),
  graphic: (g) => has(g, /graphic|logo/),
  hoodie: (g) => has(g, /hoodie/),
  "track jacket": (g) => has(g, /track/) && has(g, /jacket/),
  sweatshirt: (g) => has(g, /sweatshirt/),
  "nylon short": (g) => has(g, /short/) && has(g, /nylon|track/),
  "track pant": (g) => has(g, /track/) && has(g, /pant|trouser|jogger/),
  "retro or athletic sneaker": (g) => sneaker(g) && (badSneaker(g) || has(g, /retro|vintage|athletic/)),
  track: (g) => has(g, /track/),
  "suede bomber": (g) => suede(g) && has(g, /bomber/),
  "washed tee": (g) => has(g, /washed|faded/) && has(g, /\btee\b|t-shirt/) && !has(g, /graphic/),
  "suede overshirt": (g) => suede(g) && has(g, /overshirt/),
  "washed black jean": (g) => denimBottom(g) && has(g, /black/) && has(g, /washed|faded|worn/),
  distressed: (g) => has(g, /distressed|frayed|ripped/),
  "worn suede sneaker": (g) => suede(g) && sneaker(g) && has(g, /worn|washed|faded|distressed/),
  "suede jacket or overshirt": (g) => suede(g) && has(g, /jacket|overshirt|bomber/),
  bomber: (g) => has(g, /bomber/),
  "technical relaxed pant": (g) => has(g, /technical|nylon|hiking/) && has(g, /pant|trouser/),
  trail: (g) => has(g, /trail/) && sneaker(g),
  technical: (g) => has(g, /technical/),
  vest: (g) => has(g, /\bvest\b|gilet/),
};

function matchPhrase(g: Garment, phrase: string, slot: SlotName): boolean {
  if (slot === "top" && blazer(g)) return false;
  if (slot === "shoe" && phrase === "suede") return suede(g) && !sneaker(g);
  if (slot === "shoe" && phrase === "plain") return plainLoafer(g);
  if (slot === "bottom" && phrase === "plain") return !has(g, /print|jacquard|paisley|graphic/);
  if (slot === "layer" && phrase === "suede") return suede(g) && has(g, /jacket|bomber|overshirt|field/);
  if (slot === "layer" && phrase === "leather") return has(g, /leather/) && has(g, /jacket|bomber/);
  const fn = PHRASE[phrase];
  if (fn) return fn(g);
  const alts = phrase.split(/\s+or\s+/);
  return alts.some((part) => {
    const words = part.split(/\s+/).filter((w) => w.length > 2 && w !== "and" && w !== "the");
    return words.length > 0 && words.every((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i").test(textOf(g)));
  });
}

function grade(cell: Cell, g: Garment, slot: SlotName): Grade {
  const spec = cell.slots[slot];
  if (!spec) return "no";
  if (spec.core.some((phrase) => matchPhrase(g, phrase, slot))) return "core";
  if (spec.compatible.some((phrase) => matchPhrase(g, phrase, slot))) return "compatible";
  return "no";
}

function familyOf(g: Garment): string {
  const c = (g.colors?.[0] ?? "").toLowerCase();
  if (!c) return "";
  if (/navy|blue|indigo/.test(c)) return "blue";
  if (/black/.test(c)) return "black";
  if (/white|cream|ivory|oat|sand|stone|beige|khaki|taupe/.test(c)) return "cream";
  if (/grey|gray|charcoal/.test(c)) return "grey";
  if (/brown|tan|rust/.test(c)) return "brown";
  if (/green|olive|sage/.test(c)) return "green";
  if (/red|burgundy|wine|maroon/.test(c)) return "red";
  if (/pink/.test(c)) return "pink";
  return c;
}

function tonalOk(pieces: Garment[]): boolean {
  const fams = pieces.map(familyOf);
  if (fams.some((f) => !f)) return false;
  return new Set(fams).size === 1;
}

function chunkyCable(g: Garment): boolean {
  return has(g, /\bcable\b|chunky/) && (has(g, /chunky|heavy/) || (g.warmth ?? 0) >= 4 || has(g, /knit|sweater/));
}

function globalFail(cell: Cell, pieces: Garment[]): boolean {
  if (pieces.some((g) => has(g, /linen/)) && pieces.some((g) => has(g, /flannel/))) return true;
  if (pieces.some(blazer) && pieces.some(chunkyCable)) return true;
  const blackTrouser = pieces.some(
    (g) => slotOf(g) === "bottom" && has(g, /black/) && has(g, /trouser/) && !denimBottom(g),
  );
  const brownShoe = pieces.some((g) => slotOf(g) === "footwear" && has(g, /brown|tan/) && !has(g, /black/));
  if (blackTrouser && brownShoe) return true;
  if (cell.key !== "western_work" && pieces.filter(denimCloth).length >= 2) return true;
  const wantsIn =
    cell.tuck === "in" || cell.tuck === "full" || cell.tuck === "shirt_in_camp_out" || cell.tuck === "shirt_in_knit_out";
  for (const g of pieces) {
    const camp = has(g, /\bcamp\b/);
    const knitPolo = has(g, /polo/) && has(g, /knit/);
    const shirt = has(g, /shirt|oxford/) && !camp && !blazer(g);
    if (camp && g.tuck === "in") return true;
    if (g.tuck !== "out" || !wantsIn) continue;
    if (knitPolo && cell.tuck === "shirt_in_knit_out") continue;
    if (camp && (cell.tuck === "shirt_in_camp_out" || cell.tuck === "out")) continue;
    if (shirt || knitPolo) return true;
  }
  return false;
}

function cellFail(cell: Cell, pieces: Garment[]): boolean {
  if (cell.ban.some((id) => pieces.some((g) => g.id === id))) return true;
  const blob = pieces.map(textOf).join(" | ");
  const fail = new Set(cell.fails);
  const poloPink = /polo/.test(blob) && /pink/.test(blob) && /white/.test(blob) && /sneaker/.test(blob);
  const graphic = /graphic|hoodie/.test(blob);
  const coat = /blazer|sport coat|sportcoat/.test(blob);
  if (fail.has("WW-F1") && poloPink) return true;
  if (fail.has("IV-F1") && graphic && coat) return true;
  if (fail.has("CS-F1") && /cord/.test(blob) && (/linen/.test(blob) || /\bcamp\b/.test(blob))) return true;
  if (fail.has("GF-F1") && /suit trouser|dress trouser/.test(blob) && /sneaker/.test(blob)) return true;
  if (
    fail.has("SS-F1") &&
    /crop/.test(blob) &&
    /trouser/.test(blob) &&
    (/chunky|dad sneaker|platform/.test(blob) || /overcoat|topcoat|long coat/.test(blob))
  ) {
    return true;
  }
  if (fail.has("FK-F1") && /\bcamp\b/.test(blob) && (coat || /\bboots?\b/.test(blob))) return true;
  if (fail.has("HD-F1") && /pastel|lavender|lilac|mint|peach|\bpink\b|graphic|print|paisley/.test(blob)) return true;
  if (fail.has("LS-F1") && /linen/.test(blob) && (/flannel|\bcords?\b|corduroy|\bboots?\b/.test(blob))) return true;
  if (fail.has("FC-F1") && /cable|chunky/.test(blob) && coat) return true;
  if (fail.has("FC-F2") && (/puffer/.test(blob) || /gym|running shoe|runner/.test(blob))) return true;
  if (fail.has("CC-F1") && /western belt|trophy buckle/.test(blob) && /roper/.test(blob)) return true;
  if (fail.has("BT-F1") && /athletic|running sneaker|\brunner\b/.test(blob) && /pleat/.test(blob)) return true;
  if (fail.has("PP-F1")) {
    const printed = pieces.filter((g) => /print|jacquard|paisley/.test(textOf(g)));
    if (printed.length >= 2) return true;
    if (printed.length === 1 && /graphic/.test(blob)) return true;
  }
  if (fail.has("GS-F1") && graphic && coat) return true;
  if (fail.has("GS-F2") && /graphic/.test(blob) && /cashmere/.test(blob)) return true;
  if (fail.has("WP-F1") && /dress shirt/.test(blob) && /\btie\b/.test(blob) && /jean/.test(blob)) return true;
  if (fail.has("SO-F1") && /fleece/.test(blob) && (/dress shirt|oxford|button-down|blazer|sport coat/.test(blob))) return true;
  return false;
}

export function cellGateOpen(keyOrId: string, occasion: string, season: string): boolean {
  const cell = CELLS.find((row) => row.key === keyOrId || row.id === keyOrId);
  if (!cell) return false;
  if (cell.seasonOff.includes(season)) return false;
  if (cell.occasionOff.includes(occasion)) return false;
  return true;
}

type Dressed = { top: Garment; bottom: Garment; shoe: Garment; layer?: Garment };

function anchorHits(cell: Cell, pieces: Dressed): number {
  let hits = 0;
  for (const slot of ["top", "bottom", "shoe", "layer"] as const) {
    const g = pieces[slot];
    const phrases = cell.anchors?.any[slot];
    if (g && phrases?.some((phrase) => matchPhrase(g, phrase, slot))) hits += 1;
  }
  return hits;
}

/** A bare core may wait on the layer anchor. Nothing else is ever owed. */
function layerOwed(cell: Cell): number {
  return cell.anchors?.any.layer?.length ? 1 : 0;
}

function slotGradeOk(cell: Cell, pieces: Dressed, owed = 0): boolean {
  if (cell.anchors && anchorHits(cell, pieces) < cell.anchors.min - owed) return false;
  const slots: [SlotName, Garment | undefined][] = [
    ["top", pieces.top],
    ["bottom", pieces.bottom],
    ["shoe", pieces.shoe],
    ["layer", pieces.layer],
  ];
  let cores = 0;
  for (const [slot, g] of slots) {
    if (!g) continue;
    const gde = grade(cell, g, slot);
    if (gde === "no") return false;
    if (slot !== "layer" && gde === "core") cores += 1;
    if (cell.required.includes(slot) && gde !== "core") return false;
    if (slot === "layer" && cell.slots.layer.core.length === 0 && gde !== "compatible") return false;
  }
  if (cores < cell.minCore) return false;
  const all = [pieces.top, pieces.bottom, pieces.shoe, pieces.layer].filter((g): g is Garment => Boolean(g));
  if (cell.tonal && !tonalOk(all)) return false;
  return true;
}

function seasonOk(pieces: Garment[], season: Season): boolean {
  if (!pieces.every((g) => seasonsOf(g).includes(season))) return false;
  return lookFitsSeason(pieces, season);
}

const LEGAL = new Map<string, boolean>();

function finiteTemp(n: unknown): number | undefined {
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function legalOk(pieces: Garment[], occasion: string, season: string, weatherF?: number): boolean {
  const temp = finiteTemp(weatherF);
  const key = `${occasion}|${season}|${temp ?? ""}|${pieces.map((g) => g.id).sort().join(",")}`;
  const hit = LEGAL.get(key);
  if (hit !== undefined) return hit;
  const ok = isLegal(pieces, {
    house: null,
    occasion,
    season,
    ...(temp !== undefined ? { weatherF: temp } : {}),
  });
  LEGAL.set(key, ok);
  return ok;
}

function passesCheap(
  cell: Cell,
  pieces: Garment[],
  occasion: string,
  season: Season,
  pool: Garment[],
  owed = 0,
): boolean {
  if (pieces.some((g) => DELETED.has(g.id))) return false;
  const top = pieces.find((g) => slotRole(g, cell) === "top");
  const bottom = pieces.find((g) => slotOf(g) === "bottom");
  const shoe = pieces.find((g) => slotOf(g) === "footwear");
  const layer = pieces.find((g) => g !== top && layerRole(g, cell));
  if (!top || !bottom || !shoe) return false;
  if (new Set(pieces.map((g) => g.id)).size !== pieces.length) return false;
  if (!slotGradeOk(cell, { top, bottom, shoe, layer }, owed)) return false;
  if (globalFail(cell, pieces) || cellFail(cell, pieces)) return false;
  if (!lookFitsOccasion(pieces, occasion, pool, undefined)) return false;
  if (!seasonOk(pieces, season)) return false;
  return true;
}

function slotRole(g: Garment, cell: Cell): "top" | "other" {
  const s = slotOf(g);
  if (s === "top" || s === "dress") return grade(cell, g, "top") === "no" ? "other" : "top";
  if (s === "outerwear" && !blazer(g) && grade(cell, g, "top") !== "no") return "top";
  return "other";
}

function layerRole(g: Garment, cell: Cell): boolean {
  if (slotOf(g) === "footwear" || slotOf(g) === "bottom") return false;
  if (slotOf(g) !== "outerwear" && !blazer(g) && !has(g, /jacket|bomber|vest|fleece|overshirt/)) return false;
  return grade(cell, g, "layer") !== "no";
}

function takeBucket(list: { g: Garment; grade: Grade }[]): Garment[] {
  const cores = list.filter((row) => row.grade === "core").map((row) => row.g);
  const compat = list.filter((row) => row.grade === "compatible").map((row) => row.g);
  const room = Math.max(BUCKET, cores.length);
  return [...cores, ...compat].slice(0, room);
}

function idsOf(look: Garment[]): string {
  return look.map((g) => g.id).join("|");
}

export function maxDisjoint(looks: Garment[][]): Garment[][] {
  const greedy: Garment[][] = [];
  const used = new Set<string>();
  for (const look of looks) {
    if (look.some((g) => used.has(g.id))) continue;
    for (const g of look) used.add(g.id);
    greedy.push(look);
    if (greedy.length >= 5) return greedy;
  }
  if (greedy.length >= 3) return greedy;
  let best = greedy;
  const seen = new Set<string>();
  const acc: Garment[][] = [];
  const walk = (start: number) => {
    if (acc.length > best.length) best = acc.slice();
    if (best.length >= 5) return;
    for (let i = start; i < looks.length; i += 1) {
      if (acc.length + (looks.length - i) <= best.length) return;
      const look = looks[i]!;
      if (look.some((g) => seen.has(g.id))) continue;
      for (const g of look) seen.add(g.id);
      acc.push(look);
      walk(i + 1);
      acc.pop();
      for (const g of look) seen.delete(g.id);
      if (best.length >= 5) return;
    }
  };
  walk(0);
  return best.slice(0, 5);
}

function dressCell(cell: Cell, pool: Garment[], occasion: Occasion, season: Season, weatherF?: number): Garment[][] {
  if (!cellGateOpen(cell.key, occasion, season)) return [];
  const tops = takeBucket(
    pool
      .filter((g) => slotRole(g, cell) === "top")
      .map((g) => ({ g, grade: grade(cell, g, "top") }))
      .filter((row) => row.grade !== "no"),
  );
  const bottoms = takeBucket(
    pool
      .filter((g) => slotOf(g) === "bottom")
      .map((g) => ({ g, grade: grade(cell, g, "bottom") }))
      .filter((row) => row.grade !== "no"),
  );
  const shoes = takeBucket(
    pool
      .filter((g) => slotOf(g) === "footwear")
      .map((g) => ({ g, grade: grade(cell, g, "shoe") }))
      .filter((row) => row.grade !== "no"),
  );
  const layers = takeBucket(
    pool
      .filter((g) => layerRole(g, cell))
      .map((g) => ({ g, grade: grade(cell, g, "layer") }))
      .filter((row) => row.grade !== "no"),
  );
  const cores: Garment[][] = [];
  const seen = new Set<string>();
  let attempts = 0;
  const n = Math.max(tops.length, bottoms.length, shoes.length, 1);
  for (let k = 0; k < n && attempts < ATTEMPT_CAP && cores.length < 80; k += 1) {
    for (let i = 0; i < tops.length && attempts < ATTEMPT_CAP && cores.length < 80; i += 1) {
      const top = tops[i]!;
      const bottom = bottoms[(i + k) % bottoms.length];
      const shoe = shoes[(i + 2 * k) % shoes.length];
      if (!bottom || !shoe) continue;
      const pieces = [top, bottom, shoe];
      const key = idsOf(pieces);
      if (seen.has(key)) continue;
      seen.add(key);
      attempts += 1;
      if (!passesCheap(cell, pieces, occasion, season, pool, layerOwed(cell))) continue;
      cores.push(pieces);
    }
  }
  const stored: Garment[][] = [];
  const needJacket = jacketRequired(occasion, season, finiteTemp(weatherF));
  const remember = (pieces: Garment[]) => {
    if (stored.length >= STORE_CAP) return;
    if (stored.some((row) => idsOf(row) === idsOf(pieces))) return;
    if (!legalOk(pieces, occasion, season, weatherF)) return;
    stored.push(pieces);
  };
  for (const core of cores) {
    if (stored.length >= STORE_CAP && maxDisjoint(stored).length >= 5) break;
    const [top, bottom, shoe] = core as [Garment, Garment, Garment];
    const anchored = !cell.anchors || anchorHits(cell, { top, bottom, shoe }) >= cell.anchors.min;
    if (!needJacket && anchored) remember(core);
    for (const layer of layers) {
      if (core.some((g) => g.id === layer.id)) continue;
      const pieces = [...core, layer];
      if (!passesCheap(cell, pieces, occasion, season, pool)) continue;
      remember(pieces);
      if (stored.length >= STORE_CAP && maxDisjoint(stored).length >= 5) break;
    }
  }
  return stored;
}

function stampOf(garments: Garment[], season: string): string {
  const body = garments
    .map((g) =>
      [
        g.id,
        g.name,
        g.category,
        g.subtype,
        g.material,
        g.archived ? "1" : "0",
        g.tuck ?? "",
        (g.colors ?? []).join("."),
        (g.seasons ?? []).join("."),
      ].join(":"),
    )
    .sort()
    .join("|");
  return `${season}|${body}`;
}

export function warmCellBook(garments: Garment[], season: Season, weatherF?: number): Built[] {
  const live = livePool(garments).filter((g) => !DELETED.has(g.id));
  const temp = finiteTemp(weatherF);
  const stamp = `${stampOf(live, season)}|${temp ?? ""}`;
  const hit = BOOKS.get(stamp);
  if (hit) return hit;
  const built = CELLS.map((cell) => {
    const looks = {
      weekday: [],
      out: [],
      weekend: [],
      travel: [],
      comfy: [],
    } as Record<Occasion, Garment[][]>;
    for (const occasion of OCCASION_ORDER) looks[occasion] = dressCell(cell, live, occasion, season, temp);
    return { cell, looks };
  });
  BOOKS.set(stamp, built);
  if (BOOKS.size > 8) {
    const first = BOOKS.keys().next().value;
    if (first) BOOKS.delete(first);
  }
  return built;
}

function countsFor(built: Built, color: string | null): Record<Occasion, number> {
  const counts = { weekday: 0, out: 0, weekend: 0, travel: 0, comfy: 0 };
  for (const occasion of OCCASION_ORDER) {
    if (!cellGateOpen(built.cell.key, occasion, "")) {
      /* season gate is applied by an empty list already */
    }
    let rows = built.looks[occasion];
    if (color) rows = rows.filter((look) => detectorColor(look, color, built.cell.key).passed);
    counts[occasion] = maxDisjoint(rows).length;
  }
  return counts;
}

function openOccasions(cell: Cell, season: string): Occasion[] {
  return OCCASION_ORDER.filter((occasion) => cellGateOpen(cell.key, occasion, season));
}

function rankOf(built: Built, season: string, color: string | null) {
  const counts = countsFor(built, color);
  const open = openOccasions(built.cell, season);
  const cleared = open.filter((occasion) => counts[occasion] >= 3);
  const weakest = cleared.length ? Math.min(...cleared.map((occasion) => counts[occasion])) : 0;
  const pooled = open.reduce((sum, occasion) => sum + counts[occasion], 0);
  const cores = new Set<string>();
  for (const occasion of open) {
    let rows = built.looks[occasion];
    if (color) rows = rows.filter((look) => detectorColor(look, color, built.cell.key).passed);
    for (const look of rows) {
      const top = look.find((g) => slotOf(g) !== "bottom" && slotOf(g) !== "footwear" && slotOf(g) !== "outerwear") ?? look[0];
      const bottom = look.find((g) => slotOf(g) === "bottom");
      const shoe = look.find((g) => slotOf(g) === "footwear");
      if (top && bottom && shoe) cores.add(`${top.id}|${bottom.id}|${shoe.id}`);
    }
  }
  return {
    counts,
    cleared: cleared.length,
    ratio: open.length ? cleared.length / open.length : 0,
    weakest,
    pooled,
    cores: cores.size,
  };
}

function toWay(built: Built, season: string, color: string | null, usual: boolean): Way {
  const counts = countsFor(built, color);
  const looks: Partial<Record<Occasion, Garment[][]>> = {};
  for (const occasion of OCCASION_ORDER) {
    let rows = built.looks[occasion];
    if (!usual && color) rows = rows.filter((look) => detectorColor(look, color, built.cell.key).passed);
    const cap = usual ? 3 : 5;
    const set = maxDisjoint(rows).slice(0, cap);
    if (set.length) looks[occasion] = set;
  }
  const first = OCCASION_ORDER.flatMap((occasion) => looks[occasion] ?? [])[0] ?? [];
  return { id: built.cell.id, title: built.cell.title, pieces: first, looks, counts, usual };
}

function emptyCounts(): Record<Occasion, number> {
  return { weekday: 0, out: 0, weekend: 0, travel: 0, comfy: 0 };
}

function yourUsual(garments: Garment[], season: string, occasion: Occasion, weatherF?: number): Way[] {
  const built = usualFromCloset(garments, { occasion, season, weatherF });
  const counts = emptyCounts();
  counts[occasion] = built.looks.length;
  const looks: Partial<Record<Occasion, Garment[][]>> = {};
  if (built.looks.length) looks[occasion] = built.looks.slice(0, 3);
  return [
    {
      id: "usual",
      title: "Your usual",
      pieces: built.looks[0] ?? [],
      looks,
      counts,
      usual: true,
      ...(built.looks.length ? {} : { reason: built.reason }),
    },
  ];
}

/** Most looks a Lookbook row shows. Display only: toWay/yourUsual and the snapshot keep their caps. */
export const ROW_MAX = 8;

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededPermutation<T>(rows: readonly T[], seed: number): T[] {
  const out = [...rows];
  const rnd = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function sharedPieces(a: Garment[], b: Garment[]): number {
  const ids = new Set(a.map((g) => g.id));
  return b.filter((g) => ids.has(g.id)).length;
}

/**
 * Fill a row to ROW_MAX from the stored rows, in order: first rows that share at most one
 * piece with everything already in the set, then any unused row. Never a new combination.
 */
function fillRow(start: Garment[][], stored: Garment[][]): Garment[][] {
  const out = start.slice(0, ROW_MAX);
  const used = new Set(out.map(idsOf));
  const left = stored.filter((row) => !used.has(idsOf(row)));
  for (const row of left) {
    if (out.length >= ROW_MAX) break;
    if (used.has(idsOf(row))) continue;
    if (out.every((have) => sharedPieces(have, row) <= 1)) {
      used.add(idsOf(row));
      out.push(row);
    }
  }
  for (const row of left) {
    if (out.length >= ROW_MAX) break;
    if (used.has(idsOf(row))) continue;
    used.add(idsOf(row));
    out.push(row);
  }
  return out;
}

/**
 * The rows the Lookbook renders: each way's looks for this occasion, up to ROW_MAX, drawn only
 * from the cell's stored (already legal, same colour filter) rows. Salt 0 starts from the
 * way's current looks in order, so the first cards are exactly visibleDetectors'; a salt > 0
 * is a seeded permutation of the stored rows before the disjoint pick and the fill. The usual
 * way asks usualFromCloset for more with the same legality gate.
 */
export function rowWays(
  ways: Way[],
  garments: Garment[],
  ctx: { occasion: Occasion | string; season: Season | string; color?: string | null; weatherF?: number; salt?: number },
): Way[] {
  const occasion = (ctx.occasion || "weekday") as Occasion;
  const season = (ctx.season || "fall") as Season;
  const color = ctx.color ?? null;
  const weatherF = finiteTemp(ctx.weatherF);
  const salt = ctx.salt ?? 0;
  const book = warmCellBook(garments, season, weatherF);
  return ways.map((way) => {
    if (way.usual) {
      if (!(way.looks[occasion] ?? []).length) return way;
      const built = usualFromCloset(garments, { occasion, season, weatherF, max: ROW_MAX, salt });
      if (!built.looks.length) return way;
      return {
        ...way,
        looks: { ...way.looks, [occasion]: built.looks.slice(0, ROW_MAX) },
        counts: { ...way.counts, [occasion]: built.looks.length },
      };
    }
    const built = book.find((row) => row.cell.id === way.id);
    if (!built) return way;
    let stored = built.looks[occasion] ?? [];
    if (color) stored = stored.filter((look) => detectorColor(look, color, built.cell.key).passed);
    if (!stored.length) return way;
    const keys = new Set(stored.map(idsOf));
    const current = (way.looks[occasion] ?? []).filter((look) => keys.has(idsOf(look)));
    const pool = salt > 0 ? seededPermutation(stored, (salt ^ hashStr(way.id)) >>> 0) : stored;
    const start = salt > 0 ? maxDisjoint(pool) : current;
    const looks = fillRow(start, pool);
    if (!looks.length) return way;
    return { ...way, looks: { ...way.looks, [occasion]: looks } };
  });
}

export function visibleDetectors(
  garments: Garment[],
  ctx: { occasion?: Occasion | string; season?: Season | string; color?: string | null; weatherF?: number } = {},
): Way[] {
  const season = (ctx.season || "fall") as Season;
  const color = ctx.color ?? null;
  const weatherF = finiteTemp(ctx.weatherF);
  const occasion = (ctx.occasion || undefined) as Occasion | undefined;
  const book = warmCellBook(garments, season, weatherF);
  const ranked = book
    .map((built) => ({ built, rank: rankOf(built, season, color) }))
    .filter((row) => (occasion ? (row.rank.counts[occasion] ?? 0) >= 1 : row.rank.cleared > 0))
    .sort((a, b) => {
      if (occasion) {
        const onScreen = (b.rank.counts[occasion] ?? 0) - (a.rank.counts[occasion] ?? 0);
        if (onScreen) return onScreen;
      }
      return (
        b.rank.cleared - a.rank.cleared ||
        b.rank.ratio - a.rank.ratio ||
        b.rank.weakest - a.rank.weakest ||
        b.rank.pooled - a.rank.pooled ||
        b.rank.cores - a.rank.cores ||
        a.built.cell.id.localeCompare(b.built.cell.id, undefined, { numeric: true })
      );
    });
  if (!ranked.length) return yourUsual(garments, season, occasion ?? "weekday", weatherF);
  return ranked.slice(0, CAP).map((row) => toWay(row.built, season, color, false));
}

export function cellLooks(detector: string, garments: Garment[], occasion: Occasion | string, season: Season | string): Garment[][] {
  const cell = CELLS.find((row) => row.id === detector || row.key === detector);
  if (!cell) return [];
  const sea = season as Season;
  const book = warmCellBook(garments, sea);
  const built = book.find((row) => row.cell.id === cell.id || row.cell.key === cell.key);
  return built?.looks[occasion as Occasion] ?? [];
}

function piecesOf(look: Garment[], cell: Cell): { top?: Garment; bottom?: Garment; shoe?: Garment; layer?: Garment } {
  let top: Garment | undefined;
  let layer: Garment | undefined;
  const bottom = look.find((g) => slotOf(g) === "bottom");
  const shoe = look.find((g) => slotOf(g) === "footwear");
  for (const g of look) {
    if (g === bottom || g === shoe) continue;
    if (!top && slotRole(g, cell) === "top") {
      top = g;
      continue;
    }
    if (!layer && layerRole(g, cell)) layer = g;
  }
  return { top, bottom, shoe, layer };
}

export function sharedDetector(
  pieces: Garment[],
  ctx?: CellContext,
  pool?: Garment[],
): { id: string; title: string } | null {
  const occasion = ctx?.occasion;
  const season = ctx?.season;
  if (!occasion || !season) return null;
  const live = pool ?? ctx?.pool ?? pieces;
  const sea = season as Season;
  for (const cell of CELLS) {
    if (!cellGateOpen(cell.key, occasion, sea)) continue;
    const slots = piecesOf(pieces, cell);
    if (!slots.top || !slots.bottom || !slots.shoe) continue;
    const extra = pieces.filter((g) => g !== slots.top && g !== slots.bottom && g !== slots.shoe && g !== slots.layer);
    if (extra.length) continue;
    const row = [slots.top, slots.bottom, slots.shoe, slots.layer].filter((g): g is Garment => Boolean(g));
    if (!passesCheap(cell, row, occasion, sea, live)) continue;
    if (!legalOk(row, occasion, sea)) continue;
    if (ctx?.color && !detectorColor(row, ctx.color, cell.key).passed) continue;
    return { id: cell.id, title: cell.title };
  }
  return null;
}

export function detectorTitle(pieces: Garment[], ctx?: CellContext): string | null {
  const hit = sharedDetector(pieces, ctx, ctx?.pool);
  if (!hit || !ctx?.occasion || !ctx.season) return null;
  const open =
    ctx.ways ??
    visibleDetectors(ctx.pool ?? pieces, {
      occasion: ctx.occasion,
      season: ctx.season,
      color: ctx.color,
      weatherF: ctx.weatherF,
    });
  if (!open.some((way) => way.id === hit.id && !way.usual)) return null;
  return hit.title;
}

function dressedLooks(way: Way, occasion: Occasion): Garment[][] {
  return (way.looks[occasion] ?? []).filter((look) => look.length >= 3);
}

/** A chip only when this occasion has a true look on the page. The usual still needs three. */
export function wayChipVisible(way: Way, occasion: Occasion | string): boolean {
  const id = (occasion || "weekday") as Occasion;
  if (way.usual) {
    const looks = OCCASION_ORDER.flatMap((key) => (way.looks[key] ?? []).slice(0, ROW_MAX)).filter(
      (look) => look.length >= 3,
    );
    return looks.length >= 3;
  }
  return dressedLooks(way, id).length >= 1;
}

function stampLooks(
  id: string,
  occasion: string,
  looks: Garment[][],
): { id: string; garmentIds: string[] }[] {
  return looks.map((look, index) => ({
    id: `way:${id}:${occasion}:${index}:${look.map((g) => g.id).join(".")}`,
    garmentIds: look.map((g) => g.id),
  }));
}

/** Look cards a section actually renders. A way with no true look here is absent. */
export function renderedSectionLooks(
  ways: readonly Way[],
  occasion: Occasion | string,
  activeId?: string | null,
): { id: string; garmentIds: string[] }[] {
  const here = (occasion || "weekday") as Occasion;
  const usual = ways.find((way) => way.usual);
  if (usual) {
    const looks = OCCASION_ORDER.flatMap((key) => (usual.looks[key] ?? []).slice(0, ROW_MAX)).filter(
      (look) => look.length >= 3,
    );
    if (looks.length < 3) return [];
    return stampLooks("usual", here, looks);
  }
  const out: { id: string; garmentIds: string[] }[] = [];
  for (const way of activeFirst(ways, activeId)) {
    if (way.usual) continue;
    const looks = dressedLooks(way, here);
    if (looks.length < 1) continue;
    out.push(...stampLooks(way.id, here, looks));
  }
  return out;
}

/** The tapped way leads. Every other way stays where it was. */
export function activeFirst<T extends { id: string }>(ways: readonly T[], activeId?: string | null): T[] {
  const active = activeId ? ways.find((way) => way.id === activeId) : undefined;
  return active ? [active, ...ways.filter((way) => way !== active)] : [...ways];
}

/**
 * This week with the tapped way's true looks first. The rest of the row follows,
 * one card per combination, eight at most. No way leaves the row alone.
 */
export function wayFirstRow(row: Look[], way: Way | undefined, occasion: Occasion): Look[] {
  if (!way) return row;
  const looks = dressedLooks(way, occasion);
  const lead: Look[] = stampLooks(way.id, occasion, looks).map((look, index) => ({
    ...look,
    name: looks[index]!.map((g) => g.name).join(" · "),
    occasion,
    source: "ai",
    lookbook: false,
    createdAt: `${todayISO()}T00:00:00.000Z`,
  }));
  const seen = new Set<string>();
  const out: Look[] = [];
  for (const look of [...lead, ...row]) {
    const key = comboKey(look.garmentIds);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(look);
    if (out.length >= 8) break;
  }
  return out;
}

export { detectorPalette, detectorColor } from "./palette.ts";

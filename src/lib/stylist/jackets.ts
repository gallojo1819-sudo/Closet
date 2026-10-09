/**
 * Jacket classification and hits. Plate rows stay as filed.
 * Joe's jacket exceptions live on the detector behavior, not in the approved JSON.
 * Shearling g_wwy9b2pusds3 is outside the brown-suede cap.
 * Cuts marked confirm are guesses until Joe says otherwise.
 */
import { codeOf, fwCodes, jacketDefaults, profileKey, supersededHit, zipKnitExempt } from "../detectors/behavior.ts";
import { approvedProfile, HOUSE_BY_CODE } from "../house-profiles/load.ts";
import {
  blob,
  hasText,
  matchSpec,
  plateMemo,
  plateStampOf,
  slotOfPlate,
  type Plate,
} from "../house-profiles/evaluate.ts";
import { dominant, wash } from "./rules.ts";
import classFile from "./data/2026-09-30-jacket-classification.json" with { type: "json" };
import jacketRules from "./data/2026-09-30-jacket-rules.json" with { type: "json" };
import stylistRules from "./data/2026-09-30-proposed-stylist-rules.json" with { type: "json" };

export type JacketClass =
  | "sport_coat_soft"
  | "sport_coat_structured"
  | "casual"
  | "coat"
  | "mid"
  | null;

export type JacketCut = "tailored" | "roomy" | "waist" | "close_light" | null;
export type JacketWeight = "heavy" | "mid" | "light" | null;

export type JacketInfo = {
  class: JacketClass;
  cut: JacketCut;
  weight: JacketWeight;
  seasons: string[];
  formality: number | null;
  overChunky: boolean;
  suedeFamily: boolean;
  confirm: boolean;
  outerEligible: boolean;
  countsAsJacket: boolean;
};

export type JacketHit = { id: string; severity: "hard" | "soft"; delta: number; why: string };

export type JacketCtx = {
  occasion: string;
  season: string;
  house?: string | null;
  tempF?: number;
};

type Spec = {
  or?: Spec[];
  any?: string[];
  none?: string[];
  slot?: string;
  warmth_min?: number;
  warmth_max?: number;
  fit_any?: string[];
  fit_none?: string[];
  [k: string]: unknown;
};

type ClassPlate = {
  id: string;
  name?: string;
  class?: string;
  subclass?: string;
  cut?: string;
  weight?: string;
  seasons?: string[];
  formality?: number;
  over_chunky_knit_ok?: string;
  counts_as_jacket?: boolean;
  brown_suede_family?: boolean;
  houses_after?: string[];
};

type AddRow = {
  id?: string;
  house?: string;
  type?: string;
  add_joe_plate_ids?: { id: string; seasons?: string[] }[];
};

const CLASS_PLATES = classFile.plates as ClassPlate[];
const BY_ID = new Map(CLASS_PLATES.map((p) => [p.id, p]));
const JSIG = jacketRules.shared_signals as Record<string, Spec>;
const SSIG = stylistRules.shared_signals as Record<string, Spec>;
const ADDS = jacketRules.per_house_additions as AddRow[];

export const CUT_CONFIRM = [
  "g_3qjmw7n4wj2a",
  "g_5gfabeezh485",
  "g_x4adkv9zu9yu",
  "g_py2swfwot1ed",
] as const;
const CONFIRM = new Set<string>(CUT_CONFIRM);

export const SUEDE_FAMILY = ["g_1pg9y05mlkek", "g_py2swfwot1ed", "g_8od90wk1sl9k"] as const;
const SUEDE = new Set<string>(SUEDE_FAMILY);

/** Not in the brown-suede cap. */
export const SHEARLING_BOMBER = "g_wwy9b2pusds3";
const OVERSHIRT = "g_v7uvadckh79p";

/** Code overlays from the detector. Not written into the approved profiles. */
export const JACKET_DEFAULTS: Record<string, { id: string; seasons?: string[] }[]> = jacketDefaults();

const NONE: JacketInfo = {
  class: null,
  cut: null,
  weight: null,
  seasons: [],
  formality: null,
  overChunky: false,
  suedeFamily: false,
  confirm: false,
  outerEligible: false,
  countsAsJacket: false,
};

export function houseCode(house?: string | null): string {
  return codeOf(house);
}

function matchExt(g: Plate, spec: Spec | undefined): boolean {
  if (!spec) return false;
  if (spec.or?.length) return spec.or.some((s) => matchExt(g, s));
  if (!matchSpec(g, spec)) return false;
  if (typeof spec.warmth_min === "number" && (g.warmth ?? 0) < spec.warmth_min) return false;
  if (typeof spec.warmth_max === "number" && (g.warmth ?? 0) > spec.warmth_max) return false;
  const fit = (g.fit ?? "").toLowerCase();
  if (spec.fit_none?.length && spec.fit_none.includes(fit)) return false;
  if (spec.fit_any?.length && !spec.fit_any.includes(fit)) return false;
  return true;
}

const JSIG_MEMO = new WeakMap<Plate, { stamp: string; map: Map<string, Map<string, boolean>> }>();

function plateStamp(g: Plate): string {
  return plateStampOf(g, buildStamp);
}

function buildStamp(g: Plate): string {
  return [
    g.category ?? "",
    g.name ?? "",
    g.subtype ?? "",
    g.material ?? "",
    g.brand ?? "",
    g.fit ?? "",
    g.warmth ?? "",
    (g.colors ?? []).join(","),
  ].join("|");
}

function jsig(g: Plate | undefined, id: string, worn: string): boolean {
  if (!g) return false;
  const stamp = plateStamp(g);
  let box = JSIG_MEMO.get(g);
  if (!box || box.stamp !== stamp) {
    box = { stamp, map: new Map() };
    JSIG_MEMO.set(g, box);
  }
  let byId = box.map.get(worn);
  if (!byId) {
    byId = new Map();
    box.map.set(worn, byId);
  }
  const prev = byId.get(id);
  if (prev !== undefined) return prev;
  let val = false;
  if (id === "denim_white_or_striped") val = whiteOrStriped(g);
  else {
    const spec = JSIG[id] ?? SSIG[id];
    if (spec && !(spec.slot && spec.slot !== "any" && spec.slot !== worn)) val = matchExt(g, spec);
  }
  byId.set(id, val);
  return val;
}

function whiteOrStriped(g: Plate): boolean {
  if (!jsig(g, "denim_bottom", "bottom")) return false;
  if (hasText(blob(g), ["stripe", "striped", "white"])) return true;
  return dominant(g) === "white";
}

function classFromRow(row: ClassPlate): JacketClass {
  const c = row.class ?? "";
  if (c.startsWith("MID")) return "mid";
  if (c.startsWith("a)")) {
    const sub = (row.subclass ?? "").toLowerCase();
    // "unstructured" contains the letters of "structured".
    const structured = sub.includes("structured") && !sub.includes("unstructured");
    if (structured || row.formality === 5) return "sport_coat_structured";
    return "sport_coat_soft";
  }
  if (c.includes("coat") && !c.includes("casual") && !c.startsWith("b)")) return "coat";
  if (c.startsWith("b)") || c.includes("casual")) return "casual";
  return "casual";
}

function fromRow(row: ClassPlate): JacketInfo {
  const cls = classFromRow(row);
  const cut = (row.cut || null) as JacketCut;
  const weight = (row.weight === "heavy" || row.weight === "mid" || row.weight === "light" ? row.weight : null) as JacketWeight;
  return {
    class: cls,
    cut: cls === "mid" ? null : cut,
    weight,
    seasons: row.seasons ?? [],
    formality: typeof row.formality === "number" ? row.formality : null,
    overChunky: String(row.over_chunky_knit_ok ?? "").startsWith("yes"),
    suedeFamily: Boolean(row.brown_suede_family),
    confirm: CONFIRM.has(row.id),
    outerEligible: row.id === OVERSHIRT,
    countsAsJacket: cls !== "mid" && row.counts_as_jacket !== false,
  };
}

function heuristicFormality(g: Plate, cls: JacketClass): number {
  if (cls === "sport_coat_structured") return 5;
  if (cls === "sport_coat_soft" || cls === "coat") return 4;
  const b = blob(g);
  if (hasText(b, ["toggle", "parka", "fleece", "vest"])) return 1;
  if (hasText(b, ["suede", "leather", "corduroy", "plaid", "shearling", "sherpa"])) return 3;
  return 2;
}

function heuristicWeight(g: Plate, cls: JacketClass): JacketWeight {
  const b = blob(g);
  if ((g.warmth ?? 0) >= 4 || hasText(b, ["shearling", "sherpa", "parka", "overcoat"])) return "heavy";
  if ((g.warmth ?? 0) <= 2 || hasText(b, ["trucker", "overshirt", "zip blouson", "linen", "mint"])) return "light";
  if (cls?.startsWith("sport_coat") && (g.material ?? "").toLowerCase().includes("wool")) return "mid";
  return "mid";
}

function fromHeuristic(g: Plate): JacketInfo {
  const tailored = jsig(g, "tailored", "outer");
  const coat = jsig(g, "outer_coat", "outer");
  const mid = jsig(g, "mid_layer", "any") && (g.category === "outerwear" || slotOfPlate(g) === "mid" || slotOfPlate(g) === "outer");
  const named = hasText(blob(g), ["jacket", "blazer", "bomber", "parka", "overshirt", "coat"]);
  // A hoodie or fleece filed as outerwear is not a jacket. Classification plates override this.
  if (!named && hasText(blob(g), ["hoodie", "sweatshirt", "cardigan", "fleece"])) return NONE;
  if (!tailored && !coat && !mid && !named && g.category !== "outerwear") return NONE;
  let cls: JacketClass = "casual";
  if (mid && !tailored) cls = "mid";
  else if (tailored) {
    const structured = jsig(g, "tailored_structured", "outer");
    const soft = jsig(g, "tailored_soft", "outer");
    cls = structured && !soft ? "sport_coat_structured" : "sport_coat_soft";
  } else if (coat) cls = "coat";
  let cut: JacketCut = null;
  if (cls?.startsWith("sport_coat")) cut = "tailored";
  else if (cls === "mid") cut = null;
  else if (jsig(g, "roomy_casual_jacket", "outer")) cut = "roomy";
  else if (jsig(g, "waist_casual_jacket", "outer")) cut = "waist";
  else if (jsig(g, "close_light_jacket", "outer") || (g.warmth ?? 3) <= 2) cut = "close_light";
  else cut = "roomy";
  return {
    class: cls,
    cut,
    weight: cls === "mid" ? heuristicWeight(g, cls) : heuristicWeight(g, cls),
    seasons: ["spring", "summer", "fall", "winter"],
    formality: cls === "mid" ? null : heuristicFormality(g, cls),
    overChunky: cut === "roomy",
    suedeFamily: SUEDE.has(g.id),
    confirm: CONFIRM.has(g.id),
    outerEligible: g.id === OVERSHIRT,
    countsAsJacket: cls !== "mid" && cls !== null,
  };
}

const ROW_INFO = new Map<string, JacketInfo>();
const INFO_MEMO = new WeakMap<Plate, { stamp: string; info: JacketInfo }>();

export function jacketInfo(g: Plate): JacketInfo {
  const row = BY_ID.get(g.id);
  if (row) {
    let info = ROW_INFO.get(g.id);
    if (!info) {
      info = fromRow(row);
      ROW_INFO.set(g.id, info);
    }
    return info;
  }
  const stamp = plateStamp(g);
  const hit = INFO_MEMO.get(g);
  if (hit && hit.stamp === stamp) return hit.info;
  const info = fromHeuristic(g);
  INFO_MEMO.set(g, { stamp, info });
  return info;
}

/** Classification wins over the stored category. Null means no override. */
export function wearSlot(g: Plate): "top" | "mid" | "outer" | "bottom" | "shoe" | null {
  const info = jacketInfo(g);
  if (info.outerEligible) return "top";
  if (info.class === "mid") return "mid";
  if (
    info.class === "sport_coat_soft" ||
    info.class === "sport_coat_structured" ||
    info.class === "casual" ||
    info.class === "coat"
  ) {
    return "outer";
  }
  return null;
}

export function slotPieces(pieces: Plate[]): Partial<Record<string, Plate>> {
  const ps: Partial<Record<string, Plate>> = {};
  const dual: Plate[] = [];
  const put = (s: string, g: Plate) => {
    if (!ps[s]) {
      ps[s] = g;
      return;
    }
    if ((s === "top" || s === "outer") && !ps.mid) ps.mid = g;
  };
  for (const g of pieces) {
    const info = jacketInfo(g);
    if (info.outerEligible) {
      dual.push(g);
      continue;
    }
    put(wearSlot(g) ?? slotOfPlate(g), g);
  }
  for (const g of dual) {
    if (ps.top && !ps.outer) ps.outer = g;
    else if (!ps.top) ps.top = g;
    else if (!ps.mid) ps.mid = g;
  }
  return ps;
}

function countsAsOuter(g: Plate | undefined): boolean {
  if (!g) return false;
  const info = jacketInfo(g);
  return Boolean(info.countsAsJacket && info.class && info.class !== "mid");
}

type IdSeason = { id: string; seasons?: string[] };

function approvedIds(code: string): IdSeason[] {
  const key = HOUSE_BY_CODE[code] ?? profileKey(code) ?? code;
  const profile = approvedProfile(key) as unknown as {
    allowed_jackets?: { joe_plate_ids?: Array<string | { id: string; seasons?: string[] }> };
  };
  const raw = profile?.allowed_jackets?.joe_plate_ids ?? [];
  return raw.map((item) => (typeof item === "string" ? { id: item } : { id: item.id, seasons: item.seasons }));
}

const ADDITION_ROWS = new Map<string, IdSeason[]>();

/** Built from static rule JSON; read-only to callers. */
function additionRows(code: string): IdSeason[] {
  let rows = ADDITION_ROWS.get(code);
  if (!rows) {
    rows = buildAdditionRows(code);
    ADDITION_ROWS.set(code, rows);
  }
  return rows;
}

function buildAdditionRows(code: string): IdSeason[] {
  const out: IdSeason[] = [];
  for (const row of ADDS) {
    if (row.type !== "allowed_jackets_update") continue;
    const houses = (row.house ?? "").split(",").map((s) => s.trim());
    if (!houses.includes(code)) continue;
    for (const item of row.add_joe_plate_ids ?? []) out.push({ id: item.id, seasons: item.seasons });
  }
  for (const item of JACKET_DEFAULTS[code] ?? []) out.push(item);
  return out;
}

const ALLOW_CACHE = new Map<string, string[]>();

export function allowedJackets(house: string, season: string): string[] {
  const code = houseCode(house);
  const key = `${code}|${season}`;
  const hit = ALLOW_CACHE.get(key);
  if (hit) return hit;
  const map = new Map<string, string[] | undefined>();
  for (const item of approvedIds(code)) {
    if (!map.has(item.id)) map.set(item.id, item.seasons);
  }
  for (const item of additionRows(code)) {
    if (item.seasons?.length) map.set(item.id, item.seasons);
    else if (!map.has(item.id)) map.set(item.id, undefined);
  }
  const ids: string[] = [];
  for (const [id, limit] of map) {
    const plate = BY_ID.get(id);
    /* Only a classified jacket can be allowed. The Khaki varsity is a top; its addition rows are moot. */
    if (!plate) continue;
    let seasons = plate.seasons?.length ? [...plate.seasons] : ["spring", "summer", "fall", "winter"];
    if (limit?.length) seasons = seasons.filter((s) => limit.includes(s));
    if (!seasons.includes(season)) continue;
    ids.push(id);
  }
  ids.sort();
  ALLOW_CACHE.set(key, ids);
  return ids;
}

export function isJacketAddition(house: string, id: string, season: string): boolean {
  const code = houseCode(house);
  return additionRows(code).some((item) => {
    if (item.id !== id) return false;
    if (item.seasons?.length && !item.seasons.includes(season)) return false;
    const plate = BY_ID.get(id);
    if (plate?.seasons?.length && !plate.seasons.includes(season)) return false;
    return true;
  });
}

export function fwEligibleJackets(): string[] {
  const codes = fwCodes();
  const out: string[] = [];
  for (const plate of CLASS_PLATES) {
    if (plate.counts_as_jacket === false) continue;
    const seasons = plate.seasons ?? [];
    if (!seasons.includes("fall") && !seasons.includes("winter")) continue;
    const listed = (["fall", "winter"] as const).some((season) =>
      seasons.includes(season) && codes.some((code) => allowedJackets(code, season).includes(plate.id)),
    );
    if (listed) out.push(plate.id);
  }
  return out;
}

export function jacketRequired(occasion: string, season: string, tempF?: number): boolean {
  const occ = occasion.toLowerCase();
  const sea = season.toLowerCase();
  let hard = false;
  if ((occ === "weekday" || occ === "out") && (sea === "fall" || sea === "winter")) hard = true;
  if (occ === "weekend" && sea === "winter") hard = true;
  if (occ === "travel" && sea === "winter") hard = true;
  if (hard && tempF != null && tempF >= 72 && (occ === "weekday" || occ === "out")) return false;
  return hard;
}

export function supersededStylist(h: { id: string; severity: string }): boolean {
  if (h.id === "XC-TEX-2" && h.severity === "soft") return true;
  return supersededHit(h.id);
}

/* Per-plate scores below read plate fields and static rule JSON only; built once per plate object. */
function topScore(g: Plate): number {
  return plateMemo(g, "jackets.topScore", topScoreOf);
}

function topScoreOf(g: Plate): number {
  const b = blob(g);
  if (hasText(b, ["dress shirt"])) return 4;
  if (
    jsig(g, "tee_graphic", "top") ||
    jsig(g, "tee_plain", "top") ||
    jsig(g, "athletic_layer", "top") ||
    jsig(g, "sweat_fleece_top", "top") ||
    hasText(b, ["hoodie"])
  ) {
    return 1;
  }
  if (jsig(g, "chunky_knit", "top") || jsig(g, "zip_knit", "top")) return 2;
  if (
    hasText(b, ["flannel", "denim shirt", "printed", "henley", "camp", "bowling"]) ||
    (hasText(b, ["polo"]) && hasText(b, ["short-sleeve", "short sleeve"]))
  ) {
    return 2;
  }
  return 3;
}

function bottomScore(g: Plate): number {
  return plateMemo(g, "jackets.bottomScore", bottomScoreOf);
}

function bottomScoreOf(g: Plate): number {
  if (jsig(g, "distressed_or_frayed", "bottom") || jsig(g, "knit_lounge_pant", "bottom") || whiteOrStriped(g)) return 1;
  if (jsig(g, "tailored_trouser", "bottom")) return 4;
  if (jsig(g, "denim_bottom", "bottom")) return 2;
  return 3;
}

function shoeScore(g: Plate): number {
  return plateMemo(g, "jackets.shoeScore", shoeScoreOf);
}

function shoeScoreOf(g: Plate): number {
  if (jsig(g, "athletic_or_fashion_sneaker", "shoe")) return 1;
  if (jsig(g, "clean_leather_sneaker", "shoe") || jsig(g, "mule", "shoe") || hasText(blob(g), ["boot"])) return 2;
  if (hasText(blob(g), ["loafer", "moccasin"])) {
    const suede = (g.material ?? "").toLowerCase().includes("suede");
    if (suede && !hasText(blob(g), ["tassel", "woven"])) return 3;
    return 4;
  }
  return 2;
}

function outerScore(g: Plate): number {
  return jacketInfo(g).formality ?? 2;
}

const SPREAD_MAX: Record<string, number> = { weekday: 2, out: 2, weekend: 3, travel: 3, comfy: 2 };
const FAMILIES = ["corduroy", "cotton", "wool", "suede", "linen"];

function matFam(g: Plate): string | null {
  const m = (g.material ?? "").toLowerCase();
  for (const f of FAMILIES) if (m.includes(f)) return f;
  return null;
}

function subclassOf(g: Plate): string {
  return (BY_ID.get(g.id)?.subclass ?? "").toLowerCase();
}

function graphicOrCollegiate(g: Plate): boolean {
  return plateMemo(g, "jackets.graphicOrCollegiate", graphicOrCollegiateOf);
}

function graphicOrCollegiateOf(g: Plate): boolean {
  const sub = subclassOf(g);
  if (sub.includes("varsity")) return true;
  return hasText(blob(g), ["varsity", "letterman", "collegiate", "graphic"]);
}

function sportCoat(g: Plate | undefined): boolean {
  if (!g) return false;
  return plateMemo(g, "jackets.sportCoat", sportCoatOf);
}

function sportCoatOf(g: Plate): boolean {
  const cls = jacketInfo(g).class;
  if (cls === "sport_coat_soft" || cls === "sport_coat_structured") return true;
  const sub = subclassOf(g);
  if (sub.includes("sport coat") || sub.includes("blazer")) return true;
  return hasText(blob(g), ["sport coat", "sportcoat", "blazer"]);
}

/** Either piece may be the jacket. The words and the jacket subclass decide, not one id. */
export function coatSharesLookWithGraphic(pieces: Plate[]): boolean {
  const coats = pieces.filter((g) => sportCoat(g));
  const marks = pieces.filter((g) => graphicOrCollegiate(g));
  return coats.some((coat) => marks.some((mark) => mark.id !== coat.id));
}

function underHit(g: Plate, worn: string, outer: Plate, ctx: JacketCtx, hits: JacketHit[]) {
  const info = jacketInfo(outer);
  const softCoat = info.class === "sport_coat_soft";
  const structured = info.class === "sport_coat_structured";
  const occ = ctx.occasion.toLowerCase();
  const season = ctx.season.toLowerCase();
  const push = (severity: "hard" | "soft", delta: number, why: string) => {
    if (severity === "soft" && delta === 0) return;
    hits.push({ id: "JKT-LAY-2", severity, delta, why });
  };
  if (graphicOrCollegiate(g)) {
    push("hard", 0, `graphic or collegiate ${g.name} under a sport coat`);
    return;
  }
  if (jsig(g, "tee_graphic", worn)) {
    push("hard", 0, `graphic tee ${g.name} under a sport coat`);
    return;
  }
  if (jsig(g, "tee_plain", worn) || jsig(g, "henley", worn)) {
    if (structured) push("hard", 0, `${g.name} under a structured sport coat`);
    else if (softCoat) {
      const delta = occ === "weekend" || occ === "travel" ? -5 : -15;
      push("soft", delta, `${g.name} under a soft sport coat on ${occ}`);
    } else push("soft", -5, `${g.name} under a sport coat`);
    return;
  }
  if (jsig(g, "zip_knit", worn)) {
    const exempt = zipKnitExempt(ctx.house) && (g.fit ?? "regular") === "regular" && !hasText(blob(g), ["fleece"]);
    if (!exempt) {
      const delta = occ === "weekend" || occ === "travel" ? -5 : -10;
      push("soft", delta, `zip knit ${g.name} under a sport coat`);
    }
    return;
  }
  if (jsig(g, "cardigan", worn)) {
    push("soft", -10, `cardigan ${g.name} under a sport coat`);
    return;
  }
  if (jsig(g, "resort_shirt", worn)) {
    if (season !== "spring" && season !== "summer") push("soft", -10, `resort shirt ${g.name} under a sport coat`);
    else push("soft", -5, `resort shirt ${g.name} under a sport coat`);
    return;
  }
  if (jsig(g, "shirt_ok_under_tailoring", worn) || jsig(g, "polo_any", worn) || jsig(g, "fine_knit", worn)) return;
  push("soft", -5, `unrated ${g.name} under a sport coat`);
}

export function jacketHits(ps: Partial<Record<string, Plate>>, ctx: JacketCtx): JacketHit[] {
  const hits: JacketHit[] = [];
  const hit = (id: string, severity: "hard" | "soft", delta: number, why: string) => {
    if (severity === "soft" && delta === 0) return;
    hits.push({ id, severity, delta, why });
  };
  const occ = (ctx.occasion || "weekday").toLowerCase();
  const season = (ctx.season || "fall").toLowerCase();
  const top = ps.top;
  const mid = ps.mid;
  const outer = ps.outer;
  const bottom = ps.bottom;
  const shoe = ps.shoe;
  const info = outer ? jacketInfo(outer) : NONE;
  const tailored = Boolean(outer && (info.class === "sport_coat_soft" || info.class === "sport_coat_structured"));
  const casual = Boolean(outer && (info.class === "casual" || info.class === "coat"));

  if (tailored && outer) {
    for (const [worn, g] of [["top", top], ["mid", mid]] as const) {
      if (!g) continue;
      if (jsig(g, "chunky_knit", worn) || jsig(g, "athletic_layer", worn) || jsig(g, "sweat_fleece_top", worn)) {
        hit("JKT-LAY-1", "hard", 0, `chunky or athletic ${g.name} under sport coat ${outer.name}`);
      }
    }
    if (top) underHit(top, "top", outer, { ...ctx, occasion: occ, season }, hits);
    if (mid) underHit(mid, "mid", outer, { ...ctx, occasion: occ, season }, hits);
    if (bottom) {
      if (jsig(bottom, "knit_lounge_pant", "bottom")) hit("JKT-LAY-3", "hard", 0, `track or lounge ${bottom.name} with a sport coat`);
      if (jsig(bottom, "distressed_or_frayed", "bottom")) hit("JKT-LAY-3", "hard", 0, `distressed ${bottom.name} with a sport coat`);
      if (whiteOrStriped(bottom)) hit("JKT-LAY-3", "hard", 0, `white or striped denim ${bottom.name} with a sport coat`);
      if (jsig(bottom, "denim_bottom", "bottom") && !whiteOrStriped(bottom) && !jsig(bottom, "distressed_or_frayed", "bottom")) {
        const w = wash(bottom);
        if (w === 1) hit("JKT-LAY-3", "hard", 0, `light-wash jean ${bottom.name} with a sport coat`);
        else if (w === 0 || w === 2) {
          if (occ === "weekend" || occ === "travel") hit("JKT-LAY-3", "soft", -10, `ecru or mid jean ${bottom.name} with a sport coat`);
          else hit("JKT-LAY-3", "hard", 0, `ecru or mid jean ${bottom.name} with a sport coat`);
        }
      }
    }
    if (shoe) {
      if (jsig(shoe, "athletic_or_fashion_sneaker", "shoe")) hit("JKT-LAY-4", "hard", 0, `athletic sneaker ${shoe.name} with a sport coat`);
      else if (jsig(shoe, "clean_leather_sneaker", "shoe")) {
        if (occ === "weekend" || occ === "travel") hit("JKT-LAY-4", "soft", -5, `clean leather sneaker ${shoe.name} with a sport coat`);
        else hit("JKT-LAY-4", "hard", 0, `clean leather sneaker ${shoe.name} with a sport coat`);
      }
      if (jsig(shoe, "mule", "shoe")) {
        hit("JKT-LAY-4", "soft", season === "summer" ? -5 : -10, `mules ${shoe.name} with a sport coat`);
      }
    }
  }

  const piled = [top, mid, outer, bottom, shoe].filter((g): g is Plate => Boolean(g));
  if (coatSharesLookWithGraphic(piled)) {
    hit("JKT-LAY-8", "hard", 0, "a graphic or collegiate piece cannot share a look with a sport coat");
  }

  if (casual && outer) {
    const chunky = ([["top", top], ["mid", mid]] as const).filter((pair): pair is ["top" | "mid", Plate] => {
      const [worn, g] = pair;
      return Boolean(g && jsig(g, "chunky_knit", worn));
    });
    if (chunky.length) {
      const regular = chunky.every(([, g]) => (g.fit ?? "").toLowerCase() === "regular");
      if (info.cut === "roomy") {
        /* roomy is allowed over a chunky knit */
      } else if (info.cut === "waist") {
        if (!regular) hit("JKT-LAY-5", "hard", 0, `waist jacket ${outer.name} over a relaxed chunky knit`);
      } else if (info.cut === "close_light" || (outer.warmth ?? 3) <= 2) {
        hit("JKT-LAY-5", "hard", 0, `close or light jacket ${outer.name} over a chunky knit`);
      }
    }
    if (bottom && jsig(bottom, "tailored_trouser", "bottom")) {
      const b = blob(outer);
      if (
        hasText(b, ["denim jacket", "trucker", "jean jacket", "varsity", "letterman", "toggle", "parka", "anorak"]) ||
        (outer.material ?? "").toLowerCase().includes("denim")
      ) {
        hit("JKT-FORM-2", "soft", -10, `${outer.name} over tailored ${bottom.name}`);
      }
    }
    if (bottom) {
      const fm = matFam(outer);
      const bm = matFam(bottom);
      const od = dominant(outer);
      const bd = dominant(bottom);
      if (fm && fm === bm && od && od === bd) hit("JKT-LAY-7", "soft", -10, `${outer.name} matches ${bottom.name}`);
    }
  }

  if (tailored && outer && bottom) {
    const fm = matFam(outer);
    const bm = matFam(bottom);
    const od = dominant(outer);
    const bd = dominant(bottom);
    if (fm && fm === bm && od && od === bd) hit("JKT-LAY-7", "soft", -10, `${outer.name} matches ${bottom.name}`);
  }

  const scores: number[] = [];
  if (top) scores.push(topScore(top));
  if (outer && countsAsOuter(outer)) scores.push(outerScore(outer));
  if (bottom) scores.push(bottomScore(bottom));
  if (shoe) scores.push(shoeScore(shoe));
  if (scores.length >= 2) {
    const spread = Math.max(...scores) - Math.min(...scores);
    const limit = SPREAD_MAX[occ] ?? 3;
    const over = spread - limit;
    if (over >= 2) hit("JKT-FORM-1", "hard", 0, `formality spread ${spread} on ${occ}`);
    else if (over === 1) hit("JKT-FORM-1", "soft", -10, `formality spread ${spread} > ${limit} on ${occ}`);
  }
  if (occ === "comfy" && tailored) hit("JKT-FORM-1", "hard", 0, "sport coat on Comfy");
  if (outer && countsAsOuter(outer)) {
    const s = outerScore(outer);
    if (occ === "out" && s === 1) hit("JKT-FORM-1", "soft", -15, `technical jacket ${outer.name} on Out`);
    if (occ === "out" && s === 2) hit("JKT-FORM-1", "soft", -5, `utility jacket ${outer.name} on Out`);
    if (occ === "weekday" && s === 1) hit("JKT-FORM-1", "soft", -10, `technical jacket ${outer.name} on Weekday`);
  }

  const covered = countsAsOuter(outer);
  const hardNeed = jacketRequired(occ, season, ctx.tempF);
  const hot = ctx.tempF != null && ctx.tempF >= 72 && (occ === "weekday" || occ === "out");
  if (!covered) {
    if (hot && (occ === "weekday" || occ === "out") && (season === "fall" || season === "winter")) {
      hit("JKT-COV-1", "soft", -10, `${occ}/${season} jacket waived above 72F`);
    } else if (hardNeed) {
      hit("JKT-COV-1", "hard", 0, `${occ}/${season}: no jacket or coat`);
    } else if (occ === "weekend" && season === "fall") {
      const heavy = [top, mid].some((g) => g && (g.warmth ?? 0) >= 4 && jsig(g, "chunky_knit", g === mid ? "mid" : "top"));
      const weightMid = [top, mid].some((g) => g && jsig(g, "outerwear_weight_mid", g === mid ? "mid" : "top"));
      if (weightMid) {
        /* waived */
      } else if (heavy) hit("JKT-COV-1", "soft", -5, "Weekend/fall: heavy knit, jacket still preferred");
      else hit("JKT-COV-1", "soft", -15, "Weekend/fall: no jacket");
    } else if (occ === "travel" && season === "fall") {
      hit("JKT-COV-1", "soft", -10, "Travel/fall: no jacket");
    }
  }

  if (outer && covered && season === "winter") {
    const heavy = info.weight === "heavy";
    const light = info.weight === "light";
    if (!heavy && light && !mid) hit("JKT-COV-2", "soft", -15, `light outer ${outer.name} with no mid in winter`);
    const sum = (top?.warmth ?? 0) + (mid?.warmth ?? 0) + (outer.warmth ?? 0);
    if (!heavy && sum < 6) hit("JKT-COV-2", "soft", -10, `winter warmth ${sum} < 6`);
  }

  if (outer && covered) {
    const heavy = info.weight === "heavy" || hasText(blob(outer), ["shearling", "sherpa"]);
    if (heavy && (season === "spring" || season === "summer")) hit("JKT-COV-3", "hard", 0, `heavy ${outer.name} in ${season}`);
    else if (heavy && season === "fall") hit("JKT-COV-3", "soft", -5, `heavy ${outer.name} in fall`);
    if (season === "winter" && hasText(`${blob(outer)} ${(outer.colors ?? []).join(" ")}`, ["mint"])) {
      hit("JKT-COV-3", "soft", -10, `pastel outer ${outer.name} in winter`);
    }
  }

  return hits;
}

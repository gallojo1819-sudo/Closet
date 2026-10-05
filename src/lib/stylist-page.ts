import { clashes, daysIdle, slotOf } from "./style.ts";
import { scoreLook } from "./stylist/legal.ts";
import { OCCASIONS, SEASONS, type Garment, type Occasion, type Season } from "./types.ts";
import type { TasteMemory } from "./taste.ts";

/** The page he is on. Replaced wholesale so a previous page cannot leak. */
export type StylistRoute = "today" | "closet" | "lookbook" | "add" | "stylist";

export type StylistPageContext = {
  route: StylistRoute;
  occasion?: string;
  season?: string;
  color?: string;
  openGarmentId?: string;
  onScreenLookIds: string[];
  weatherF?: number;
};

export type ScreenLook = { id: string; garmentIds: string[] };

export type StylistPageInput = {
  route: StylistRoute;
  occasion?: string;
  season?: string;
  color?: string | null;
  openGarmentId?: string | null;
  onScreenLookIds?: string[];
  weatherF?: number;
  /** Piece ids for the rendered cards. Not part of the context object. */
  screenLooks?: ScreenLook[];
};

export type StylistAskData = {
  prompt: string;
  garments: Garment[];
  page: StylistPageContext;
  weatherF?: number;
  taste?: TasteMemory;
  lockedIds?: string[];
  thread?: { role: "user" | "stylist"; text: string }[];
  context?: string;
  onScreenLooks?: ScreenLook[];
};

const HOUSE =
  /\b(purple label|rrl|a\.?l\.?d\.?|aim[eé] leon dore|faloni|sweet stable|italian summer|italian winter|ralph lauren|ralph|fortela|drake'?s|fivefourfive)\b/i;

const REFUSE =
  /\b(anything goes|buy|shop|purchase|you should get|pick up a|order a|add to cart)\b/i;

const DETECTOR =
  /\b(?:western_work|ivy_prep|country_stable|glossy_formal|shrunken_suit|fine_knit_loafer|henley_denim|linen_soft|flannel_cashmere|clean_city|boxy_tonal|print_plain|graphic_street|worn_paris|soft_outdoor)\b|\b(?:WW|IV|CS|GF|SS|FK|HD|LS|FC|CC|BT|PP|GS|WP|SO|JKT|ALD|XC)-[A-Z0-9]+(?:-[A-Z0-9]+)?\b/;

const GARMENT_NOUN =
  /((?:[a-z0-9]+[\s-]+){0,3})(blazers?|jackets?|coats?|overcoats?|shirts?|oxfords?|tees?|t-shirts?|polos?|knits?|sweaters?|hoodies?|chinos?|trousers?|jeans?|cords?|corduroys?|shorts?|loafers?|sneakers?|boots?|shoes?|derbies)\b/gi;

const STOP = new Set([
  "the",
  "your",
  "with",
  "and",
  "over",
  "under",
  "a",
  "an",
  "his",
  "this",
  "that",
  "holds",
  "at",
  "wear",
  "wearing",
  "swap",
  "change",
  "switch",
  "replace",
  "put",
  "dress",
  "style",
  "try",
  "skip",
]);

const ORDINALS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
];

let current: StylistPageContext = { route: "today", onScreenLookIds: [] };
let written = false;
const screenGarments = new Map<string, string[]>();
const listeners = new Set<() => void>();
let closetDrawer = 0;

function finite(n: unknown): number | undefined {
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function copyPage(page: StylistPageContext): StylistPageContext {
  return {
    route: page.route,
    onScreenLookIds: [...page.onScreenLookIds],
    ...(page.occasion ? { occasion: page.occasion } : {}),
    ...(page.season ? { season: page.season } : {}),
    ...(page.color ? { color: page.color } : {}),
    ...(page.openGarmentId ? { openGarmentId: page.openGarmentId } : {}),
    ...(finite(page.weatherF) !== undefined ? { weatherF: page.weatherF } : {}),
  };
}

function looksKey(ids: readonly string[]): string {
  return ids.map((id) => `${id}=${(screenGarments.get(id) ?? []).join(",")}`).join(";");
}

function samePage(next: StylistPageContext, prevLooks: string, nextLooks: string): boolean {
  if (!written) return false;
  if (current.route !== next.route) return false;
  if ((current.occasion ?? "") !== (next.occasion ?? "")) return false;
  if ((current.season ?? "") !== (next.season ?? "")) return false;
  if ((current.color ?? "") !== (next.color ?? "")) return false;
  if ((current.openGarmentId ?? "") !== (next.openGarmentId ?? "")) return false;
  if (finite(current.weatherF) !== finite(next.weatherF)) return false;
  if (current.onScreenLookIds.join("|") !== next.onScreenLookIds.join("|")) return false;
  return prevLooks === nextLooks;
}

export function readStylistPage(): StylistPageContext {
  return current;
}

export function subscribeStylistPage(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function writeStylistPage(input: StylistPageInput): void {
  const ids = (input.onScreenLookIds ?? []).filter((id) => typeof id === "string" && id);
  const prevLooks = looksKey(current.onScreenLookIds);
  const allow = new Set(ids);
  screenGarments.clear();
  for (const look of input.screenLooks ?? []) {
    if (!allow.has(look.id)) continue;
    screenGarments.set(
      look.id,
      look.garmentIds.filter((id) => typeof id === "string" && id),
    );
  }
  const next = copyPage({
    route: input.route,
    onScreenLookIds: ids,
    ...(input.occasion ? { occasion: input.occasion } : {}),
    ...(input.season ? { season: input.season } : {}),
    ...(input.color ? { color: input.color } : {}),
    ...(input.openGarmentId ? { openGarmentId: input.openGarmentId } : {}),
    ...(finite(input.weatherF) !== undefined ? { weatherF: input.weatherF } : {}),
  });
  if (samePage(next, prevLooks, looksKey(ids))) return;
  current = next;
  written = true;
  for (const fn of listeners) fn();
}

/** A service reading only. A missing or invented temperature is omitted. */
export function realWeatherF(
  weather?: { f?: number; measured?: boolean } | null,
): number | undefined {
  if (!weather?.measured) return undefined;
  return finite(weather.f);
}

export function routeFromPath(pathname: string): StylistRoute {
  if (pathname.startsWith("/closet")) return "closet";
  if (pathname.startsWith("/lookbook")) return "lookbook";
  if (pathname.startsWith("/add")) return "add";
  if (pathname.startsWith("/stylist")) return "stylist";
  return "today";
}

/**
 * Leaving a page replaces its chips. /stylist opens the panel and writes
 * nothing, so the page he left stays. The path is still noted for the
 * drawer cleanup, which must not clear an open piece he carried here.
 */
let lastNotedPath = "";
export function noteRoute(pathname: string): void {
  lastNotedPath = pathname;
  const route = routeFromPath(pathname);
  if (route === "stylist") return;
  if (current.route !== route) writeStylistPage({ route, onScreenLookIds: [] });
}

/**
 * The closet route cannot publish the open piece. The drawer does.
 * Unmount clears it only while he is still on the closet page; leaving for
 * /stylist keeps the piece he was looking at.
 */
export function bindClosetPiece(id: string): () => void {
  closetDrawer += 1;
  writeStylistPage({ route: "closet", openGarmentId: id, onScreenLookIds: [] });
  return () => {
    closetDrawer -= 1;
    queueMicrotask(() => {
      if (closetDrawer > 0) return;
      if (routeFromPath(lastNotedPath) !== "closet") return;
      const page = readStylistPage();
      if (page.route === "closet" && page.openGarmentId === id) {
        writeStylistPage({ route: "closet", onScreenLookIds: [] });
      }
    });
  };
}

export function rememberedLooks(page: StylistPageContext = current): ScreenLook[] {
  const out: ScreenLook[] = [];
  for (const id of page.onScreenLookIds) {
    const garmentIds = screenGarments.get(id);
    if (garmentIds?.length) out.push({ id, garmentIds: [...garmentIds] });
  }
  return out;
}

export function stylistAskFields(input: {
  prompt: string;
  garments: Garment[];
  taste?: TasteMemory;
  lockedIds?: string[];
  thread?: StylistAskData["thread"];
  context?: string;
  page?: StylistPageContext;
  onScreenLooks?: ScreenLook[];
}): StylistAskData {
  const page = copyPage(input.page ?? readStylistPage());
  const data: StylistAskData = {
    prompt: input.prompt,
    garments: input.garments,
    page,
  };
  const weather = finite(page.weatherF);
  if (weather !== undefined) data.weatherF = weather;
  if (input.taste) data.taste = input.taste;
  if (input.lockedIds?.length) data.lockedIds = input.lockedIds;
  if (input.thread) data.thread = input.thread;
  if (input.context) data.context = input.context;
  const looks = (input.onScreenLooks ?? rememberedLooks(page)).filter((look) =>
    page.onScreenLookIds.includes(look.id),
  );
  if (looks.length) data.onScreenLooks = looks;
  return data;
}

function labelOf(kind: "occasion" | "season", id?: string): string {
  if (!id) return "";
  const rows = kind === "occasion" ? OCCASIONS : SEASONS;
  return rows.find((row) => row.id === id)?.label ?? "";
}

function speakPiece(g: Garment): string {
  const brand = (g.brand ?? "").trim();
  const original = g.name.trim();
  let name = original;
  if (brand) {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    name = name.replace(new RegExp(escaped, "ig"), " ");
  }
  name = name.replace(HOUSE, " ").replace(/\s+/g, " ").trim();
  const subtype = (g.subtype || "").trim();
  if (subtype) {
    const typeWord = new RegExp(`\\b${subtype.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    // Brand "Polo" is the house. The name's polo is the shirt.
    if (!typeWord.test(name) && typeWord.test(original)) name = `${name} ${subtype}`.trim();
  }
  name = name.replace(HOUSE, " ").replace(/\s+/g, " ").trim();
  if (name && !HOUSE.test(name)) return name;
  const color = (g.colors ?? []).map((c) => c.trim()).find(Boolean) ?? "";
  const kind = (g.subtype || g.category || "").trim();
  return [color, kind].filter(Boolean).join(" ").replace(HOUSE, "").replace(/\s+/g, " ").trim();
}

function pieceBlob(g: Garment): string {
  return `${g.name} ${g.subtype} ${g.category} ${(g.colors ?? []).join(" ")} ${g.material ?? ""}`
    .toLowerCase();
}

function hasWord(blob: string, word: string): boolean {
  if (blob.includes(word)) return true;
  if (word.length > 3 && word.endsWith("s") && blob.includes(word.slice(0, -1))) return true;
  if (word.length > 3 && !word.endsWith("s") && blob.includes(`${word}s`)) return true;
  return false;
}

function phraseOwned(phrase: string, garments: readonly Garment[]): boolean {
  const words = phrase
    .toLowerCase()
    .split(/[\s-]+/)
    .map((word) => word.replace(/[^a-z0-9]/g, ""))
    .filter((word) => word.length > 2 && !STOP.has(word));
  if (!words.length) return true;
  return garments.some((g) => {
    const blob = pieceBlob(g);
    return words.every((word) => hasWord(blob, word));
  });
}

/** A qualified garment he does not own. A bare slot word, like "shirt", is not one. */
function promptInventsGarment(text: string, garments: readonly Garment[]): boolean {
  GARMENT_NOUN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = GARMENT_NOUN.exec(text.toLowerCase()))) {
    const qual = (match[1] ?? "").trim();
    const words = qual
      .split(/[\s-]+/)
      .map((word) => word.replace(/[^a-z0-9]/g, ""))
      .filter((word) => word.length > 2 && !STOP.has(word));
    if (!words.length) continue;
    const phrase = `${qual} ${match[2] ?? ""}`.trim();
    if (!phraseOwned(phrase, garments)) return true;
  }
  return false;
}

/** A garment phrase he does not own. Houses, shops, and scores are refused too. */
export function acceptStylistReply(text: string, garments: readonly Garment[]): string | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (REFUSE.test(clean) || DETECTOR.test(clean) || /\bscore\b/i.test(clean)) return null;
  if (HOUSE.test(clean)) return null;
  if (/\bpolo\b/i.test(clean)) {
    const asType = garments.some((g) => /\bpolo\b/i.test(`${g.subtype} ${g.name}`) && !/\bpolo\b/i.test(g.brand ?? ""));
    if (!asType) return null;
  }
  GARMENT_NOUN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = GARMENT_NOUN.exec(clean.toLowerCase()))) {
    const phrase = `${match[1] ?? ""}${match[2] ?? ""}`.trim();
    if (!phraseOwned(phrase, garments)) return null;
  }
  return clean;
}

export const NOT_IN_CLOSET = "That piece is not in this closet.";

/** Lines the panel can show. A LOOK row alone is not a reply. */
export function stylistProse(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^LOOK:/i.test(line) && !/^MISSING:/i.test(line));
  if (lines.length) return lines.join("\n");
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat || /^LOOK:/i.test(flat)) return NOT_IN_CLOSET;
  return flat;
}

/**
 * The dock reads the server value, including a JSON body.
 * A missing garment list must not throw the reply away.
 */
export async function stylistPayload(
  res: unknown,
): Promise<{ ok?: boolean; text?: string; error?: string; garmentIds?: string[]; occasion?: string; technique?: string | null }> {
  if (!res || typeof res !== "object") return { ok: false, error: NOT_IN_CLOSET };
  const row = res as {
    ok?: boolean;
    text?: unknown;
    error?: unknown;
    garmentIds?: unknown;
    occasion?: unknown;
    technique?: unknown;
    json?: unknown;
  };
  if (typeof row.text === "string" || typeof row.error === "string" || Array.isArray(row.garmentIds)) {
    return {
      ok: row.ok,
      ...(typeof row.text === "string" ? { text: row.text } : {}),
      ...(typeof row.error === "string" ? { error: row.error } : {}),
      ...(Array.isArray(row.garmentIds) ? { garmentIds: row.garmentIds.filter((id): id is string => typeof id === "string") } : {}),
      ...(typeof row.occasion === "string" ? { occasion: row.occasion } : {}),
      ...(typeof row.technique === "string" || row.technique === null ? { technique: row.technique as string | null } : {}),
    };
  }
  if (typeof row.json === "function") {
    try {
      const body = await (row.json as () => Promise<unknown>)();
      return stylistPayload(body);
    } catch {
      return { ok: false, error: NOT_IN_CLOSET };
    }
  }
  return { ok: false, error: NOT_IN_CLOSET };
}

/** A 200 is a line. An unowned garment is the rejection, not an empty thread. */
export function replyFromStylistResult(
  res: { ok?: boolean; text?: string; error?: string; garmentIds?: string[] } | null | undefined,
  garments: readonly Garment[],
): { text: string; garmentIds: string[] } {
  const rawText = typeof res?.text === "string" ? res.text : "";
  const rawError = typeof res?.error === "string" ? res.error : "";
  const ids = (res?.garmentIds ?? []).filter(
    (id) => typeof id === "string" && garments.some((g) => g.id === id),
  );
  const accepted = rawText.trim() ? acceptStylistReply(rawText, garments) : null;
  if (accepted) {
    const prose = stylistProse(accepted);
    if (prose && prose !== NOT_IN_CLOSET) return { text: prose, garmentIds: ids };
    const names = ids
      .map((id) => garments.find((g) => g.id === id))
      .filter((g): g is Garment => Boolean(g))
      .map((g) => speakPiece(g))
      .filter(Boolean);
    if (names.length) return { text: names.join(", "), garmentIds: ids };
  }
  const err = stylistProse(rawError);
  if (rawError.trim() && err && err !== NOT_IN_CLOSET) return { text: err, garmentIds: [] };
  return { text: NOT_IN_CLOSET, garmentIds: [] };
}

function piecesFrom(
  id: string,
  garments: readonly Garment[],
  looks: readonly ScreenLook[],
): Garment[] {
  const ids = looks.find((look) => look.id === id)?.garmentIds ?? screenGarments.get(id) ?? [];
  const out: Garment[] = [];
  for (const gid of ids) {
    const piece = garments.find((g) => g.id === gid);
    if (piece) out.push(piece);
  }
  return out;
}

function clause(pieces: readonly Garment[]): string | null {
  const top = pieces.find((g) => {
    const slot = slotOf(g);
    return slot === "top" || slot === "dress";
  });
  const bottom = pieces.find((g) => slotOf(g) === "bottom");
  const shoe = pieces.find((g) => slotOf(g) === "footwear");
  const layer = pieces.find((g) => slotOf(g) === "outerwear");
  const named = (g: Garment | undefined) => (g ? speakPiece(g) : "");
  if (!named(top) || !named(bottom) || !named(shoe)) {
    const fallback = pieces.map(speakPiece).filter(Boolean);
    return fallback.length ? fallback.join(", ") : null;
  }
  if (layer && named(layer)) {
    return `the ${named(layer)} over your ${named(top)} with the ${named(bottom)} and the ${named(shoe)}`;
  }
  return `your ${named(top)} with the ${named(bottom)} and the ${named(shoe)}`;
}

function holdClause(page: StylistPageContext): string {
  const bits = [labelOf("occasion", page.occasion), labelOf("season", page.season)].filter(Boolean);
  if (!bits.length) return "";
  if (bits.length === 1) return ` holds ${bits[0]}`;
  return ` holds ${bits[0]} and ${bits[1]}`;
}

/**
 * The winning look as a Wear sentence: one top, one bottom, one shoe, from
 * these pieces only. A jacket goes under. Never the page line.
 */
function wearSentence(pieces: readonly Garment[]): string | null {
  const top = pieces.find((g) => {
    const slot = slotOf(g);
    return slot === "top" || slot === "dress";
  });
  const bottom = pieces.find((g) => slotOf(g) === "bottom");
  const shoe = pieces.find((g) => slotOf(g) === "footwear");
  const jacket = pieces.find((g) => slotOf(g) === "outerwear");
  const named = (g: Garment | undefined) => (g ? speakPiece(g) : "");
  if (!named(top) || !named(bottom) || !named(shoe)) return null;
  const wear = `Wear your ${named(top)} with the ${named(bottom)} and the ${named(shoe)}`;
  if (named(jacket)) return `${wear} under the ${named(jacket)}.`;
  return `${wear}.`;
}

/** A question about the looks on this page, not a request to dress a piece. */
function asksAboutOnScreenLooks(prompt: string): boolean {
  return /\blooks?\b/i.test(prompt) || /\b(?:this page|on screen)\b/i.test(prompt);
}

export function formatStrongest(
  index: number,
  pieces: readonly Garment[],
  page: StylistPageContext,
): string | null {
  const body = clause(pieces);
  if (!body) return null;
  const ord = ORDINALS[index] ?? `look ${index + 1}`;
  const weather =
    page.route === "today" && finite(page.weatherF) !== undefined ? `, at ${page.weatherF}°` : "";
  return `The ${ord} look is the strongest: ${body}${holdClause(page)}${weather}.`;
}

function chipSentence(page: StylistPageContext): string | null {
  const bits = [
    labelOf("occasion", page.occasion),
    labelOf("season", page.season),
    page.color ?? "",
  ].filter(Boolean);
  if (!bits.length) return null;
  const list =
    bits.length === 1 ? bits[0] : `${bits.slice(0, -1).join(", ")} and ${bits[bits.length - 1]}`;
  return `${list} ${bits.length === 1 ? "is" : "are"} on. Nothing is on screen.`;
}

function safeScore(pieces: Garment[], page: StylistPageContext): number {
  try {
    const occasion = (page.occasion as Occasion) || "weekday";
    const season = (page.season as Season) || "fall";
    return scoreLook(pieces, {
      house: null,
      occasion,
      season,
      color: page.color ?? null,
    });
  } catch {
    return Number.NEGATIVE_INFINITY;
  }
}

function rankIndex(
  rows: { pieces: Garment[] }[],
  page: StylistPageContext,
): number {
  let best = -1;
  let bestScore = Number.NEGATIVE_INFINITY;
  rows.forEach((row, index) => {
    if (!clause(row.pieces) || clashes(row.pieces)) return;
    const score = safeScore(row.pieces, page);
    if (!Number.isFinite(score) || score === Number.NEGATIVE_INFINITY) return;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
}

function byIdle(pool: readonly Garment[], slot: "top" | "bottom" | "footwear" | "outerwear"): Garment[] {
  return pool
    .filter((g) => {
      const s = slotOf(g);
      if (slot === "top") return s === "top" || s === "dress";
      return s === slot;
    })
    .sort((a, b) => daysIdle(b) - daysIdle(a) || a.id.localeCompare(b.id));
}

function matesFor(open: Garment, pool: readonly Garment[], page: StylistPageContext): Garment[] {
  const rest = pool.filter((g) => g.id !== open.id);
  const openSlot = slotOf(open);
  const tops = openSlot === "top" || openSlot === "dress" ? [open] : byIdle(rest, "top").slice(0, 4);
  const bottoms = openSlot === "bottom" ? [open] : byIdle(rest, "bottom").slice(0, 4);
  const shoes = openSlot === "footwear" ? [open] : byIdle(rest, "footwear").slice(0, 4);
  let best: Garment[] | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let tries = 0;
  for (const top of tops) {
    for (const bottom of bottoms) {
      for (const shoe of shoes) {
        if (++tries > 48) break;
        const pieces = [top, bottom, shoe].filter((g, i, all) => all.findIndex((x) => x.id === g.id) === i);
        if (pieces.length < 3 || clashes(pieces)) continue;
        const score = safeScore(pieces, page);
        if (!Number.isFinite(score) || score === Number.NEGATIVE_INFINITY) continue;
        if (score > bestScore) {
          bestScore = score;
          best = pieces.filter((g) => g.id !== open.id);
        }
      }
    }
  }
  return best ?? [];
}

function betterThan(open: Garment, chosen: Garment, pool: readonly Garment[]): Garment | null {
  const slot = slotOf(chosen);
  const want =
    slot === "top" || slot === "dress"
      ? "top"
      : slot === "bottom" || slot === "footwear" || slot === "outerwear"
        ? slot
        : null;
  if (!want) return null;
  for (const cand of byIdle(pool, want)) {
    if (cand.id === chosen.id || cand.id === open.id) continue;
    if (clashes([open, cand])) continue;
    return cand;
  }
  return null;
}

function openSentence(
  open: Garment,
  pool: readonly Garment[],
  page: StylistPageContext,
  chosen?: Garment,
): string {
  const lead = speakPiece(open);
  const title = lead ? `The ${lead}` : "This piece";
  if (chosen && chosen.id !== open.id && clashes([open, chosen])) {
    const better = betterThan(open, chosen, pool);
    const named = better ? speakPiece(better) : "";
    const tail = named ? ` Better: ${named}.` : "";
    return `${title} does not go with the ${speakPiece(chosen) || "piece already chosen"}.${tail}`;
  }
  const mates = matesFor(open, pool, page).map(speakPiece).filter(Boolean);
  if (!mates.length) return `${title} does not go with the other pieces in this closet.`;
  if (mates.length === 1) return `${title} goes with your ${mates[0]}.`;
  const last = mates[mates.length - 1];
  const rest = mates.slice(0, -1).map((name, i) => (i === 0 ? name : `the ${name}`));
  return `${title} goes with your ${rest.join(", ")}, and the ${last}.`;
}

export function screenSentence(
  page: StylistPageContext,
  garments: readonly Garment[],
  looks: readonly ScreenLook[] = rememberedLooks(page),
  chosenId?: string,
): string {
  if (page.openGarmentId) {
    const open = garments.find((g) => g.id === page.openGarmentId);
    if (!open) return "This piece does not go with the other pieces in this closet.";
    const chosen = chosenId ? garments.find((g) => g.id === chosenId) : undefined;
    return openSentence(open, garments, page, chosen);
  }
  const rows = page.onScreenLookIds.map((id) => ({
    id,
    pieces: piecesFrom(id, garments, looks),
  }));
  if (page.onScreenLookIds.length) {
    const index = rankIndex(rows, page);
    const line = index >= 0 ? formatStrongest(index, rows[index]!.pieces, page) : null;
    if (line && acceptStylistReply(line, garments)) return line;
    if (page.route === "lookbook" || page.route === "stylist") {
      const chips = chipSentence(page);
      if (chips) return chips.replace("Nothing is on screen.", "None of these looks holds them.");
    }
    if (line) return line;
    return "Watching this page.";
  }
  if ((page.route === "lookbook" || page.route === "stylist") && page.onScreenLookIds.length === 0) {
    const chips = chipSentence(page);
    if (chips) return chips;
  }
  return "Watching this page.";
}

function namedInPrompt(prompt: string, garments: readonly Garment[]): Garment[] {
  const text = prompt.toLowerCase();
  return garments.filter((g) => {
    const name = g.name.trim().toLowerCase();
    if (name.length > 2 && text.includes(name)) return true;
    const spoken = speakPiece(g).toLowerCase();
    return spoken.length > 2 && text.includes(spoken);
  });
}

export type PageAnswer =
  | { kind: "pass" }
  | { kind: "reject" }
  | { kind: "answer"; text: string; garmentIds: string[] };

/** Rank only the looks on the page. An unowned garment is refused. */
export function answerAsked(input: {
  prompt: string;
  page?: StylistPageContext;
  garments: readonly Garment[];
  looks?: readonly ScreenLook[];
  modelText?: string;
}): PageAnswer {
  const page = input.page ?? readStylistPage();
  const garments = input.garments;
  if (input.modelText && !acceptStylistReply(input.modelText, garments)) return { kind: "reject" };
  if (promptInventsGarment(input.prompt, garments)) return { kind: "reject" };
  const looks = (input.looks ?? rememberedLooks(page)).filter((look) =>
    page.onScreenLookIds.includes(look.id),
  );
  if (page.onScreenLookIds.length) {
    const wanted = namedInPrompt(input.prompt, garments);
    const rows = page.onScreenLookIds.map((id) => ({
      id,
      pieces: piecesFrom(id, garments, looks),
    }));
    const pool = wanted.length
      ? rows.filter((row) => wanted.every((g) => row.pieces.some((piece) => piece.id === g.id)))
      : rows;
    if (wanted.length && !pool.length) {
      return { kind: "answer", text: "That piece is not in the looks on this page.", garmentIds: [] };
    }
    const index = rankIndex(pool, page);
    if (index < 0) {
      return { kind: "answer", text: "None of these looks holds them.", garmentIds: [] };
    }
    const winner = pool[index]!;
    const ids = winner.pieces.map((g) => g.id);
    const wear = wearSentence(winner.pieces);
    const accepted = wear ? acceptStylistReply(wear, garments) : null;
    if (accepted) return { kind: "answer", text: accepted, garmentIds: ids };
    const names = winner.pieces.map(speakPiece).filter(Boolean);
    return {
      kind: "answer",
      text: names.length ? names.join(" · ") : "None of these looks holds them.",
      garmentIds: ids,
    };
  }
  if (page.openGarmentId) {
    const open = garments.find((g) => g.id === page.openGarmentId);
    const named = namedInPrompt(input.prompt, garments).find((g) => g.id !== page.openGarmentId);
    if (!open) {
      return {
        kind: "answer",
        text: "This piece does not go with the other pieces in this closet.",
        garmentIds: [],
      };
    }
    const text = openSentence(open, garments, page, named);
    return { kind: "answer", text, garmentIds: [] };
  }
  if (asksAboutOnScreenLooks(input.prompt)) {
    return { kind: "answer", text: "Nothing is on screen.", garmentIds: [] };
  }
  return { kind: "pass" };
}

export function pageNotes(page: StylistPageContext | undefined): string {
  if (!page) return "";
  const lines = [`Page: ${page.route}`];
  if (page.occasion) lines.push(`Occasion: ${page.occasion}`);
  if (page.season) lines.push(`Season: ${page.season}`);
  if (page.color) lines.push(`Color: ${page.color}`);
  if (page.openGarmentId) lines.push(`Open piece: ${page.openGarmentId}`);
  if (page.onScreenLookIds.length) lines.push(`On screen: ${page.onScreenLookIds.join(",")}`);
  lines.push(
    "Rank only the looks listed as On screen. Do not answer about a look that is not listed. Do not invent a piece. Do not name a house or a brand. Do not tell him to buy. Do not say anything goes. If no temperature is listed, do not invent one.",
  );
  return lines.join("\n");
}

/**
 * Idea rows: the Lookbook rows as rendered. Every row is a theme (a cell), every card starts
 * from a different hero piece of that theme, and within a row no two cards share a top, bottom,
 * shoe or jacket. Across the screen no piece is on more than SCREEN_CAP cards. Freshness (days
 * idle, not suggested lately, not yet on this screen) weighs about as much as fit (the cell's
 * grade). A "Forgotten pieces" row closes the screen, built only from pieces not worn or
 * suggested in a while. The engine's stored rows (visibleDetectors, the snapshot) are untouched:
 * this is display, as storedRows was. Pure: relative imports only, no React, no DOM.
 */
import { cellKit, maxDisjoint, rankedWays, ROW_MAX, storedRows, type Cell, type Way } from "./cells.ts";
import { detectorColor } from "./palette.ts";
import { lookFitsOccasion, lookHasColor } from "../lookbook.ts";
import { livePool } from "../rack.ts";
import type { Season } from "../season.ts";
import { daysIdle, slotOf } from "../style.ts";
import { jacketRequired, wearSlot } from "../stylist/jackets.ts";
import type { Garment, Occasion } from "../types.ts";
import { todayISO } from "../utils.ts";

/** Most cards one piece is on across one screen (every row and the week row). */
export const SCREEN_CAP = 2;
/** A row shrinks to this before it gives up its theme. */
export const ROW_MIN = 3;
export const FORGOTTEN_ID = "forgotten";
export const FORGOTTEN_TITLE = "Forgotten pieces";
/** A piece is forgotten after this many days unworn and unsuggested. */
export const FORGOTTEN_DAYS = 30;
/** Days since a suggestion after which a piece counts as fully unseen. */
const UNSEEN_DAYS = 14;
const IDLE_DAYS = 90;
/** Themed rows one screen shows, as visibleDetectors' cap. */
export const THEME_ROWS = 4;
/** Candidates per slot a hero may try; cheap checks one hero, then one row, may spend. */
const BEAM = 8;
const HERO_TRIES = 400;
const ROW_TRIES = 8000;

type SlotName = "top" | "bottom" | "shoe" | "layer";

export type IdeaContext = {
  occasion: Occasion | string;
  season: Season | string;
  color?: string | null;
  weatherF?: number;
  /** 0 is the best row; a Re-dress salt re-orders the heroes and their partners. */
  salt?: number;
  /** Piece ids already on the screen before the rows (the week row), one entry per card. */
  onScreen?: readonly string[];
  /** Last day each piece was suggested: a drop, a journal entry, a saved look. Absent = never. */
  suggested?: ReadonlyMap<string, string>;
  today?: string;
};

type Scored = { g: Garment; slot: SlotName; score: number };

function finiteTemp(n: unknown): number | undefined {
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function hashId(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i += 1) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(to) - Date.parse(from);
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.round(ms / 86_400_000));
}

/**
 * Last day each piece was put in front of the user: today's drop, the wear journal, and the
 * saved looks (the week the Lookbook keeps). Nothing is written; this only reads the store.
 */
export function lastSuggested(input: {
  drop?: { date: string; garmentIds: readonly string[] } | null;
  journal?: readonly { date: string; garmentIds: readonly string[] }[];
  looks?: readonly { createdAt: string; garmentIds: readonly string[] }[];
}): Map<string, string> {
  const out = new Map<string, string>();
  const note = (day: string, ids: readonly string[]) => {
    const iso = day.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
    for (const id of ids) {
      const have = out.get(id);
      if (!have || have < iso) out.set(id, iso);
    }
  };
  if (input.drop) note(input.drop.date, input.drop.garmentIds);
  for (const row of input.journal ?? []) note(row.date, row.garmentIds);
  for (const look of input.looks ?? []) note(look.createdAt, look.garmentIds);
  return out;
}

/** 0..1 before the on-screen penalty: half days idle, half days since a suggestion. */
export function freshness(
  g: Garment,
  ctx: { today: string; suggested?: ReadonlyMap<string, string> },
  onScreen = 0,
): number {
  const idle = Math.min(daysIdle(g, ctx.today), IDLE_DAYS) / IDLE_DAYS;
  const last = ctx.suggested?.get(g.id);
  const unseen = last ? Math.min(daysBetween(last, ctx.today), UNSEEN_DAYS) / UNSEEN_DAYS : 1;
  return 0.5 * idle + 0.5 * unseen - 0.75 * onScreen;
}

/** Pieces not worn and not suggested for FORGOTTEN_DAYS. Accessories never count. */
export function forgottenIds(
  garments: Garment[],
  ctx: { today?: string; suggested?: ReadonlyMap<string, string> } = {},
): Set<string> {
  const today = ctx.today ?? todayISO();
  const out = new Set<string>();
  for (const g of livePool(garments)) {
    const slot = slotOf(g);
    if (slot !== "top" && slot !== "dress" && slot !== "bottom" && slot !== "footwear" && slot !== "outerwear") continue;
    if (daysIdle(g, today) < FORGOTTEN_DAYS) continue;
    const last = ctx.suggested?.get(g.id);
    if (last && daysBetween(last, today) < FORGOTTEN_DAYS) continue;
    out.add(g.id);
  }
  return out;
}

/** A theme piece: core grade in its slot, or an anchor hit for that slot. */
function isTheme(cell: Cell, g: Garment, slot: SlotName): boolean {
  if (cellKit.grade(cell, g, slot) === "core") return true;
  if (!cell.anchors?.any[slot]?.length) return false;
  const probe = { [slot]: g } as unknown as { top: Garment; bottom: Garment; shoe: Garment; layer?: Garment };
  return cellKit.anchorHits(cell, probe) > 0;
}

/** The theme pieces of a look for a cell. Every idea card has at least one. */
export function themePieces(cellId: string, look: Garment[]): Garment[] {
  const cell = cellKit.cells().find((row) => row.id === cellId || row.key === cellId);
  if (!cell) return [];
  return look.filter((g) => {
    const slot = slotNameOf(g, cell);
    return slot ? isTheme(cell, g, slot) : false;
  });
}

function slotNameOf(g: Garment, cell: Cell): SlotName | null {
  const s = slotOf(g);
  if (s === "bottom") return "bottom";
  if (s === "footwear") return "shoe";
  if (cellKit.slotRole(g, cell) === "top") return "top";
  if (cellKit.layerRole(g, cell)) return "layer";
  return null;
}

/** Every piece of every card counted: the screen's cap is checked against this. */
export function pieceCounts(looks: readonly (readonly { id: string }[])[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const look of looks) for (const g of look) counts.set(g.id, (counts.get(g.id) ?? 0) + 1);
  return counts;
}

/** Cards in order, dropping any that would put a piece on more than `cap` cards. */
export function capScreenLooks<T extends { garmentIds: readonly string[] }>(looks: readonly T[], cap = SCREEN_CAP): T[] {
  const counts = new Map<string, number>();
  const out: T[] = [];
  for (const look of looks) {
    if (look.garmentIds.some((id) => (counts.get(id) ?? 0) >= cap)) continue;
    for (const id of look.garmentIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    out.push(look);
  }
  return out;
}

/** Pieces (other than jackets) that sit on more than one card of the row. Empty for a good row. */
export function rowRepeats(looks: readonly Garment[][], jackets = false): Garment[] {
  const seen = new Map<string, Garment>();
  const out = new Map<string, Garment>();
  for (const look of looks) {
    for (const g of look) {
      const outer = wearSlot(g) === "outer" || slotOf(g) === "outerwear";
      if (outer !== jackets) continue;
      if (seen.has(g.id)) out.set(g.id, g);
      else seen.set(g.id, g);
    }
  }
  return [...out.values()];
}

type Dresser = {
  tops: Garment[];
  bottoms: Garment[];
  shoes: Garment[];
  layers: Garment[];
  /** A core (top, bottom, shoe) that may still take a layer. */
  coreOk: (core: Garment[]) => boolean;
  /** A finished look: the cheap gates, the colour filter, then the legality engine. */
  finalOk: (pieces: Garment[]) => boolean;
  /** A bare core may ship (no jacket owed by the weather or the theme). */
  bareOk: (core: Garment[]) => boolean;
  fit: (g: Garment, slot: SlotName) => number;
  theme: (g: Garment, slot: SlotName) => boolean;
};

type Budget = { tries: number; hero: number };

function orderBy(list: Scored[]): Garment[] {
  return list.sort((a, b) => b.score - a.score || a.g.id.localeCompare(b.g.id)).map((row) => row.g);
}

/**
 * One card from one hero: the best-scored partners per slot, first legal look wins. A layer
 * not yet on screen comes before a bare core; a bare core before a layer already on screen.
 */
function dressHero(
  hero: Scored,
  d: Dresser,
  score: (g: Garment, slot: SlotName) => number,
  open: (g: Garment) => boolean,
  countOf: (g: Garment) => number,
  budget: Budget,
): Garment[] | null {
  const pick = (list: Garment[], slot: SlotName): Garment[] =>
    hero.slot === slot
      ? [hero.g]
      : orderBy(list.filter((g) => g.id !== hero.g.id && open(g)).map((g) => ({ g, slot, score: score(g, slot) }))).slice(
          0,
          BEAM,
        );
  const tops = pick(d.tops, "top");
  const bottoms = pick(d.bottoms, "bottom");
  const shoes = pick(d.shoes, "shoe");
  const layers = pick(d.layers, "layer");
  const freshLayers = layers.filter((g) => countOf(g) === 0);
  const shownLayers = layers.filter((g) => countOf(g) > 0);
  for (const top of tops) {
    for (const bottom of bottoms) {
      for (const shoe of shoes) {
        if (budget.tries <= 0 || budget.hero <= 0) return null;
        budget.tries -= 1;
        budget.hero -= 1;
        const core = [top, bottom, shoe];
        if (!d.coreOk(core)) continue;
        const layered = (list: Garment[]): Garment[] | null => {
          for (const layer of list) {
            if (budget.tries <= 0 || budget.hero <= 0) return null;
            budget.tries -= 1;
            budget.hero -= 1;
            const pieces = [...core, layer];
            if (d.finalOk(pieces)) return pieces;
          }
          return null;
        };
        const fresh = layered(freshLayers);
        if (fresh) return fresh;
        if (hero.slot !== "layer" && d.bareOk(core) && d.finalOk(core)) return core;
        const shown = layered(shownLayers);
        if (shown) return shown;
      }
    }
  }
  return null;
}

/** Hero-first cards for one theme. Pieces distinct within the row, counts bumped as it goes. */
function heroRow(d: Dresser, counts: Map<string, number>, salt: number, fresh: (g: Garment, onScreen: number) => number): Garment[][] {
  const countOf = (g: Garment) => counts.get(g.id) ?? 0;
  const rowUsed = new Set<string>();
  const open = (g: Garment) => !rowUsed.has(g.id) && countOf(g) < SCREEN_CAP;
  const jitter = (g: Garment) => (salt > 0 ? hashId(g.id, salt) * 0.6 : 0);
  const score = (g: Garment, slot: SlotName) => d.fit(g, slot) + fresh(g, countOf(g)) + jitter(g);
  const heroes: Scored[] = [];
  const pools: [Garment[], SlotName][] = [
    [d.tops, "top"],
    [d.bottoms, "bottom"],
    [d.shoes, "shoe"],
    [d.layers, "layer"],
  ];
  for (const [list, slot] of pools) {
    for (const g of list) if (d.theme(g, slot)) heroes.push({ g, slot, score: score(g, slot) });
  }
  heroes.sort((a, b) => b.score - a.score || a.g.id.localeCompare(b.g.id));
  const looks: Garment[][] = [];
  const budget: Budget = { tries: ROW_TRIES, hero: HERO_TRIES };
  for (const hero of heroes) {
    if (looks.length >= ROW_MAX || budget.tries <= 0) break;
    if (!open(hero.g)) continue;
    budget.hero = HERO_TRIES;
    const look = dressHero(hero, d, score, open, countOf, budget);
    if (!look) continue;
    looks.push(look);
    for (const g of look) {
      rowUsed.add(g.id);
      counts.set(g.id, countOf(g) + 1);
    }
  }
  return looks;
}

function cellDresser(
  cell: Cell,
  live: Garment[],
  occasion: Occasion,
  season: Season,
  weatherF: number | undefined,
  color: string | null,
  pool: Garment[],
): Dresser {
  const needJacket = jacketRequired(occasion, season, weatherF);
  const owed = cellKit.layerOwed(cell);
  const colorOk = (pieces: Garment[]) => !color || detectorColor(pieces, color, cell.key).passed;
  const fit = (g: Garment, slot: SlotName) => (cellKit.grade(cell, g, slot) === "core" ? 1 : 0.5);
  return {
    tops: live.filter((g) => cellKit.slotRole(g, cell) === "top"),
    bottoms: live.filter((g) => slotOf(g) === "bottom" && cellKit.grade(cell, g, "bottom") !== "no"),
    shoes: live.filter((g) => slotOf(g) === "footwear" && cellKit.grade(cell, g, "shoe") !== "no"),
    layers: live.filter((g) => cellKit.layerRole(g, cell)),
    coreOk: (core) => cellKit.passesCheap(cell, core, occasion, season, pool, owed),
    finalOk: (pieces) =>
      cellKit.passesCheap(cell, pieces, occasion, season, pool) &&
      colorOk(pieces) &&
      cellKit.legalOk(pieces, occasion, season, weatherF),
    bareOk: () => !needJacket,
    fit,
    theme: (g, slot) => isTheme(cell, g, slot),
  };
}

/** The forgotten row has no cell: the shared hard rules, the occasion and season gates, then isLegal. */
const PLAIN_CELL = { key: "", tuck: "", ban: [], fails: [] } as unknown as Cell;

function isOuterPiece(g: Garment): boolean {
  return wearSlot(g) === "outer" || slotOf(g) === "outerwear";
}

function isTopPiece(g: Garment): boolean {
  if (isOuterPiece(g)) return false;
  const slot = slotOf(g);
  return slot === "top" || slot === "dress";
}

function forgottenDresser(
  live: Garment[],
  forgotten: ReadonlySet<string>,
  occasion: Occasion,
  season: Season,
  weatherF: number | undefined,
  color: string | null,
  pool: Garment[],
): Dresser {
  const needJacket = jacketRequired(occasion, season, weatherF);
  const colorOk = (pieces: Garment[]) => !color || lookHasColor(pieces, color);
  const cheap = (pieces: Garment[]) =>
    new Set(pieces.map((g) => g.id)).size === pieces.length &&
    !pieces.some((g) => cellKit.deleted.has(g.id)) &&
    !cellKit.globalFail(PLAIN_CELL, pieces) &&
    lookFitsOccasion(pieces, occasion, pool, undefined) &&
    cellKit.seasonOk(pieces, season);
  return {
    tops: live.filter(isTopPiece),
    bottoms: live.filter((g) => slotOf(g) === "bottom"),
    shoes: live.filter((g) => slotOf(g) === "footwear"),
    layers: live.filter(isOuterPiece),
    coreOk: cheap,
    finalOk: (pieces) => cheap(pieces) && colorOk(pieces) && cellKit.legalOk(pieces, occasion, season, weatherF),
    bareOk: () => !needJacket,
    /* Fit lifts the other forgotten pieces: a card of only forgotten pieces when the rules allow. */
    fit: (g) => (forgotten.has(g.id) ? 1 : 0.5),
    theme: (g) => forgotten.has(g.id),
  };
}

function idsOf(look: Garment[]): string {
  return cellKit.idsOf(look);
}

/** The "Forgotten pieces" row: three or more cards whose heroes are forgotten, or nothing. */
function forgottenWay(
  garments: Garment[],
  live: Garment[],
  pool: Garment[],
  counts: Map<string, number>,
  ctx: {
    occasion: Occasion;
    season: Season;
    weatherF: number | undefined;
    color: string | null;
    salt: number;
    today: string;
    fresh: (g: Garment, onScreen: number) => number;
    suggested?: ReadonlyMap<string, string>;
  },
): Way | null {
  const forgotten = forgottenIds(garments, { today: ctx.today, suggested: ctx.suggested });
  if (!live.some((g) => forgotten.has(g.id))) return null;
  const d = forgottenDresser(live, forgotten, ctx.occasion, ctx.season, ctx.weatherF, ctx.color, pool);
  const seen = new Set<string>();
  const rows = heroRow(d, counts, ctx.salt, ctx.fresh)
    .filter((look) => look.some((g) => forgotten.has(g.id)))
    .filter((look) => !seen.has(idsOf(look)) && seen.add(idsOf(look)));
  if (rows.length < ROW_MIN) return null;
  return {
    id: FORGOTTEN_ID,
    title: FORGOTTEN_TITLE,
    pieces: rows[0]!,
    looks: { [ctx.occasion]: rows },
    counts: { weekday: 0, out: 0, weekend: 0, travel: 0, comfy: 0, [ctx.occasion]: rows.length },
  };
}

/**
 * The rows the Lookbook renders. Each way's looks for this occasion become hero-first cards
 * (ROW_MIN..ROW_MAX, distinct pieces within the row, SCREEN_CAP across the screen). A theme
 * that cannot reach ROW_MIN falls back to its stored disjoint rows under the same cap, so a
 * thin closet still shows what it has. The usual way asks usualFromCloset as before. A
 * "Forgotten pieces" row closes the list when three cards of forgotten pieces are legal.
 */
export function rowWays(ways: Way[], garments: Garment[], ctx: IdeaContext): Way[] {
  const occasion = (ctx.occasion || "weekday") as Occasion;
  const season = (ctx.season || "fall") as Season;
  const color = ctx.color ?? null;
  const weatherF = finiteTemp(ctx.weatherF);
  const salt = ctx.salt ?? 0;
  const today = ctx.today ?? todayISO();
  const pool = livePool(garments);
  const live = pool.filter((g) => !cellKit.deleted.has(g.id));
  const counts = pieceCounts((ctx.onScreen ?? []).map((id) => [{ id }]));
  const fresh = (g: Garment, onScreen: number) => freshness(g, { today, suggested: ctx.suggested }, onScreen);
  if (ways.some((way) => way.usual)) return storedRows(ways, garments, { occasion, season, color, weatherF, salt });
  /* The ranked ways first, then every other open cell: a theme the stored count ranked low may
     still dress three distinct heroes. */
  const extra = rankedWays(garments, { occasion, season, color, weatherF }).filter(
    (way) => !ways.some((have) => have.id === way.id),
  );
  const order = [...ways, ...extra].filter((way) => (way.looks[occasion] ?? []).length > 0);
  const out: Way[] = [];
  const short: Way[] = [];
  for (const way of order) {
    if (out.length >= THEME_ROWS) break;
    const cell = cellKit.cells().find((row) => row.id === way.id);
    if (!cell) continue;
    const d = cellDresser(cell, live, occasion, season, weatherF, color, pool);
    const looks = heroRow(d, new Map(counts), salt, fresh);
    if (looks.length < ROW_MIN) {
      if (short.length < THEME_ROWS) short.push(way);
      continue;
    }
    for (const look of looks) for (const g of look) counts.set(g.id, (counts.get(g.id) ?? 0) + 1);
    out.push({ ...way, pieces: looks[0] ?? way.pieces, looks: { ...way.looks, [occasion]: looks } });
  }
  const forgotten = forgottenWay(garments, live, pool, counts, { occasion, season, weatherF, color, salt, today, fresh, suggested: ctx.suggested });
  if (!out.length && !forgotten && short.length) {
    /* No theme reaches three distinct heroes and nothing is forgotten: the stored disjoint rows,
       under the cap, say "Only N in your closet" as before rather than leaving the page bare. */
    const stored = storedRows(short, garments, { occasion, season, color, weatherF, salt });
    for (const [i, way] of short.entries()) {
      const kept = maxDisjoint(stored[i]?.looks[occasion] ?? []).filter((look) =>
        look.every((g) => (counts.get(g.id) ?? 0) < SCREEN_CAP),
      );
      if (!kept.length) continue;
      for (const look of kept) for (const g of look) counts.set(g.id, (counts.get(g.id) ?? 0) + 1);
      out.push({ ...way, pieces: kept[0]!, looks: { ...way.looks, [occasion]: kept } });
    }
  }
  if (forgotten) out.push(forgotten);
  return out;
}

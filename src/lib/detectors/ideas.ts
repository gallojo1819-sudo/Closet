/**
 * Idea rows: the Lookbook rows as rendered. Every row is a theme (a cell), every card starts
 * from a different hero piece of that theme, and within a row no two cards share a top, bottom,
 * shoe or jacket. Across the screen no piece is on more than SCREEN_CAP cards. Freshness (days
 * idle, not suggested lately, not yet on this screen) weighs about as much as fit (the cell's
 * grade). A "Forgotten pieces" row closes the screen, built only from pieces not worn or
 * suggested in a while. Summer themes (linen, camp collar, resort, short-sleeve polo: SUMMER_ONLY
 * in cells.ts) show in summer only. A jacket theme (jacketTheme in cells.ts) puts a jacket on every
 * card, so a row with fewer than ROW_MIN jackets shrinks or hides. The engine's stored rows
 * (visibleDetectors, the snapshot) are untouched: this is display, as storedRows was. With a
 * Rotation (rotation.ts) in the context, candidates are ordered by least-recently-shown instead
 * of by score, looks seen this session are refused, and the week row (weekRotationRow) is built
 * the same way from the plain rules: the style rules are pass/fail guardrails only. Pure:
 * relative imports only, no React, no DOM.
 */
import { cellKit, isSummerOnlyPiece, maxDisjoint, rankedWays, ROW_MAX, storedRows, type Cell, type Way } from "./cells.ts";
import { detectorColor } from "./palette.ts";
import { lookFitsOccasion, lookHasColor } from "../lookbook.ts";
import { livePool } from "../rack.ts";
import { rotationLookKey, rotationRank, type Rotation } from "../rotation.ts";
import { pieceFitsSeason, type Season } from "../season.ts";
import { daysIdle, slotOf } from "../style.ts";
import { jacketRequired, wearSlot } from "../stylist/jackets.ts";
import { applyAtlas, pieceVetoIds, type TasteMemory } from "../taste.ts";
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
/** A plain row's budget: its heroes may each need a wide retry when the day asks for a jacket. */
const WIDE_ROW_TRIES = 16000;
/** A plain (unthemed) hero that fails the beam retries over every open partner, this many tries. */
const WIDE_TRIES = 2400;
/** One pairability check for a piece that failed as a hero: every partner, no row or page cap. */
const PAIR_TRIES = 6000;
/** Heroes not yet known to pair that a plain row may try: bounds a first page in a new scope. */
const UNKNOWN_HEROES = 96;
/** Wide retries a plain row spends on heroes whose pairability is still unknown (the search cap hit). */
const UNKNOWN_WIDE = 4;

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
  /** Session rotation: least-recently-shown pieces lead; looks seen this cycle are refused. */
  rotation?: Rotation;
  /** Pieces that pair with nothing here (weekRotationRow's unpairable): never tried as heroes. */
  stuck?: ReadonlySet<string>;
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
  /** A plain dresser: a hero that fails the beam is retried over every open partner. */
  wide?: boolean;
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
  beam = BEAM,
): Garment[] | null {
  const pick = (list: Garment[], slot: SlotName): Garment[] =>
    hero.slot === slot
      ? [hero.g]
      : orderBy(list.filter((g) => g.id !== hero.g.id && open(g)).map((g) => ({ g, slot, score: score(g, slot) }))).slice(
          0,
          beam,
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

type RowOpts = {
  salt: number;
  fresh: (g: Garment, onScreen: number) => number;
  rotation?: Rotation;
  /** Cards at most; ROW_MAX unless the caller says. */
  max?: number;
  /** Never a hero: known to pair with nothing here. */
  skip?: ReadonlySet<string>;
  /**
   * For a plain dresser: whether a hero pairs with anything here at all. A hero not yet known
   * gets the cheap verdict first, then the beam; a failure is checked (a few full searches per
   * page) and costs the row nothing. After UNKNOWN_HEROES unknowns, only heroes known to pair
   * are tried, so a first page in a new scope stays quick and still fills.
   */
  pairable?: Pairable;
};

type Pairable = {
  /** Cached answer, no search. */
  known: (g: Garment) => boolean | undefined;
  /** The cheap verdict only: false when no core passes the cheap rules, else undefined. */
  cheap: (g: Garment) => false | undefined;
  /** Cached answer, or a search when this page still may run one. */
  check: (g: Garment) => boolean | undefined;
  /** A hero that dressed pairs here. */
  note: (g: Garment, ok: boolean) => void;
};

/**
 * Hero-first cards for one theme. Pieces distinct within the row, counts bumped as it goes.
 * With a rotation, heroes and partners are ordered by least-recently-shown (fit, freshness and
 * the salt no longer rank anything) and a look seen this cycle is refused.
 */
function heroRow(d: Dresser, counts: Map<string, number>, opts: RowOpts): Garment[][] {
  const { salt, fresh, rotation } = opts;
  const max = opts.max ?? ROW_MAX;
  const countOf = (g: Garment) => counts.get(g.id) ?? 0;
  const rowUsed = new Set<string>();
  const open = (g: Garment) => !rowUsed.has(g.id) && countOf(g) < SCREEN_CAP;
  const jitter = (g: Garment) => (salt > 0 ? hashId(g.id, salt) * 0.6 : 0);
  const rank = rotation ? rotationRank(rotation) : null;
  const score = rank
    ? (g: Garment) => -rank(g.id)
    : (g: Garment, slot: SlotName) => d.fit(g, slot) + fresh(g, countOf(g)) + jitter(g);
  const seen = rotation && rotation.looks.length ? new Set(rotation.looks) : null;
  const dd: Dresser = seen
    ? { ...d, finalOk: (pieces) => d.finalOk(pieces) && !seen.has(rotationLookKey(pieces.map((g) => g.id))) }
    : d;
  const heroes: Scored[] = [];
  const pools: [Garment[], SlotName][] = [
    [d.tops, "top"],
    [d.bottoms, "bottom"],
    [d.shoes, "shoe"],
    [d.layers, "layer"],
  ];
  for (const [list, slot] of pools) {
    for (const g of list) if (!opts.skip?.has(g.id) && d.theme(g, slot)) heroes.push({ g, slot, score: score(g, slot) });
  }
  heroes.sort((a, b) => b.score - a.score || a.g.id.localeCompare(b.g.id));
  const looks: Garment[][] = [];
  const budget: Budget = { tries: d.wide ? WIDE_ROW_TRIES : ROW_TRIES, hero: HERO_TRIES };
  let unknownTried = 0;
  let unknownWide = 0;
  for (const hero of heroes) {
    if (looks.length >= max || budget.tries <= 0) break;
    if (!open(hero.g)) continue;
    const known = opts.pairable?.known(hero.g);
    if (known === false) continue;
    if (known === undefined && opts.pairable) {
      if (unknownTried >= UNKNOWN_HEROES) continue;
      unknownTried += 1;
      if (opts.pairable.cheap(hero.g) === false) continue;
    }
    budget.hero = HERO_TRIES;
    const before = budget.tries;
    let look = dressHero(hero, dd, score, open, countOf, budget);
    if (!look && dd.wide && budget.tries > 0) {
      const pairs = opts.pairable ? opts.pairable.check(hero.g) : true;
      const retry = pairs === true || (pairs === undefined && unknownWide < UNKNOWN_WIDE);
      if (pairs === undefined && retry) unknownWide += 1;
      if (retry) {
        budget.hero = WIDE_TRIES;
        look = dressHero(hero, dd, score, open, countOf, budget, Number.POSITIVE_INFINITY);
      }
      /* Unpairable, or still unknown and not retried: the row keeps its budget for heroes that can dress. */
      if (!look && pairs !== true) budget.tries = before;
    }
    if (!look) continue;
    opts.pairable?.note(hero.g, true);
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
  /* A jacket theme: only a jacket may be the layer, and no card goes without one. */
  const jacket = cellKit.jacketTheme(cell);
  const owed = cellKit.layerOwed(cell);
  const colorOk = (pieces: Garment[]) => !color || detectorColor(pieces, color, cell.key).passed;
  const fit = (g: Garment, slot: SlotName) => (cellKit.grade(cell, g, slot) === "core" ? 1 : 0.5);
  return {
    tops: live.filter((g) => cellKit.slotRole(g, cell) === "top"),
    bottoms: live.filter((g) => slotOf(g) === "bottom" && cellKit.grade(cell, g, "bottom") !== "no"),
    shoes: live.filter((g) => slotOf(g) === "footwear" && cellKit.grade(cell, g, "shoe") !== "no"),
    layers: live.filter((g) => cellKit.layerRole(g, cell) && (!jacket || isOuterPiece(g))),
    coreOk: (core) => cellKit.seasonFits(core, season) && cellKit.passesCheap(cell, core, occasion, season, pool, owed),
    finalOk: (pieces) =>
      cellKit.seasonFits(pieces, season) &&
      cellKit.passesCheap(cell, pieces, occasion, season, pool) &&
      colorOk(pieces) &&
      cellKit.legalOk(pieces, occasion, season, weatherF),
    bareOk: () => !needJacket && !jacket,
    fit,
    theme: (g, slot) => isTheme(cell, g, slot),
  };
}

/** The forgotten row has no cell: the shared hard rules, the occasion and season gates, then isLegal. */
const PLAIN_CELL = { key: "", tuck: "", ban: [], fails: [] } as unknown as Cell;

/** A jacket: classified outer, or filed as outerwear. Cardigans, fleeces and vests are not. */
export function isOuterPiece(g: Garment): boolean {
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
    cellKit.seasonFits(pieces, season);
  /* Out-of-season pieces wait: they would fail every look and cost the row its budget. */
  const inSeason = (g: Garment) => pieceInSeason(g, season);
  return {
    tops: live.filter((g) => isTopPiece(g) && inSeason(g)),
    bottoms: live.filter((g) => slotOf(g) === "bottom" && inSeason(g)),
    shoes: live.filter((g) => slotOf(g) === "footwear" && inSeason(g)),
    layers: live.filter((g) => isOuterPiece(g) && inSeason(g)),
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
    rotation?: Rotation;
    stuck?: ReadonlySet<string>;
  },
): Way | null {
  const forgotten = forgottenIds(garments, { today: ctx.today, suggested: ctx.suggested });
  if (!live.some((g) => forgotten.has(g.id))) return null;
  const d = forgottenDresser(live, forgotten, ctx.occasion, ctx.season, ctx.weatherF, ctx.color, pool);
  const seen = new Set<string>();
  const scope = scopeKey(ctx.occasion, ctx.season, ctx.color, ctx.weatherF, live);
  const skip = new Set(ctx.stuck ?? []);
  for (const [id, ok] of PAIRABLE.get(scope) ?? []) if (!ok) skip.add(id);
  const rows = heroRow({ ...d, wide: true }, counts, {
    salt: ctx.salt,
    fresh: ctx.fresh,
    rotation: ctx.rotation,
    skip,
    pairable: pairChecker(scope, d),
  })
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
 * that cannot reach ROW_MIN falls back to its stored disjoint rows under the same cap (and the
 * same season and jacket rules), so a thin closet still shows what it has. The usual way asks usualFromCloset as before. A
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
    const looks = heroRow(d, new Map(counts), { salt, fresh, rotation: ctx.rotation, skip: ctx.stuck });
    if (looks.length < ROW_MIN) {
      if (short.length < THEME_ROWS) short.push(way);
      continue;
    }
    for (const look of looks) for (const g of look) counts.set(g.id, (counts.get(g.id) ?? 0) + 1);
    out.push({ ...way, pieces: looks[0] ?? way.pieces, looks: { ...way.looks, [occasion]: looks } });
  }
  const forgotten = forgottenWay(garments, live, pool, counts, {
    occasion,
    season,
    weatherF,
    color,
    salt,
    today,
    fresh,
    suggested: ctx.suggested,
    rotation: ctx.rotation,
    stuck: ctx.stuck,
  });
  if (!out.length && !forgotten && short.length) {
    /* No theme reaches three distinct heroes and nothing is forgotten: the stored disjoint rows,
       under the cap, say "Only N in your closet" as before rather than leaving the page bare. */
    const stored = storedRows(short, garments, { occasion, season, color, weatherF, salt });
    for (const [i, way] of short.entries()) {
      const cell = cellKit.cells().find((row) => row.id === way.id);
      const jacket = cell ? cellKit.jacketTheme(cell) : false;
      const kept = maxDisjoint(stored[i]?.looks[occasion] ?? []).filter(
        (look) =>
          look.every((g) => (counts.get(g.id) ?? 0) < SCREEN_CAP) &&
          cellKit.seasonFits(look, season) &&
          (!jacket || look.some(isOuterPiece)),
      );
      if (!kept.length) continue;
      for (const look of kept) for (const g of look) counts.set(g.id, (counts.get(g.id) ?? 0) + 1);
      out.push({ ...way, pieces: kept[0]!, looks: { ...way.looks, [occasion]: kept } });
    }
  }
  if (forgotten) out.push(forgotten);
  return out;
}

/** A piece alone fits the season: the per-piece season rules plus seasonFits' summer-only gate. */
function pieceInSeason(g: Garment, season: Season): boolean {
  return pieceFitsSeason(g, season) && (season === "summer" || !isSummerOnlyPiece(g));
}

/** Pieces a rotation page may show: top, bottom, shoe or jacket, in season, not vetoed. */
function dressable(g: Garment): boolean {
  const slot = slotOf(g);
  return slot === "top" || slot === "dress" || slot === "bottom" || slot === "footwear" || slot === "outerwear";
}

/**
 * The pieces coverage waits for: every live piece in a dressable slot that fits the season on
 * its own and is not vetoed. Out-of-season pieces wait for their season.
 */
export function rotationEligible(garments: Garment[], season: Season | string, taste?: TasteMemory): Garment[] {
  const sea = (season || "fall") as Season;
  const veto = taste ? pieceVetoIds(taste) : null;
  return livePool(garments).filter(
    (g) => !cellKit.deleted.has(g.id) && !veto?.has(g.id) && dressable(g) && pieceInSeason(g, sea),
  );
}

/** The plain dresser: the shared hard rules, the occasion and season gates, colour, taste, then isLegal. */
function plainDresser(
  live: Garment[],
  occasion: Occasion,
  season: Season,
  weatherF: number | undefined,
  color: string | null,
  pool: Garment[],
  taste: TasteMemory | undefined,
  bare: boolean,
): Dresser {
  const needJacket = jacketRequired(occasion, season, weatherF);
  const colorOk = (pieces: Garment[]) => !color || lookHasColor(pieces, color);
  const tasteOk = (pieces: Garment[]) => {
    if (!taste || !taste.vetoes.length) return true;
    const kept = applyAtlas(pieces, taste);
    return Boolean(kept) && kept!.length === pieces.length;
  };
  const cheap = (pieces: Garment[]) =>
    new Set(pieces.map((g) => g.id)).size === pieces.length &&
    !pieces.some((g) => cellKit.deleted.has(g.id)) &&
    !cellKit.globalFail(PLAIN_CELL, pieces) &&
    lookFitsOccasion(pieces, occasion, pool, undefined) &&
    cellKit.seasonFits(pieces, season);
  const inSeason = (g: Garment) => pieceInSeason(g, season);
  return {
    tops: live.filter((g) => isTopPiece(g) && inSeason(g)),
    bottoms: live.filter((g) => slotOf(g) === "bottom" && inSeason(g)),
    shoes: live.filter((g) => slotOf(g) === "footwear" && inSeason(g)),
    layers: live.filter((g) => isOuterPiece(g) && inSeason(g)),
    coreOk: cheap,
    finalOk: (pieces) =>
      cheap(pieces) && colorOk(pieces) && tasteOk(pieces) && cellKit.legalOk(pieces, occasion, season, weatherF),
    bareOk: () => bare || !needJacket,
    fit: () => 1,
    theme: () => true,
    wide: true,
  };
}

/** Pairability per scope (closet, occasion, season, colour, weather): one search per piece, ever. */
const PAIRABLE = new Map<string, Map<string, boolean>>();
/** Pairability searches one page may run; the rest wait for the next page. */
const PAIR_SEARCHES = 6;

function scopeKey(occasion: Occasion, season: Season, color: string | null, weatherF: number | undefined, live: Garment[]): string {
  return [occasion, season, color ?? "", weatherF ?? "", live.map((g) => g.id).join(",")].join("|");
}

function pairCache(scope: string): Map<string, boolean> {
  let cache = PAIRABLE.get(scope);
  if (!cache) {
    cache = new Map();
    PAIRABLE.set(scope, cache);
    if (PAIRABLE.size > 8) {
      const first = PAIRABLE.keys().next().value;
      if (first) PAIRABLE.delete(first);
    }
  }
  return cache;
}

function heroSlot(hero: Garment): SlotName | null {
  if (isOuterPiece(hero)) return "layer";
  if (slotOf(hero) === "bottom") return "bottom";
  if (slotOf(hero) === "footwear") return "shoe";
  return isTopPiece(hero) ? "top" : null;
}

/**
 * The cheap verdict: a core piece whose every (top, bottom, shoe) core fails the cheap rules
 * (occasion, season, the shared hard rules) can never pair, whatever the layer. A few hundred
 * cheap checks, no legality engine. A layer is not decided here.
 */
function cheapUnpairable(hero: Garment, slot: SlotName, d: Dresser): boolean {
  if (slot === "layer") return false;
  const tops = slot === "top" ? [hero] : d.tops;
  const bottoms = slot === "bottom" ? [hero] : d.bottoms;
  const shoes = slot === "shoe" ? [hero] : d.shoes;
  for (const top of tops) {
    for (const bottom of bottoms) {
      for (const shoe of shoes) {
        if (top.id === bottom.id || top.id === shoe.id || bottom.id === shoe.id) continue;
        if (d.coreOk([top, bottom, shoe])) return false;
      }
    }
  }
  return true;
}

/** A page's pairability checker: cached answers are free, full searches are capped per page. */
function pairChecker(scope: string, d: Dresser): Pairable {
  const cache = pairCache(scope);
  let searches = 0;
  const cheap = (g: Garment): false | undefined => {
    const slot = heroSlot(g);
    if (slot && !cheapUnpairable(g, slot, d)) return undefined;
    cache.set(g.id, false);
    return false;
  };
  return {
    known: (g) => cache.get(g.id),
    cheap: (g) => (cache.get(g.id) === undefined ? cheap(g) : cache.get(g.id) ? undefined : false),
    check: (g) => {
      const hit = cache.get(g.id);
      if (hit !== undefined) return hit;
      if (cheap(g) === false) return false;
      if (searches >= PAIR_SEARCHES) return undefined;
      searches += 1;
      return pairableIn(scope, g, d);
    },
    note: (g, ok) => {
      if (!cache.has(g.id)) cache.set(g.id, ok);
    },
  };
}

function pairableIn(scope: string, hero: Garment, d: Dresser): boolean {
  const cache = pairCache(scope);
  const hit = cache.get(hero.id);
  if (hit !== undefined) return hit;
  const slot = heroSlot(hero);
  let ok = false;
  if (slot && !cheapUnpairable(hero, slot, d)) {
    const budget: Budget = { tries: PAIR_TRIES, hero: PAIR_TRIES };
    const byId = (a: Garment, b: Garment) => a.id.localeCompare(b.id);
    const wide: Dresser = {
      ...d,
      tops: [...d.tops].sort(byId),
      bottoms: [...d.bottoms].sort(byId),
      shoes: [...d.shoes].sort(byId),
      layers: [...d.layers].sort(byId),
    };
    ok = Boolean(
      dressHero({ g: hero, slot, score: 0 }, wide, () => 0, () => true, () => 0, budget, Number.POSITIVE_INFINITY),
    );
  }
  cache.set(hero.id, ok);
  return ok;
}

export type WeekRotation = {
  /** The cards, in order. */
  looks: Garment[][];
  /** Indexes of cards that go without the jacket the day asks for: every jacket was spent. */
  demoted: number[];
  /** Eligible pieces that no legal look here can hold. Listed, never silently dropped. */
  unpairable: Garment[];
  /** What coverage waits for in this scope (rotationEligible). */
  eligible: string[];
};

/**
 * The week row under rotation: hero-first cards from the plain rules, heroes and partners in
 * least-recently-shown order, no piece twice in the row, no look seen this cycle. When the day
 * asks for a jacket and the jackets run out, the remaining heroes go bare and are marked
 * demoted, as the engine's JKT-COV-1 did. A hero that finds no card is checked once for
 * pairability in this scope; the ones that can never pair are returned, not dropped quietly.
 */
export function weekRotationRow(
  garments: Garment[],
  ctx: IdeaContext & { cap?: number; taste?: TasteMemory },
): WeekRotation {
  const occasion = (ctx.occasion || "weekday") as Occasion;
  const season = (ctx.season || "fall") as Season;
  const color = ctx.color ?? null;
  const weatherF = finiteTemp(ctx.weatherF);
  const cap = Math.max(0, ctx.cap ?? ROW_MAX);
  const pool = livePool(garments);
  const veto = ctx.taste ? pieceVetoIds(ctx.taste) : null;
  const live = pool.filter((g) => !cellKit.deleted.has(g.id) && !veto?.has(g.id));
  const eligible = rotationEligible(garments, season, ctx.taste).map((g) => g.id);
  const counts = pieceCounts((ctx.onScreen ?? []).map((id) => [{ id }]));
  const today = ctx.today ?? todayISO();
  const fresh = (g: Garment, onScreen: number) => freshness(g, { today, suggested: ctx.suggested }, onScreen);
  const salt = ctx.salt ?? 0;
  const strict = plainDresser(live, occasion, season, weatherF, color, pool, ctx.taste, false);
  const scope = scopeKey(occasion, season, color, weatherF, live);
  const skip = new Set(ctx.stuck ?? []);
  for (const [id, ok] of PAIRABLE.get(scope) ?? []) if (!ok) skip.add(id);
  const pairable = pairChecker(scope, strict);
  const looks = heroRow(strict, counts, { salt, fresh, rotation: ctx.rotation, max: cap, skip, pairable });
  const demoted: number[] = [];
  const needJacket = jacketRequired(occasion, season, weatherF);
  const used = new Set(looks.flat().map((g) => g.id));
  const jacketsLeft = strict.layers.some((g) => !used.has(g.id) && pairable.known(g) !== false);
  if (needJacket && looks.length < cap && !jacketsLeft) {
    const left = live.filter((g) => !used.has(g.id));
    const bare = plainDresser(left, occasion, season, weatherF, color, pool, ctx.taste, true);
    const more = heroRow({ ...bare, layers: [] }, counts, {
      salt,
      fresh,
      rotation: ctx.rotation,
      max: cap - looks.length,
      skip,
      pairable,
    });
    for (const look of more) {
      demoted.push(looks.length);
      looks.push(look);
    }
  }
  /* Every piece this scope has found unpairable so far, so the caller's list is complete. */
  const unpairable: Garment[] = [];
  for (const [id, ok] of PAIRABLE.get(scope) ?? []) {
    if (ok) continue;
    const g = live.find((x) => x.id === id);
    if (g) unpairable.push(g);
  }
  return { looks, demoted, unpairable, eligible };
}

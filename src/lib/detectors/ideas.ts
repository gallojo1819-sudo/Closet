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
 * the same way from the plain rules: the style rules are pass/fail guardrails only. Lists never
 * shrink: when the unseen looks run out a row is filled from the whole closet, least-recently-
 * shown first (fillRow), the week row to its cap and every row to ROW_MIN; the section always
 * shows STORY_ROWS rows, plain rows (FILL_TITLES) after the themes, a short plain row rather
 * than none when the page cap leaves too few pieces. Weekday admits any long-sleeve top here
 * (isLongSleeveTop in lookbook.ts); the engine's gate is unchanged. Under rotation, look-alike
 * pieces (twinKey: the same slot, colour, material and kind, as four pairs of white leather
 * sneakers stored apart) count as one piece for the row and page caps and take one turn.
 * Colours spread: a family already a third of the page ranks its pieces after the rest, and
 * brown suede jackets past a third of the page's jackets are swapped (spreadJackets). Pure:
 * relative imports only, no React, no DOM.
 */
import { cellKit, isSummerOnlyPiece, maxDisjoint, rankedWays, ROW_MAX, storedRows, type Cell, type Way } from "./cells.ts";
import { detectorColor } from "./palette.ts";
import type { PaletteColor } from "../color.ts";
import { looseColor, nameLeadColor } from "../garment-color.ts";
import { leadPiece } from "../look-collage.ts";
import { weekLeadPiece } from "../look.ts";
import { lookFitsOccasion, lookHasColor } from "../lookbook.ts";
import { livePool } from "../rack.ts";
import { rotationLookKey, rotationRank, type Rotation } from "../rotation.ts";
import { pieceFitsSeason, type Season } from "../season.ts";
import { daysIdle, isBrownSuedeOuter, slotOf } from "../style.ts";
import { jacketRequired, wearSlot } from "../stylist/jackets.ts";
import { applyAtlas, pieceVetoIds, type TasteMemory } from "../taste.ts";
import type { Garment, Occasion } from "../types.ts";
import { todayISO } from "../utils.ts";

/** Most cards one piece is on across one screen (every row and the week row). */
export const SCREEN_CAP = 2;
/** The page cap a plain row owed to the section may use when the strict cap leaves it short. */
export const RELAXED_CAP = SCREEN_CAP + 1;
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
/** Rows the idea section always shows under rotation: the themes, the forgotten row, then plain rows from the whole closet. */
export const STORY_ROWS = 4;
export const FILL_ID = "more";
/** Titles of the plain rows that fill the section to STORY_ROWS, in order. */
export const FILL_TITLES = ["More from your closet", "Next in the rotation", "Another turn", "One more turn"] as const;
/** The rotation rows' occasion gate: weekday takes any long-sleeve top. */
const WIDE = { wideWeekdayTops: true } as const;
/** Brown suede jackets past this share of a page's jackets are swapped for the next jacket. */
export const SUEDE_SHARE = 1 / 3;
/** A colour family at this share of the page's pieces ranks its pieces after the rest. */
export const FAMILY_SHARE = 1 / 3;
/** Pieces on the page before a family share is judged. */
const FAMILY_MIN = 6;
/** Pushes a partner behind every rank; ranks are bounded by the closet size. */
const FAMILY_PENALTY = 1e6;

type SlotName = "top" | "bottom" | "shoe" | "layer";

export type ColorFamily = "blue" | "white" | "brown" | "green" | "red" | "pink" | "grey";

const FAMILY: Record<PaletteColor, ColorFamily> = {
  navy: "blue",
  "light blue": "blue",
  cream: "white",
  white: "white",
  ivory: "white",
  khaki: "brown",
  beige: "brown",
  tan: "brown",
  camel: "brown",
  brown: "brown",
  chocolate: "brown",
  gold: "brown",
  olive: "green",
  forest: "green",
  maroon: "red",
  burgundy: "red",
  wine: "red",
  rust: "red",
  pink: "pink",
  blush: "pink",
  grey: "grey",
  charcoal: "grey",
  black: "grey",
};

const FAMILY_OF = new WeakMap<Garment, ColorFamily | null>();

/** The piece's colour family: the colour its name leads with, else its first tagged colour. */
export function colorFamily(g: Garment): ColorFamily | null {
  const hit = FAMILY_OF.get(g);
  if (hit !== undefined) return hit;
  const color = nameLeadColor(g.name) ?? looseColor(g.colors?.[0]);
  const fam = color ? FAMILY[color] : null;
  FAMILY_OF.set(g, fam);
  return fam;
}

/** Share of the counted pieces (cards' pieces, as pieceCounts) in each colour family. */
export function familyShares(counts: ReadonlyMap<string, number>, byId: ReadonlyMap<string, Garment>): Map<ColorFamily, number> {
  let total = 0;
  const per = new Map<ColorFamily, number>();
  for (const [id, n] of counts) {
    const g = byId.get(id);
    if (!g) continue;
    total += n;
    const fam = colorFamily(g);
    if (fam) per.set(fam, (per.get(fam) ?? 0) + n);
  }
  const out = new Map<ColorFamily, number>();
  if (total) for (const [fam, n] of per) out.set(fam, n / total);
  return out;
}

/**
 * Look-alike pieces: the slot, the colour the name leads with (else the first tagged colour),
 * the material and the last word of the name. Four pairs of "white leather sneakers" stored as
 * four garments, or a brown suede bomber and a brown suede field jacket, are one piece to the
 * eye, so the row and page caps and the rotation treat them as one.
 */
export function twinKey(g: Garment): string {
  const words = g.name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const noun = (words.at(-1) ?? "").replace(/(?<!s)s$/, "");
  const color = nameLeadColor(g.name) ?? looseColor(g.colors?.[0]) ?? (g.colors?.[0] ?? "").trim().toLowerCase();
  const material = (g.material ?? "").trim().toLowerCase() || words.at(-2) || "";
  return `${slotOf(g)}|${color}|${material}|${noun}`;
}

/**
 * The photo a piece was added from (fileHash: the fingerprint of the source file, see rack.ts).
 * Two garments made from one photo are one piece stored twice, whatever their name or material
 * fields say; a piece with no hash stands on its own.
 */
function photoKey(g: Garment): string | null {
  const hash = (g.fileHash ?? "").trim();
  return hash ? `${slotOf(g)}|${hash}` : null;
}

export type Twins = {
  key: (g: Garment) => string;
  /** The pieces that share a key with `g`, `g` among them. */
  of: (g: Garment) => readonly Garment[];
};

/**
 * The twin groups of a pool: built once per page, read by every row. twinKey groups first;
 * then groups whose members share a photo (photoKey) are merged into one (only ever more
 * grouping, never a split). A name alone never merges: two shirts both stored as "brown blue
 * plaid shirt" (a regular collar, warmth 3, and a button-down, warmth 2) are two shirts, so
 * each gets its own cards under the caps and its own turn of the rotation.
 */
export function twinGroups(pool: readonly Garment[]): Twins {
  const alias = new Map<string, string>();
  const find = (key: string): string => {
    let out = key;
    while (alias.has(out)) out = alias.get(out)!;
    return out;
  };
  const byPhoto = new Map<string, string>();
  for (const g of pool) {
    const photo = photoKey(g);
    if (!photo) continue;
    const key = find(twinKey(g));
    const have = byPhoto.get(photo);
    if (have === undefined) byPhoto.set(photo, key);
    else if (find(have) !== key) alias.set(key, find(have));
  }
  const keys = new Map<string, string>();
  const groups = new Map<string, Garment[]>();
  for (const g of pool) {
    const key = find(twinKey(g));
    keys.set(g.id, key);
    const group = groups.get(key);
    if (group) group.push(g);
    else groups.set(key, [g]);
  }
  const key = (g: Garment) => keys.get(g.id) ?? twinKey(g);
  return { key, of: (g) => groups.get(key(g)) ?? [g] };
}

/** No grouping: every piece its own twin. What the rows use when no rotation is in play. */
export function soloTwins(): Twins {
  return { key: (g) => g.id, of: (g) => [g] };
}

/** Cards per twin key across the looks: what the page cap is really checked against. */
export function twinCounts(looks: readonly (readonly Garment[])[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const look of looks) for (const g of look) counts.set(twinKey(g), (counts.get(twinKey(g)) ?? 0) + 1);
  return counts;
}

/** Cards the twins of `g` are on, by the id counts. */
function twinCount(counts: ReadonlyMap<string, number>, twins: Twins, g: Garment): number {
  let n = 0;
  for (const t of twins.of(g)) n += counts.get(t.id) ?? 0;
  return n;
}

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
  /**
   * Ids of the pieces that lead a card already on the page (the week row's `leads`: each card's
   * leadPiece). A piece leads one card a page, so no idea row card leads with them.
   */
  leadIds?: readonly string[];
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

/**
 * Pieces (other than jackets) that sit on more than one card of the row, by id. Empty for a
 * good row. Look-alikes are checked with twinCounts.
 */
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
  /** Cards already in the row (a fill pass): their pieces stay distinct, their counts stand. */
  seed?: readonly Garment[][];
  /** The page's look-alike groups; built from the dresser's pools when the caller has none. */
  twins?: Twins;
  /** Cards a piece (with its twins) may be on across the page; SCREEN_CAP unless a relaxed pass says. */
  cap?: number;
  /**
   * For a plain dresser: whether a hero pairs with anything here at all. A hero not yet known
   * gets the cheap verdict first, then the beam; a failure is checked (a few full searches per
   * page) and costs the row nothing. After UNKNOWN_HEROES unknowns, only heroes known to pair
   * are tried, so a first page in a new scope stays quick and still fills.
   */
  pairable?: Pairable;
  /**
   * Twin keys of the pieces that lead a card somewhere on this page (leadPiece: the outer
   * layer, else the top, as the card shows it). A piece leads one card a page: a jacket that
   * leads already is closed to the row (a jacket always leads its card); a top that leads
   * already may still sit under a jacket but not lead a bare card. Mutated as cards land, so
   * callers that may discard a row hand in a copy and commit it with the row.
   */
  led?: Set<string>;
  /** Which piece a card of this row leads with; leadPiece (the idea card) unless the caller says. */
  leadOf?: (pieces: readonly Garment[]) => Garment | null;
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
  const pools: [Garment[], SlotName][] = [
    [d.tops, "top"],
    [d.bottoms, "bottom"],
    [d.shoes, "shoe"],
    [d.layers, "layer"],
  ];
  const byId = new Map<string, Garment>();
  for (const [list] of pools) for (const g of list) byId.set(g.id, g);
  const twins = opts.twins ?? (rotation ? twinGroups([...byId.values()]) : soloTwins());
  /* A piece's cards on the page are its twins' cards too: one white sneaker, however many pairs. */
  const countOf = (g: Garment) => twinCount(counts, twins, g);
  const rowUsed = new Set<string>();
  const looks: Garment[][] = opts.seed ? opts.seed.map((look) => [...look]) : [];
  for (const look of looks) for (const g of look) rowUsed.add(twins.key(g));
  const cap = opts.cap ?? SCREEN_CAP;
  const open = (g: Garment) => !rowUsed.has(twins.key(g)) && countOf(g) < cap;
  const jitter = (g: Garment) => (salt > 0 ? hashId(g.id, salt) * 0.6 : 0);
  const rank = rotation ? twinRank(rotationRank(rotation), twins, byId.size) : null;
  /* A partner whose colour family already holds FAMILY_SHARE of the page goes behind the rest.
     The crowded families are read once per hero: the counts move only when a card lands. */
  let hot = new Set<ColorFamily>();
  const crowdedFamilies = (): Set<ColorFamily> => {
    let total = 0;
    for (const n of counts.values()) total += n;
    const out = new Set<ColorFamily>();
    if (total < FAMILY_MIN) return out;
    for (const [fam, share] of familyShares(counts, byId)) if (share >= FAMILY_SHARE) out.add(fam);
    return out;
  };
  const crowded = (g: Garment): number => {
    const fam = colorFamily(g);
    return fam && hot.has(fam) ? FAMILY_PENALTY : 0;
  };
  /* A relaxed pass (cap past SCREEN_CAP) still takes pieces under the strict cap first. */
  const over = (g: Garment) => (cap > SCREEN_CAP && countOf(g) >= SCREEN_CAP ? FAMILY_PENALTY : 0);
  const heroScore = rank
    ? (g: Garment) => -rank(g) - over(g)
    : (g: Garment, slot: SlotName) => d.fit(g, slot) + fresh(g, countOf(g)) + jitter(g);
  const score = rank ? (g: Garment) => -rank(g) - crowded(g) - over(g) : heroScore;
  const seen = rotation && rotation.looks.length ? new Set(rotation.looks) : null;
  /* A piece leads one card a page (RowOpts.led). A led jacket is closed as hero and partner;
     a led top is closed as a bare card's lead only. The finished look is checked whatever the
     path, so the rule holds for every card this row lands. */
  const led = opts.led;
  const leadOf = opts.leadOf ?? leadPiece;
  const isLed = (g: Garment) => Boolean(led?.size && led.has(twins.key(g)));
  const leadOk = (pieces: Garment[]) => {
    const lead = leadOf(pieces);
    return !lead || !isLed(lead);
  };
  const dd: Dresser = {
    ...d,
    finalOk: (pieces) =>
      d.finalOk(pieces) && (!seen || !seen.has(rotationLookKey(pieces.map((g) => g.id)))) && leadOk(pieces),
  };
  const heroes: Scored[] = [];
  for (const [list, slot] of pools) {
    for (const g of list) if (!opts.skip?.has(g.id) && d.theme(g, slot)) heroes.push({ g, slot, score: heroScore(g, slot) });
  }
  heroes.sort((a, b) => b.score - a.score || a.g.id.localeCompare(b.g.id));
  const budget: Budget = { tries: d.wide ? WIDE_ROW_TRIES : ROW_TRIES, hero: HERO_TRIES };
  let unknownTried = 0;
  let unknownWide = 0;
  const needLayer = !d.bareOk([]);
  /* A jacket that leads a card already cannot sit on another (it would lead it too). */
  const openHere = (g: Garment) => open(g) && !(isLed(g) && isOuterPiece(g));
  for (const hero of heroes) {
    if (looks.length >= max || budget.tries <= 0) break;
    if (!openHere(hero.g)) continue;
    /* A partner slot with nothing open (the page cap, the row): no search, no pairability check. */
    if (
      (hero.slot !== "top" && !d.tops.some(openHere)) ||
      (hero.slot !== "bottom" && !d.bottoms.some(openHere)) ||
      (hero.slot !== "shoe" && !d.shoes.some(openHere)) ||
      (hero.slot !== "layer" && needLayer && !d.layers.some(openHere))
    )
      continue;
    const known = opts.pairable?.known(hero.g);
    if (known === false) continue;
    if (known === undefined && opts.pairable) {
      if (unknownTried >= UNKNOWN_HEROES) continue;
      unknownTried += 1;
      if (opts.pairable.cheap(hero.g) === false) continue;
    }
    budget.hero = HERO_TRIES;
    const before = budget.tries;
    if (rank) hot = crowdedFamilies();
    let look = dressHero(hero, dd, score, openHere, countOf, budget);
    if (!look && dd.wide && budget.tries > 0) {
      const pairs = opts.pairable ? opts.pairable.check(hero.g) : true;
      const retry = pairs === true || (pairs === undefined && unknownWide < UNKNOWN_WIDE);
      if (pairs === undefined && retry) unknownWide += 1;
      if (retry) {
        budget.hero = WIDE_TRIES;
        look = dressHero(hero, dd, score, openHere, countOf, budget, Number.POSITIVE_INFINITY);
      }
      /* Unpairable, or still unknown and not retried: the row keeps its budget for heroes that can dress. */
      if (!look && pairs !== true) budget.tries = before;
    }
    if (!look) continue;
    opts.pairable?.note(hero.g, true);
    looks.push(look);
    for (const g of look) {
      rowUsed.add(twins.key(g));
      counts.set(g.id, (counts.get(g.id) ?? 0) + 1);
    }
    const lead = leadOf(look);
    if (led && lead) led.add(twins.key(lead));
  }
  return looks;
}

/** The twin keys of the pieces that lead these cards (leadPiece), added to `led`. */
function noteLeads(looks: readonly (readonly Garment[])[], twins: Twins, led: Set<string>): void {
  for (const look of looks) {
    const lead = leadPiece(look);
    if (lead) led.add(twins.key(lead));
  }
}

/**
 * Least-recently-shown over twin groups: a group ranks by its latest-shown member, so four
 * pairs of the same sneaker take one turn, and within the group the member shown longest ago
 * leads. Ranks are -1 (never queued) or a queue index; the member term stays under one.
 */
function twinRank(rank: (id: string) => number, twins: Twins, span: number): (g: Garment) => number {
  const scale = span + 2;
  const memo = new Map<string, number>();
  return (g) => {
    const hit = memo.get(g.id);
    if (hit !== undefined) return hit;
    let latest = -1;
    for (const t of twins.of(g)) latest = Math.max(latest, rank(t.id));
    const out = latest + (rank(g.id) + 1) / scale;
    memo.set(g.id, out);
    return out;
  };
}

/** The rotation with no refused looks: the fill pass may show a look seen this cycle. */
function unseen(r: Rotation): Rotation {
  return r.looks.length ? { ...r, looks: [] } : r;
}

/**
 * heroRow, then when the row is short of `min` and the cycle refuses looks, the same row again
 * with the seen looks allowed: least-recently-shown pieces from the whole closet fill it to
 * `min` rather than leave it short. Without a rotation a row is what heroRow found.
 */
function fillRow(d: Dresser, counts: Map<string, number>, opts: RowOpts, min: number): Garment[][] {
  const looks = heroRow(d, counts, opts);
  if (looks.length >= min || !opts.rotation?.looks.length) return looks;
  return heroRow(d, counts, { ...opts, rotation: unseen(opts.rotation), seed: looks, max: Math.max(min, looks.length) });
}

/**
 * Brown suede jackets past SUEDE_SHARE of the page's jackets (the cards counted so far, this row
 * included): the latest such card takes the next-least-recently-shown jacket that is not brown
 * suede, not in the row (twins included), under the page cap and legal with the card's core.
 * Stops when the share is met or no other jacket fits. Counts are kept current.
 */
function spreadJackets(
  looks: Garment[][],
  d: Dresser,
  counts: Map<string, number>,
  byId: ReadonlyMap<string, Garment>,
  rotation: Rotation | undefined,
  twins: Twins,
  /** The page's lead keys: when the jacket leads the card (leadOf), the one swapped in must not lead another. */
  led?: Set<string>,
  leadOf: (pieces: readonly Garment[]) => Garment | null = leadPiece,
): void {
  let total = 0;
  let suede = 0;
  for (const [id, n] of counts) {
    const g = byId.get(id);
    if (!g || !isOuterPiece(g)) continue;
    total += n;
    if (isBrownSuedeOuter(g)) suede += n;
  }
  const rank = rotation ? twinRank(rotationRank(rotation), twins, byId.size) : null;
  const rowUsed = new Set(looks.flat().map((g) => twins.key(g)));
  for (let i = looks.length - 1; i >= 0 && suede > total * SUEDE_SHARE; i -= 1) {
    const look = looks[i]!;
    const old = look.find(isOuterPiece);
    if (!old || !isBrownSuedeOuter(old)) continue;
    const core = look.filter((g) => g.id !== old.id);
    const options = d.layers
      .filter(
        (g) =>
          isOuterPiece(g) &&
          !isBrownSuedeOuter(g) &&
          !rowUsed.has(twins.key(g)) &&
          !led?.has(twins.key(g)) &&
          twinCount(counts, twins, g) < SCREEN_CAP,
      )
      .sort((a, b) => (rank ? rank(a) - rank(b) : 0) || a.id.localeCompare(b.id));
    const next = options.find((g) => {
      const swapped = [...core, g];
      if (!d.finalOk(swapped)) return false;
      /* The swap must not hand the card a lead that leads another card (no-op where the top leads). */
      const lead = leadOf(swapped);
      return !lead || lead.id === leadOf(look)?.id || !led?.has(twins.key(lead));
    });
    if (!next) continue;
    const was = leadOf(look);
    looks[i] = [...core, next];
    rowUsed.delete(twins.key(old));
    rowUsed.add(twins.key(next));
    const now = leadOf(looks[i]!);
    if (led && was && now && was.id !== now.id) {
      led.delete(twins.key(was));
      led.add(twins.key(now));
    }
    counts.set(old.id, Math.max(0, (counts.get(old.id) ?? 1) - 1));
    counts.set(next.id, (counts.get(next.id) ?? 0) + 1);
    suede -= 1;
  }
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
    coreOk: (core) => cellKit.seasonFits(core, season) && cellKit.passesCheap(cell, core, occasion, season, pool, owed, true),
    finalOk: (pieces) =>
      cellKit.seasonFits(pieces, season) &&
      cellKit.passesCheap(cell, pieces, occasion, season, pool, 0, true) &&
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
    lookFitsOccasion(pieces, occasion, pool, undefined, WIDE) &&
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
    /** Cards at most (the page's row budget); ROW_MAX unless the caller says. */
    max?: number;
    twins: Twins;
    /** The page's lead keys so far. Read only: the caller commits the row's leads with the row. */
    led?: ReadonlySet<string>;
  },
): Way | null {
  const forgotten = forgottenIds(garments, { today: ctx.today, suggested: ctx.suggested });
  if (!live.some((g) => forgotten.has(g.id))) return null;
  const d = forgottenDresser(live, forgotten, ctx.occasion, ctx.season, ctx.weatherF, ctx.color, pool);
  const seen = new Set<string>();
  const scope = scopeKey(ctx.occasion, ctx.season, ctx.color, ctx.weatherF, live);
  const skip = new Set(ctx.stuck ?? []);
  for (const [id, ok] of PAIRABLE.get(scope) ?? []) if (!ok) skip.add(id);
  /* The row dresses on its own counts and leads: only the cards it ships are charged to the page. */
  const local = new Map(counts);
  const led = new Set(ctx.led ?? []);
  const rows = fillRow(
    { ...d, wide: true },
    local,
    {
      salt: ctx.salt,
      fresh: ctx.fresh,
      rotation: ctx.rotation,
      skip,
      pairable: pairChecker(scope, d),
      max: ctx.max,
      twins: ctx.twins,
      led,
    },
    ROW_MIN,
  )
    .filter((look) => look.some((g) => forgotten.has(g.id)))
    .filter((look) => !seen.has(idsOf(look)) && seen.add(idsOf(look)));
  if (rows.length < ROW_MIN) return null;
  const shipped = new Map(counts);
  for (const look of rows) for (const g of look) shipped.set(g.id, (shipped.get(g.id) ?? 0) + 1);
  const shippedLed = new Set(ctx.led ?? []);
  noteLeads(rows, ctx.twins, shippedLed);
  spreadJackets(rows, d, shipped, new Map(live.map((g) => [g.id, g])), ctx.rotation, ctx.twins, shippedLed);
  for (const [id, n] of shipped) counts.set(id, n);
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
  const byId = new Map(live.map((g) => [g.id, g]));
  const twins = ctx.rotation ? twinGroups(live) : soloTwins();
  let counts = pieceCounts((ctx.onScreen ?? []).map((id) => [{ id }]));
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
  const scope = scopeKey(occasion, season, color, weatherF, live);
  if (ctx.rotation) census(scope, plainDresser(live, occasion, season, weatherF, color, pool, undefined, false));
  const unpairable = new Set(ctx.stuck ?? []);
  for (const [id, ok] of PAIRABLE.get(scope) ?? []) if (!ok) unpairable.add(id);
  /* A piece leads one card a page (leadPiece: the jacket, else the top, as the card shows it):
     the week row's leads come in as ctx.leadIds, then every card these rows land adds its own
     (twin keys, so four pairs of one sneaker lead once). A row that may be discarded builds on a
     copy and commits it with the row. */
  let led = new Set<string>();
  for (const id of ctx.leadIds ?? []) {
    const g = byId.get(id);
    if (g) led.add(twins.key(g));
  }
  /* Under rotation the section promises exactly STORY_ROWS rows, the forgotten row among them
     when the closet has forgotten pieces (a seat is held for it until it is built), so each
     row takes its share of the scarcest slot's room. */
  const forgottenWanted = Boolean(ctx.rotation) && live.some((g) => forgottenIds(garments, { today, suggested: ctx.suggested }).has(g.id));
  /* Rows still to build, the one in hand included: the forgotten row's seat is one of them until
     it is built; once built (its cards charged to the page) it is a row waiting to be pushed. */
  let pending = 0;
  const rowsWanted = () => Math.max(1, STORY_ROWS - pending - out.length);
  const rowMax = (d: Dresser) => (ctx.rotation ? rowBudget(d, counts, unpairable, rowsWanted(), twins) : ROW_MAX);
  const themeCap = ctx.rotation ? STORY_ROWS - (forgottenWanted ? 1 : 0) : THEME_ROWS;
  for (const way of order) {
    if (out.length >= themeCap) break;
    const cell = cellKit.cells().find((row) => row.id === way.id);
    if (!cell) continue;
    const d = cellDresser(cell, live, occasion, season, weatherF, color, pool);
    const local = new Map(counts);
    const ledLocal = new Set(led);
    const looks = fillRow(d, local, { salt, fresh, rotation: ctx.rotation, skip: ctx.stuck, max: rowMax(d), twins, led: ledLocal }, ROW_MIN);
    if (looks.length < ROW_MIN) {
      if (short.length < THEME_ROWS) short.push(way);
      continue;
    }
    spreadJackets(looks, d, local, byId, ctx.rotation, twins, ledLocal);
    counts = local;
    led = ledLocal;
    out.push({ ...way, pieces: looks[0] ?? way.pieces, looks: { ...way.looks, [occasion]: looks } });
  }
  /* The section never shrinks below STORY_ROWS: plain rows from the whole closet, least-
     recently-shown first, follow the themes (before the forgotten row, which closes the screen;
     after it only if it did not come). Jackets when the day asks for them; bare cores only when
     the jackets are spent; and when the page cap leaves too few pieces for ROW_MIN cards, the
     row ships short rather than not at all. */
  let fills = 0;
  const fillRows = (upTo: number) => {
    const rotation = ctx.rotation;
    if (!rotation) return;
    while (out.length < upTo && fills < FILL_TITLES.length) {
      const d = plainDresser(live, occasion, season, weatherF, color, pool, undefined, false);
      const ledLocal = new Set(led);
      const opts: RowOpts = {
        salt,
        fresh,
        rotation,
        skip: unpairable,
        pairable: pairChecker(scope, d),
        max: rowMax(d),
        twins,
        led: ledLocal,
      };
      let looks = fillRow(d, counts, opts, ROW_MIN);
      const needJacket = jacketRequired(occasion, season, weatherF);
      const bare = needJacket ? plainDresser(live, occasion, season, weatherF, color, pool, undefined, true) : null;
      const again = (dd: Dresser, cap: number) =>
        heroRow(dd, counts, { ...opts, rotation: unseen(rotation), seed: looks, max: ROW_MIN, cap });
      if (looks.length < ROW_MIN && bare) looks = again({ ...bare, layers: [] }, SCREEN_CAP);
      /* Too few pieces left under the page cap (a chapter with five kinds of shoe): the row is
         still owed, so its pieces may take one more card than the cap. The way says so. */
      let relaxed = false;
      if (looks.length < ROW_MIN) {
        const before = looks.length;
        looks = again(d, RELAXED_CAP);
        if (looks.length < ROW_MIN && bare) looks = again({ ...bare, layers: [] }, RELAXED_CAP);
        relaxed = looks.length > before;
      }
      if (!looks.length) return;
      spreadJackets(looks, d, counts, byId, rotation, twins, ledLocal);
      led = ledLocal;
      out.push({
        id: `${FILL_ID}-${fills + 1}`,
        title: FILL_TITLES[fills]!,
        pieces: looks[0]!,
        looks: { [occasion]: looks },
        counts: { weekday: 0, out: 0, weekend: 0, travel: 0, comfy: 0, [occasion]: looks.length },
        ...(relaxed ? { relaxed: true } : {}),
      });
      fills += 1;
    }
  };
  /* The forgotten row is built before the plain rows (it has a theme to keep; they never lack
     heroes) and shown after them, closing the screen as before. */
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
    max: forgottenWanted ? rowMax(plainDresser(live, occasion, season, weatherF, color, pool, undefined, false)) : undefined,
    twins,
    led,
  });
  if (forgotten) noteLeads(forgotten.looks[occasion] ?? [], twins, led);
  pending = forgotten ? 1 : 0;
  fillRows(STORY_ROWS - pending);
  if (!out.length && !forgotten && short.length) {
    /* No theme reaches three distinct heroes and nothing is forgotten: the stored disjoint rows,
       under the cap, say "Only N in your closet" as before rather than leaving the page bare. */
    const stored = storedRows(short, garments, { occasion, season, color, weatherF, salt });
    for (const [i, way] of short.entries()) {
      const cell = cellKit.cells().find((row) => row.id === way.id);
      const jacket = cell ? cellKit.jacketTheme(cell) : false;
      /* Disjoint by id, and by look-alike: a twin key once per row, its twins under the page cap;
         a card whose lead already leads a card on the page is left out. */
      const rowUsed = new Set<string>();
      const kept: Garment[][] = [];
      for (const look of maxDisjoint(stored[i]?.looks[occasion] ?? [])) {
        if (!look.every((g) => twinCount(counts, twins, g) < SCREEN_CAP && !rowUsed.has(twins.key(g)))) continue;
        if (!cellKit.seasonFits(look, season) || (jacket && !look.some(isOuterPiece))) continue;
        const lead = leadPiece(look);
        if (lead && led.has(twins.key(lead))) continue;
        for (const g of look) rowUsed.add(twins.key(g));
        if (lead) led.add(twins.key(lead));
        kept.push(look);
      }
      if (!kept.length) continue;
      for (const look of kept) for (const g of look) counts.set(g.id, (counts.get(g.id) ?? 0) + 1);
      out.push({ ...way, pieces: kept[0]!, looks: { ...way.looks, [occasion]: kept } });
    }
  }
  if (forgotten) out.push(forgotten);
  pending = 0;
  fillRows(STORY_ROWS);
  return out;
}

/**
 * Cards one row may take so the rows still wanted on this page get theirs: the scarcest core
 * slot's room (twin groups with a pairable member, each SCREEN_CAP minus the group's count)
 * split between the rows, never under ROW_MIN or over ROW_MAX.
 */
function rowBudget(
  d: Dresser,
  counts: ReadonlyMap<string, number>,
  unpairable: ReadonlySet<string>,
  rows: number,
  twins: Twins,
): number {
  const room = (list: Garment[]) => {
    const seen = new Set<string>();
    let n = 0;
    for (const g of list) {
      if (unpairable.has(g.id) || seen.has(twins.key(g))) continue;
      seen.add(twins.key(g));
      n += Math.max(0, SCREEN_CAP - twinCount(counts, twins, g));
    }
    return n;
  };
  const scarce = Math.min(room(d.tops), room(d.bottoms), room(d.shoes));
  return Math.min(ROW_MAX, Math.max(ROW_MIN, Math.floor(scarce / Math.max(1, rows))));
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
    lookFitsOccasion(pieces, occasion, pool, undefined, WIDE) &&
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
/**
 * Full searches' worth of tries one page may spend (the week row's heroes, then settle); the
 * rest wait for the next page. A search always gets its whole PAIR_TRIES, so a verdict is never
 * cut short; a pairable piece spends a few hundred tries, one that cannot pair spends them all.
 */
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

/** Scopes whose core pieces have had the cheap verdict (census). */
const CENSUSED = new Set<string>();

/**
 * The cheap verdict for every core piece of a scope, once: pieces no (top, bottom, shoe) core
 * can hold under the plain rules are known unpairable before the first row is built, so the
 * rows skip them and the row budgets (rowBudget) count the room that is really there.
 */
function census(scope: string, d: Dresser): void {
  if (CENSUSED.has(scope)) return;
  CENSUSED.add(scope);
  if (CENSUSED.size > 16) {
    const first = CENSUSED.values().next().value;
    if (first) CENSUSED.delete(first);
  }
  const cache = pairCache(scope);
  /* Shoes, then bottoms, then tops; each pass drops the pieces the earlier ones ruled out. */
  let dd: Dresser = d;
  const open = (list: Garment[]) => list.filter((g) => cache.get(g.id) !== false);
  const lists: [SlotName, () => Garment[]][] = [
    ["shoe", () => dd.shoes],
    ["bottom", () => dd.bottoms],
    ["top", () => dd.tops],
  ];
  for (const [slot, list] of lists) {
    for (const g of list()) {
      if (cache.has(g.id)) continue;
      if (cheapUnpairable(g, slot, dd)) cache.set(g.id, false);
    }
    dd = { ...dd, tops: open(dd.tops), bottoms: open(dd.bottoms), shoes: open(dd.shoes) };
  }
}

/** A page's pairability checker: cached answers are free, full searches are capped per page. */
function pairChecker(scope: string, d: Dresser): Pairable {
  const cache = pairCache(scope);
  let left = PAIR_SEARCHES * PAIR_TRIES;
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
      if (left < PAIR_TRIES) return undefined;
      const budget: Budget = { tries: PAIR_TRIES, hero: PAIR_TRIES };
      const ok = pairableIn(scope, g, d, budget);
      left -= PAIR_TRIES - budget.tries;
      return ok;
    },
    note: (g, ok) => {
      if (!cache.has(g.id)) cache.set(g.id, ok);
    },
  };
}

function pairableIn(scope: string, hero: Garment, d: Dresser, budget: Budget): boolean {
  const cache = pairCache(scope);
  const hit = cache.get(hero.id);
  if (hit !== undefined) return hit;
  const slot = heroSlot(hero);
  let ok = false;
  if (slot && !cheapUnpairable(hero, slot, d)) {
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

/**
 * The verdict for core pieces the row never tried: a row fills from the first heroes that
 * dress, so a piece late in the order that no legal look here can hold (the cheap gates pass,
 * the legality engine refuses every look) would stay unknown, neither shown nor listed, until
 * the order reached it. The never-shown pieces whose verdict is unknown get a full search now,
 * scarcest slot first (shoes, bottoms, tops), least-recently-shown first, with the full searches
 * the page has left (PAIR_SEARCHES, shared with the row); the rest wait for the next page.
 * Pairable pieces resolve in a few tries, so the budget goes to the ones that cannot pair.
 */
function settle(d: Dresser, pairable: Pairable, rotation: Rotation, twins: Twins, span: number): void {
  const rank = twinRank(rotationRank(rotation), twins, span);
  for (const list of [d.shoes, d.bottoms, d.tops]) {
    const open = list.filter((g) => pairable.known(g) === undefined).sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
    for (const g of open) if (pairable.check(g) === undefined) return;
  }
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
  /** The id of each card's lead piece (leadPiece), for the rows' ctx.leadIds: a piece leads one card a page. */
  leads: string[];
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
  if (ctx.rotation) census(scope, strict);
  const skip = new Set(ctx.stuck ?? []);
  for (const [id, ok] of PAIRABLE.get(scope) ?? []) if (!ok) skip.add(id);
  const pairable = pairChecker(scope, strict);
  const twins = ctx.rotation ? twinGroups(live) : soloTwins();
  /* A piece leads one card a page: the row's own cards, after any the caller says lead already. */
  const led = new Set<string>();
  for (const id of ctx.leadIds ?? []) {
    const g = live.find((x) => x.id === id);
    if (g) led.add(twins.key(g));
  }
  const opts: RowOpts = { salt, fresh, rotation: ctx.rotation, max: cap, skip, pairable, twins, led, leadOf: weekLeadPiece };
  /* The unseen looks first; when they run out, the least-recently-shown pieces fill the row to its cap. */
  const looks = fillRow(strict, counts, opts, cap);
  const demoted: number[] = [];
  const needJacket = jacketRequired(occasion, season, weatherF);
  if (needJacket && looks.length < cap) {
    /* The jackets are spent (or none left pairs): the rest of the row goes bare, marked demoted. */
    const used = new Set(looks.flat().map((g) => g.id));
    const left = live.filter((g) => !used.has(g.id));
    const bare = plainDresser(left, occasion, season, weatherF, color, pool, ctx.taste, true);
    const more = fillRow({ ...bare, layers: [] }, counts, { ...opts, max: cap - looks.length }, cap - looks.length);
    for (const look of more) {
      demoted.push(looks.length);
      looks.push(look);
    }
  }
  spreadJackets(looks, strict, counts, new Map(live.map((g) => [g.id, g])), ctx.rotation, twins, led, weekLeadPiece);
  if (ctx.rotation) settle(strict, pairable, ctx.rotation, twins, live.length);
  /* Every piece this scope has found unpairable so far, so the caller's list is complete. */
  const unpairable: Garment[] = [];
  for (const [id, ok] of PAIRABLE.get(scope) ?? []) {
    if (ok) continue;
    const g = live.find((x) => x.id === id);
    if (g) unpairable.push(g);
  }
  const leads = looks.map((look) => weekLeadPiece(look)?.id).filter((id): id is string => Boolean(id));
  return { looks, demoted, unpairable, eligible, leads };
}

/**
 * For tests and diagnostics: whether `jacket` could still lead one more card of the row `wayId`
 * (a theme cell, a plain FILL row, or the forgotten row) dressed from `open` (the tops, bottoms
 * and shoes still under the page cap and not in that row), by the row's own gates: the theme
 * (some piece of the card is a theme piece; a forgotten card holds a forgotten piece), the
 * season, the occasion, the colour, then the legality engine. Every combination is tried, not a
 * beam, so a false here means the row truly has no card left for that jacket.
 */
export function wayCanDress(
  wayId: string,
  jacket: Garment,
  open: readonly Garment[],
  garments: Garment[],
  ctx: Pick<IdeaContext, "occasion" | "season" | "weatherF" | "color" | "today" | "suggested">,
): boolean {
  const occasion = (ctx.occasion || "weekday") as Occasion;
  const season = (ctx.season || "fall") as Season;
  const color = ctx.color ?? null;
  const weatherF = finiteTemp(ctx.weatherF);
  const pool = livePool(garments);
  const live = [jacket, ...open.filter((g) => g.id !== jacket.id)];
  let d: Dresser;
  let themed: (look: Garment[]) => boolean;
  if (wayId === FORGOTTEN_ID) {
    const forgotten = forgottenIds(garments, { today: ctx.today ?? todayISO(), suggested: ctx.suggested });
    d = forgottenDresser(live, forgotten, occasion, season, weatherF, color, pool);
    themed = (look) => look.some((g) => forgotten.has(g.id));
  } else if (wayId.startsWith(FILL_ID)) {
    d = plainDresser(live, occasion, season, weatherF, color, pool, undefined, false);
    themed = () => true;
  } else {
    const cell = cellKit.cells().find((row) => row.id === wayId);
    if (!cell) return false;
    const cd = cellDresser(cell, live, occasion, season, weatherF, color, pool);
    d = cd;
    themed = (look) => look.some((g) => {
      const slot = slotNameOf(g, cell);
      return slot ? cd.theme(g, slot) : false;
    });
  }
  if (!d.layers.some((g) => g.id === jacket.id)) return false;
  for (const top of d.tops) {
    for (const bottom of d.bottoms) {
      for (const shoe of d.shoes) {
        const core = [top, bottom, shoe];
        if (!d.coreOk(core)) continue;
        const look = [...core, jacket];
        if (themed(look) && d.finalOk(look)) return true;
      }
    }
  }
  return false;
}

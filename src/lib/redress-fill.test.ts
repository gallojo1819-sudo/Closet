/**
 * Redress fill: every Re-dress shows a page as full as the closet allows, and over a few taps
 * every piece that can pair gets a turn. The closet is the snapshot fixture
 * (engine-garments.json): the owner's pieces, brands stripped, the fifteen shirts, trousers,
 * jeans and chinos added on Oct 10 2026 among them; the clock is frozen at the snapshot's
 * instant. A row never repeats a piece, so a chapter whose scarcest core slot (top, bottom or
 * shoe) has fewer pairable look-alike groups than the week cap gets exactly that many week
 * cards: on this closet the "out" chapter, where only the non-sneaker shoes (loafers, boots and
 * the suede mules) pair. A piece no legal look can hold is listed as unpairable, never dropped
 * silently; the mules in winter walk that path. Taps are simulated as the Lookbook page does
 * them: the week row (weekRotationRow), then the rows (rowWays) with the week's pieces on
 * screen, the rotation advanced after each.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  colorFamily,
  familyShares,
  FILL_ID,
  isOuterPiece,
  pieceCounts,
  RELAXED_CAP,
  ROW_MIN,
  rotationEligible,
  rowRepeats,
  rowWays,
  SCREEN_CAP,
  STORY_ROWS,
  SUEDE_SHARE,
  twinCounts,
  twinGroups,
  visibleDetectors,
  weekRotationRow,
} from "./detectors.ts";
import { isLongSleeveTop, lookFitsOccasion } from "./lookbook.ts";
import { advanceRotation, emptyRotation, rotationLookKey, type Rotation } from "./rotation.ts";
import { lookFitsSeason } from "./season.ts";
import { isBrownSuedeOuter } from "./style.ts";
import { isLegal } from "./stylist/legal.ts";
import { OCCASIONS, type Garment, type Occasion, type Season } from "./types.ts";
import { NEXT_PLAIN_ROW, roomLeft, roomLine } from "./__fixtures__/page-room.ts";
import { TEST_CLOSET_COUNT, testCloset } from "./__fixtures__/snapshot.ts";

const CLOSET: Garment[] = testCloset;
/** The navy camp shirt added on Oct 10 2026: a navy piece whose colour family the page spreads. */
const NAVY_CAMP_SHIRT = "g_b82609ex2nd7";
/** The brown suede mules: casual and dressy, a fall shoe for out and weekend; a mule sits out winter (XC-SEA-3). */
const MULES = "g_wymz2j18s6wh";
const BY_ID = new Map(CLOSET.map((g) => [g.id, g]));
/** The page's twin groups (four white sneakers are one piece; two shirts under one name are two): what the rotation gets and coverage counts. */
const TWINS = twinGroups(CLOSET);
const KEY = new Map(CLOSET.map((g) => [g.id, TWINS.key(g)]));
const ALIKE = KEY;
const NOW = new Date("2026-10-09T15:00:00.000Z");
const TODAY = "2026-10-09";
const SEASON: Season = "fall";
const ALL: Occasion[] = OCCASIONS.map((o) => o.id);
const TAPS = 6;
const WEEK = 8;

const ids = (look: readonly Garment[]) => look.map((g) => g.id);
const names = (list: readonly string[]) => list.map((id) => BY_ID.get(id)?.name ?? id);

type Tap = {
  n: number;
  week: Garment[][];
  demoted: number[];
  rows: { id: string; title: string; looks: Garment[][]; relaxed: boolean }[];
  /** Every card on the page: the week row, then the rows. */
  page: Garment[][];
  pieces: Set<string>;
  /** Pieces allowed in this scope so far: eligible minus what is known unpairable after this tap. */
  allowed: string[];
  /** What was listed unpairable when the tap was built. */
  stuck: Set<string>;
  /** Look-alike groups (the page's merged keys) of the allowed pieces. */
  allowedTwins: Set<string>;
  coveredAllowed: number;
  reset: boolean;
  ms: number;
};

type Run = {
  occasion: Occasion;
  season: Season;
  taps: Tap[];
  eligible: string[];
  /** Eligible pieces no legal look here can hold, as the last week-row call lists them. */
  unpairable: string[];
  /** Look-alike groups in the scarcest core slot among the pieces that pair: the week row holds exactly min(cap, this) cards. */
  pairableCore: number;
  shownBy: Map<number, Set<string>>;
};

/** Look-alike groups shown by a tap. */
const shownTwinsBy = (run: Run, n: number) => new Set([...run.shownBy.get(n)!].map((id) => KEY.get(id)!));

const CORE_SLOTS = ["top", "bottom", "footwear"] as const;
/** Distinct look-alike groups per core slot among these pieces, the smallest. */
const coreTwins = (allowed: readonly string[]) =>
  Math.min(...CORE_SLOTS.map((category) => new Set(allowed.filter((id) => BY_ID.get(id)!.category === category).map((id) => KEY.get(id)!)).size));

function simulate(occasion: Occasion, taps = TAPS, season: Season = SEASON): Run {
  const closet = CLOSET.map((g) => g.id);
  const eligible = rotationEligible(CLOSET, season).map((g) => g.id);
  let rotation: Rotation = emptyRotation();
  let stuck = new Set<string>();
  const out: Tap[] = [];
  const shownEver = new Set<string>();
  const shownBy = new Map<number, Set<string>>();
  for (let n = 1; n <= taps; n += 1) {
    const t0 = performance.now();
    const week = weekRotationRow(CLOSET, { occasion, season, rotation, cap: WEEK, today: TODAY, stuck });
    stuck = new Set(week.unpairable.map((g) => g.id));
    let adv = advanceRotation(rotation, { page: week.looks.map(ids), closet, eligible, stuck, alike: ALIKE });
    rotation = adv.next;
    let reset = adv.reset;
    const found = visibleDetectors(CLOSET, { occasion, season });
    const ways = rowWays(found, CLOSET, {
      occasion,
      season,
      onScreen: week.looks.flatMap(ids),
      today: TODAY,
      rotation,
      stuck,
    });
    const rows = ways.map((way) => ({ id: way.id, title: way.title, looks: way.looks[occasion] ?? [], relaxed: Boolean(way.relaxed) }));
    adv = advanceRotation(rotation, { page: rows.flatMap((row) => row.looks).map(ids), closet, eligible, stuck, alike: ALIKE });
    rotation = adv.next;
    reset = reset || adv.reset;
    const page = [...week.looks, ...rows.flatMap((row) => row.looks)];
    const pieces = new Set(page.flat().map((g) => g.id));
    for (const id of pieces) shownEver.add(id);
    shownBy.set(n, new Set(shownEver));
    const allowed = eligible.filter((id) => !stuck.has(id));
    out.push({
      n,
      week: week.looks,
      demoted: week.demoted,
      rows,
      page,
      pieces,
      allowed,
      stuck: new Set(stuck),
      allowedTwins: new Set(allowed.map((id) => KEY.get(id)!)),
      coveredAllowed: allowed.filter((id) => shownEver.has(id)).length,
      reset,
      ms: Math.round(performance.now() - t0),
    });
  }
  const last = weekRotationRow(CLOSET, { occasion, season, rotation, cap: 0, today: TODAY, stuck });
  const unpairable = last.unpairable.map((g) => g.id);
  const pairable = eligible.filter((id) => !unpairable.includes(id));
  return { occasion, season, taps: out, eligible, unpairable, pairableCore: coreTwins(pairable), shownBy };
}

let RUNS: Run[] = [];
/** Two weekend taps in winter: the mules pass the cheap gates there and no look is legal. */
let WINTER_WEEKEND: Run;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  RUNS = ALL.map((occasion) => simulate(occasion));
  WINTER_WEEKEND = simulate("weekend", 2, "winter");
});

afterAll(() => {
  vi.useRealTimers();
});

describe("the snapshot test closet", () => {
  it("is the snapshot closet: distinct, brand-free pieces", () => {
    expect(CLOSET.length).toBe(TEST_CLOSET_COUNT);
    expect(CLOSET.some((g) => g.id === NAVY_CAMP_SHIRT)).toBe(true);
    expect(new Set(CLOSET.map((g) => g.id)).size).toBe(TEST_CLOSET_COUNT);
    for (const g of CLOSET) expect(g.brand ?? "", g.name).toBe("");
  });
});

/** The exhaustive proof that a row has no card left (page-room.ts), as an assertion message; null when it is full. */
function proof(run: Run, tap: Tap, rowId: string): string | null {
  return roomLine(
    roomLeft({ closet: CLOSET, occasion: run.occasion, season: run.season, today: TODAY, week: tap.week, rows: tap.rows, stuck: tap.stuck, eligible: new Set(run.eligible) }, rowId),
  );
}

describe("six Re-dresses on the snapshot closet, every chapter", () => {
  it("every tap shows a week row exactly as full as the closet allows (the scarcest core slot's pairable look-alike groups, eight at most) and story rows as full as the rules allow", () => {
    let full = 0;
    for (const run of RUNS) {
      /* No piece twice in a row, so the pairable groups of the scarcest slot bound the row; the fill pass reaches that bound. */
      const expected = Math.min(WEEK, run.pairableCore);
      if (expected === WEEK) full += 1;
      for (const tap of run.taps) {
        expect(tap.week.length, `${run.occasion} tap ${tap.n} week row (${run.pairableCore} pairable groups in the scarcest core slot)`).toBe(expected);
        expect(tap.rows.length, `${run.occasion} tap ${tap.n} rows: ${tap.rows.map((r) => r.id).join(",")}`).toBeLessThanOrEqual(STORY_ROWS);
        /* Every rule is pass or fail: a page short of STORY_ROWS rows, or a row short of ROW_MIN, is right only when no card is left for it. */
        if (tap.rows.length < STORY_ROWS) expect(proof(run, tap, NEXT_PLAIN_ROW), `${run.occasion} tap ${tap.n}: ${tap.rows.length} rows, yet another plain row`).toBeNull();
        for (const row of tap.rows) {
          expect(row.looks.length, `${run.occasion} tap ${tap.n} / ${row.title}: empty`).toBeGreaterThan(0);
          if (row.looks.length < ROW_MIN) expect(proof(run, tap, row.id), `${run.occasion} tap ${tap.n} / ${row.title}: ${row.looks.length} cards`).toBeNull();
          expect(row.title.length).toBeGreaterThan(0);
        }
      }
    }
    expect(full, "chapters with a full week row").toBeGreaterThan(0);
  });

  it("the brown suede mules, casual and dressy, are on cards of the out chapter and of the weekend chapter", () => {
    expect(BY_ID.get(MULES)?.name).toMatch(/\bmules\b/);
    for (const occasion of ["out", "weekend"] as const) {
      const run = RUNS.find((r) => r.occasion === occasion)!;
      expect(run.eligible, `${occasion}: eligible`).toContain(MULES);
      expect(run.unpairable, `${occasion}: listed as unpairable`).not.toContain(MULES);
      const cards = run.taps.flatMap((tap) => tap.page).filter((look) => look.some((g) => g.id === MULES));
      expect(cards.length, `${occasion}: cards with the mules in ${TAPS} taps`).toBeGreaterThan(0);
    }
  });

  it("a piece no legal look here can hold is listed as unpairable, never dropped silently", () => {
    /* Every eligible piece is accounted for by the last tap: shown (as a look-alike) or listed. */
    for (const run of RUNS) {
      const shown = shownTwinsBy(run, TAPS);
      const silent = run.eligible.filter((id) => !shown.has(KEY.get(id)!) && !run.unpairable.includes(id));
      expect(names(silent), `${run.occasion}: eligible pieces neither shown nor listed`).toEqual([]);
      for (const id of run.unpairable) expect(run.eligible, `${run.occasion}: unpairable ${id} is eligible`).toContain(id);
    }
    /* The path the cheap census cannot see: in winter the mules pass the weekend gate and the
       season gate with many cores, and the legality engine refuses every look (a mule sits out
       winter). The week row settles their verdict on the first tap, before the hero order could
       have reached them, so they are listed at once and never on a card. */
    const mules = BY_ID.get(MULES)!;
    expect(WINTER_WEEKEND.eligible).toContain(MULES);
    const tops = CLOSET.filter((g) => g.category === "top" && WINTER_WEEKEND.eligible.includes(g.id));
    const bottoms = CLOSET.filter((g) => g.category === "bottom" && WINTER_WEEKEND.eligible.includes(g.id));
    let gatesPass = 0;
    for (const top of tops) {
      for (const bottom of bottoms) {
        const core = [top, bottom, mules];
        if (lookFitsOccasion(core, "weekend", CLOSET, undefined, { wideWeekdayTops: true }) && lookFitsSeason(core, "winter")) gatesPass += 1;
        expect(isLegal(core, { house: null, occasion: "weekend", season: "winter" }), `${top.name} + ${bottom.name} + mules legal in winter`).toBe(false);
      }
    }
    expect(gatesPass, "cores with the mules that pass the cheap gates in winter").toBeGreaterThan(0);
    expect(WINTER_WEEKEND.taps[0]!.allowed, "weekend/winter tap 1: the mules still allowed").not.toContain(MULES);
    expect(WINTER_WEEKEND.unpairable).toContain(MULES);
    for (const tap of WINTER_WEEKEND.taps) expect(tap.pieces.has(MULES), `weekend/winter tap ${tap.n} shows the mules`).toBe(false);
  });

  it("every allowed piece appears at least once within the first five taps (look-alikes as one piece)", () => {
    for (const run of RUNS) {
      const allowed = run.taps[4]!.allowed;
      const shown = shownTwinsBy(run, 5);
      const missing = allowed.filter((id) => !shown.has(KEY.get(id)!));
      expect(names(missing), `${run.occasion}: allowed pieces never shown in 5 taps`).toEqual([]);
      /* No share floor: every eligible piece is shown or listed unpairable with the rules that refuse it (rotation.test.ts). */
      expect(allowed.length, `${run.occasion}: allowed pieces`).toBeGreaterThan(0);
    }
  });

  it("the sixth tap brings pieces the fifth did not", () => {
    for (const run of RUNS) {
      const fifth = run.taps[4]!.pieces;
      const sixth = run.taps[5]!.pieces;
      const fresh = [...sixth].filter((id) => !fifth.has(id));
      expect(fresh.length, `${run.occasion}: tap 6 brings nothing tap 5 lacked`).toBeGreaterThan(0);
      /* And no tap repeats the whole of the one before it. */
      for (let i = 1; i < run.taps.length; i += 1) {
        const prev = new Set(run.taps[i - 1]!.page.map((look) => rotationLookKey(ids(look))));
        const same = run.taps[i]!.page.filter((look) => prev.has(rotationLookKey(ids(look)))).length;
        expect(same, `${run.occasion} tap ${i + 1} repeats tap ${i}`).toBeLessThan(run.taps[i]!.page.length / 2);
      }
    }
  });

  it("no piece is on more than two cards of a page, nor twice in one row (sneakers, loafers, jackets and look-alikes included)", () => {
    for (const run of RUNS) {
      for (const tap of run.taps) {
        /* A plain row the section owed may take one more card than the cap (relaxed); the rest holds. */
        const strict = [...tap.week, ...tap.rows.filter((row) => !row.relaxed).flatMap((row) => row.looks)];
        const over = [...twinCounts(strict).entries()].filter(([, n]) => n > SCREEN_CAP);
        expect(over.map(([key, n]) => `${key}=${n}`), `${run.occasion} tap ${tap.n}: over the page cap`).toEqual([]);
        const overRelaxed = [...twinCounts(tap.page).entries()].filter(([, n]) => n > RELAXED_CAP);
        expect(overRelaxed.map(([key, n]) => `${key}=${n}`), `${run.occasion} tap ${tap.n}: over the relaxed cap`).toEqual([]);
        const rows = [{ title: "week", looks: tap.week }, ...tap.rows];
        for (const row of rows) {
          expect(rowRepeats(row.looks).map((g) => g.name), `${run.occasion} tap ${tap.n} / ${row.title}`).toEqual([]);
          expect(rowRepeats(row.looks, true).map((g) => g.name), `${run.occasion} tap ${tap.n} / ${row.title} jacket`).toEqual([]);
          const twice = [...twinCounts(row.looks).entries()].filter(([, n]) => n > 1).map(([key]) => key);
          expect(twice, `${run.occasion} tap ${tap.n} / ${row.title}: a look-alike twice in the row`).toEqual([]);
        }
      }
    }
  });

  it("every card passes the guardrails: occasion (weekday with any long-sleeve top), season, legality, a jacket where the day asks", () => {
    let longSleeveWeekday = 0;
    for (const run of RUNS) {
      for (const tap of run.taps) {
        tap.page.forEach((look, i) => {
          const line = `${run.occasion} tap ${tap.n} card ${i + 1}: ${look.map((g) => g.name).join(" + ")}`;
          expect(look.length, line).toBeGreaterThanOrEqual(3);
          expect(new Set(ids(look)).size, line).toBe(look.length);
          expect(lookFitsOccasion(look, run.occasion, CLOSET, undefined, { wideWeekdayTops: true }), line).toBe(true);
          expect(lookFitsSeason(look, run.season), line).toBe(true);
          expect(isLegal(look, { house: null, occasion: run.occasion, season: run.season }), line).toBe(true);
          if (run.occasion === "weekday" && !lookFitsOccasion(look, "weekday", CLOSET) && look.some(isLongSleeveTop)) longSleeveWeekday += 1;
        });
        if (run.occasion === "weekday" || run.occasion === "out") {
          tap.week.forEach((look, i) => {
            if (tap.demoted.includes(i)) return;
            expect(look.some(isOuterPiece), `${run.occasion} tap ${tap.n} week card ${i + 1} has no jacket`).toBe(true);
          });
        }
      }
    }
    /* The wider weekday gate is in use: cards the strict gate (oxford, polo, knit) would refuse. */
    expect(longSleeveWeekday).toBeGreaterThan(0);
  });

  it("colours spread: no page is mostly one family, and brown suede is at most a third of a page's jackets", () => {
    for (const run of RUNS) {
      for (const tap of run.taps) {
        const counts = pieceCounts(tap.page);
        const shares = familyShares(counts, BY_ID);
        for (const [fam, share] of shares) expect(share, `${run.occasion} tap ${tap.n}: ${fam} is ${Math.round(share * 100)}% of the page`).toBeLessThan(0.5);
        let jackets = 0;
        let suede = 0;
        for (const look of tap.page) {
          const jacket = look.find(isOuterPiece);
          if (!jacket) continue;
          jackets += 1;
          if (isBrownSuedeOuter(jacket)) suede += 1;
        }
        if (jackets) expect(suede, `${run.occasion} tap ${tap.n}: ${suede} brown suede of ${jackets} jackets`).toBeLessThanOrEqual(Math.floor(jackets * SUEDE_SHARE));
      }
    }
    expect(colorFamily(BY_ID.get(NAVY_CAMP_SHIRT)!)).toBe("blue");
  });

  it("the plain rows carry their own titles and the stored themes keep theirs", () => {
    for (const run of RUNS) {
      for (const tap of run.taps) {
        const titles = tap.rows.map((row) => row.title);
        expect(new Set(titles).size, `${run.occasion} tap ${tap.n}: duplicate row titles`).toBe(titles.length);
        for (const row of tap.rows) if (row.id.startsWith(FILL_ID)) expect(row.title).not.toMatch(/^\s*$/);
      }
    }
  });

  it("reports coverage per tap", () => {
    for (const run of RUNS) {
      const line = run.taps
        .map((tap) => `tap ${tap.n}: ${tap.week.length} week + ${tap.rows.map((r) => r.looks.length).join("+")} rows, allowed ${tap.coveredAllowed}/${tap.allowed.length}, new ${tap.n > 1 ? [...tap.pieces].filter((id) => !run.taps[tap.n - 2]!.pieces.has(id)).length : tap.pieces.size}${tap.reset ? ", new cycle" : ""}, ${tap.ms}ms`)
        .join("\n  ");
      console.log(`redress ${run.occasion}/${run.season} (eligible ${run.eligible.length}, cannot pair ${run.unpairable.length}, scarcest core slot ${run.pairableCore} pairable groups):\n  ${line}`);
      const last = run.taps.at(-1)!;
      const shown = shownTwinsBy(run, last.n);
      expect([...last.allowedTwins].filter((key) => !shown.has(key))).toEqual([]);
    }
  });
});

/**
 * Redress on the live closet: the snapshot fixture is the owner's closet (brands stripped),
 * and it stores look-alikes apart: four "white leather sneakers", four brown suede jackets, six
 * beige knit sweaters, three light blue denim jeans. The live page showed white sneakers three
 * or four times a page, the brown suede jacket three times, and lost a row on the last tap.
 * Six taps per chapter are simulated as the Lookbook page does them (the week row, then the
 * rows with the week's pieces on screen, the rotation advanced after each): a look-alike piece
 * is on at most one card per row and two per page, the section always shows STORY_ROWS rows,
 * least-recently-shown pieces lead so every tap brings pieces the last one lacked, and every
 * allowed look-alike piece has appeared within a few taps. The seasonal gate (no summer-only
 * piece in fall) and the jacket rules (a jacket where the day or the theme asks) hold on every
 * card.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  isJacketWay,
  isOuterPiece,
  RELAXED_CAP,
  ROW_MIN,
  rotationEligible,
  rowRepeats,
  rowWays,
  SCREEN_CAP,
  STORY_ROWS,
  twinCounts,
  twinGroups,
  twinKey,
  visibleDetectors,
  weekRotationRow,
} from "./detectors.ts";
import { lookFitsOccasion } from "./lookbook.ts";
import { advanceRotation, emptyRotation, rotationLookKey, type Rotation } from "./rotation.ts";
import { lookFitsSeason } from "./season.ts";
import { isBrownSuedeOuter } from "./style.ts";
import { isLegal } from "./stylist/legal.ts";
import { OCCASIONS, type Garment, type Occasion, type Season } from "./types.ts";
import { LIVE_SNAPSHOT_COUNT, liveSnapshot } from "./__fixtures__/snapshot.ts";

const CLOSET: Garment[] = liveSnapshot;
const BY_ID = new Map(CLOSET.map((g) => [g.id, g]));
/** What the page hands the rotation and what coverage counts: the twin groups (twinKey, or one photo; never the name alone). */
const TWINS = twinGroups(CLOSET);
const KEY = new Map(CLOSET.map((g) => [g.id, TWINS.key(g)]));
const ALIKE = KEY;
const NOW = new Date("2026-10-09T15:00:00.000Z");
const TODAY = "2026-10-09";
const SEASON: Season = "fall";
const ALL: Occasion[] = OCCASIONS.map((o) => o.id);
const TAPS = 6;
const WEEK = 8;
/** Pieces (ids) a tap must bring that the tap before it did not show. */
const FRESH_MIN = 10;
/** Taps within which every allowed look-alike piece has appeared. */
const COVER_BY = 5;

const WHITE_SNEAKERS = twinKey(BY_ID.get("g_01xaga54r12h")!);
/** Two different shirts stored under one name: a regular collar (warmth 3) and a button-down (warmth 2). */
const PLAID_SHIRTS = ["g_z6syv3lx30tn", "g_21b6d3qcohmu"] as const;
const BROWN_SUEDE_JACKET = twinKey(BY_ID.get("g_py2swfwot1ed")!);

const ids = (look: readonly Garment[]) => look.map((g) => g.id);
const names = (list: readonly string[]) => list.map((id) => BY_ID.get(id)?.name ?? id);

type Row = { id: string; title: string; looks: Garment[][]; relaxed: boolean };

type Tap = {
  n: number;
  week: Garment[][];
  demoted: number[];
  rows: Row[];
  /** Every card on the page: the week row, then the rows. */
  page: Garment[][];
  pieces: Set<string>;
  /** Look-alike keys on the page. */
  twins: Set<string>;
  /** Allowed look-alike keys so far: eligible minus what is known unpairable after this tap. */
  allowedTwins: Set<string>;
  /** Pieces the tap before did not show. */
  fresh: number;
  /** Look-alike keys never shown before this tap. */
  newTwins: number;
  reset: boolean;
  ms: number;
};

type Run = { occasion: Occasion; taps: Tap[]; eligible: string[]; shownTwinsBy: Map<number, Set<string>> };

function simulate(occasion: Occasion, taps = TAPS): Run {
  const closet = CLOSET.map((g) => g.id);
  const eligible = rotationEligible(CLOSET, SEASON).map((g) => g.id);
  let rotation: Rotation = emptyRotation();
  let stuck = new Set<string>();
  const out: Tap[] = [];
  const shownTwins = new Set<string>();
  const shownTwinsBy = new Map<number, Set<string>>();
  let prev = new Set<string>();
  for (let n = 1; n <= taps; n += 1) {
    const t0 = performance.now();
    const week = weekRotationRow(CLOSET, { occasion, season: SEASON, rotation, cap: WEEK, today: TODAY, stuck });
    stuck = new Set(week.unpairable.map((g) => g.id));
    let adv = advanceRotation(rotation, { page: week.looks.map(ids), closet, eligible, stuck, alike: ALIKE });
    rotation = adv.next;
    let reset = adv.reset;
    const found = visibleDetectors(CLOSET, { occasion, season: SEASON });
    const ways = rowWays(found, CLOSET, {
      occasion,
      season: SEASON,
      onScreen: week.looks.flatMap(ids),
      today: TODAY,
      rotation,
      stuck,
    });
    const rows: Row[] = ways.map((way) => ({
      id: way.id,
      title: way.title,
      looks: way.looks[occasion] ?? [],
      relaxed: Boolean(way.relaxed),
    }));
    adv = advanceRotation(rotation, { page: rows.flatMap((row) => row.looks).map(ids), closet, eligible, stuck, alike: ALIKE });
    rotation = adv.next;
    reset = reset || adv.reset;
    const page = [...week.looks, ...rows.flatMap((row) => row.looks)];
    const pieces = new Set(page.flat().map((g) => g.id));
    const twins = new Set(page.flat().map((g) => KEY.get(g.id)!));
    const newTwins = [...twins].filter((key) => !shownTwins.has(key)).length;
    for (const key of twins) shownTwins.add(key);
    shownTwinsBy.set(n, new Set(shownTwins));
    const allowedTwins = new Set(eligible.filter((id) => !stuck.has(id)).map((id) => KEY.get(id)!));
    out.push({
      n,
      week: week.looks,
      demoted: week.demoted,
      rows,
      page,
      pieces,
      twins,
      allowedTwins,
      fresh: [...pieces].filter((id) => !prev.has(id)).length,
      newTwins,
      reset,
      ms: Math.round(performance.now() - t0),
    });
    prev = pieces;
  }
  return { occasion, taps: out, eligible, shownTwinsBy };
}

let RUNS: Run[] = [];

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  RUNS = ALL.map((occasion) => simulate(occasion));
});

afterAll(() => {
  vi.useRealTimers();
});

describe("the live closet", () => {
  it("stores two different shirts under one name; they are two pieces to the caps and the cycle", () => {
    const [a, b] = PLAID_SHIRTS.map((id) => BY_ID.get(id)!);
    expect(a!.name).toBe(b!.name);
    expect(a!.subtype).not.toBe(b!.subtype);
    expect(twinKey(a!)).not.toBe(twinKey(b!));
    expect(KEY.get(a!.id)).not.toBe(KEY.get(b!.id));
    expect(TWINS.of(a!)).not.toContain(b);
  });

  it("stores look-alike pieces apart: four white leather sneakers, four brown suede jackets", () => {
    expect(CLOSET.length).toBe(LIVE_SNAPSHOT_COUNT);
    const groups = new Map<string, Garment[]>();
    for (const g of CLOSET) groups.set(twinKey(g), [...(groups.get(twinKey(g)) ?? []), g]);
    expect(groups.get(WHITE_SNEAKERS)!.map((g) => g.name)).toEqual(Array(4).fill("white leather sneakers"));
    expect(groups.get(BROWN_SUEDE_JACKET)!.every(isBrownSuedeOuter)).toBe(true);
    expect(groups.get(BROWN_SUEDE_JACKET)!.length).toBe(4);
    expect([...groups.values()].filter((group) => group.length >= 3).length).toBeGreaterThanOrEqual(4);
    /* Different kinds, colours or materials stay apart. */
    expect(twinKey(BY_ID.get("g_fzekzikyrf50")!)).not.toBe(WHITE_SNEAKERS);
    expect(twinKey(BY_ID.get("g_5josnvyoi4z9")!)).not.toBe(twinKey(BY_ID.get("g_3qjmw7n4wj2a")!));
  });
});

describe("six Re-dresses on the live closet, every chapter", () => {
  it("every tap shows a full week row and exactly four idea rows, none dropped", () => {
    for (const run of RUNS) {
      for (const tap of run.taps) {
        expect(tap.week.length, `${run.occasion} tap ${tap.n} week row`).toBeGreaterThanOrEqual(ROW_MIN);
        expect(tap.rows.length, `${run.occasion} tap ${tap.n} rows: ${tap.rows.map((r) => r.id).join(",")}`).toBe(STORY_ROWS);
        for (const row of tap.rows) {
          expect(row.looks.length, `${run.occasion} tap ${tap.n} / ${row.title}`).toBeGreaterThanOrEqual(row.relaxed ? 1 : ROW_MIN);
          expect(row.title.length).toBeGreaterThan(0);
        }
        expect(new Set(tap.rows.map((row) => row.title)).size).toBe(tap.rows.length);
      }
    }
  });

  it("a look-alike piece is on at most one card per row and two per page", () => {
    for (const run of RUNS) {
      for (const tap of run.taps) {
        const rows = [{ title: "week", looks: tap.week, relaxed: false }, ...tap.rows];
        for (const row of rows) {
          expect(rowRepeats(row.looks).map((g) => g.name), `${run.occasion} tap ${tap.n} / ${row.title}`).toEqual([]);
          expect(rowRepeats(row.looks, true).map((g) => g.name), `${run.occasion} tap ${tap.n} / ${row.title} jacket`).toEqual([]);
          const inRow = [...twinCounts(row.looks).entries()].filter(([, n]) => n > 1);
          expect(inRow, `${run.occasion} tap ${tap.n} / ${row.title}: twice in the row`).toEqual([]);
        }
        /* A plain row the section owed may take one more card than the cap (relaxed); the rest of
           the page keeps the strict cap, and a page with no relaxed row keeps it everywhere. */
        const relaxed = tap.rows.some((row) => row.relaxed);
        const cap = relaxed ? RELAXED_CAP : SCREEN_CAP;
        const over = [...twinCounts(tap.page).entries()].filter(([, n]) => n > cap);
        expect(over, `${run.occasion} tap ${tap.n}: over the page cap`).toEqual([]);
        const strictPage = [...tap.week, ...tap.rows.filter((row) => !row.relaxed).flatMap((row) => row.looks)];
        const overStrict = [...twinCounts(strictPage).entries()].filter(([, n]) => n > SCREEN_CAP);
        expect(overStrict, `${run.occasion} tap ${tap.n}: over the cap outside the relaxed rows`).toEqual([]);
      }
    }
  });

  it("white sneakers and the brown suede jacket: never twice in a row, never more than twice a page", () => {
    let sneakers = 0;
    let suede = 0;
    for (const run of RUNS) {
      for (const tap of run.taps) {
        const counts = twinCounts(tap.page);
        expect(counts.get(WHITE_SNEAKERS) ?? 0, `${run.occasion} tap ${tap.n}: white sneakers`).toBeLessThanOrEqual(SCREEN_CAP);
        expect(counts.get(BROWN_SUEDE_JACKET) ?? 0, `${run.occasion} tap ${tap.n}: brown suede jacket`).toBeLessThanOrEqual(SCREEN_CAP);
        sneakers += counts.get(WHITE_SNEAKERS) ?? 0;
        suede += counts.get(BROWN_SUEDE_JACKET) ?? 0;
        for (const row of [{ title: "week", looks: tap.week }, ...tap.rows]) {
          const inRow = twinCounts(row.looks);
          expect(inRow.get(WHITE_SNEAKERS) ?? 0, `${run.occasion} tap ${tap.n} / ${row.title}: white sneakers`).toBeLessThanOrEqual(1);
          expect(inRow.get(BROWN_SUEDE_JACKET) ?? 0, `${run.occasion} tap ${tap.n} / ${row.title}: brown suede`).toBeLessThanOrEqual(1);
        }
      }
    }
    /* Both still get their turns: capped, not banned. */
    expect(sneakers).toBeGreaterThan(0);
    expect(suede).toBeGreaterThan(0);
  });

  it("least-recently-shown leads: every tap brings pieces the tap before lacked and repeats few of its looks", () => {
    for (const run of RUNS) {
      for (let i = 1; i < run.taps.length; i += 1) {
        const tap = run.taps[i]!;
        expect(tap.fresh, `${run.occasion} tap ${tap.n}: pieces tap ${i} lacked`).toBeGreaterThanOrEqual(FRESH_MIN);
        const prev = new Set(run.taps[i - 1]!.page.map((look) => rotationLookKey(ids(look))));
        const same = tap.page.filter((look) => prev.has(rotationLookKey(ids(look)))).length;
        expect(same, `${run.occasion} tap ${tap.n} repeats tap ${i}`).toBeLessThan(tap.page.length / 2);
      }
    }
  });

  it("coverage is steady: every allowed look-alike piece appears within five taps and the cycle turns over", () => {
    for (const run of RUNS) {
      const shown = run.shownTwinsBy.get(COVER_BY)!;
      const allowed = run.taps[COVER_BY - 1]!.allowedTwins;
      const missing = [...allowed].filter((key) => !shown.has(key));
      expect(missing, `${run.occasion}: allowed look-alike pieces never shown in ${COVER_BY} taps`).toEqual([]);
      /* New pieces keep coming until the allowed set is covered. */
      for (const tap of run.taps) {
        const covered = [...tap.allowedTwins].every((key) => run.shownTwinsBy.get(tap.n)!.has(key));
        if (tap.n > 1 && !covered) expect(tap.newTwins, `${run.occasion} tap ${tap.n}: nothing new while pieces remain`).toBeGreaterThan(0);
      }
      expect(run.taps.some((tap) => tap.reset), `${run.occasion}: no cycle completed in ${TAPS} taps`).toBe(true);
    }
  });

  it("every card keeps the seasonal and jacket rules: no summer-only piece, a jacket where the day or the theme asks", () => {
    for (const run of RUNS) {
      for (const tap of run.taps) {
        tap.page.forEach((look, i) => {
          const line = `${run.occasion} tap ${tap.n} card ${i + 1}: ${look.map((g) => g.name).join(" + ")}`;
          expect(look.length, line).toBeGreaterThanOrEqual(3);
          expect(new Set(ids(look)).size, line).toBe(look.length);
          expect(lookFitsOccasion(look, run.occasion, CLOSET, undefined, { wideWeekdayTops: true }), line).toBe(true);
          expect(lookFitsSeason(look, SEASON), line).toBe(true);
          expect(look.some((g) => /linen|\bcamp\b|resort|short[- ]?sleeve/.test(`${g.name} ${g.material}`.toLowerCase())), line).toBe(false);
          expect(isLegal(look, { house: null, occasion: run.occasion, season: SEASON }), line).toBe(true);
        });
        if (run.occasion === "weekday" || run.occasion === "out") {
          tap.week.forEach((look, i) => {
            if (tap.demoted.includes(i)) return;
            expect(look.some(isOuterPiece), `${run.occasion} tap ${tap.n} week card ${i + 1} has no jacket`).toBe(true);
          });
        }
        for (const row of tap.rows) {
          if (!isJacketWay(row.id)) continue;
          for (const look of row.looks) expect(look.some(isOuterPiece), `${run.occasion} tap ${tap.n} / ${row.title}: no jacket`).toBe(true);
        }
      }
    }
  });

  it("both shirts under one name take their own turn: each allowed one is on a card within the taps", () => {
    const [a, b] = PLAID_SHIRTS.map((id) => BY_ID.get(id)!);
    let chaptersWithBoth = 0;
    for (const run of RUNS) {
      const allowed = run.taps.at(-1)!.allowedTwins;
      const shown = new Set(run.taps.flatMap((tap) => [...tap.pieces]));
      const here = [a!, b!].filter((g) => allowed.has(KEY.get(g.id)!));
      for (const g of here) expect(shown.has(g.id), `${run.occasion}: ${g.id} (${g.subtype}) never on a card in ${TAPS} taps`).toBe(true);
      if (here.length === 2) chaptersWithBoth += 1;
    }
    /* Out refuses both at the gate (a plain shirt is not an oxford, polo, camp collar or knit); the other chapters take both. */
    expect(chaptersWithBoth, "chapters where both shirts pair").toBeGreaterThan(0);
  });

  it("reports new pieces per tap", () => {
    for (const run of RUNS) {
      const line = run.taps
        .map(
          (tap) =>
            `tap ${tap.n}: ${tap.week.length} week + ${tap.rows.map((r) => `${r.looks.length}${r.relaxed ? "*" : ""}`).join("+")} rows, new ${tap.newTwins} (vs last tap ${tap.fresh}), shown ${[...tap.allowedTwins].filter((key) => run.shownTwinsBy.get(tap.n)!.has(key)).length}/${tap.allowedTwins.size} allowed${tap.reset ? ", new cycle" : ""}, ${tap.ms}ms`,
        )
        .join("\n  ");
      console.log(`redress live ${run.occasion}/${SEASON} (eligible ${run.eligible.length}):\n  ${line}`);
      expect(names(run.eligible).length).toBe(run.eligible.length);
    }
  });
});

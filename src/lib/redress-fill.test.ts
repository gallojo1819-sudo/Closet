/**
 * Redress fill: every Re-dress shows a full page, and over a few taps every piece that can pair
 * gets a turn. The closet is the 142-piece engine fixture plus 15 pieces (redress-extra.json:
 * button-downs, sweaters, a cardigan, a long-sleeve polo, bottoms, non-sneaker shoes, jackets
 * that are not brown suede), 157 in all; the clock is frozen at the snapshot's instant. Taps
 * are simulated as the Lookbook page does them: the week row (weekRotationRow), then the rows
 * (rowWays) with the week's pieces on screen, the rotation advanced after each.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  colorFamily,
  familyShares,
  FILL_ID,
  isOuterPiece,
  pieceCounts,
  ROW_MIN,
  rotationEligible,
  rowRepeats,
  rowWays,
  SCREEN_CAP,
  STORY_ROWS,
  SUEDE_SHARE,
  visibleDetectors,
  weekRotationRow,
} from "./detectors.ts";
import { isLongSleeveTop, lookFitsOccasion } from "./lookbook.ts";
import { advanceRotation, emptyRotation, rotationLookKey, type Rotation } from "./rotation.ts";
import { lookFitsSeason } from "./season.ts";
import { isBrownSuedeOuter } from "./style.ts";
import { isLegal } from "./stylist/legal.ts";
import { OCCASIONS, type Garment, type Occasion, type Season } from "./types.ts";

const read = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as Garment[];
const CLOSET: Garment[] = [...read("./__fixtures__/engine-garments.json"), ...read("./__fixtures__/redress-extra.json")];
const BY_ID = new Map(CLOSET.map((g) => [g.id, g]));
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
  rows: { id: string; title: string; looks: Garment[][] }[];
  /** Every card on the page: the week row, then the rows. */
  page: Garment[][];
  pieces: Set<string>;
  /** Pieces allowed in this scope so far: eligible minus what is known unpairable after this tap. */
  allowed: string[];
  coveredAllowed: number;
  reset: boolean;
  ms: number;
};

type Run = { occasion: Occasion; taps: Tap[]; eligible: string[]; unpairable: string[]; shownBy: Map<number, Set<string>> };

function simulate(occasion: Occasion, taps = TAPS): Run {
  const closet = CLOSET.map((g) => g.id);
  const eligible = rotationEligible(CLOSET, SEASON).map((g) => g.id);
  let rotation: Rotation = emptyRotation();
  let stuck = new Set<string>();
  const out: Tap[] = [];
  const shownEver = new Set<string>();
  const shownBy = new Map<number, Set<string>>();
  for (let n = 1; n <= taps; n += 1) {
    const t0 = performance.now();
    const week = weekRotationRow(CLOSET, { occasion, season: SEASON, rotation, cap: WEEK, today: TODAY, stuck });
    stuck = new Set(week.unpairable.map((g) => g.id));
    let adv = advanceRotation(rotation, { page: week.looks.map(ids), closet, eligible, stuck });
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
    const rows = ways.map((way) => ({ id: way.id, title: way.title, looks: way.looks[occasion] ?? [] }));
    adv = advanceRotation(rotation, { page: rows.flatMap((row) => row.looks).map(ids), closet, eligible, stuck });
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
      coveredAllowed: allowed.filter((id) => shownEver.has(id)).length,
      reset,
      ms: Math.round(performance.now() - t0),
    });
  }
  const last = weekRotationRow(CLOSET, { occasion, season: SEASON, rotation, cap: 0, today: TODAY, stuck });
  return { occasion, taps: out, eligible, unpairable: last.unpairable.map((g) => g.id), shownBy };
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

describe("the 157-piece test closet", () => {
  it("is the fixture plus fifteen distinct, brand-free pieces", () => {
    expect(CLOSET.length).toBe(157);
    expect(new Set(CLOSET.map((g) => g.id)).size).toBe(157);
    for (const g of CLOSET) expect(g.brand ?? "", g.name).toBe("");
  });
});

describe("six Re-dresses on the 157-piece closet, every chapter", () => {
  it("every tap shows a full week row of eight looks and at least three story rows", () => {
    for (const run of RUNS) {
      for (const tap of run.taps) {
        expect(tap.week.length, `${run.occasion} tap ${tap.n} week row`).toBe(WEEK);
        expect(tap.rows.length, `${run.occasion} tap ${tap.n} rows: ${tap.rows.map((r) => r.id).join(",")}`).toBeGreaterThanOrEqual(STORY_ROWS);
        for (const row of tap.rows) {
          expect(row.looks.length, `${run.occasion} tap ${tap.n} / ${row.title}`).toBeGreaterThanOrEqual(ROW_MIN);
          expect(row.title.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("every allowed piece appears at least once within the first five taps", () => {
    for (const run of RUNS) {
      const allowed = run.taps[4]!.allowed;
      const shown = run.shownBy.get(5)!;
      const missing = allowed.filter((id) => !shown.has(id));
      expect(names(missing), `${run.occasion}: allowed pieces never shown in 5 taps`).toEqual([]);
      /* The loose weekday gate and the plain rows keep most of the closet in play. */
      expect(allowed.length, `${run.occasion}: allowed pieces`).toBeGreaterThanOrEqual(Math.ceil(0.5 * run.eligible.length));
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

  it("no piece is on more than two cards of a page, nor twice in one row (sneakers, loafers and jackets included)", () => {
    for (const run of RUNS) {
      for (const tap of run.taps) {
        const over = [...pieceCounts(tap.page).entries()].filter(([, n]) => n > SCREEN_CAP);
        expect(over.map(([id, n]) => `${BY_ID.get(id)?.name}=${n}`), `${run.occasion} tap ${tap.n}: over the page cap`).toEqual([]);
        const rows = [{ title: "week", looks: tap.week }, ...tap.rows];
        for (const row of rows) {
          expect(rowRepeats(row.looks).map((g) => g.name), `${run.occasion} tap ${tap.n} / ${row.title}`).toEqual([]);
          expect(rowRepeats(row.looks, true).map((g) => g.name), `${run.occasion} tap ${tap.n} / ${row.title} jacket`).toEqual([]);
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
          expect(lookFitsSeason(look, SEASON), line).toBe(true);
          expect(isLegal(look, { house: null, occasion: run.occasion, season: SEASON }), line).toBe(true);
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
    expect(colorFamily(BY_ID.get("x_jkt_navy_chore")!)).toBe("blue");
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
      console.log(`redress ${run.occasion}/${SEASON} (eligible ${run.eligible.length}, cannot pair ${run.unpairable.length}):\n  ${line}`);
      expect(run.taps.at(-1)!.coveredAllowed).toBe(run.taps.at(-1)!.allowed.length);
    }
  });
});

/**
 * Redress rotation: every in-season piece gets a turn before anything repeats. The fixture is
 * the stripped live closet the engine snapshot uses, the clock frozen at the snapshot's
 * instant. Repeated Re-dresses are simulated as the Lookbook page does them: the week row
 * (weekRotationRow), then the idea rows (rowWays) with the week's pieces already on screen,
 * the rotation advanced after each.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  capScreenLooks,
  isOuterPiece,
  RELAXED_CAP,
  rotationEligible,
  rowRepeats,
  rowWays,
  SCREEN_CAP,
  seasonFits,
  twinCounts,
  twinKey,
  visibleDetectors,
  weekRotationRow,
} from "./detectors.ts";
import { looksFromRows, lookFitsOccasion } from "./lookbook.ts";
import {
  advanceRotation,
  emptyRotation,
  readRotation,
  rotationLookKey,
  rotationRank,
  seenLook,
  STALL_ADVANCES,
  writeRotation,
  type Rotation,
} from "./rotation.ts";
import { lookFitsSeason, pieceFitsSeason } from "./season.ts";
import { isLegal } from "./stylist/legal.ts";
import { OCCASIONS, type Garment, type Occasion, type Season } from "./types.ts";

const FIXTURE = JSON.parse(
  readFileSync(new URL("./__fixtures__/engine-garments.json", import.meta.url), "utf8"),
) as Garment[];
const BY_ID = new Map(FIXTURE.map((g) => [g.id, g]));
/** Look-alike key per piece: the caps and the cycle count four white sneakers as one piece. */
const ALIKE = new Map(FIXTURE.map((g) => [g.id, twinKey(g)]));
const NOW = new Date("2026-10-09T15:00:00.000Z");
const TODAY = "2026-10-09";
const SEASON: Season = "fall";
const ALL: Occasion[] = OCCASIONS.map((o) => o.id);
const REDRESSES = 5;

const ids = (look: readonly Garment[]) => look.map((g) => g.id);
const names = (list: readonly string[]) => list.map((id) => BY_ID.get(id)?.name ?? id);

type Page = {
  n: number;
  week: Garment[][];
  demoted: number[];
  rows: { id: string; title: string; looks: Garment[][]; relaxed: boolean }[];
  keys: Set<string>;
  reset: boolean;
};

type Run = { occasion: Occasion; pages: Page[]; eligible: string[]; unpairable: string[]; shownBy: Map<number, Set<string>> };

/** One Re-dress after another, as the page does it. */
function simulate(occasion: Occasion, redresses = REDRESSES): Run {
  const closet = FIXTURE.map((g) => g.id);
  const eligible = rotationEligible(FIXTURE, SEASON).map((g) => g.id);
  let rotation: Rotation = emptyRotation();
  let stuck = new Set<string>();
  const pages: Page[] = [];
  const shownEver = new Set<string>();
  const shownBy = new Map<number, Set<string>>();
  for (let n = 1; n <= redresses; n += 1) {
    const week = weekRotationRow(FIXTURE, { occasion, season: SEASON, rotation, cap: 8, today: TODAY, stuck });
    stuck = new Set(week.unpairable.map((g) => g.id));
    let adv = advanceRotation(rotation, { page: week.looks.map(ids), closet, eligible, stuck, alike: ALIKE });
    rotation = adv.next;
    let reset = adv.reset;
    const found = visibleDetectors(FIXTURE, { occasion, season: SEASON });
    const ways = rowWays(found, FIXTURE, {
      occasion,
      season: SEASON,
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
    for (const g of page.flat()) shownEver.add(g.id);
    shownBy.set(n, new Set(shownEver));
    pages.push({ n, week: week.looks, demoted: week.demoted, rows, keys: new Set(page.map((l) => rotationLookKey(ids(l)))), reset });
  }
  /* The scope's complete list, after the run. */
  const last = weekRotationRow(FIXTURE, { occasion, season: SEASON, rotation, cap: 0, today: TODAY, stuck });
  return { occasion, pages, eligible, unpairable: last.unpairable.map((g) => g.id), shownBy };
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

describe("the rotation queue", () => {
  it("ranks unseen pieces first, then least-recently-shown; shown pieces go to the back", () => {
    const r0 = emptyRotation();
    expect(rotationRank(r0)("a")).toBe(-1);
    const { next: r1 } = advanceRotation(r0, { page: [["a", "b"]], closet: ["a", "b", "c", "d"], eligible: ["a", "b", "c", "d"] });
    expect(r1.queue).toEqual(["c", "d", "a", "b"]);
    const rank = rotationRank(r1);
    expect(rank("c")).toBeLessThan(rank("a"));
    expect(rank("a")).toBeLessThan(rank("b"));
    expect(seenLook(r1, ["b", "a"])).toBe(true);
    expect(seenLook(r1, ["c", "a"])).toBe(false);
    const { next: r2 } = advanceRotation(r1, { page: [["c", "a"]], closet: ["a", "b", "c", "d"], eligible: ["a", "b", "c", "d"] });
    expect(r2.queue).toEqual(["d", "b", "c", "a"]);
    expect(r2.shown.sort()).toEqual(["a", "b", "c"]);
  });

  it("recording the same page again changes nothing", () => {
    const { next: r1 } = advanceRotation(emptyRotation(), { page: [["a", "b"]], closet: ["a", "b", "c"], eligible: ["a", "b", "c"] });
    const again = advanceRotation(r1, { page: [["a", "b"]], closet: ["a", "b", "c"], eligible: ["a", "b", "c"] });
    expect(again.next).toBe(r1);
    expect(again.reset).toBe(false);
  });

  it("resets when every eligible piece has appeared, pieces that cannot pair aside, and forgets the seen looks", () => {
    const closet = ["a", "b", "c", "x"];
    const { next: r1 } = advanceRotation(emptyRotation(), { page: [["a", "b"]], closet, eligible: closet, stuck: new Set(["x"]) });
    expect(r1.passes).toBe(0);
    const done = advanceRotation(r1, { page: [["c", "a"]], closet, eligible: closet, stuck: new Set(["x"]) });
    expect(done.reset).toBe(true);
    expect(done.next.passes).toBe(1);
    expect(done.next.shown).toEqual([]);
    expect(done.next.looks).toEqual([]);
    expect(done.next.queue).toEqual(["x", "b", "c", "a"]);
    expect(seenLook(done.next, ["a", "b"])).toBe(false);
  });

  it("a whole page with new looks but no new piece ends the cycle instead of stalling", () => {
    const closet = ["a", "b", "c", "d"];
    const { next: r1 } = advanceRotation(emptyRotation(), { page: [["a", "b", "c"]], closet, eligible: closet });
    let r = r1;
    let reset = false;
    for (let i = 0; i < STALL_ADVANCES; i += 1) {
      const adv = advanceRotation(r, { page: [[i ? "c" : "b", "a"]], closet, eligible: closet });
      r = adv.next;
      reset = adv.reset;
    }
    expect(reset).toBe(true);
    expect(r.passes).toBe(1);
  });

  it("pieces that left the closet leave the queue; new pieces come first", () => {
    const { next: r1 } = advanceRotation(emptyRotation(), { page: [["a", "b"]], closet: ["a", "b"], eligible: ["a", "b"] });
    const { next: r2 } = advanceRotation(r1, { page: [["a", "n"]], closet: ["a", "n", "m"], eligible: ["a", "n", "m"] });
    expect(r2.queue).toEqual(["m", "a", "n"]);
  });

  it("survives a round trip through the session store and shrugs at junk", () => {
    const { next: r1 } = advanceRotation(emptyRotation(), { page: [["a", "b"]], closet: ["a", "b", "c"], eligible: ["a", "b", "c"] });
    expect(readRotation(writeRotation(r1))).toEqual(r1);
    expect(readRotation(null)).toEqual(emptyRotation());
    expect(readRotation("{not json")).toEqual(emptyRotation());
    expect(readRotation(JSON.stringify({ v: 2, queue: ["a"] }))).toEqual(emptyRotation());
    expect(readRotation(JSON.stringify({ v: 1, queue: ["a", 3, null], passes: "x" }))).toEqual({ ...emptyRotation(), queue: ["a"] });
  });
});

describe("repeated Re-dress on the fixture closet", () => {
  it("every piece that can pair appears within a few Re-dresses (look-alikes as one piece); the rest are listed, not dropped", () => {
    for (const run of RUNS) {
      const pairable = run.eligible.filter((id) => !run.unpairable.includes(id));
      const shown = new Set([...run.shownBy.get(REDRESSES)!].map((id) => ALIKE.get(id)!));
      const missing = pairable.filter((id) => !shown.has(ALIKE.get(id)!));
      expect(missing.map((id) => BY_ID.get(id)?.name), `${run.occasion}: never shown`).toEqual([]);
      /* Out in fall asks for a jacket and refuses sneakers while loafers are owned: just under half of this fixture pairs there. */
      expect(pairable.length, `${run.occasion}: pairable pieces`).toBeGreaterThanOrEqual(Math.ceil(0.45 * run.eligible.length));
      for (const id of run.unpairable) expect(run.eligible, `${run.occasion}: unpairable ${id} is eligible`).toContain(id);
    }
  });

  it("prints how much of the closet 1, 3 and 5 Re-dresses show", () => {
    for (const run of RUNS) {
      const pairable = run.eligible.length - run.unpairable.length;
      const at = (n: number) => run.shownBy.get(n)!.size;
      console.log(
        `rotation ${run.occasion}/${SEASON}: eligible ${run.eligible.length}, pairable ${pairable}, ` +
          `shown after 1: ${at(1)}, 3: ${at(3)}, 5: ${at(5)}; cannot pair here: ${run.unpairable.length}`,
      );
      expect(at(1)).toBeLessThanOrEqual(at(3));
      expect(at(3)).toBeLessThanOrEqual(at(5));
    }
  });

  it("no piece more than twice per page, and never twice in one row (jackets and look-alikes included)", () => {
    for (const run of RUNS) {
      for (const page of run.pages) {
        /* A plain row the section owed may take one more card than the cap (relaxed); the rest holds. */
        const strict = [...page.week, ...page.rows.filter((row) => !row.relaxed).flatMap((row) => row.looks)];
        const over = [...twinCounts(strict).entries()].filter(([, n]) => n > SCREEN_CAP);
        expect(over.map(([key, n]) => `${key}=${n}`), `${run.occasion} p${page.n}: over the page cap`).toEqual([]);
        const all = [...page.week, ...page.rows.flatMap((row) => row.looks)];
        const overRelaxed = [...twinCounts(all).entries()].filter(([, n]) => n > RELAXED_CAP);
        expect(overRelaxed.map(([key, n]) => `${key}=${n}`), `${run.occasion} p${page.n}: over the relaxed cap`).toEqual([]);
        expect(rowRepeats(page.week).map((g) => g.name), `${run.occasion} p${page.n}: week row repeats`).toEqual([]);
        expect(rowRepeats(page.week, true).map((g) => g.name), `${run.occasion} p${page.n}: week row repeats a jacket`).toEqual([]);
        for (const row of [{ title: "week", looks: page.week }, ...page.rows]) {
          expect(rowRepeats(row.looks).map((g) => g.name), `${run.occasion} p${page.n} / ${row.title}`).toEqual([]);
          expect(rowRepeats(row.looks, true).map((g) => g.name), `${run.occasion} p${page.n} / ${row.title} jacket`).toEqual([]);
          const twice = [...twinCounts(row.looks).entries()].filter(([, n]) => n > 1).map(([key]) => key);
          expect(twice, `${run.occasion} p${page.n} / ${row.title}: a look-alike twice in the row`).toEqual([]);
        }
        /* The page shows the week row as capScreenLooks would: nothing for it to drop. */
        const looks = page.week.map((pieces, i) => ({ id: String(i), garmentIds: ids(pieces) }));
        expect(capScreenLooks(looks).length).toBe(looks.length);
      }
    }
  });

  it("consecutive Re-dresses share no look until the closet is exhausted", () => {
    let compared = 0;
    for (const run of RUNS) {
      for (let i = 1; i < run.pages.length; i += 1) {
        const prev = run.pages[i - 1]!;
        const page = run.pages[i]!;
        if (prev.reset) continue;
        const shared = [...page.keys].filter((key) => prev.keys.has(key));
        expect(shared.map((key) => names(key.split("|")).join(" + ")), `${run.occasion} p${page.n} repeats p${prev.n}`).toEqual([]);
        expect(page.keys.size, `${run.occasion} p${page.n} is empty`).toBeGreaterThan(0);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(ALL.length);
  });

  it("every look passes the style guardrails: occasion, season, the summer gate and isLegal", () => {
    for (const run of RUNS) {
      for (const page of run.pages) {
        const cards = [
          ...page.week.map((look, i) => ({ look, where: `week card ${i + 1}` })),
          ...page.rows.flatMap((row) => row.looks.map((look) => ({ look, where: row.title }))),
        ];
        for (const { look, where } of cards) {
          const line = `${run.occasion} p${page.n} / ${where}: ${look.map((g) => g.name).join(" + ")}`;
          expect(look.length, line).toBeGreaterThanOrEqual(3);
          expect(new Set(ids(look)).size, line).toBe(look.length);
          expect(lookFitsOccasion(look, run.occasion, FIXTURE, undefined, { wideWeekdayTops: true }), line).toBe(true);
          expect(lookFitsSeason(look, SEASON), line).toBe(true);
          expect(seasonFits(look, SEASON), line).toBe(true);
          expect(isLegal(look, { house: null, occasion: run.occasion, season: SEASON }), line).toBe(true);
          for (const g of look) expect(pieceFitsSeason(g, SEASON), `${line} (${g.name} out of season)`).toBe(true);
        }
        /* Weekday and out in fall ask for a jacket: every week card has one unless marked demoted. */
        if (run.occasion === "weekday" || run.occasion === "out") {
          page.week.forEach((look, i) => {
            if (page.demoted.includes(i)) return;
            expect(look.some(isOuterPiece), `${run.occasion} p${page.n} week card ${i + 1} has no jacket`).toBe(true);
          });
        }
      }
    }
  });

  it("the week row is a full row of distinct looks on every page", () => {
    for (const run of RUNS) {
      for (const page of run.pages) {
        expect(page.week.length, `${run.occasion} p${page.n} week row`).toBeGreaterThanOrEqual(3);
        const looks = looksFromRows(page.week, run.occasion, page.demoted);
        expect(new Set(looks.map((l) => l.id)).size).toBe(looks.length);
        looks.forEach((look, i) => {
          expect(look.garmentIds).toEqual(ids(page.week[i]!));
          expect(look.demoted).toBe(page.demoted.includes(i) ? "JKT-COV-1" : undefined);
          expect(look.name.length).toBeGreaterThan(0);
        });
      }
    }
  });

  it("the same rotation state gives the same page; out-of-season pieces wait", () => {
    const a = weekRotationRow(FIXTURE, { occasion: "weekend", season: "winter", rotation: emptyRotation(), cap: 8, today: TODAY });
    const b = weekRotationRow(FIXTURE, { occasion: "weekend", season: "winter", rotation: emptyRotation(), cap: 8, today: TODAY });
    expect(a.looks.map(ids)).toEqual(b.looks.map(ids));
    const summerOnly = FIXTURE.filter((g) => pieceFitsSeason(g, "summer") && !pieceFitsSeason(g, "winter"));
    expect(summerOnly.length).toBeGreaterThan(0);
    for (const look of a.looks) for (const g of look) expect(summerOnly.map((p) => p.id), g.name).not.toContain(g.id);
    expect(a.eligible).not.toContain(summerOnly[0]!.id);
  });
});

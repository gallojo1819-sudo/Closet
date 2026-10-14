/**
 * Cross-row rotation on one Lookbook screen. Seen live on Oct 14 2026: a field jacket, a pair
 * of chinos with the pink suede sneakers, and the denim jacket each led or sat on card after
 * card across the rows. Across the screen (the week row and the idea rows) a piece, with its
 * look-alikes, now leads (first card) at most one row while another hero can dress, sits on
 * at most SCREEN_CAP cards (RELAXED_CAP only in a plain row the section owed when the pool is
 * short), every piece that can pair still gets a turn, and the week row holds exactly
 * min(8, the scarcest core slot's pairable look-alike groups): 6 on out/fall, 8 elsewhere.
 * A one-look row only where the chapter has fewer pairable shoe groups than ROW_MIN. Six
 * pages per chapter on the snapshot closet, simulated as the route does them: the week row,
 * then the rows with the week's pieces on screen and its first card as a lead.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  RELAXED_CAP,
  ROW_MIN,
  rotationEligible,
  rowWays,
  SCREEN_CAP,
  STORY_ROWS,
  twinGroups,
  visibleDetectors,
  weekRotationRow,
} from "./detectors.ts";
import { advanceRotation, emptyRotation, type Rotation } from "./rotation.ts";
import { OCCASIONS, type Garment, type Occasion, type Season } from "./types.ts";
import { testCloset } from "./__fixtures__/snapshot.ts";

const CLOSET: Garment[] = testCloset;
const BY_ID = new Map(CLOSET.map((g) => [g.id, g]));
const TWINS = twinGroups(CLOSET);
const KEY = new Map(CLOSET.map((g) => [g.id, TWINS.key(g)]));
const NOW = new Date("2026-10-14T15:00:00.000Z");
const TODAY = "2026-10-14";
const SEASON: Season = "fall";
const ALL: Occasion[] = OCCASIONS.map((o) => o.id);
const PAGES = 6;
const WEEK = 8;
/** The week row's exact size per chapter on this closet: the scarcest core slot's pairable groups, eight at most. */
const WEEK_EXPECTED: Record<Occasion, number> = { weekday: 8, out: 6, weekend: 8, travel: 8, comfy: 8 };

const ids = (look: readonly Garment[]) => look.map((g) => g.id);
const names = (list: readonly string[]) => list.map((id) => BY_ID.get(id)?.name ?? id);
const keyCounts = (looks: readonly (readonly Garment[])[]): Map<string, number> => {
  const out = new Map<string, number>();
  for (const look of looks) for (const g of look) out.set(KEY.get(g.id)!, (out.get(KEY.get(g.id)!) ?? 0) + 1);
  return out;
};

type Row = { id: string; title: string; looks: Garment[][]; relaxed: boolean };
type Page = { n: number; week: Garment[][]; rows: Row[]; page: Garment[][] };
type Run = { occasion: Occasion; pages: Page[]; eligible: string[]; unpairable: string[]; shoeGroups: number; coreGroups: number; shownBy5: Set<string> };

const CORE = ["top", "bottom", "footwear"] as const;

function simulate(occasion: Occasion): Run {
  const closet = CLOSET.map((g) => g.id);
  const eligible = rotationEligible(CLOSET, SEASON).map((g) => g.id);
  let rotation: Rotation = emptyRotation();
  let stuck = new Set<string>();
  const pages: Page[] = [];
  const shown = new Set<string>();
  let shownBy5 = new Set<string>();
  for (let n = 1; n <= PAGES; n += 1) {
    const week = weekRotationRow(CLOSET, { occasion, season: SEASON, rotation, cap: WEEK, today: TODAY, stuck });
    stuck = new Set(week.unpairable.map((g) => g.id));
    rotation = advanceRotation(rotation, { page: week.looks.map(ids), closet, eligible, stuck, alike: KEY }).next;
    const found = visibleDetectors(CLOSET, { occasion, season: SEASON });
    const ways = rowWays(found, CLOSET, {
      occasion,
      season: SEASON,
      salt: n - 1,
      onScreen: week.looks.flatMap(ids),
      leadIds: ids(week.looks[0] ?? []),
      today: TODAY,
      rotation,
      stuck,
    });
    const rows: Row[] = ways.map((way) => ({ id: way.id, title: way.title, looks: way.looks[occasion] ?? [], relaxed: Boolean(way.relaxed) }));
    rotation = advanceRotation(rotation, { page: rows.flatMap((row) => row.looks).map(ids), closet, eligible, stuck, alike: KEY }).next;
    const page = [...week.looks, ...rows.flatMap((row) => row.looks)];
    for (const g of page.flat()) shown.add(KEY.get(g.id)!);
    if (n === 5) shownBy5 = new Set(shown);
    pages.push({ n, week: week.looks, rows, page });
  }
  const last = weekRotationRow(CLOSET, { occasion, season: SEASON, rotation, cap: 0, today: TODAY, stuck });
  const unpairable = last.unpairable.map((g) => g.id);
  const pairable = eligible.filter((id) => !unpairable.includes(id));
  const groups = (category: Garment["category"]) => new Set(pairable.filter((id) => BY_ID.get(id)!.category === category).map((id) => KEY.get(id)!)).size;
  return { occasion, pages, eligible, unpairable, shoeGroups: groups("footwear"), coreGroups: Math.min(...CORE.map(groups)), shownBy5 };
}

let RUNS: Run[] = [];

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  RUNS = ALL.map(simulate);
});

afterAll(() => {
  vi.useRealTimers();
});

describe("six pages per chapter on the snapshot closet", () => {
  it("a. no piece (with its look-alikes) leads more than one row of a screen, the week row included", () => {
    for (const run of RUNS) {
      for (const page of run.pages) {
        const leads = new Map<string, string[]>();
        for (const row of [{ id: "week", looks: page.week }, ...page.rows]) {
          for (const g of row.looks[0] ?? []) leads.set(KEY.get(g.id)!, [...(leads.get(KEY.get(g.id)!) ?? []), row.id]);
        }
        const twice = [...leads.entries()].filter(([, rows]) => rows.length > 1).map(([key, rows]) => `${key} leads ${rows.join(", ")}`);
        expect(twice, `${run.occasion} page ${page.n}`).toEqual([]);
      }
    }
  });

  it("b. no piece sits on more than SCREEN_CAP cards of a screen; RELAXED_CAP only in a relaxed plain row", () => {
    for (const run of RUNS) {
      for (const page of run.pages) {
        const strict = [...page.week, ...page.rows.filter((row) => !row.relaxed).flatMap((row) => row.looks)];
        const over = [...keyCounts(strict).entries()].filter(([, n]) => n > SCREEN_CAP).map(([key, n]) => `${key}=${n}`);
        expect(over, `${run.occasion} page ${page.n}: over the page cap outside relaxed rows`).toEqual([]);
        const overRelaxed = [...keyCounts(page.page).entries()].filter(([, n]) => n > RELAXED_CAP).map(([key, n]) => `${key}=${n}`);
        expect(overRelaxed, `${run.occasion} page ${page.n}: over the relaxed cap`).toEqual([]);
        /* A relaxed row is the short-pool case only: fewer pairable core groups than the page's cards need. */
        if (page.rows.some((row) => row.relaxed)) {
          const cards = page.page.length;
          expect(run.coreGroups * SCREEN_CAP, `${run.occasion} page ${page.n}: relaxed with room to spare`).toBeLessThan(cards);
        }
      }
    }
  });

  it("c. every piece that pairs is shown within five pages (look-alikes as one piece); the unpairable are listed", () => {
    for (const run of RUNS) {
      const allowed = run.eligible.filter((id) => !run.unpairable.includes(id));
      const missing = allowed.filter((id) => !run.shownBy5.has(KEY.get(id)!));
      expect(names(missing), `${run.occasion}: pairable pieces never shown in 5 pages`).toEqual([]);
      expect(allowed.length, `${run.occasion}: pairable share`).toBeGreaterThanOrEqual(Math.ceil(0.48 * run.eligible.length));
    }
  });

  it("d. the week row is exactly 6 on out/fall and 8 elsewhere; the section is STORY_ROWS rows; a one-look row only when the shoes are short", () => {
    for (const run of RUNS) {
      expect(Math.min(WEEK, run.coreGroups), `${run.occasion}: pairable groups in the scarcest core slot`).toBe(WEEK_EXPECTED[run.occasion]);
      const floor = run.shoeGroups < ROW_MIN ? 1 : ROW_MIN;
      for (const page of run.pages) {
        expect(page.week.length, `${run.occasion} page ${page.n} week row`).toBe(WEEK_EXPECTED[run.occasion]);
        expect(page.rows.length, `${run.occasion} page ${page.n} rows`).toBe(STORY_ROWS);
        for (const row of page.rows) {
          expect(row.looks.length, `${run.occasion} page ${page.n} / ${row.title} (${run.shoeGroups} pairable shoe groups)`).toBeGreaterThanOrEqual(floor);
        }
      }
    }
  });

  it("reports the per-page numbers", () => {
    for (const run of RUNS) {
      const line = run.pages
        .map((page) => `page ${page.n}: ${page.week.length} week + ${page.rows.map((r) => `${r.looks.length}${r.relaxed ? "*" : ""}`).join("+")}, max per-page ${Math.max(...keyCounts(page.page).values())}`)
        .join("\n  ");
      console.log(`crossrow ${run.occasion}/${SEASON} (${run.coreGroups} core groups, ${run.shoeGroups} shoe groups, ${run.unpairable.length} unpairable):\n  ${line}`);
      expect(run.pages.length).toBe(PAGES);
    }
  });
});

/**
 * Two Lookbook bugs seen live after 4e0db3d. A piece sat twice in one row ("light grey pleated
 * trousers" on two cards of "More from your closet"): the closet stored it twice, once with
 * material "wool" and once with none, and twinKey's material falls back to a name word, so the
 * two got different keys and passed the in-row guard. And the header always read "8 looks":
 * it counted only the week row (capped at 8) while fifteen to twenty cards rendered.
 *
 * The closet is the snapshot fixture (engine-garments.json) plus the two
 * same-name trousers and a second "Light Blue denim jacket" next to the stored one. Six pages
 * (the first load and five Re-dress taps) per chapter are simulated as the page does them.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  RELAXED_CAP,
  renderedSectionLooks,
  ROW_MIN,
  rotationEligible,
  rowWays,
  SCREEN_CAP,
  STORY_ROWS,
  twinGroups,
  twinKey,
  visibleDetectors,
  weekRotationRow,
} from "./detectors.ts";
import { screenLookCount } from "./lookbook-status.ts";
import { advanceRotation, emptyRotation, type Rotation } from "./rotation.ts";
import { OCCASIONS, type Garment, type Occasion, type Season } from "./types.ts";
import { testCloset } from "./__fixtures__/snapshot.ts";

const STORED: Garment[] = testCloset;

/** The live bug's pieces: one name stored twice, the material field differing. */
const TROUSERS = STORED.find((g) => /\btrousers\b/i.test(g.name) && g.category !== "outerwear")!;
const DUPES: Garment[] = [
  { ...TROUSERS, id: "g_dupe_trousers_wool", name: "light grey pleated trousers", colors: ["light grey"], material: "wool" },
  { ...TROUSERS, id: "g_dupe_trousers_none", name: "light grey pleated trousers", colors: ["light grey"], material: "" },
];
const DENIM_JACKET = STORED.find((g) => g.name === "light blue denim jacket")!;
const DENIM_TWIN: Garment = { ...DENIM_JACKET, id: "g_dupe_denim_jacket", name: "Light Blue denim jacket" };

const CLOSET: Garment[] = [...STORED, ...DUPES, DENIM_TWIN];
const BY_ID = new Map(CLOSET.map((g) => [g.id, g]));
/** What the page hands the rotation: twinKey per id. */
const ALIKE = new Map(CLOSET.map((g) => [g.id, twinKey(g)]));
/** What the rows check their caps against: the page's merged groups. */
const TWINS = twinGroups(CLOSET);
const NOW = new Date("2026-10-13T15:00:00.000Z");
const TODAY = "2026-10-13";
const SEASON: Season = "fall";
const ALL: Occasion[] = OCCASIONS.map((o) => o.id);
const PAGES = 6;
const WEEK = 8;
/** Pieces (by twin key) a tap must bring that the page before did not show. */
const FRESH_MIN = 5;

const ids = (look: readonly Garment[]) => look.map((g) => g.id);
const keyCounts = (looks: readonly (readonly Garment[])[]): Map<string, number> => {
  const out = new Map<string, number>();
  for (const look of looks) for (const g of look) out.set(TWINS.key(g), (out.get(TWINS.key(g)) ?? 0) + 1);
  return out;
};

type Row = { id: string; title: string; looks: Garment[][]; relaxed: boolean };

type Page = {
  n: number;
  week: Garment[][];
  rows: Row[];
  page: Garment[][];
  twins: Set<string>;
  /** Twin keys the page before did not show. */
  fresh: number;
  /** The header helper's count, and what it must equal. */
  header: number;
  weekRendered: number;
  sectionRendered: number;
};

function simulate(occasion: Occasion): Page[] {
  const closet = CLOSET.map((g) => g.id);
  const eligible = rotationEligible(CLOSET, SEASON).map((g) => g.id);
  let rotation: Rotation = emptyRotation();
  let stuck = new Set<string>();
  const out: Page[] = [];
  let prev = new Set<string>();
  for (let n = 1; n <= PAGES; n += 1) {
    const week = weekRotationRow(CLOSET, { occasion, season: SEASON, rotation, cap: WEEK, today: TODAY, stuck });
    stuck = new Set(week.unpairable.map((g) => g.id));
    rotation = advanceRotation(rotation, { page: week.looks.map(ids), closet, eligible, stuck, alike: ALIKE }).next;
    const found = visibleDetectors(CLOSET, { occasion, season: SEASON });
    const ways = rowWays(found, CLOSET, {
      occasion,
      season: SEASON,
      salt: n - 1,
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
    rotation = advanceRotation(rotation, { page: rows.flatMap((row) => row.looks).map(ids), closet, eligible, stuck, alike: ALIKE }).next;
    const page = [...week.looks, ...rows.flatMap((row) => row.looks)];
    const twins = new Set(page.flat().map((g) => TWINS.key(g)));
    /* The header, as the page computes it: the week cards with three resolvable pieces, plus the
       cards renderedSectionLooks hands the section. */
    const weekPieces = week.looks.map((look) => ids(look).map((id) => BY_ID.get(id)).filter(Boolean));
    const section = renderedSectionLooks(ways, occasion);
    out.push({
      n,
      week: week.looks,
      rows,
      page,
      twins,
      fresh: [...twins].filter((key) => !prev.has(key)).length,
      header: screenLookCount(weekPieces, section),
      weekRendered: weekPieces.filter((pieces) => pieces.length >= 3).length,
      sectionRendered: section.length,
    });
    prev = twins;
  }
  return out;
}

let RUNS: { occasion: Occasion; pages: Page[] }[] = [];

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  RUNS = ALL.map((occasion) => ({ occasion, pages: simulate(occasion) }));
});

afterAll(() => {
  vi.useRealTimers();
});

describe("same-name pieces are twins", () => {
  it("the closet reproduces the live bug: one name, two twinKeys", () => {
    expect(CLOSET.length).toBe(160);
    expect(twinKey(DUPES[0]!)).not.toBe(twinKey(DUPES[1]!));
  });
  it("twinGroups puts each same-name pair in one group", () => {
    expect(TWINS.key(DUPES[0]!)).toBe(TWINS.key(DUPES[1]!));
    /* The group may also hold a stored look-alike (same slot, colour, material and noun). */
    for (const g of DUPES) expect(TWINS.of(DUPES[0]!)).toContain(g);
    expect(TWINS.key(DENIM_TWIN)).toBe(TWINS.key(DENIM_JACKET));
    expect(TWINS.of(DENIM_JACKET)).toContain(DENIM_TWIN);
  });
  it("only ever groups more: every twinKey group is inside one twins group", () => {
    const byTwinKey = new Map<string, Set<string>>();
    for (const g of CLOSET) byTwinKey.set(twinKey(g), new Set([...(byTwinKey.get(twinKey(g)) ?? []), TWINS.key(g)]));
    for (const [key, keys] of byTwinKey) expect(keys.size, key).toBe(1);
    /* The stored look-alikes keep their groups: four white leather sneakers, four brown suede jackets. */
    const sneakers = CLOSET.filter((g) => g.name === "white leather sneakers");
    expect(sneakers.length).toBe(4);
    expect(new Set(sneakers.map((g) => TWINS.key(g))).size).toBe(1);
    expect(TWINS.of(BY_ID.get("g_py2swfwot1ed")!).length).toBe(4);
  });
});

describe(`six pages per chapter on the ${CLOSET.length}-piece closet`, () => {
  it("a. no twin key twice inside any row, jackets included", () => {
    for (const run of RUNS) {
      for (const page of run.pages) {
        for (const row of [{ title: "week", looks: page.week }, ...page.rows]) {
          const twice = [...keyCounts(row.looks).entries()].filter(([, n]) => n > 1).map(([key]) => key);
          expect(twice, `${run.occasion} page ${page.n} / ${row.title}: twice in the row`).toEqual([]);
        }
      }
    }
  });

  it("b. no twin key on more than two cards a page, three only in a relaxed row", () => {
    for (const run of RUNS) {
      for (const page of run.pages) {
        const relaxed = page.rows.some((row) => row.relaxed);
        const cap = relaxed ? RELAXED_CAP : SCREEN_CAP;
        const over = [...keyCounts(page.page).entries()].filter(([, n]) => n > cap);
        expect(over, `${run.occasion} page ${page.n}: over the page cap`).toEqual([]);
        const strict = [...page.week, ...page.rows.filter((row) => !row.relaxed).flatMap((row) => row.looks)];
        const overStrict = [...keyCounts(strict).entries()].filter(([, n]) => n > SCREEN_CAP);
        expect(overStrict, `${run.occasion} page ${page.n}: over the cap outside the relaxed rows`).toEqual([]);
      }
    }
  });

  it("c. exactly four idea rows a page, each at least ROW_MIN looks (a relaxed plain row, one)", () => {
    for (const run of RUNS) {
      for (const page of run.pages) {
        expect(page.rows.length, `${run.occasion} page ${page.n} rows: ${page.rows.map((r) => r.id).join(",")}`).toBe(STORY_ROWS);
        for (const row of page.rows) {
          /* A plain row the section owed may run relaxed when the scope is scarce ("out": the non-sneaker shoes). */
          expect(row.looks.length, `${run.occasion} page ${page.n} / ${row.title}`).toBeGreaterThanOrEqual(row.relaxed ? 1 : ROW_MIN);
        }
      }
    }
  });

  it("d. every tap after the first brings at least five pieces the page before lacked", () => {
    for (const run of RUNS) {
      for (const page of run.pages.slice(1)) {
        expect(page.fresh, `${run.occasion} page ${page.n}: new pieces`).toBeGreaterThanOrEqual(FRESH_MIN);
      }
    }
  });

  it("e. the header counts the week cards that render plus the idea-row cards, more than the week row alone", () => {
    for (const run of RUNS) {
      for (const page of run.pages) {
        expect(page.header, `${run.occasion} page ${page.n}`).toBe(page.weekRendered + page.sectionRendered);
        expect(page.header, `${run.occasion} page ${page.n}: header stuck at the week row`).toBeGreaterThan(WEEK);
      }
    }
  });

  it("reports the per-page numbers", () => {
    for (const run of RUNS) {
      const line = run.pages
        .map((page) => {
          const rowMax = Math.max(...[{ looks: page.week }, ...page.rows].map((row) => Math.max(...keyCounts(row.looks).values())));
          const pageMax = Math.max(...keyCounts(page.page).values());
          return `page ${page.n}: ${page.rows.length} rows (${page.week.length} week + ${page.rows.map((r) => `${r.looks.length}${r.relaxed ? "*" : ""}`).join("+")}), max per-row repeat ${rowMax}, max per-page ${pageMax}, new ${page.fresh}, header ${page.header} = ${page.weekRendered}+${page.sectionRendered}`;
        })
        .join("\n  ");
      console.log(`redress rowdupe ${run.occasion}/${SEASON}:\n  ${line}`);
      expect(run.pages.length).toBe(PAGES);
    }
  });
});

/**
 * Two Lookbook bugs seen live after 4e0db3d. A piece sat twice in one row ("light grey pleated
 * trousers" on two cards of "More from your closet"): one photo was added twice, once with
 * material "wool" and once with none, and twinKey's material falls back to a name word, so the
 * two records got different keys and passed the in-row guard. And the header always read "8
 * looks": it counted only the week row (capped at 8) while fifteen to twenty cards rendered.
 *
 * A piece stored twice is one piece only when the records are true look-alikes: one twinKey
 * (the four white leather sneakers) or one photo (fileHash). A shared name alone merges
 * nothing: the closet holds two different shirts both named "brown blue plaid shirt".
 *
 * The closet is the snapshot fixture (engine-garments.json) plus the two trousers added from
 * one photo and a second "Light Blue denim jacket" next to the stored one. Six pages (the
 * first load and five Re-dress taps) per chapter are simulated as the page does them. A row
 * may hold one look only where the chapter has fewer pairable shoe groups than ROW_MIN; the
 * header's "N looks" is the number of cards on the page.
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
import { NEXT_PLAIN_ROW, roomLeft, roomLine } from "./__fixtures__/page-room.ts";
import { testCloset } from "./__fixtures__/snapshot.ts";

const STORED: Garment[] = testCloset;

/** The live bug's pieces: one photo stored twice, the material field differing. */
const TROUSERS = STORED.find((g) => /\btrousers\b/i.test(g.name) && g.category !== "outerwear")!;
const PHOTO = "sha256-dupe-trousers-photo";
const DUPES: Garment[] = [
  { ...TROUSERS, id: "g_dupe_trousers_wool", name: "light grey pleated trousers", colors: ["light grey"], material: "wool", fileHash: PHOTO },
  { ...TROUSERS, id: "g_dupe_trousers_none", name: "light grey pleated trousers", colors: ["light grey"], material: "", fileHash: PHOTO },
];
/** Two different shirts the closet stores under one name: a regular collar (warmth 3) and a button-down (warmth 2). */
const PLAID_SHIRTS = ["g_z6syv3lx30tn", "g_21b6d3qcohmu"] as const;
const DENIM_JACKET = STORED.find((g) => g.name === "light blue denim jacket")!;
const DENIM_TWIN: Garment = { ...DENIM_JACKET, id: "g_dupe_denim_jacket", name: "Light Blue denim jacket" };

const CLOSET: Garment[] = [...STORED, ...DUPES, DENIM_TWIN];
const BY_ID = new Map(CLOSET.map((g) => [g.id, g]));
/** The page's merged groups: what the rows check their caps against and what the page hands the rotation. */
const TWINS = twinGroups(CLOSET);
const ALIKE = new Map(CLOSET.map((g) => [g.id, TWINS.key(g)]));
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
  /** What was listed unpairable when the page was built. */
  stuck: Set<string>;
};

type Sim = {
  pages: Page[];
  /** Look-alike groups of shoes that pair in this chapter (eligible, not unpairable). */
  shoeGroups: number;
  eligible: string[];
};

function simulate(occasion: Occasion): Sim {
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
      stuck: new Set(stuck),
    });
    prev = twins;
  }
  const last = weekRotationRow(CLOSET, { occasion, season: SEASON, rotation, cap: 0, today: TODAY, stuck });
  const unpairable = new Set(last.unpairable.map((g) => g.id));
  const shoeGroups = new Set(
    CLOSET.filter((g) => g.category === "footwear" && eligible.includes(g.id) && !unpairable.has(g.id)).map((g) => TWINS.key(g)),
  ).size;
  return { pages: out, shoeGroups, eligible };
}

let RUNS: { occasion: Occasion; pages: Page[]; shoeGroups: number; eligible: string[] }[] = [];

/** The exhaustive proof that a row has no card left (page-room.ts), as an assertion message; null when it is full. */
function proof(run: { occasion: Occasion; eligible: string[] }, page: Page, rowId: string): string | null {
  return roomLine(
    roomLeft({ closet: CLOSET, occasion: run.occasion, season: SEASON, today: TODAY, week: page.week, rows: page.rows, stuck: page.stuck, eligible: new Set(run.eligible) }, rowId),
  );
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  RUNS = ALL.map((occasion) => ({ occasion, ...simulate(occasion) }));
});

afterAll(() => {
  vi.useRealTimers();
});

describe("pieces stored twice are twins by photo or twinKey, never by name", () => {
  it("the closet reproduces the live bug: one photo, two twinKeys", () => {
    expect(CLOSET.length).toBe(160);
    expect(twinKey(DUPES[0]!)).not.toBe(twinKey(DUPES[1]!));
  });
  it("twinGroups puts the two records of one photo in one group", () => {
    expect(TWINS.key(DUPES[0]!)).toBe(TWINS.key(DUPES[1]!));
    /* The group may also hold a stored look-alike (same slot, colour, material and noun). */
    for (const g of DUPES) expect(TWINS.of(DUPES[0]!)).toContain(g);
    expect(TWINS.key(DENIM_TWIN)).toBe(TWINS.key(DENIM_JACKET));
    expect(TWINS.of(DENIM_JACKET)).toContain(DENIM_TWIN);
  });
  it("two shirts under one name, two photos, stay two pieces", () => {
    const [a, b] = PLAID_SHIRTS.map((id) => BY_ID.get(id)!);
    expect(a!.name).toBe(b!.name);
    expect(twinKey(a!)).not.toBe(twinKey(b!));
    expect(TWINS.key(a!)).not.toBe(TWINS.key(b!));
    expect(TWINS.of(a!)).not.toContain(b);
    /* Same name, two different photos: still two pieces. */
    const withPhotos = twinGroups([...CLOSET, { ...a!, id: "g_plaid_a", fileHash: "photo-a" }, { ...b!, id: "g_plaid_b", fileHash: "photo-b" }]);
    expect(withPhotos.key({ ...a!, id: "g_plaid_a", fileHash: "photo-a" })).not.toBe(withPhotos.key({ ...b!, id: "g_plaid_b", fileHash: "photo-b" }));
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

  it("c. idea rows as full as the rules allow: a row short of ROW_MIN or a page short of four rows has no card left (exhaustive); the header counts the cards shown", () => {
    for (const run of RUNS) {
      for (const page of run.pages) {
        expect(page.rows.length, `${run.occasion} page ${page.n} rows: ${page.rows.map((r) => r.id).join(",")}`).toBeLessThanOrEqual(STORY_ROWS);
        if (page.rows.length < STORY_ROWS) expect(proof(run, page, NEXT_PLAIN_ROW), `${run.occasion} page ${page.n}: ${page.rows.length} rows, yet another plain row`).toBeNull();
        for (const row of page.rows) {
          expect(row.looks.length, `${run.occasion} page ${page.n} / ${row.title}: empty`).toBeGreaterThan(0);
          if (row.looks.length < ROW_MIN) expect(proof(run, page, row.id), `${run.occasion} page ${page.n} / ${row.title} (${run.shoeGroups} pairable shoe groups)`).toBeNull();
        }
        expect(page.header, `${run.occasion} page ${page.n}: "N looks" vs the cards on the page`).toBe(page.page.length);
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
      console.log(`redress rowdupe ${run.occasion}/${SEASON} (${run.shoeGroups} pairable shoe groups):\n  ${line}`);
      expect(run.pages.length).toBe(PAGES);
    }
  });
});

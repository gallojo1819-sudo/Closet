/**
 * Cross-row rotation on one Lookbook screen. Seen live on Oct 14 2026: a field jacket, a pair
 * of chinos with the pink suede sneakers, and the denim jacket each led or sat on card after
 * card across the rows; then, with the row-first-card rule of f51a011, the brown chore jacket,
 * the navy field jacket and the blue plaid shearling jacket each still led two cards of one
 * weekday/fall page. A card's lead is the piece the card shows first: a week card its top (the
 * stacked plate's first band, weekLeadPiece in look.ts), an idea card its jacket, else its top
 * (the jacket-first collage, leadPiece in look-collage.ts), and across the whole page (the week
 * row, every idea row, the forgotten row) a piece, with its look-alikes, leads at most one card. A piece sits on at most
 * SCREEN_CAP cards (RELAXED_CAP only in a plain row the section owed when the pool is short),
 * every piece that can pair still gets a turn, the week row holds exactly min(8, the scarcest
 * core slot's pairable look-alike groups): 6 on out/fall, 8 elsewhere, and no section row is
 * shorter than it was before the rule (BEFORE, measured at f51a011): a slot a led piece would
 * have taken goes to the next piece that has not led. Six pages per chapter on the snapshot
 * closet, simulated as the route does them: the week row, then the rows with the week's pieces
 * on screen and the week cards' leads as leads.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  isOuterPiece,
  RELAXED_CAP,
  ROW_MIN,
  rotationEligible,
  rowWays,
  SCREEN_CAP,
  STORY_ROWS,
  twinGroups,
  visibleDetectors,
  wayCanDress,
  weekRotationRow,
} from "./detectors.ts";
import { weekLeadPiece } from "./look.ts";
import { leadPiece } from "./look-collage.ts";
import { lookFitsOccasion } from "./lookbook.ts";
import { isLegal } from "./stylist/legal.ts";
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
/**
 * Row sizes per page before the one-lead-per-page rule (f51a011, this closet, fall): the week
 * row, then the four section rows in order. No row may come back shorter.
 */
const BEFORE: Record<Occasion, number[][]> = {
  weekday: [
    [8, 3, 3, 3, 6],
    [8, 3, 4, 3, 6],
    [8, 3, 3, 5, 5],
    [8, 3, 3, 3, 7],
    [8, 3, 3, 5, 5],
    [8, 3, 3, 3, 7],
  ],
  out: Array.from({ length: PAGES }, () => [6, 3, 3, 3, 3]),
  weekend: [
    [8, 3, 3, 3, 8],
    [8, 3, 3, 3, 7],
    [8, 3, 3, 3, 7],
    [8, 3, 3, 3, 6],
    [8, 3, 3, 3, 8],
    [8, 3, 3, 3, 8],
  ],
  comfy: Array.from({ length: PAGES }, () => [8, 3, 3, 3, 3]),
  travel: Array.from({ length: PAGES }, () => [8, 4, 4, 4, 4]),
};

const ids = (look: readonly Garment[]) => look.map((g) => g.id);
const names = (list: readonly string[]) => list.map((id) => BY_ID.get(id)?.name ?? id);
const keyCounts = (looks: readonly (readonly Garment[])[]): Map<string, number> => {
  const out = new Map<string, number>();
  for (const look of looks) for (const g of look) out.set(KEY.get(g.id)!, (out.get(KEY.get(g.id)!) ?? 0) + 1);
  return out;
};

type Row = { id: string; title: string; looks: Garment[][]; relaxed: boolean };
type Page = {
  n: number;
  week: Garment[][];
  weekLeads: string[];
  rows: Row[];
  page: Garment[][];
  /**
   * Pairable in-season jacket groups that lead no idea card and sit under the page cap, with
   * whether any legal look for this chapter dresses one from the tops, bottoms and shoes still
   * under the cap (the chapter's rules alone), and per row whether that row could still take a
   * card led by it under the row's own gates (wayCanDress: the theme, distinct pieces within
   * the row). A jacket a row could take is room that row left unused.
   */
  openJackets: { name: string; dressable: boolean; rows: Record<string, boolean> }[];
};
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
      leadIds: week.leads,
      today: TODAY,
      rotation,
      stuck,
    });
    const rows: Row[] = ways.map((way) => ({ id: way.id, title: way.title, looks: way.looks[occasion] ?? [], relaxed: Boolean(way.relaxed) }));
    rotation = advanceRotation(rotation, { page: rows.flatMap((row) => row.looks).map(ids), closet, eligible, stuck, alike: KEY }).next;
    const page = [...week.looks, ...rows.flatMap((row) => row.looks)];
    for (const g of page.flat()) shown.add(KEY.get(g.id)!);
    if (n === 5) shownBy5 = new Set(shown);
    /* Jackets the rows could still have led: pairable, in season, leading no idea card, under the cap. */
    const unpairableNow = new Set([...stuck, ...week.unpairable.map((g) => g.id)]);
    const counts = keyCounts(page);
    const ledInRows = new Set(rows.flatMap((row) => row.looks.map((look) => KEY.get(leadPiece(look)!.id)!)));
    const underCap = (g: Garment) => eligible.includes(g.id) && !unpairableNow.has(g.id) && (counts.get(KEY.get(g.id)!) ?? 0) < SCREEN_CAP;
    const openTops = CLOSET.filter((g) => (g.category === "top" || g.category === "dress") && underCap(g));
    const openBottoms = CLOSET.filter((g) => g.category === "bottom" && underCap(g));
    const openShoes = CLOSET.filter((g) => g.category === "footwear" && underCap(g));
    const legal = (look: Garment[]) => isLegal(look, { occasion, season: SEASON }) && lookFitsOccasion(look, occasion, CLOSET, undefined, { wideWeekdayTops: true });
    const dressable = (jacket: Garment) =>
      openTops.some((top) => openBottoms.some((bottom) => openShoes.some((shoe) => legal([top, bottom, shoe, jacket]))));
    const seenKeys = new Set<string>();
    const openJackets: { name: string; dressable: boolean; rows: Record<string, boolean> }[] = [];
    const openCore = [...openTops, ...openBottoms, ...openShoes];
    for (const g of CLOSET) {
      if (!isOuterPiece(g) || !underCap(g)) continue;
      const key = KEY.get(g.id)!;
      if (ledInRows.has(key) || seenKeys.has(key)) continue;
      seenKeys.add(key);
      const rowsCanTake: Record<string, boolean> = {};
      for (const row of rows) {
        const inRow = new Set(row.looks.flat().map((p) => KEY.get(p.id)!));
        const partners = openCore.filter((p) => !inRow.has(KEY.get(p.id)!));
        rowsCanTake[row.id] = !inRow.has(key) && wayCanDress(row.id, g, partners, CLOSET, { occasion, season: SEASON, today: TODAY });
      }
      openJackets.push({ name: g.name, dressable: dressable(g), rows: rowsCanTake });
    }
    pages.push({ n, week: week.looks, weekLeads: week.leads, rows, page, openJackets });
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
  it("a. a piece (with its look-alikes) leads at most one card on the whole page: the week row, every row, the forgotten row", () => {
    for (const run of RUNS) {
      for (const page of run.pages) {
        const leads = new Map<string, string[]>();
        const cards = [
          ...page.week.map((look, i) => ({ where: `week card ${i + 1}`, lead: weekLeadPiece(look) })),
          ...page.rows.flatMap((row) => row.looks.map((look, i) => ({ where: `${row.title} card ${i + 1}`, lead: leadPiece(look) }))),
        ];
        for (const card of cards) {
          const lead = card.lead;
          expect(lead, `${run.occasion} page ${page.n}: ${card.where} has no lead`).not.toBeNull();
          const key = KEY.get(lead!.id)!;
          leads.set(key, [...(leads.get(key) ?? []), card.where]);
        }
        const twice = [...leads.entries()].filter(([, where]) => where.length > 1).map(([key, where]) => `${BY_ID.get(key.split("|")[0] ?? "")?.name ?? key} leads ${where.join(", ")}`);
        expect(twice, `${run.occasion} page ${page.n}`).toEqual([]);
        /* The week row reports the same leads the rows were handed. */
        expect(page.weekLeads).toEqual(page.week.map((look) => weekLeadPiece(look)!.id));
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

  it("e. no section is shorter than before the one-lead rule unless the un-led jackets are spent: every row holds the cards it held at f51a011, or the page has no pairable jacket left that could lead one more card", () => {
    const drops: string[] = [];
    const unexplained: string[] = [];
    for (const run of RUNS) {
      for (const page of run.pages) {
        const before = BEFORE[run.occasion][page.n - 1]!;
        const after = [page.week.length, ...page.rows.map((row) => row.looks.length)];
        expect(after.length, `${run.occasion} page ${page.n}: rows`).toBe(before.length);
        after.forEach((n, i) => {
          if (n >= before[i]!) return;
          const where = `${run.occasion}/${SEASON} page ${page.n} ${i === 0 ? "week row" : page.rows[i - 1]!.title}: ${before[i]} -> ${n}`;
          drops.push(where);
          /* A shorter row is allowed only where every card must carry a jacket (the chapter asks
             for one in this season) and no un-led jacket under the cap has a legal look left among
             the tops, bottoms and shoes still under the cap: the slot has no eligible piece. */
          const jacketsOwed = run.occasion === "weekday" || run.occasion === "out";
          const rowId = i === 0 ? "week" : page.rows[i - 1]!.id;
          const usable = page.openJackets.filter((j) => j.dressable && (i === 0 || j.rows[rowId]));
          if (!jacketsOwed || usable.length) unexplained.push(`${where} (un-led jackets this row could still take: ${usable.map((j) => j.name).join(", ") || "none"}; jackets owed: ${jacketsOwed})`);
        });
      }
    }
    expect(unexplained).toEqual([]);
    if (drops.length) console.log(`crossrow rows shorter than at f51a011 (every pairable jacket already leads a card):\n  ${drops.join("\n  ")}`);
    /* The week rows never shrink. */
    for (const run of RUNS) for (const page of run.pages) expect(page.week.length).toBe(BEFORE[run.occasion][page.n - 1]![0]);
  });

  it("reports the per-page numbers", () => {
    for (const run of RUNS) {
      const line = run.pages
        .map((page) => `page ${page.n}: ${page.week.length} week + ${page.rows.map((r) => `${r.looks.length}${r.relaxed ? "*" : ""}`).join("+")}, max per-page ${Math.max(...keyCounts(page.page).values())}, jackets on ${page.page.filter((look) => look.some((g) => BY_ID.get(g.id)!.category === "outerwear")).length}/${page.page.length} cards, un-led jackets under the cap ${page.openJackets.map((j) => `${j.name}${j.dressable ? ` (legal; rows that could take it: ${Object.entries(j.rows).filter(([, ok]) => ok).map(([id]) => id).join(",") || "none"})` : ""}`).join("; ") || "none"}`)
        .join("\n  ");
      console.log(`crossrow ${run.occasion}/${SEASON} (${run.coreGroups} core groups, ${run.shoeGroups} shoe groups, ${run.unpairable.length} unpairable):\n  ${line}`);
      expect(run.pages.length).toBe(PAGES);
    }
  });
});

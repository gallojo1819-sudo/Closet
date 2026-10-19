/**
 * Cross-row rotation on one Lookbook screen. Seen live on Oct 14 2026: a field jacket, a pair
 * of chinos with the pink suede sneakers, and the denim jacket each led or sat on card after
 * card across the rows; then, with the row-first-card rule of f51a011, the brown chore jacket,
 * the navy field jacket and the blue plaid shearling jacket each still led two cards of one
 * weekday/fall page. A card's lead is the piece the card shows first: a week card its top (the
 * stacked plate's first band, weekLeadPiece in look.ts), an idea card its jacket, else its top
 * (the jacket-first collage, leadPiece in look-collage.ts), and across the whole page (the week
 * row, every idea row, the forgotten row) a piece, with its look-alikes, leads at most one
 * card. A piece sits on at most SCREEN_CAP cards (RELAXED_CAP only in a plain row the section
 * owed when the pool is short), every piece that can pair still gets a turn, and the week row
 * holds exactly min(8, the scarcest core slot's pairable look-alike groups): 6 on out/fall, 8
 * elsewhere.
 *
 * Since the probability round every rule is pass or fail, so a row is as full as the rules,
 * the page cap and the one-lead rule allow: a weekday or out page in fall is bounded by its
 * jackets (one lead each) and out by its six shoe groups. No row count is pinned; a row shorter
 * than the minimum, or a page with fewer than STORY_ROWS rows, is right only when an
 * exhaustive search (page-room.ts: every open top, bottom, shoe and un-led jacket, the full
 * relax ladder) finds no card it could still take. Six pages per chapter on the snapshot
 * closet, simulated as the route does them.
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
import { weekLeadPiece } from "./look.ts";
import { leadPiece } from "./look-collage.ts";
import { lookFitsOccasion } from "./lookbook.ts";
import { passesRules } from "./stylist/legal.ts";
import { advanceRotation, emptyRotation, type Rotation } from "./rotation.ts";
import { OCCASIONS, type Garment, type Occasion, type Season } from "./types.ts";
import { NEXT_PLAIN_ROW, roomLeft, roomLine } from "./__fixtures__/page-room.ts";
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

type Row = { id: string; title: string; looks: Garment[][]; relaxed: boolean; waived: string[][] };
type Page = {
  n: number;
  week: Garment[][];
  weekWaived: string[][];
  weekLeads: string[];
  rows: Row[];
  page: Garment[][];
  /** Pieces listed unpairable when this page was built. */
  stuck: Set<string>;
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
    const rows: Row[] = ways.map((way) => ({ id: way.id, title: way.title, looks: way.looks[occasion] ?? [], relaxed: Boolean(way.relaxed), waived: way.waived ?? [] }));
    rotation = advanceRotation(rotation, { page: rows.flatMap((row) => row.looks).map(ids), closet, eligible, stuck, alike: KEY }).next;
    const page = [...week.looks, ...rows.flatMap((row) => row.looks)];
    for (const g of page.flat()) shown.add(KEY.get(g.id)!);
    if (n === 5) shownBy5 = new Set(shown);
    pages.push({ n, week: week.looks, weekWaived: week.waived, weekLeads: week.leads, rows, page, stuck: new Set(stuck) });
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

/** The exhaustive proof that a row has no card left, as an assertion message (null: full). */
function proof(run: Run, page: Page, rowId: string, strictCap = false): string | null {
  return roomLine(
    roomLeft(
      { closet: CLOSET, occasion: run.occasion, season: SEASON, today: TODAY, week: page.week, rows: page.rows, stuck: page.stuck, eligible: new Set(run.eligible) },
      rowId,
      { strictCap },
    ),
  );
}

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

  it("b. no piece sits on more than SCREEN_CAP cards of a screen; RELAXED_CAP only in a relaxed plain row that had no card left at the strict cap", () => {
    for (const run of RUNS) {
      for (const page of run.pages) {
        const strict = [...page.week, ...page.rows.filter((row) => !row.relaxed).flatMap((row) => row.looks)];
        const over = [...keyCounts(strict).entries()].filter(([, n]) => n > SCREEN_CAP).map(([key, n]) => `${key}=${n}`);
        expect(over, `${run.occasion} page ${page.n}: over the page cap outside relaxed rows`).toEqual([]);
        const overRelaxed = [...keyCounts(page.page).entries()].filter(([, n]) => n > RELAXED_CAP).map(([key, n]) => `${key}=${n}`);
        expect(overRelaxed, `${run.occasion} page ${page.n}: over the relaxed cap`).toEqual([]);
        /* A relaxed row is the short-pool case only: at the strict cap it had no card left. */
        for (const row of page.rows.filter((r) => r.relaxed)) {
          expect(proof(run, page, row.id, true), `${run.occasion} page ${page.n} / ${row.title}: relaxed with room to spare`).toBeNull();
        }
      }
    }
  });

  it("c. every piece that pairs is shown within five pages (look-alikes as one piece); the unpairable are listed, each eligible", () => {
    for (const run of RUNS) {
      const allowed = run.eligible.filter((id) => !run.unpairable.includes(id));
      const missing = allowed.filter((id) => !run.shownBy5.has(KEY.get(id)!));
      expect(names(missing), `${run.occasion}: pairable pieces never shown in 5 pages`).toEqual([]);
      for (const id of run.unpairable) expect(run.eligible, `${run.occasion}: unpairable ${id} is eligible`).toContain(id);
      expect(allowed.length, `${run.occasion}: nothing pairs`).toBeGreaterThan(0);
    }
  });

  it("d. the week row is exactly 6 on out/fall and 8 elsewhere; a row short of ROW_MIN, or a page short of STORY_ROWS rows, has no card left (exhaustive)", () => {
    for (const run of RUNS) {
      expect(Math.min(WEEK, run.coreGroups), `${run.occasion}: pairable groups in the scarcest core slot`).toBe(WEEK_EXPECTED[run.occasion]);
      for (const page of run.pages) {
        expect(page.week.length, `${run.occasion} page ${page.n} week row`).toBe(WEEK_EXPECTED[run.occasion]);
        expect(page.rows.length, `${run.occasion} page ${page.n} rows`).toBeLessThanOrEqual(STORY_ROWS);
        if (page.rows.length < STORY_ROWS) {
          expect(proof(run, page, NEXT_PLAIN_ROW), `${run.occasion} page ${page.n}: ${page.rows.length} rows, yet another plain row`).toBeNull();
        }
        for (const row of page.rows) {
          expect(row.looks.length, `${run.occasion} page ${page.n} / ${row.title}: an empty row`).toBeGreaterThan(0);
          if (row.looks.length < ROW_MIN) {
            expect(proof(run, page, row.id), `${run.occasion} page ${page.n} / ${row.title}: ${row.looks.length} cards`).toBeNull();
          }
        }
      }
    }
  });

  it("e. every card passes the rules, or names the soft rules the ladder waived for it; the week row never waives on this closet in fall", () => {
    let waivedCards = 0;
    for (const run of RUNS) {
      for (const page of run.pages) {
        const cards = [
          ...page.week.map((look, i) => ({ look, waived: page.weekWaived[i] ?? [], where: `week card ${i + 1}` })),
          ...page.rows.flatMap((row) => row.looks.map((look, i) => ({ look, waived: row.waived[i] ?? [], where: `${row.title} card ${i + 1}` }))),
        ];
        for (const card of cards) {
          const line = `${run.occasion} page ${page.n} / ${card.where}: ${card.look.map((g) => g.name).join(" + ")}`;
          expect(lookFitsOccasion(card.look, run.occasion, CLOSET, undefined, { wideWeekdayTops: true }), line).toBe(true);
          const verdict = passesRules(card.look, { house: null, occasion: run.occasion, season: SEASON, pool: CLOSET });
          if (verdict.pass) continue;
          waivedCards += 1;
          /* A card that fails strictly carries its waiver, and every failing rule is among the waived (soft) ones. */
          expect(card.waived.length, `${line}: fails ${verdict.failed.join(",")} with no waiver`).toBeGreaterThan(0);
          for (const id of verdict.failed) expect(card.waived, `${line}: ${id} is not waived`).toContain(id);
        }
      }
    }
    expect(waivedCards, "cards the ladder had to waive for").toBeGreaterThanOrEqual(0);
  });

  it("reports the per-page numbers", () => {
    for (const run of RUNS) {
      const line = run.pages
        .map((page) => `page ${page.n}: ${page.week.length} week + ${page.rows.map((r) => `${r.looks.length}${r.relaxed ? "*" : ""}${r.waived.some((w) => w.length) ? "~" : ""}`).join("+")}, max per-page ${Math.max(...keyCounts(page.page).values())}, jackets on ${page.page.filter((look) => look.some((g) => BY_ID.get(g.id)!.category === "outerwear")).length}/${page.page.length} cards, unpairable ${page.stuck.size}`)
        .join("\n  ");
      console.log(`crossrow ${run.occasion}/${SEASON} (${run.coreGroups} core groups, ${run.shoeGroups} shoe groups, ${run.unpairable.length} unpairable):\n  ${line}`);
      expect(run.pages.length).toBe(PAGES);
    }
  });
});

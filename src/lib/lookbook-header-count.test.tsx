/**
 * The Lookbook header's "N looks" equals the cards on the screen. The idea rows are drawn by
 * DetectorSections from sectionRows; the header counts renderedSectionLooks, which is the same
 * list flattened. This renders the section to markup and counts its cards, the week cards as
 * the route does (a card with a gate, a missing piece, or under three resolvable pieces draws
 * no look), and checks the header number against the sum on six pages (the first load and
 * five Re-dress taps) per chapter.
 *
 * The closet is the snapshot fixture (engine-garments.json): the owner's pieces, brands
 * stripped. The "Your usual" branch uses a thin closet of five of those pieces
 * (three tops, a bottom, a shoe), which clears no way and so gets the usual row of three; a
 * closet of the same pieces without a bottom gets the usual's reason and no card.
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DetectorSections } from "@/components/closet/detector-sections";
import {
  capScreenLooks,
  renderedSectionLooks,
  rotationEligible,
  rowWays,
  sectionRows,
  twinKey,
  visibleDetectors,
  weekRotationRow,
  type Way,
} from "./detectors.ts";
import { looksFromRows, realWeekLooks } from "./lookbook.ts";
import { pageResolved, screenLookCount } from "./lookbook-status.ts";
import { advanceRotation, emptyRotation, type Rotation } from "./rotation.ts";
import { OCCASIONS, type Garment, type Look, type Occasion, type Season } from "./types.ts";
import { TEST_CLOSET_COUNT, testCloset } from "./__fixtures__/snapshot.ts";

const CLOSET: Garment[] = testCloset;
const NOW = new Date("2026-10-13T15:00:00.000Z");
const TODAY = "2026-10-13";
const SEASON: Season = "fall";
const ALL: Occasion[] = OCCASIONS.map((o) => o.id);
const PAGES = 6;
const WEEK = 8;

/** Five of the owner's pieces: the first three tops, the first bottom, the first shoe. */
const THIN_IDS = ["g_oimadifuvalb", "g_j4qu90fgv347", "g_1zteshjh31ac", "g_v3ovns4bv344", "g_8nrtffa2s13s"];
const THIN: Garment[] = THIN_IDS.map((id) => CLOSET.find((g) => g.id === id)!);
const THIN_NO_BOTTOM: Garment[] = THIN.filter((g) => g.category !== "bottom");

const ids = (look: readonly Garment[]) => look.map((g) => g.id);

type Page = {
  n: number;
  shown: Way[];
  /** The header helper's number, from the same inputs the route hands it. */
  header: number;
  /** Week cards the route's JSX draws a look for. */
  weekRendered: number;
  /** PlateCards in DetectorSections' markup. */
  sectionRendered: number;
  /** renderedSectionLooks, the list the header counts. */
  sectionCounted: number;
  rows: { id: string; title: string; cards: number }[];
  usual: boolean;
  markup: string;
};

/** PlateCard's button: `Open <piece names>`. The rack's own controls carry other labels. */
function countCards(markup: string): number {
  return (markup.match(/<button[^>]*aria-label="Open /g) ?? []).length;
}

function renderSection(closet: Garment[], shown: Way[], occasion: Occasion): string {
  return renderToStaticMarkup(<DetectorSections garments={closet} ways={shown} occasion={occasion} season={SEASON} />);
}

/** Six pages of one chapter, built as the Lookbook route builds them. */
function simulate(closet: Garment[], occasion: Occasion): Page[] {
  const byId = new Map(closet.map((g) => [g.id, g]));
  const owned = new Set(byId.keys());
  const piecesFor = (look: Look) => look.garmentIds.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
  const closetIds = closet.map((g) => g.id);
  const eligible = rotationEligible(closet, SEASON).map((g) => g.id);
  const alike = new Map(closet.map((g) => [g.id, twinKey(g)]));
  let rotation: Rotation = emptyRotation();
  let stuck = new Set<string>();
  const out: Page[] = [];
  for (let n = 1; n <= PAGES; n += 1) {
    /* The week row: weekRotationRow, then looksFromRows, realWeekLooks and capScreenLooks (the route's `cards`). */
    const built = weekRotationRow(closet, { occasion, season: SEASON, rotation, cap: WEEK, today: TODAY, stuck });
    stuck = new Set(built.unpairable.map((g) => g.id));
    rotation = advanceRotation(rotation, { page: built.looks.map(ids), closet: closetIds, eligible, stuck, alike }).next;
    const cards = capScreenLooks(realWeekLooks(looksFromRows(built.looks, occasion, built.demoted), owned));
    /* The route's JSX: a gated or short card draws no look. */
    const weekRendered = cards.filter((look) => !look.gate && !look.needsPieces && piecesFor(look).length >= 3).length;
    /* The idea rows: rowWays with the week's pieces on screen and the Re-dress salt. */
    const found = visibleDetectors(closet, { occasion, season: SEASON });
    const shown = rowWays(found, closet, {
      occasion,
      season: SEASON,
      salt: n - 1,
      onScreen: cards.flatMap((look) => look.garmentIds),
      today: TODAY,
      rotation,
      stuck,
    });
    rotation = advanceRotation(rotation, {
      page: shown.flatMap((way) => (way.looks[occasion] ?? []).map(ids)),
      closet: closetIds,
      eligible,
      stuck,
      alike,
    }).next;
    const section = renderedSectionLooks(shown, occasion);
    const header = screenLookCount(
      cards.map((look) => (look.gate || look.needsPieces ? [] : piecesFor(look))),
      section,
    );
    const markup = renderSection(closet, shown, occasion);
    const plan = sectionRows(shown, occasion);
    out.push({
      n,
      shown,
      header,
      weekRendered,
      sectionRendered: countCards(markup),
      sectionCounted: section.length,
      rows: plan.rows.map((row) => ({ id: row.id, title: row.title, cards: row.looks.length })),
      usual: Boolean(plan.usual),
      markup,
    });
  }
  return out;
}

let RUNS: { occasion: Occasion; pages: Page[] }[] = [];
let USUAL: Page[] = [];
let USUAL_SHORT: Page[] = [];

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  RUNS = ALL.map((occasion) => ({ occasion, pages: simulate(CLOSET, occasion) }));
  USUAL = simulate(THIN, "weekend");
  USUAL_SHORT = simulate(THIN_NO_BOTTOM, "weekend");
});

afterAll(() => {
  vi.useRealTimers();
});

describe("the header counts the cards on the screen", () => {
  it("the closet is the snapshot closet", () => {
    expect(CLOSET.length).toBe(TEST_CLOSET_COUNT);
    expect(THIN.length).toBe(5);
    expect(new Set(THIN.map((g) => g.category))).toEqual(new Set(["top", "bottom", "footwear"]));
  });

  it("six pages per chapter: header == week cards drawn + section cards drawn", () => {
    for (const run of RUNS) {
      for (const page of run.pages) {
        const where = `${run.occasion} page ${page.n}`;
        expect(page.sectionRendered, `${where}: markup vs renderedSectionLooks`).toBe(page.sectionCounted);
        expect(page.header, `${where}: header vs cards drawn`).toBe(page.weekRendered + page.sectionRendered);
        expect(page.header, `${where}: header stuck at the week row`).toBeGreaterThan(WEEK);
        expect(page.usual, where).toBe(false);
      }
    }
  });

  it("the section's rows are sectionRows, title for title and card for card", () => {
    for (const run of RUNS) {
      for (const page of run.pages) {
        for (const row of page.rows) {
          expect(page.markup, `${run.occasion} page ${page.n}: row ${row.id}`).toContain(`aria-label="${row.title} outfits"`);
        }
        expect(page.rows.reduce((sum, row) => sum + row.cards, 0)).toBe(page.sectionRendered);
      }
    }
  });

  it("Your usual: the one row of its looks is drawn and counted alike", () => {
    for (const page of USUAL) {
      const where = `usual page ${page.n}`;
      expect(page.usual, where).toBe(true);
      expect(page.rows.map((row) => row.id), where).toEqual(["usual"]);
      expect(page.markup, where).toContain("Your usual");
      expect(page.sectionRendered, where).toBe(3);
      expect(page.sectionRendered, `${where}: markup vs renderedSectionLooks`).toBe(page.sectionCounted);
      expect(page.header, `${where}: header vs cards drawn`).toBe(page.weekRendered + page.sectionRendered);
    }
  });

  it("Your usual with under three looks: the reason, no card, nothing counted", () => {
    for (const page of USUAL_SHORT) {
      const where = `usual-short page ${page.n}`;
      expect(page.usual, where).toBe(true);
      expect(page.rows, where).toEqual([]);
      expect(page.markup, where).toContain("data-usual-reason");
      expect(page.sectionRendered, where).toBe(0);
      expect(page.header, where).toBe(page.weekRendered);
    }
  });

  it("the route shows a number only once both rows are in: the count line, the skeletons and the empty reason read pageResolved", () => {
    const page = readFileSync(new URL("../routes/lookbook.tsx", import.meta.url), "utf8");
    expect(page).toMatch(/const countResolved = pageResolved\(\{ week: weekResolved, ways: waysReady \}\);/);
    expect(page.match(/resolved: countResolved/g)?.length).toBe(3);
    expect(page).not.toMatch(/resolved: weekResolved/);
    expect(pageResolved({ week: true, ways: false })).toBe(false);
  });

  it("reports the per-page numbers", () => {
    for (const run of RUNS) {
      const line = run.pages
        .map((page) => `page ${page.n}: header ${page.header} = ${page.weekRendered} week + ${page.sectionRendered} section (${page.rows.map((row) => `${row.title} ${row.cards}`).join(", ")})`)
        .join("\n  ");
      console.log(`header count ${run.occasion}/${SEASON}:\n  ${line}`);
    }
    console.log(`header count usual/weekend: ${USUAL.map((page) => `page ${page.n}: ${page.header} = ${page.weekRendered}+${page.sectionRendered}`).join("; ")}`);
    expect(RUNS.length).toBe(ALL.length);
  });
});

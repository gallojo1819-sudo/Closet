/**
 * The probability round (Oct 15 2026): no numeric score ranks or gates any look; every surface
 * draws at random, seeded by the New York day, the surface and the live closet, among the looks
 * that pass the rules, with odds from rotation alone. The closet is the owner's snapshot
 * (engine-garments.json), never a hand-made piece.
 *
 *  1. 60-day rotation coverage per Weekday, Weekend and Out in fall and winter with simulated
 *     wear: every piece some rule-passing look holds is drawn; the rest are listed with the rule
 *     ids that refuse them.
 *  2. No scorer is left in src/ (a grep), and no "score" in the chooser modules.
 *  3. Determinism: the same seed, closet and journal give the same look a hundred times; the next
 *     date gives a different one on most days; Today, the dock's "This look" and the ask agree.
 *  4. Odds: a piece worn yesterday is drawn at most half as often as an unworn one; a piece never
 *     in a look more often than one shown last week.
 *  5. The rules hold on every surface, with spot checks of XC-PROP-2, XC-SEA-4, COL-12 and the
 *     jacket day on real ids.
 *  6. No rating surface: no technique line, no match copy, no stars, thumbs, rate or score in the
 *     components and routes; nothing writes taste.techniques[].weight; normalizeTaste round-trips.
 *  7. The Lookbook header is never a number before both rows are ready; the week row is 8 full
 *     cards; one lead per piece; the count is the cards.
 *  8. Today's Suggest shows one to three alternates or a reason line; the stylist's first open
 *     has three starter chips; the dock labels a closet answer.
 *  9. The owner's style rules and the addendum, on real ids: loafers on a rugby-and-jeans look, a
 *     country knit with cords on a weekday, jeans first-class, linen never with flannel,
 *     JKT-LAY-2 only for a chunky or cable knit, the brown suede mules on Out and Weekend in fall,
 *     the brown button-up as a jacket.
 * 10. Jeans with a blazer (Joe 2026-10-18/19): ecru or mid-wash clean jeans under a sport coat pass
 *     the rules and draw at half odds (JEANS_BLAZER_ODDS); light-wash, white, striped and
 *     distressed stay blocked.
 * 11. Outfit with this and "N looks with this": every piece some hero occasion can dress gets an
 *     outfit; the heading count is the cards; no surface says "5" unless it shows 5; the per-piece
 *     time of looksForHero.
 * 12. A seven-day Today sample for Weekday/fall, printed for the round's record.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dailyPickWeather, liveIdsKey } from "./daily-pick.ts";
import { rotationEligible, rowWays, twinGroups, visibleDetectors, weekRotationRow, renderedSectionLooks } from "./detectors.ts";
import { cellKit } from "./detectors/cells.ts";
import { drawLook, drawOrder, drawSeed, FRESH_BOOST, JEANS_BLAZER_ODDS, lookWeight, pieceWeight, RECENT_MIN, rngFromSalt } from "./draw.ts";
import { dressAcrossOccasions, NO_OUTFIT_NOTE } from "./dress.ts";
import { pickDropWith, type PickDropExtra } from "./drop-pick.ts";
import { HERO_LOOKS, heroOccasionsFor, looksForHero, looksWithLabel } from "./lookbook.ts";
import { pieceLabel } from "./piece-label.ts";
import { seasonFromWeather } from "./season.ts";
import { weekLeadPiece } from "./look.ts";
import { leadPiece } from "./look-collage.ts";
import { FINDING_LOOKS, lookbookCountLine, pageResolved, screenLookCount } from "./lookbook-status.ts";
import { lookFitsOccasion } from "./occasion-gate.ts";
import { emptyRotation } from "./rotation.ts";
import type { Season } from "./season.ts";
import { clashes, isFlannelPiece, isLinenPiece, slotOf } from "./style.ts";
import { STARTER_CHIPS } from "./stylist-session.ts";
import { answerTodayAsk } from "./stylist-page.ts";
import { BROWN_BUTTON_UP, ecruOrMidJeans, jacketHits, jacketInfo, jacketRequired, jeansWithBlazer, OUTER_ELIGIBLE, slotPieces } from "./stylist/jackets.ts";
import { JACKET_COVER_IDS, passesRules, pieceRuleFails, PREFERENCE_IDS, relaxTiers, ruleFails, ruleHits } from "./stylist/legal.ts";
import { RULE_SENTENCES } from "./stylist/rule-copy.ts";
import { emptyTaste, normalizeTaste } from "./taste.ts";
import { dailyPickIds, todayLookPieces } from "./today-look.ts";
import { NO_ALTERNATES, todaySuggestions } from "./today-suggest.ts";
import type { Garment, Occasion, WearEntry } from "./types.ts";
import { liveSnapshot, TEST_CLOSET_COUNT } from "./__fixtures__/snapshot.ts";

const CLOSET: Garment[] = liveSnapshot;
const BY_ID = new Map(CLOSET.map((g) => [g.id, g]));
const LIVE_IDS = liveIdsKey(CLOSET);
const START = "2026-10-15";
const NOW = new Date(`${START}T15:00:00.000Z`);
const DAYS = 120;
const COVER_BY = 60;
const MULES = "g_wymz2j18s6wh";
const SRC = fileURLToPath(new URL("./", import.meta.url));

const name = (id: string) => BY_ID.get(id)?.name ?? id;
const names = (ids: readonly string[]) => ids.map(name).join(" / ");

/** ISO dates from START, in New York (the fixture's days are plain dates). */
function dateAfter(days: number): string {
  const d = new Date(`${START}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type Journal = Pick<WearEntry, "date" | "garmentIds" | "verdict">[];

/** One Today draw for a day: the daily pick's inputs (the bucket's weather, the surface "today", the closet), the simulated journal as the wear record. */
function todayDraw(occasion: Occasion, season: Season, date: string, journal: Journal, extra: Partial<PickDropExtra> = {}) {
  return pickDropWith(CLOSET, dailyPickWeather(season), occasion, {
    salt: drawSeed(date, "today", LIVE_IDS),
    season,
    today: date,
    journal,
    ...extra,
  });
}

type Run = {
  occasion: Occasion;
  season: Season;
  days: { date: string; ids: string[]; relaxed: string[] }[];
  shownBy: Map<number, Set<string>>;
  /** Pieces some rule-passing look (strict, or under the ladder) holds. */
  pairable: Set<string>;
  /** Pieces no look holds, with the rule ids that refuse them on their own (pieceRuleFails), or the rules their best partner look trips. */
  blocked: Map<string, string[]>;
  eligible: string[];
  ms: number;
};

const RUN_KEYS: [Occasion, Season][] = [
  ["weekday", "fall"],
  ["weekend", "fall"],
  ["out", "fall"],
  ["weekday", "winter"],
  ["weekend", "winter"],
  ["out", "winter"],
];

/**
 * Whether a piece sits in any rule-passing look for the chapter: every partner combination is
 * tried (no beam, no budget) and read as the lowest relax tier it passes under; the first strict
 * look stops the search. A core whose own fails no jacket can mend (anything but the jacket-cover
 * ids, or a soft rule no tier waives) is not dressed with jackets. With no look, the rule ids of
 * the piece's least-failing look.
 */
function pairableLook(piece: Garment, occasion: Occasion, season: Season): { tier: number; look?: Garment[]; least: string[] } {
  const eligible = new Set(rotationEligible(CLOSET, season).map((g) => g.id));
  const live = CLOSET.filter((g) => eligible.has(g.id));
  const slot = slotOf(piece);
  const outer = slot === "outerwear";
  const tops = slot === "top" || slot === "dress" ? [piece] : live.filter((g) => (slotOf(g) === "top" || slotOf(g) === "dress") && g.id !== piece.id);
  const bottoms = slot === "bottom" ? [piece] : live.filter((g) => slotOf(g) === "bottom");
  const shoes = slot === "footwear" ? [piece] : live.filter((g) => slotOf(g) === "footwear");
  const jackets = outer ? [piece] : live.filter((g) => slotOf(g) === "outerwear");
  const needJacket = jacketRequired(occasion, season);
  const waivable = new Set(relaxTiers().at(-1));
  const ctx = { house: null, occasion, season, pool: CLOSET };
  let best = -1;
  let bestLook: Garment[] | undefined;
  let least: string[] = [];
  let leastN = Number.POSITIVE_INFINITY;
  const note = (failed: string[]) => {
    if (best < 0 && failed.length < leastN) {
      leastN = failed.length;
      least = failed;
    }
  };
  const consider = (look: Garment[]): boolean => {
    if (!lookFitsOccasion(look, occasion, CLOSET, undefined, { wideWeekdayTops: true })) return false;
    const tier = cellKit.ruleTier(look, occasion, season);
    if (tier >= 0 && (best < 0 || tier < best)) {
      best = tier;
      bestLook = look;
    }
    if (tier < 0) note(ruleFails(look, ctx));
    return best === 0;
  };
  search: for (const top of tops) {
    for (const bottom of bottoms) {
      for (const shoe of shoes) {
        const core = [top, bottom, shoe];
        if (!outer && !needJacket && consider(core)) break search;
        /* Jackets only where the bare core's own fails are ones a jacket can mend. */
        const hits = ruleHits(core, ctx);
        const mendable = hits.hard.every((id) => JACKET_COVER_IDS.includes(id)) && hits.soft.every((id) => waivable.has(id) || JACKET_COVER_IDS.includes(id));
        if (!mendable) {
          note([...hits.hard, ...hits.soft]);
          continue;
        }
        for (const jacket of jackets) if (consider([...core, jacket])) break search;
      }
    }
  }
  return { tier: best, look: bestLook, least };
}

function simulate(occasion: Occasion, season: Season): Run {
  const t0 = performance.now();
  const journal: Journal = [];
  const days: Run["days"] = [];
  const shown = new Set<string>();
  const shownBy = new Map<number, Set<string>>();
  for (let i = 0; i < DAYS; i += 1) {
    const date = dateAfter(i);
    const picked = todayDraw(occasion, season, date, journal);
    days.push({ date, ids: picked.ids, relaxed: picked.relaxed });
    if (picked.ids.length) journal.unshift({ date, garmentIds: picked.ids, verdict: "worn" });
    for (const id of picked.ids) shown.add(id);
    shownBy.set(i + 1, new Set(shown));
  }
  const eligible = rotationEligible(CLOSET, season).map((g) => g.id);
  const pairable = new Set<string>();
  const blocked = new Map<string, string[]>();
  for (const id of eligible) {
    const g = BY_ID.get(id)!;
    const own = pieceRuleFails(g, { house: null, occasion, season, pool: CLOSET });
    if (own.length) {
      blocked.set(id, own);
      continue;
    }
    const found = pairableLook(g, occasion, season);
    if (found.tier >= 0) pairable.add(id);
    else blocked.set(id, found.least.length ? found.least : ["no partner core passes the cheap gates"]);
  }
  return { occasion, season, days, shownBy, pairable, blocked, eligible, ms: Math.round(performance.now() - t0) };
}

let RUNS: Run[] = [];

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  RUNS = RUN_KEYS.map(([occasion, season]) => simulate(occasion, season));
}, 1_200_000);

afterAll(() => {
  vi.useRealTimers();
});

const run = (occasion: Occasion, season: Season) => RUNS.find((r) => r.occasion === occasion && r.season === season)!;

describe("1. rotation coverage: every piece a rule-passing look holds is drawn; the rest are listed with their rule ids", () => {
  it("the closet is the snapshot", () => {
    expect(CLOSET.length).toBe(TEST_CLOSET_COUNT);
    expect(CLOSET.every((g) => (g.brand ?? "") === "")).toBe(true);
  });

  it("prints the coverage table", () => {
    const lines = RUNS.map((r) => {
      const at = (n: number) => [...r.shownBy.get(n)!].filter((id) => r.pairable.has(id)).length;
      return `${r.occasion.padEnd(8)} ${r.season.padEnd(7)} eligible ${String(r.eligible.length).padStart(3)}  pairable ${String(r.pairable.size).padStart(3)}  blocked ${String(r.blocked.size).padStart(3)}  shown by day 30: ${String(at(30)).padStart(3)}  60: ${String(at(60)).padStart(3)}  90: ${String(at(90)).padStart(3)}  120: ${String(at(120)).padStart(3)}  relaxed days ${r.days.filter((d) => d.relaxed.length).length}  (${r.ms} ms)`;
    });
    console.log(`coverage (${DAYS} days of Today, simulated wear):\n  ${lines.join("\n  ")}`);
    for (const r of RUNS) {
      const groups = new Map<string, string[]>();
      for (const [id, rules] of r.blocked) {
        const key = rules.join(",");
        groups.set(key, [...(groups.get(key) ?? []), name(id)]);
      }
      const by = [...groups.entries()].map(([rules, pieces]) => `${rules}: ${pieces.length} (${pieces.slice(0, 4).join("; ")}${pieces.length > 4 ? "; …" : ""})`);
      console.log(`blocked on ${r.occasion}/${r.season}:\n  ${by.join("\n  ") || "none"}`);
    }
    expect(RUNS.length).toBe(RUN_KEYS.length);
  });

  it("every pairable piece is drawn within the run, most within 60 days; every blocked piece names its rules", () => {
    for (const r of RUNS) {
      const at = (n: number) => [...r.pairable].filter((id) => r.shownBy.get(n)!.has(id));
      const missing = [...r.pairable].filter((id) => !r.shownBy.get(DAYS)!.has(id));
      expect(missing.map(name), `${r.occasion}/${r.season}: pairable pieces never drawn in ${DAYS} days`).toEqual([]);
      /* By day 60 the draw has reached at least four pieces in five it could; a day is one look. */
      expect(at(COVER_BY).length, `${r.occasion}/${r.season}: pairable pieces drawn by day ${COVER_BY}`).toBeGreaterThanOrEqual(Math.floor(r.pairable.size * 0.8));
      for (const [id, rules] of r.blocked) {
        expect(rules.length, `${r.occasion}/${r.season}: ${name(id)} is blocked with no rule named`).toBeGreaterThan(0);
        for (const rule of rules) expect(RULE_SENTENCES[rule] ?? rule, `${r.occasion}/${r.season}: ${rule} has no sentence`).toBeTruthy();
      }
      for (const day of r.days) expect(day.ids.length, `${r.occasion}/${r.season} ${day.date}: no look`).toBeGreaterThanOrEqual(3);
    }
  });

  it("no day repeats the look of the day before, and a piece worn yesterday (weight RECENT_MIN) comes back on few days", () => {
    for (const r of RUNS) {
      let repeats = 0;
      for (let i = 1; i < r.days.length; i += 1) {
        const prev = new Set(r.days[i - 1]!.ids);
        expect([...r.days[i]!.ids].sort().join(), `${r.occasion}/${r.season} ${r.days[i]!.date}: the same look as the day before`).not.toBe([...prev].sort().join());
        if (r.days[i]!.ids.some((id) => prev.has(id))) repeats += 1;
      }
      console.log(`${r.occasion}/${r.season}: days with a piece worn the day before: ${repeats} of ${r.days.length - 1}`);
      /* Out in fall has six shoe groups, so a shoe comes back sooner there; elsewhere a repeat is rare. */
      expect(repeats, `${r.occasion}/${r.season}: days repeating a piece`).toBeLessThanOrEqual(r.occasion === "out" ? 40 : 20);
    }
  });
});

/** Source files under src/, the tests, fixtures, approved profiles and the two allowed scorers left out. */
function sources(dir = SRC, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (/__fixtures__|__tests__|approved/.test(entry)) continue;
      sources(path, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry) || /\.test\.tsx?$/.test(entry) || /\.d\.ts$/.test(entry)) continue;
    if (/stylist-notes[\\/](rank|classify)\.ts$/.test(path)) continue;
    out.push(path);
  }
  return out;
}

describe("2. no scorer is left", () => {
  const SCORERS = /\b(scoreLook|rankLook|seasonRank|softDelta|trendScore|techniqueWeight|techniqueLine|bestScore|byScore|heroScore|scoreOuterForRecipe|occasionScore|scorePlates)\b|b\.score - a\.score|b\.s - a\.s|b\.best - a\.best/;
  const CHOOSERS = ["style.ts", "drop-pick.ts", "lookbook.ts", "detectors/ideas.ts", "detectors/cells.ts", "stylist/matrix.ts", "stylist/legal.ts", "stylist-page.ts", "outfit-check.ts", "taste.ts", "look-opinion.ts", "dress.ts"];

  it("no scoring symbol survives in src/ outside the allowed scorers", () => {
    const hits: string[] = [];
    for (const file of sources(fileURLToPath(new URL("../", import.meta.url)))) {
      const text = readFileSync(file, "utf8");
      const m = SCORERS.exec(text);
      if (m) hits.push(`${file.slice(file.indexOf("src/"))}: ${m[0]}`);
    }
    expect(hits).toEqual([]);
  });

  it("no \"score\" in the chooser modules", () => {
    const hits: string[] = [];
    for (const rel of CHOOSERS) {
      const text = readFileSync(join(SRC, rel), "utf8");
      const lines = text.split("\n").map((line, i) => ({ line, i })).filter(({ line }) => /\bscore\b/i.test(line));
      for (const { line, i } of lines) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
    }
    expect(hits).toEqual([]);
  });
});

describe("3. determinism", () => {
  const journalOf = (): Journal => [{ date: dateAfter(-3), garmentIds: run("weekday", "fall").days[5]!.ids, verdict: "worn" }];

  it("the same seed, closet and journal give the same look a hundred times", () => {
    const journal = journalOf();
    const first = todayDraw("weekday", "fall", START, journal);
    expect(first.ids.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 100; i += 1) expect(todayDraw("weekday", "fall", START, journal).ids).toEqual(first.ids);
  });

  it("the next date gives a different look on at least 80% of 30 days, with no wear between them", () => {
    let different = 0;
    for (let i = 0; i < 30; i += 1) {
      const a = todayDraw("weekday", "fall", dateAfter(i), []).ids;
      const b = todayDraw("weekday", "fall", dateAfter(i + 1), []).ids;
      if ([...a].sort().join() !== [...b].sort().join()) different += 1;
    }
    expect(different).toBeGreaterThanOrEqual(24);
  });

  it("Today, the dock's \"This look\" and the ask agree on the day's pick", () => {
    const state = { drop: null, journal: [], thisWeek: [], garments: CLOSET, season: "fall" as const };
    const page = todayLookPieces(state, START).map((g) => g.id);
    expect(page.length).toBeGreaterThanOrEqual(3);
    expect(new Set(dailyPickIds(state, START))).toEqual(new Set(page));
    expect(answerTodayAsk({ ...state, today: START }).garmentIds).toEqual(page);
    expect(todayLookPieces(state, START).map((g) => g.id)).toEqual(page);
  });
});

describe("4. odds from rotation alone", () => {
  const SEEDS = 2000;

  it("over 2,000 seeds a piece worn yesterday is drawn at most half as often as an unworn one, and a piece never in a look more often than one shown last week (the draw itself)", () => {
    const today = START;
    const yesterday = dateAfter(-1);
    const lastWeek = dateAfter(-6);
    const mk = (id: string, wornOn: string[], createdAt = "2026-09-12T12:00:00.000Z"): Garment => ({ ...CLOSET[0]!, id, wornOn, createdAt });
    const worn = mk("p_yesterday", [yesterday]);
    const unworn = mk("p_unworn", [dateAfter(-40)]);
    const never = mk("p_never", []);
    const shown = mk("p_lastweek", [lastWeek]);
    const counts = new Map<string, number>();
    for (let s = 0; s < SEEDS; s += 1) {
      const rng = rngFromSalt(drawSeed(today, "odds", LIVE_IDS, s));
      const first = drawOrder([worn, unworn, never, shown], (g) => pieceWeight(g, { today }), rng)[0]!;
      counts.set(first.id, (counts.get(first.id) ?? 0) + 1);
    }
    console.log(`odds over ${SEEDS} seeds (first drawn): ${[...counts.entries()].map(([id, n]) => `${id} ${n}`).join(", ")}`);
    expect(counts.get("p_yesterday") ?? 0).toBeLessThanOrEqual(0.5 * (counts.get("p_unworn") ?? 0));
    expect(counts.get("p_never") ?? 0).toBeGreaterThan(counts.get("p_lastweek") ?? 0);
    expect(pieceWeight(worn, { today })).toBeCloseTo(Math.pow(RECENT_MIN + (1 - RECENT_MIN) / 14, 2), 6);
    expect(pieceWeight(never, { today })).toBeGreaterThan(pieceWeight(shown, { today }) * FRESH_BOOST ** 0);
  });

  it("the same holds through Today's pick: a top worn yesterday lands in the look at most half as often as the same top unworn", () => {
    const PICKS = 400;
    const top = CLOSET.find((g) => g.id === run("weekday", "fall").days[0]!.ids.find((id) => slotOf(BY_ID.get(id)!) === "top"))!;
    const count = (journal: Journal) => {
      let n = 0;
      for (let s = 0; s < PICKS; s += 1) {
        const picked = pickDropWith(CLOSET, dailyPickWeather("fall"), "weekday", { salt: drawSeed(START, "odds-pick", LIVE_IDS, s), season: "fall", today: START, journal });
        if (picked.ids.includes(top.id)) n += 1;
      }
      return n;
    };
    const unworn = count([]);
    const wornYesterday = count([{ date: dateAfter(-1), garmentIds: [top.id], verdict: "worn" }]);
    console.log(`Today's pick over ${PICKS} seeds: ${top.name} unworn ${unworn}, worn yesterday ${wornYesterday}`);
    expect(unworn).toBeGreaterThan(0);
    expect(wornYesterday).toBeLessThanOrEqual(0.5 * unworn);
  });
});

describe("5. the rules hold on every surface", () => {
  it("every look the runs drew passes the rules, or names the soft rules the ladder waived; a hard rule is never waived", () => {
    const soft = new Set(relaxTiers().at(-1));
    let waived = 0;
    for (const r of RUNS) {
      for (const day of r.days) {
        const look = day.ids.map((id) => BY_ID.get(id)!);
        const verdict = passesRules(look, { house: null, occasion: r.occasion, season: r.season, pool: CLOSET });
        const line = `${r.occasion}/${r.season} ${day.date}: ${names(day.ids)}`;
        if (verdict.pass) {
          expect(day.relaxed, `${line}: passes yet reports a waiver`).toEqual([]);
          continue;
        }
        waived += 1;
        expect(day.relaxed.length, `${line}: fails ${verdict.failed.join(",")} with no waiver`).toBeGreaterThan(0);
        for (const id of verdict.failed) {
          expect(soft.has(id), `${line}: ${id} is not a rule the ladder may waive`).toBe(true);
          expect(day.relaxed, `${line}: ${id} is not in the waiver`).toContain(id);
        }
      }
    }
    console.log(`days the ladder had to waive for, across the runs: ${waived} of ${RUNS.length * DAYS}`);
  });

  /** The first look of real pieces that trips a rule, in id order; null when the closet cannot trip it. */
  function tripping(rule: string, occasion: Occasion, season: Season, withJacket = true): Garment[] | null {
    const tops = CLOSET.filter((g) => slotOf(g) === "top").sort((a, b) => a.id.localeCompare(b.id));
    const bottoms = CLOSET.filter((g) => slotOf(g) === "bottom").sort((a, b) => a.id.localeCompare(b.id));
    const shoes = CLOSET.filter((g) => slotOf(g) === "footwear").sort((a, b) => a.id.localeCompare(b.id));
    const jackets = withJacket ? CLOSET.filter((g) => slotOf(g) === "outerwear").sort((a, b) => a.id.localeCompare(b.id)) : [];
    for (const top of tops) for (const bottom of bottoms) for (const shoe of shoes) {
      const core = [top, bottom, shoe];
      if (!withJacket && ruleFails(core, { house: null, occasion, season, pool: CLOSET }).includes(rule)) return core;
      for (const jacket of jackets) {
        const look = [...core, jacket];
        if (ruleFails(look, { house: null, occasion, season, pool: CLOSET }).includes(rule)) return look;
      }
    }
    return null;
  }

  it("XC-PROP-2, XC-SEA-4, COL-12 and the jacket day (JKT-COV-1) each refuse a real look, and no drawn look trips them unwaived", () => {
    const cases: [string, Occasion, Season, boolean][] = [
      ["XC-PROP-2", "weekend", "fall", true],
      ["XC-SEA-4", "weekday", "fall", true],
      ["COL-12", "out", "fall", true],
      ["JKT-COV-1", "weekday", "fall", false],
    ];
    for (const [rule, occasion, season, withJacket] of cases) {
      const look = tripping(rule, occasion, season, withJacket);
      expect(look, `${rule}: no real look trips it`).not.toBeNull();
      const verdict = passesRules(look!, { house: null, occasion, season, pool: CLOSET });
      expect(verdict.pass, `${rule}: ${names(look!.map((g) => g.id))} passes`).toBe(false);
      expect(verdict.failed, rule).toContain(rule);
      console.log(`${rule} refuses: ${names(look!.map((g) => g.id))} (${RULE_SENTENCES[rule]})`);
    }
    for (const r of RUNS) {
      for (const day of r.days) {
        const failed = ruleFails(day.ids.map((id) => BY_ID.get(id)!), { house: null, occasion: r.occasion, season: r.season, pool: CLOSET });
        for (const rule of ["XC-SEA-4", "JKT-COV-1"]) expect(failed, `${r.occasion}/${r.season} ${day.date}: ${rule}`).not.toContain(rule);
        for (const rule of ["XC-PROP-2", "COL-12"]) if (failed.includes(rule)) expect(day.relaxed, `${r.occasion}/${r.season} ${day.date}: ${rule} unwaived`).toContain(rule);
      }
    }
  });

  it("a jacket is on every drawn look where the day asks for one", () => {
    for (const r of RUNS) {
      if (!jacketRequired(r.occasion, r.season)) continue;
      for (const day of r.days) {
        const outer = slotPieces(day.ids.map((id) => BY_ID.get(id)!)).outer;
        expect(outer, `${r.occasion}/${r.season} ${day.date}: no jacket on ${names(day.ids)}`).toBeTruthy();
      }
    }
  });

  it("the pass-list names the Joe-kept soft hits, and only soft hits", () => {
    expect([...PREFERENCE_IDS]).toEqual(["JKT-COV-1", "JKT-LAY-3"]);
  });
});

describe("6. no rating surface", () => {
  const UI = ["components", "routes"].flatMap((dir) => sources(join(SRC, "..", dir)));

  it("no technique line, no match copy, no stars, thumbs, rate or score in the components and routes", () => {
    const hits: string[] = [];
    for (const file of UI) {
      const text = readFileSync(file, "utf8");
      for (const re of [/techniqueLine/, /This matches\./, /This doesn't match\./, /\bstars?\b/i, /\bthumbs?[- ]?(up|down)\b/i, /\brat(e|ing)\b/i, /\bscore\b/i]) {
        const m = re.exec(text);
        if (m) hits.push(`${file.slice(file.indexOf("src/"))}: ${m[0]}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("no code path changes taste.techniques[].weight, and normalizeTaste round-trips what is stored", () => {
    const taste = readFileSync(join(SRC, "taste.ts"), "utf8");
    for (const gone of ["logWear", "learnFromLock", "learnFromSave", "creditTechniques", "decayTaste", "techniqueLine", "techniqueWeight"]) {
      expect(taste.includes(gone), `taste.ts still has ${gone}`).toBe(false);
    }
    const stored = { ...emptyTaste(), techniques: emptyTaste().techniques.map((t, i) => ({ ...t, weight: i % 3 })) };
    const back = normalizeTaste(JSON.parse(JSON.stringify(stored)));
    expect(back.techniques.map((t) => [t.id, t.weight])).toEqual(stored.techniques.map((t) => [t.id, t.weight]));
    const writes = sources(SRC).filter((file) => /techniques[^\n]*weight\s*[+\-*]?=(?!=)/.test(readFileSync(file, "utf8")));
    expect(writes).toEqual([]);
  });
});

describe("7. the Lookbook header and the week row", () => {
  it("the header is never a number before both rows are ready", () => {
    expect(lookbookCountLine({ resolved: false, count: 12, chapter: "weekday", season: "fall" })).toBe(FINDING_LOOKS);
    expect(/\d/.test(lookbookCountLine({ resolved: false, count: 12, chapter: "weekday", season: "fall" }))).toBe(false);
    expect(pageResolved({ week: true, ways: false })).toBe(false);
    expect(pageResolved({ week: false, ways: true })).toBe(false);
    expect(pageResolved({ week: true, ways: true })).toBe(true);
    const page = readFileSync(join(SRC, "..", "routes", "lookbook.tsx"), "utf8");
    expect(page).toMatch(/const countResolved = pageResolved\(\{ week: weekResolved, ways: waysReady \}\);/);
    /* The count line, the skeletons and the empty reason all read it. */
    expect(page.match(/resolved: countResolved/g)?.length).toBe(3);
    expect(page).not.toMatch(/resolved: weekResolved/);
  });

  it("a weekday/fall page: the week row is 8 full cards, a piece leads one card, the count is the cards", () => {
    const occasion: Occasion = "weekday";
    const season: Season = "fall";
    const week = weekRotationRow(CLOSET, { occasion, season, rotation: emptyRotation(), cap: 8, today: START });
    expect(week.looks.length).toBe(8);
    for (const look of week.looks) expect(look.length).toBeGreaterThanOrEqual(3);
    const ways = rowWays(visibleDetectors(CLOSET, { occasion, season }), CLOSET, {
      occasion,
      season,
      onScreen: week.looks.flatMap((l) => l.map((g) => g.id)),
      leadIds: week.leads,
      today: START,
      rotation: emptyRotation(),
    });
    const twins = twinGroups(CLOSET);
    const leads = [...week.looks.map((l) => twins.key(weekLeadPiece(l)!)), ...ways.flatMap((w) => (w.looks[occasion] ?? []).map((l) => twins.key(leadPiece(l)!)))];
    expect(new Set(leads).size, "a piece leads one card").toBe(leads.length);
    const section = renderedSectionLooks(ways, occasion);
    expect(screenLookCount(week.looks, section)).toBe(week.looks.length + section.length);
    expect(lookbookCountLine({ resolved: true, count: screenLookCount(week.looks, section), chapter: "weekday", season: "fall" })).toMatch(/\d/);
  });
});

describe("8. Today's Suggest and the stylist's first open", () => {
  it("Suggest shows one to three alternates that pass the rules and repeat neither today's core nor its lead, or a reason line", () => {
    const state = { garments: CLOSET, journal: [], drop: null };
    const today = todayDraw("weekday", "fall", START, []).ids;
    const got = todaySuggestions(state, { todayIds: today, occasion: "weekday", season: "fall", today: START });
    if (got.alternates.length === 0) {
      expect(got.reason).toContain(NO_ALTERNATES);
      return;
    }
    expect(got.reason).toBeNull();
    expect(got.alternates.length).toBeGreaterThanOrEqual(1);
    expect(got.alternates.length).toBeLessThanOrEqual(3);
    const lead = weekLeadPiece(today.map((id) => BY_ID.get(id)!))?.id;
    const keys = new Set<string>();
    for (const alt of got.alternates) {
      const verdict = passesRules(alt.pieces, { house: null, occasion: "weekday", season: "fall", pool: CLOSET });
      if (!verdict.pass) for (const id of verdict.failed) expect(alt.relaxed, `${names(alt.ids)}: ${id}`).toContain(id);
      const key = [...alt.ids].sort().join("|");
      expect(keys.has(key), "an alternate twice").toBe(false);
      keys.add(key);
      expect(key).not.toBe([...today].sort().join("|"));
      expect(weekLeadPiece(alt.pieces)?.id).not.toBe(lead);
    }
    /* The same day asks again and gets the same alternates. */
    expect(todaySuggestions(state, { todayIds: today, occasion: "weekday", season: "fall", today: START }).alternates.map((a) => a.ids)).toEqual(got.alternates.map((a) => a.ids));
    const page = readFileSync(join(SRC, "..", "routes", "index.tsx"), "utf8");
    expect(page).toMatch(/data-today-suggest\b/);
    expect(page).toMatch(/data-today-alternate=/);
    expect(page).toMatch(/data-today-suggest-reason/);
    const block = page.slice(page.indexOf("data-today-suggest "), page.indexOf("data-today-suggest-reason") + 4000);
    expect(block).toMatch(/setDrop\(\{/);
    expect(block).toMatch(/saveLook\(/);
  });

  it("the stylist's first open shows three starter chips, and the dock marks a closet answer", () => {
    expect(STARTER_CHIPS).toEqual(["What should I wear today?", "Something different today", "Dress my least-worn piece"]);
    const dock = readFileSync(join(SRC, "..", "components", "shell", "stylist-dock.tsx"), "utf8");
    expect(dock).toMatch(/data-stylist-chips/);
    expect(dock).toMatch(/STARTER_CHIPS\.map\(/);
    expect(dock).toMatch(/data-stylist-chip\b/);
    expect(dock).toMatch(/data-stylist-thinking/);
    expect(dock).toMatch(/payload\.source === "closet" \? markClosetReply\(spoken\) : spoken/);
  });
});

describe("9. the owner's style rules and the addendum, on real ids", () => {
  const find = (re: RegExp, slot: ReturnType<typeof slotOf>) => CLOSET.filter((g) => re.test(`${g.name} ${g.subtype} ${g.material}`.toLowerCase()) && slotOf(g) === slot);
  const strict = (look: Garment[], occasion: Occasion, season: Season = "fall") => passesRules(look, { house: null, occasion, season, pool: CLOSET });
  /** The first strictly passing look among the combinations, or null. */
  const firstPassing = (tops: Garment[], bottoms: Garment[], shoes: Garment[], jackets: Garment[] | null, occasion: Occasion, season: Season = "fall"): Garment[] | null => {
    for (const top of tops) for (const bottom of bottoms) for (const shoe of shoes) {
      const core = [top, bottom, shoe];
      if (!jackets && strict(core, occasion, season).pass) return core;
      for (const jacket of jackets ?? []) {
        const look = [...core, jacket];
        if (strict(look, occasion, season).pass) return look;
      }
    }
    return null;
  };
  const jackets = CLOSET.filter((g) => slotOf(g) === "outerwear");

  it("rule 1: a rugby or hoodie with jeans wears loafers on a weekend; no rule bans the loafers", () => {
    const tops = find(/rugby|hoodie|sweatshirt/, "top");
    const jeans = find(/\bjeans?\b|denim/, "bottom");
    const loafers = find(/loafer/, "footwear");
    expect(tops.length).toBeGreaterThan(0);
    const look = firstPassing(tops, jeans, loafers, null, "weekend");
    expect(look, "no rugby-or-hoodie, jeans and loafers look passes on a weekend").not.toBeNull();
    console.log(`rule 1: ${names(look!.map((g) => g.id))}`);
    for (const g of loafers) expect(pieceRuleFails(g, { house: null, occasion: "weekend", season: "fall", pool: CLOSET })).toEqual([]);
  });

  it("rule 2: a country knit with cords and boots is a weekday look", () => {
    const knits = find(/fair isle|gingham|cable|country|knit|sweater/, "top");
    const cords = find(/cord/, "bottom");
    const boots = find(/boot|chelsea|chukka/, "footwear");
    const look = firstPassing(knits, cords, boots, jackets, "weekday");
    expect(look, "no country knit, cords and boots look passes on a weekday").not.toBeNull();
    console.log(`rule 2: ${names(look!.map((g) => g.id))}`);
  });

  it("rule 3: jeans are first-class: they pair on Weekday, Weekend and Out in fall, and the runs drew them", () => {
    const jeans = find(/\bjeans?\b/, "bottom");
    expect(jeans.length).toBeGreaterThan(0);
    for (const occasion of ["weekday", "weekend", "out"] as const) {
      const r = run(occasion, "fall");
      const pairing = jeans.filter((g) => r.pairable.has(g.id));
      expect(pairing.length, `${occasion}: no jeans pair`).toBeGreaterThan(0);
      const drawn = r.days.filter((d) => d.ids.some((id) => jeans.some((j) => j.id === id))).length;
      expect(drawn, `${occasion}: jeans never drawn in ${DAYS} days`).toBeGreaterThan(0);
      console.log(`rule 3: ${occasion}/fall jeans pairing ${pairing.length}/${jeans.length}, drawn on ${drawn} of ${DAYS} days`);
    }
  });

  it("rule 4: linen and flannel never share a look: a hard clash, and no drawn look holds both", () => {
    const linen = CLOSET.filter(isLinenPiece);
    const flannel = CLOSET.filter(isFlannelPiece);
    expect(linen.length).toBeGreaterThan(0);
    expect(flannel.length).toBeGreaterThan(0);
    const l = linen[0]!;
    const f = flannel[0]!;
    const shoe = CLOSET.find((g) => slotOf(g) === "footwear")!;
    const look = slotOf(l) === slotOf(f) ? [l, f, CLOSET.find((g) => slotOf(g) === "bottom" && g.id !== l.id && g.id !== f.id)!, shoe] : [l, f, shoe];
    expect(clashes(look)).toBe(true);
    for (const occasion of ["weekday", "weekend", "out"] as const) {
      expect(strict(look, occasion).failed).toContain("CLASH");
      expect(strict(look, occasion).failed).toContain("XC-SEA-5");
    }
    for (const r of RUNS) for (const day of r.days) {
      const pieces = day.ids.map((id) => BY_ID.get(id)!);
      expect(pieces.some(isLinenPiece) && pieces.some(isFlannelPiece), `${r.occasion}/${r.season} ${day.date}: linen with flannel`).toBe(false);
    }
  });

  it("rule 5: JKT-LAY-2 passes a woven shirt or a fine knit under a sport coat and fails only a chunky or cable knit", () => {
    const sportCoat = CLOSET.find((g) => g.id === "g_5josnvyoi4z9")!;
    expect(jacketInfo(sportCoat).class).toMatch(/sport_coat/);
    const woven = find(/oxford|button-down|button-up|poplin|dress shirt/, "top").find((g) => !/flannel|cable|chunky/.test(g.name))!;
    const fine =
      find(/merino|fine[- ]knit|cashmere|knit polo/, "top")[0] ??
      find(/sweater|knit/, "top").find((g) => !/cable|chunky|aran|fisherman|ribbed|zip/.test(`${g.name} ${g.subtype}`) && (g.warmth ?? 0) <= 2)!;
    const cable = find(/cable|chunky|aran|fisherman/, "top")[0]!;
    expect(woven && fine && cable).toBeTruthy();
    const bottom = CLOSET.find((g) => slotOf(g) === "bottom")!;
    const shoe = CLOSET.find((g) => slotOf(g) === "footwear")!;
    const lay2 = (top: Garment) => jacketHits(slotPieces([top, bottom, shoe, sportCoat]), { occasion: "weekday", season: "fall" }).filter((h) => h.id === "JKT-LAY-2");
    expect(lay2(woven), `${woven.name} under the sport coat`).toEqual([]);
    expect(lay2(fine), `${fine.name} under the sport coat`).toEqual([]);
    expect(lay2(cable).some((h) => h.severity === "hard"), `${cable.name} under the sport coat`).toBe(true);
    console.log(`rule 5: woven ${woven.name}; fine ${fine.name}; cable ${cable.name}`);
  });

  describe("addendum A: the brown suede mules on Out and Weekend in fall", () => {
    const mules = BY_ID.get(MULES)!;

    it("(i) a rule-passing Out/fall look and a Weekend/fall look hold the mules", () => {
      expect(mules.name).toMatch(/mules/);
      const tops = CLOSET.filter((g) => slotOf(g) === "top");
      const bottoms = CLOSET.filter((g) => slotOf(g) === "bottom");
      for (const occasion of ["out", "weekend"] as const) {
        const look = firstPassing(tops, bottoms, [mules], occasion === "out" ? jackets : null, occasion) ?? firstPassing(tops, bottoms, [mules], jackets, occasion);
        expect(look, `${occasion}/fall: no rule-passing look holds the mules`).not.toBeNull();
        console.log(`addendum A ${occasion}: ${names(look!.map((g) => g.id))}`);
      }
    });

    it("(ii) the 60-day Out/fall and Weekend/fall runs draw the mules at least once", () => {
      for (const occasion of ["out", "weekend"] as const) {
        const r = run(occasion, "fall");
        expect(r.pairable.has(MULES), `${occasion}/fall: the mules are listed as blocked (${(r.blocked.get(MULES) ?? []).join(",")})`).toBe(true);
        const days = r.days.filter((d) => d.ids.includes(MULES)).map((d) => d.date);
        expect(days.length, `${occasion}/fall: the mules never drawn in ${DAYS} days`).toBeGreaterThan(0);
        expect(days[0]! <= dateAfter(COVER_BY - 1), `${occasion}/fall: first drawn ${days[0]}`).toBe(true);
      }
    });

    it("(iii) guard: XC-SEA-3 is not among the mule look's fails on Out or Weekend in fall, and it is in winter", () => {
      for (const occasion of ["out", "weekend"] as const) {
        expect(pieceRuleFails(mules, { house: null, occasion, season: "fall", pool: CLOSET })).not.toContain("XC-SEA-3");
        const tops = CLOSET.filter((g) => slotOf(g) === "top");
        const bottoms = CLOSET.filter((g) => slotOf(g) === "bottom");
        const look = firstPassing(tops, bottoms, [mules], jackets, occasion)!;
        expect(look).not.toBeNull();
        expect(strict(look, occasion).failed).not.toContain("XC-SEA-3");
        expect(strict(look, occasion, "winter").failed).toContain("XC-SEA-3");
      }
    });
  });

  describe("addendum B: the brown button-up counts as a jacket", () => {
    const shirt = BY_ID.get(BROWN_BUTTON_UP)!;

    it("jacketInfo says countsAsJacket and outerEligible, like the overshirt", () => {
      expect(shirt.name).toMatch(/button-up/);
      expect(OUTER_ELIGIBLE).toContain(BROWN_BUTTON_UP);
      expect(OUTER_ELIGIBLE).toContain("g_v7uvadckh79p");
      for (const id of OUTER_ELIGIBLE) {
        const info = jacketInfo(BY_ID.get(id)!);
        expect(info.countsAsJacket, id).toBe(true);
        expect(info.outerEligible, id).toBe(true);
      }
    });

    it("a real look of another top with the shirt seats it as the outer and passes the jacket day", () => {
      const tops = CLOSET.filter((g) => slotOf(g) === "top" && g.id !== BROWN_BUTTON_UP);
      const bottoms = CLOSET.filter((g) => slotOf(g) === "bottom");
      const shoes = CLOSET.filter((g) => slotOf(g) === "footwear");
      let found: Garment[] | null = null;
      search: for (const top of tops) for (const bottom of bottoms) for (const shoe of shoes) {
        const look = [top, bottom, shoe, shirt];
        if (slotPieces(look).outer?.id !== BROWN_BUTTON_UP) continue;
        if (strict(look, "weekday").pass) {
          found = look;
          break search;
        }
      }
      expect(found, "no weekday/fall look seats the brown button-up as its jacket").not.toBeNull();
      expect(jacketRequired("weekday", "fall")).toBe(true);
      expect(slotPieces(found!).outer?.id).toBe(BROWN_BUTTON_UP);
      console.log(`addendum B: ${names(found!.map((g) => g.id))}`);
    });
  });
});

describe("10. jeans with a blazer pass at half odds (Joe 2026-10-18/19)", () => {
  const NAVY_BLAZER = "g_5josnvyoi4z9";
  const sportCoats = CLOSET.filter((g) => slotOf(g) === "outerwear" && /sport_coat/.test(jacketInfo(g).class ?? "")).sort((a, b) => (a.id === NAVY_BLAZER ? -1 : b.id === NAVY_BLAZER ? 1 : a.id.localeCompare(b.id)));
  const jeans = CLOSET.filter((g) => slotOf(g) === "bottom" && ecruOrMidJeans(g));
  const hardJeans = CLOSET.filter((g) => slotOf(g) === "bottom" && /\bjeans?\b/.test(g.name) && !ecruOrMidJeans(g));
  const trousers = CLOSET.filter((g) => slotOf(g) === "bottom" && /trouser|chino/.test(g.name) && !/\bjeans?\b|denim/.test(`${g.name} ${g.subtype}`));
  const ctx = { house: null, occasion: "weekday" as Occasion, season: "fall" as Season, pool: CLOSET };
  const lay3 = (look: Garment[]) => jacketHits(slotPieces(look), { occasion: "weekday", season: "fall" }).filter((h) => h.id === "JKT-LAY-3");

  /** The first sport coat (the navy blazer first), top and shoe that pass on a weekday over both a pair of the jeans and a pair of trousers. */
  function pair(): { coat: Garment; top: Garment; shoe: Garment; jean: Garment; trouser: Garment } | null {
    const tops = CLOSET.filter((g) => slotOf(g) === "top");
    const shoes = CLOSET.filter((g) => slotOf(g) === "footwear");
    for (const coat of sportCoats) for (const jean of jeans) for (const trouser of trousers) for (const top of tops) for (const shoe of shoes) {
      if (passesRules([top, jean, shoe, coat], ctx).pass && passesRules([top, trouser, shoe, coat], ctx).pass) return { coat, top, shoe, jean, trouser };
    }
    return null;
  }
  const found = pair();
  const sportCoat = found?.coat ?? sportCoats[0]!;
  const SPORT_COAT = sportCoat.id;

  it("the navy blazer over ecru or mid jeans passes on a weekend; on a weekday the formality spread (JKT-FORM-1) fails it, and a soft sport coat passes instead", () => {
    const navy = BY_ID.get(NAVY_BLAZER)!;
    const tops = CLOSET.filter((g) => slotOf(g) === "top");
    const shoes = CLOSET.filter((g) => slotOf(g) === "footwear");
    const weekend = { ...ctx, occasion: "weekend" as Occasion };
    let passing: Garment[] | null = null;
    const weekdayFails = new Map<string, number>();
    let weekdayLooks = 0;
    for (const jean of jeans) for (const top of tops) for (const shoe of shoes) {
      const look = [top, jean, shoe, navy];
      if (!passing && passesRules(look, weekend).pass) passing = look;
      const v = passesRules(look, ctx);
      weekdayLooks += 1;
      if (v.pass) weekdayFails.set("pass", (weekdayFails.get("pass") ?? 0) + 1);
      for (const id of v.failed) weekdayFails.set(id, (weekdayFails.get(id) ?? 0) + 1);
    }
    expect(passing, "no weekend look passes with the navy blazer over the jeans").not.toBeNull();
    console.log(`navy blazer + jeans, weekend: ${names(passing!.map((g) => g.id))}; weekday looks ${weekdayLooks}, JKT-FORM-1 fails ${weekdayFails.get("JKT-FORM-1") ?? 0}, pass ${weekdayFails.get("pass") ?? 0}`);
    /* Every weekday look of the navy blazer over jeans trips the formality spread: a soft hit at a7016b8, a fail now (not a Joe-kept pass). */
    expect(weekdayFails.get("JKT-FORM-1")).toBe(weekdayLooks);
    expect(sportCoat.id, "the sport coat that passes on a weekday over jeans").not.toBe(NAVY_BLAZER);
    console.log(`weekday jeans + sport coat uses ${sportCoat.name} (${jacketInfo(sportCoat).class})`);
  });

  it("ecru or mid-wash clean jeans under the sport coat pass the rules, as JKT-LAY-3's soft case", () => {
    expect(jeans.length, "the snapshot has ecru or mid-wash jeans").toBeGreaterThan(0);
    expect(jacketInfo(sportCoat).class).toMatch(/sport_coat/);
    expect(found, "no top and shoe pass with the sport coat over both jeans and trousers").not.toBeNull();
    const look = [found!.top, found!.jean, found!.shoe, sportCoat];
    expect(jeansWithBlazer(look)).toBe(true);
    const hits = lay3(look);
    expect(hits.length, "the soft JKT-LAY-3 hit fires").toBeGreaterThan(0);
    expect(hits.every((h) => h.severity === "soft")).toBe(true);
    expect(passesRules(look, ctx).pass).toBe(true);
    expect(ruleHits(look, ctx).soft).not.toContain("JKT-LAY-3");
    console.log(`jeans + blazer passes: ${names(look.map((g) => g.id))}`);
  });

  it("light-wash, white, striped and distressed jeans under the sport coat stay blocked", () => {
    expect(hardJeans.length, "the snapshot has light-wash, white, striped or distressed jeans").toBeGreaterThan(0);
    for (const jean of hardJeans) {
      const look = [found!.top, jean, found!.shoe, sportCoat];
      expect(jeansWithBlazer(look), jean.name).toBe(false);
      expect(lay3(look).some((h) => h.severity === "hard"), `${jean.name}: hard JKT-LAY-3`).toBe(true);
      expect(passesRules(look, ctx).failed, jean.name).toContain("JKT-LAY-3");
    }
    console.log(`blocked under the sport coat: ${hardJeans.map((g) => g.name).join("; ")}`);
  });

  it("the jeans look weighs exactly JEANS_BLAZER_ODDS times the trousers look, and over 2,000 seeds is drawn at 0.4–0.6 of its rate, never zero", () => {
    expect(JEANS_BLAZER_ODDS).toBe(0.5);
    const today = START;
    /* The same rotation on both bottoms: never worn, added the same day. */
    const jean = { ...found!.jean, wornOn: [], createdAt: found!.trouser.createdAt };
    const trouser = { ...found!.trouser, wornOn: [] };
    const withJeans = [found!.top, jean, found!.shoe, sportCoat];
    const withTrousers = [found!.top, trouser, found!.shoe, sportCoat];
    expect(lookWeight(withJeans, { today })).toBeCloseTo(JEANS_BLAZER_ODDS * lookWeight(withTrousers, { today }), 12);
    let jeansDrawn = 0;
    let trousersDrawn = 0;
    for (let s = 0; s < 2000; s += 1) {
      const rng = rngFromSalt(drawSeed(today, "odds:jeans-blazer", LIVE_IDS, s));
      const drawn = drawLook([withJeans, withTrousers], (look) => lookWeight(look, { today }), rng)!;
      if (drawn === withJeans) jeansDrawn += 1;
      else trousersDrawn += 1;
    }
    console.log(`jeans + blazer over 2000 seeds: jeans ${jeansDrawn}, trousers ${trousersDrawn}, ratio ${(jeansDrawn / trousersDrawn).toFixed(3)}`);
    expect(jeansDrawn).toBeGreaterThan(0);
    expect(jeansDrawn / trousersDrawn).toBeGreaterThanOrEqual(0.4);
    expect(jeansDrawn / trousersDrawn).toBeLessThanOrEqual(0.6);
  });

  it("through Today's pick on a closet of the two looks, the jeans look is drawn at about half the trousers look's rate and still appears", () => {
    /* The same rotation on every piece (never worn, added the same day), so only the coin tells the two bottoms apart. */
    const rack = [found!.top, found!.shoe, sportCoat, found!.jean, found!.trouser].map((g) => ({ ...g, wornOn: [], createdAt: found!.top.createdAt }));
    let jeansDrawn = 0;
    let trousersDrawn = 0;
    for (let s = 0; s < 400; s += 1) {
      const picked = pickDropWith(rack, dailyPickWeather("fall"), "weekday", { salt: drawSeed(START, "odds:jeans-pick", LIVE_IDS, s), season: "fall", today: START });
      expect(picked.ids).toContain(SPORT_COAT);
      if (picked.ids.includes(found!.jean.id)) jeansDrawn += 1;
      else if (picked.ids.includes(found!.trouser.id)) trousersDrawn += 1;
    }
    console.log(`Today's pick over 400 seeds: jeans ${jeansDrawn}, trousers ${trousersDrawn}`);
    expect(jeansDrawn).toBeGreaterThan(0);
    /* Not exactly half here: when the jeans are the hero, their held look is worn (never blocked); when another piece is, the coin halves them. */
    expect(jeansDrawn / trousersDrawn).toBeGreaterThanOrEqual(0.3);
    expect(jeansDrawn / trousersDrawn).toBeLessThanOrEqual(0.8);
  });
});

describe("11. Outfit with this and \"N looks with this\"", () => {
  const dressable = CLOSET.filter((g) => !g.archived && (slotOf(g) === "top" || slotOf(g) === "dress" || slotOf(g) === "bottom" || slotOf(g) === "footwear" || slotOf(g) === "outerwear"));
  type HeroRun = { piece: Garment; looks: ReturnType<typeof looksForHero>; ms: number; outfit: ReturnType<typeof dressAcrossOccasions> };
  let runs: HeroRun[] = [];

  beforeAll(() => {
    runs = dressable.map((piece) => {
      const t0 = performance.now();
      const looks = looksForHero(piece, CLOSET);
      const ms = performance.now() - t0;
      const outfit = dressAcrossOccasions({ lockedIds: [piece.id], garments: CLOSET, occasion: "out", today: START });
      return { piece, looks, ms, outfit };
    });
  }, 1_200_000);

  it("outfitWith's dresser returns a look for every piece that leads a look in any hero occasion; the rest are listed by rule id", () => {
    const still: string[] = [];
    for (const r of runs) {
      if (r.outfit) {
        expect(r.outfit.garmentIds, r.piece.name).toContain(r.piece.id);
        const season = seasonFromWeather(68);
        const verdict = passesRules(r.outfit.pieces, { house: null, occasion: r.outfit.occasion, season, pool: CLOSET });
        /* The look passes, or every rule it trips is one the ladder waived and the dresser reports. */
        for (const id of verdict.failed) expect(r.outfit.relaxed, `${r.piece.name}: ${names(r.outfit.garmentIds)} fails ${id} unwaived on ${r.outfit.occasion}/${season}`).toContain(id);
        continue;
      }
      expect(r.looks.length, `${r.piece.name}: leads ${r.looks.length} looks yet gets no outfit`).toBe(0);
      const occasions = heroOccasionsFor(r.piece, CLOSET);
      const why = occasions.length
        ? `no partner look passes on ${occasions.join("/")}`
        : (["weekday", "out", "weekend", "travel", "comfy"] as Occasion[]).map((o) => `${o}: ${pieceRuleFails(r.piece, { house: null, occasion: o, season: seasonFromWeather(68), pool: CLOSET }).join(",")}`).join("; ");
      still.push(`${r.piece.name} (${r.piece.id}): ${why}`);
    }
    console.log(`outfit with this: ${runs.length - still.length} of ${runs.length} pieces dressed; still null:\n  ${still.join("\n  ") || "none"}`);
    expect(NO_OUTFIT_NOTE).toBe("No look in your closet works with this piece yet.");
  });

  it("the heading count is the cards: every look has three or more pieces and the hero, at most HERO_LOOKS, and the label says 5 only for 5", () => {
    expect(HERO_LOOKS).toBe(5);
    for (const r of runs) {
      expect(r.looks.length).toBeLessThanOrEqual(HERO_LOOKS);
      const cards = r.looks.filter((look) => look.garmentIds.filter((id) => BY_ID.has(id)).length >= 3);
      expect(cards.length, `${r.piece.name}: a look under three pieces`).toBe(r.looks.length);
      for (const look of r.looks) expect(look.garmentIds, r.piece.name).toContain(r.piece.id);
      const label = looksWithLabel(cards.length, "this");
      expect(label.startsWith("5 ")).toBe(cards.length === 5);
      expect(label).toBe(cards.length === 1 ? "1 look with this" : `${cards.length} looks with this`);
    }
    for (const rel of ["components/closet/detail.tsx", "routes/closet.tsx", "routes/lookbook.tsx"]) {
      const text = readFileSync(join(SRC, "..", rel), "utf8");
      expect(text, rel).not.toMatch(/5 looks with/);
      expect(text, rel).toMatch(/looksWithLabel\(/);
    }
    const detail = readFileSync(join(SRC, "..", "components/closet/detail.tsx"), "utf8");
    expect(detail).toMatch(/\(looksCount \?\? 0\) > 0 &&/);
    expect(detail).toMatch(/NO_OUTFIT_NOTE/);
  });

  it("reports looksForHero's time per piece and the looks per piece", () => {
    const times = runs.map((r) => r.ms).sort((a, b) => a - b);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const counts = new Map<number, number>();
    for (const r of runs) counts.set(r.looks.length, (counts.get(r.looks.length) ?? 0) + 1);
    console.log(
      `looksForHero over ${runs.length} pieces: mean ${mean.toFixed(0)} ms, median ${times[Math.floor(times.length / 2)]!.toFixed(0)} ms, max ${times.at(-1)!.toFixed(0)} ms; looks per piece: ${[...counts.entries()].sort((a, b) => a[0] - b[0]).map(([n, c]) => `${n} looks × ${c} pieces`).join(", ")}`,
    );
    expect(runs.length).toBeGreaterThan(0);
  });
});

describe("12. a seven-day Today sample for the record", () => {
  it("prints Weekday/fall, date to piece labels", () => {
    const r = run("weekday", "fall");
    const lines = r.days.slice(0, 7).map((d) => `${d.date}  ${d.ids.map((id) => pieceLabel(BY_ID.get(id)!, CLOSET)).join(" · ")}${d.relaxed.length ? `  (waived ${d.relaxed.join(",")})` : ""}`);
    console.log(`Today, weekday/fall, seven days:\n  ${lines.join("\n  ")}`);
    expect(lines.length).toBe(7);
  });
});

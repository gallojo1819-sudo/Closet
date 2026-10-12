/**
 * Lookbook variety: the idea rows use the whole closet. Every row is a theme with a different
 * hero per card, no piece repeats within a row, no piece sits on more than two cards of a
 * screen, titles say what differs, and a "Forgotten pieces" row shows what has not been worn
 * or suggested in a while. The fixture is the 142-piece stripped closet the engine snapshot
 * uses, with the clock frozen at the snapshot's instant.
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  capScreenLooks,
  FORGOTTEN_DAYS,
  FORGOTTEN_ID,
  FORGOTTEN_TITLE,
  forgottenIds,
  freshness,
  lastSuggested,
  pieceCounts,
  ROW_MAX,
  ROW_MIN,
  rowRepeats,
  rowWays,
  SCREEN_CAP,
  storedRows,
  themePieces,
  visibleDetectors,
  type Way,
} from "./detectors.ts";
import { ideaTitle, pieceLine } from "./look-collage.ts";
import { buildReshuffleRow, lookbookPool } from "./lookbook.ts";
import { lookFitsSeason } from "./season.ts";
import { slotOf } from "./style.ts";
import { isLegal } from "./stylist/legal.ts";
import { OCCASIONS, type Garment, type Occasion, type Season } from "./types.ts";

const FIXTURE = JSON.parse(
  readFileSync(new URL("./__fixtures__/engine-garments.json", import.meta.url), "utf8"),
) as Garment[];
const BY_ID = new Map(FIXTURE.map((g) => [g.id, g]));
const NOW = Date.parse("2026-10-09T15:00:00.000Z");
const TODAY = "2026-10-09";
const SEASON: Season = "fall";
const ALL: Occasion[] = OCCASIONS.map((o) => o.id);
const BANNED = /\b(Polo|Purple|RRL|ALD|Faloni|545|Sweet Stable|Italian summer|Italian winter)\b/;

const key = (look: Garment[]) => look.map((g) => g.id).sort().join("|");

function g(partial: Pick<Garment, "id" | "name" | "category" | "subtype"> & Partial<Garment>): Garment {
  return {
    colors: ["navy"],
    material: "cotton",
    brand: "",
    notes: "",
    formality: 3,
    warmth: 2,
    seasons: ["fall"],
    imageSrc: "/x.jpg",
    cutoutSrc: "/x.jpg",
    imageSource: "official",
    matteQuality: "clean",
    demo: false,
    archived: false,
    wornOn: [],
    createdAt: "2026-01-01T12:00:00.000Z",
    ...partial,
  };
}

type Screen = {
  occasion: Occasion;
  week: Garment[][];
  rows: Way[];
  before: Way[];
};

/** One Lookbook screen per occasion: the week row (capped as the page shows it) and the rows. */
function buildScreens(): Screen[] {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  try {
    return ALL.map((occasion) => {
      const engine = buildReshuffleRow(FIXTURE, occasion, { season: SEASON, salt: 1, cap: 8 });
      const shown = capScreenLooks(engine.filter((look) => !look.gate && !look.needsPieces));
      const week = shown.map((look) => look.garmentIds.map((id) => BY_ID.get(id)).filter((x): x is Garment => Boolean(x)));
      const found = visibleDetectors(FIXTURE, { occasion, season: SEASON });
      const before = storedRows(found, FIXTURE, { occasion, season: SEASON });
      const rows = rowWays(found, FIXTURE, {
        occasion,
        season: SEASON,
        onScreen: shown.flatMap((look) => look.garmentIds),
        today: TODAY,
      });
      return { occasion, week, rows, before };
    });
  } finally {
    mock.timers.reset();
  }
}

const SCREENS = buildScreens();
const rowLooks = (way: Way, occasion: Occasion) => way.looks[occasion] ?? [];

describe("idea rows: a theme, a hero per card, nothing repeated in a row", () => {
  it("rowRepeats names a piece that sits on two cards; jackets are checked apart", () => {
    const knit = g({ id: "k", name: "Cream knit", category: "top", subtype: "sweater" });
    const cords = g({ id: "c", name: "Brown cords", category: "bottom", subtype: "cords" });
    const jeans = g({ id: "j", name: "Blue jeans", category: "bottom", subtype: "jeans" });
    const boots = g({ id: "b", name: "Brown boots", category: "footwear", subtype: "boots" });
    const loafers = g({ id: "l", name: "Brown loafers", category: "footwear", subtype: "loafers" });
    const field = g({ id: "f", name: "Olive field jacket", category: "outerwear", subtype: "field jacket" });
    const bad = [
      [knit, cords, boots, field],
      [knit, jeans, loafers, field],
    ];
    assert.deepEqual(rowRepeats(bad).map((p) => p.id), ["k"]);
    assert.deepEqual(rowRepeats(bad, true).map((p) => p.id), ["f"]);
    const good = [
      [knit, cords, boots, field],
      [g({ id: "k2", name: "Grey knit", category: "top", subtype: "sweater" }), jeans, loafers],
    ];
    assert.deepEqual(rowRepeats(good), []);
    assert.deepEqual(rowRepeats(good, true), []);
  });

  it("no row repeats a top, bottom, shoe or jacket; every card has a different hero", () => {
    for (const { occasion, rows } of SCREENS) {
      for (const way of rows) {
        const looks = rowLooks(way, occasion);
        const repeats = rowRepeats(looks);
        assert.deepEqual(
          repeats.map((p) => p.name),
          [],
          `${occasion} / ${way.title} repeats ${repeats.map((p) => p.name).join(", ")}`,
        );
        assert.deepEqual(rowRepeats(looks, true).map((p) => p.name), [], `${occasion} / ${way.title} repeats a jacket`);
        assert.equal(new Set(looks.map(key)).size, looks.length);
        assert.ok(looks.length <= ROW_MAX, `${way.title}: ${looks.length}`);
      }
    }
  });

  it("every card of a themed row carries a theme piece, and the forgotten row only forgotten heroes", () => {
    const forgotten = forgottenIds(FIXTURE, { today: TODAY });
    for (const { occasion, rows } of SCREENS) {
      for (const way of rows) {
        for (const look of rowLooks(way, occasion)) {
          if (way.id === FORGOTTEN_ID) {
            assert.ok(look.some((p) => forgotten.has(p.id)), `${occasion} forgotten: ${pieceLine(look)}`);
            continue;
          }
          const theme = themePieces(way.id, look);
          assert.ok(theme.length >= 1, `${occasion} / ${way.title} has no theme piece: ${pieceLine(look)}`);
        }
      }
    }
  });

  it("a row shrinks to three rather than break its theme; only when no theme reaches three does a short row show", () => {
    for (const { occasion, rows } of SCREENS) {
      const long = rows.filter((way) => rowLooks(way, occasion).length >= ROW_MIN);
      const short = rows.filter((way) => rowLooks(way, occasion).length < ROW_MIN);
      if (long.length) assert.deepEqual(short, [], `${occasion}: short rows beside full ones`);
    }
    assert.ok(
      SCREENS.some(({ occasion, rows }) => rows.some((way) => rowLooks(way, occasion).length >= ROW_MIN)),
      "some screen has a full themed row",
    );
  });

  it("every card is legal for its occasion and season, and the week row is intact", () => {
    for (const { occasion, rows, week } of SCREENS) {
      for (const way of rows) {
        for (const look of rowLooks(way, occasion)) {
          assert.equal(isLegal(look, { occasion, season: SEASON }), true, `${occasion} / ${way.title}: ${pieceLine(look)}`);
          assert.equal(lookFitsSeason(look, SEASON), true);
        }
      }
      assert.ok(week.length >= 3, `${occasion} week row`);
    }
  });

  it("the same inputs give the same rows; a Re-dress salt changes at least one row", () => {
    mock.timers.enable({ apis: ["Date"], now: NOW });
    try {
      let differs = false;
      for (const occasion of ["weekend", "comfy"] as Occasion[]) {
        const found = visibleDetectors(FIXTURE, { occasion, season: SEASON });
        const base = rowWays(found, FIXTURE, { occasion, season: SEASON, today: TODAY });
        const again = rowWays(found, FIXTURE, { occasion, season: SEASON, today: TODAY });
        assert.deepEqual(
          base.map((w) => rowLooks(w, occasion).map(key)),
          again.map((w) => rowLooks(w, occasion).map(key)),
        );
        const salted = rowWays(found, FIXTURE, { occasion, season: SEASON, today: TODAY, salt: 3 });
        for (const way of salted) {
          const looks = rowLooks(way, occasion);
          assert.deepEqual(rowRepeats(looks), []);
          for (const look of looks) assert.equal(isLegal(look, { occasion, season: SEASON }), true);
        }
        if (JSON.stringify(salted.map((w) => rowLooks(w, occasion).map(key))) !== JSON.stringify(base.map((w) => rowLooks(w, occasion).map(key)))) {
          differs = true;
        }
      }
      assert.ok(differs, "salt 3 changed nothing");
    } finally {
      mock.timers.reset();
    }
  });
});

describe("the screen cap and freshness", () => {
  it("no piece is on more than two cards of a screen: every row and the week row together", () => {
    for (const { occasion, rows, week } of SCREENS) {
      const screen = [...rows.flatMap((way) => rowLooks(way, occasion)), ...week];
      const counts = pieceCounts(screen);
      const over = [...counts.entries()].filter(([, n]) => n > SCREEN_CAP);
      assert.deepEqual(
        over.map(([id, n]) => `${BY_ID.get(id)?.name}=${n}`),
        [],
        `${occasion}: over the cap`,
      );
    }
  });

  it("capScreenLooks keeps order and drops the card that would put a piece on a third", () => {
    const looks = [
      { id: "a", garmentIds: ["t1", "b1", "s1"] },
      { id: "b", garmentIds: ["t2", "b1", "s2"] },
      { id: "c", garmentIds: ["t3", "b1", "s3"] },
      { id: "d", garmentIds: ["t4", "b2", "s1"] },
    ];
    assert.deepEqual(capScreenLooks(looks).map((l) => l.id), ["a", "b", "d"]);
    assert.deepEqual(capScreenLooks(looks, 3).map((l) => l.id), ["a", "b", "c", "d"]);
  });

  it("freshness lifts the idle and the unsuggested, and lowers what is already on screen", () => {
    const worn = g({ id: "w", name: "Navy knit", category: "top", subtype: "sweater", wornOn: ["2026-10-07"] });
    const idle = g({ id: "i", name: "Grey knit", category: "top", subtype: "sweater", wornOn: ["2026-05-01"] });
    const ctx = { today: TODAY };
    assert.ok(freshness(idle, ctx) > freshness(worn, ctx));
    const suggested = new Map([["i", "2026-10-08"]]);
    assert.ok(freshness(idle, { ...ctx, suggested }) < freshness(idle, ctx));
    assert.ok(freshness(idle, ctx, 1) < freshness(idle, ctx, 0));
    assert.ok(freshness(idle, ctx, 2) < freshness(idle, ctx, 1));
    const fit = 1;
    assert.ok(Math.abs(fit - freshness(idle, ctx)) <= 0.5, "freshness and fit weigh about the same");
  });

  it("lastSuggested reads the drop, the journal and the saved looks; the latest day wins", () => {
    const map = lastSuggested({
      drop: { date: "2026-10-09", garmentIds: ["a", "b"] },
      journal: [
        { date: "2026-10-01", garmentIds: ["b", "c"] },
        { date: "2026-09-01", garmentIds: ["c", "d"] },
      ],
      looks: [{ createdAt: "2026-10-05T00:00:00.000Z", garmentIds: ["d"] }],
    });
    assert.deepEqual([...map.entries()].sort(), [
      ["a", "2026-10-09"],
      ["b", "2026-10-09"],
      ["c", "2026-10-01"],
      ["d", "2026-10-05"],
    ]);
  });

  it("a suggested piece drops out of the forgotten set, and comes back after FORGOTTEN_DAYS", () => {
    const all = forgottenIds(FIXTURE, { today: TODAY });
    const first = FIXTURE.find((p) => all.has(p.id))!;
    const recent = forgottenIds(FIXTURE, { today: TODAY, suggested: new Map([[first.id, "2026-10-01"]]) });
    assert.equal(recent.has(first.id), false);
    const old = forgottenIds(FIXTURE, {
      today: TODAY,
      suggested: new Map([[first.id, "2026-06-01"]]),
    });
    assert.equal(old.has(first.id), true);
    const wornLately = forgottenIds([{ ...first, wornOn: ["2026-10-05"] }], { today: TODAY });
    assert.equal(wornLately.has(first.id), false);
    assert.ok(FORGOTTEN_DAYS >= 14);
  });

  it("the forgotten row is titled, last, and present on some screen with three or more cards", () => {
    let seen = 0;
    for (const { occasion, rows } of SCREENS) {
      const at = rows.findIndex((way) => way.id === FORGOTTEN_ID);
      if (at < 0) continue;
      seen += 1;
      assert.equal(at, rows.length - 1, `${occasion}: forgotten row is last`);
      assert.equal(rows[at]!.title, FORGOTTEN_TITLE);
      assert.ok(rowLooks(rows[at]!, occasion).length >= ROW_MIN);
    }
    assert.ok(seen >= 1, "no screen built a forgotten row");
  });
});

describe("idea titles", () => {
  const field = g({ id: "f", name: "Olive cotton field jacket", category: "outerwear", subtype: "field jacket", colors: ["olive"] });
  const knit = g({ id: "k", name: "Cream knit", category: "top", subtype: "sweater", colors: ["cream"], material: "wool" });
  const jeans = g({ id: "j", name: "Light blue denim jeans", category: "bottom", subtype: "jeans", colors: ["light blue"], material: "denim" });
  const sneaker = g({ id: "s", name: "White leather sneakers", category: "footwear", subtype: "sneakers", colors: ["white"], material: "leather" });
  const cords = g({ id: "c", name: "Brown corduroy trousers", category: "bottom", subtype: "trousers", colors: ["brown"], material: "corduroy" });
  const loafer = g({ id: "l", name: "Brown suede loafers", category: "footwear", subtype: "loafers", colors: ["brown"], material: "suede" });

  it("names the jacket, the cloth and the shoe: what differs from the card beside it", () => {
    assert.equal(ideaTitle([knit, jeans, sneaker, field]), "Olive field, denim, white sneaker");
    assert.equal(ideaTitle([knit, cords, loafer]), "Cream knit, brown cords, brown suede loafer");
    const branded = g({ ...knit, id: "b", name: "X Brand cream knit", brand: "X Brand" });
    assert.equal(ideaTitle([branded, cords, loafer]).includes("X Brand"), false);
  });

  it("never the old 'X and Y jacket' pattern, never a house name, on every card of every screen", () => {
    for (const { occasion, rows } of SCREENS) {
      for (const way of rows) {
        for (const look of rowLooks(way, occasion)) {
          const title = ideaTitle(look);
          assert.ok(title.length > 0);
          assert.equal(/\band\b/.test(title), false, title);
          assert.equal(/ jacket$/.test(title), false, title);
          assert.equal(BANNED.test(title), false, title);
          assert.equal(title.charAt(0), title.charAt(0).toUpperCase());
          assert.ok(title.split(", ").length >= 2, title);
        }
      }
    }
  });
});

describe("the Lookbook uses the whole closet", () => {
  const eligible = lookbookPool(FIXTURE).filter((p) => {
    const s = slotOf(p);
    return s === "top" || s === "dress" || s === "bottom" || s === "footwear" || s === "outerwear";
  });

  function distinct(pick: (s: Screen) => Garment[][]): Set<string> {
    const ids = new Set<string>();
    for (const screen of SCREENS) for (const look of pick(screen)) for (const p of look) ids.add(p.id);
    return ids;
  }

  it("at least 60% of eligible pieces appear across the five chapters (printed before and after)", (t) => {
    const before = distinct((s) => [...s.before.flatMap((way) => rowLooks(way, s.occasion)), ...s.week]);
    const after = distinct((s) => [...s.rows.flatMap((way) => rowLooks(way, s.occasion)), ...s.week]);
    const rowsOnlyBefore = distinct((s) => s.before.flatMap((way) => rowLooks(way, s.occasion)));
    const rowsOnlyAfter = distinct((s) => s.rows.flatMap((way) => rowLooks(way, s.occasion)));
    const pct = (n: number) => `${n} of ${eligible.length} (${Math.round((100 * n) / eligible.length)}%)`;
    const line =
      `Lookbook distinct pieces, fixture closet, fall, five chapters: ` +
      `before (stored rows + week) ${pct(before.size)}; after (idea rows + week) ${pct(after.size)}; ` +
      `rows alone before ${rowsOnlyBefore.size}, after ${rowsOnlyAfter.size}`;
    console.log(line);
    t.diagnostic(line);
    assert.ok(after.size > before.size, "the idea rows show more of the closet than the stored rows did");
    assert.ok(after.size >= Math.ceil(0.6 * eligible.length), `only ${pct(after.size)} of the closet appears`);
  });
});

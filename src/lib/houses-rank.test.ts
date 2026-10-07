import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import platesFile from "./stylist/__tests__/fixtures/plates-2026-09-30.json" with { type: "json" };
import { visibleDetectors, wayFirstRow } from "./detectors.ts";
import { HOUSE_CHIPS } from "./houses.ts";
import {
  buildReshuffleRow,
  comboKey,
  houseFirstRow,
  lookFitsHouse,
  lookbookPool,
  realWeekLooks,
} from "./lookbook.ts";
import type { Garment, Look, Occasion, Season } from "./types.ts";

type Raw = {
  id: string;
  name?: string | null;
  category?: string;
  subtype?: string;
  material?: string;
  colors?: string[];
  brand?: string;
  fit?: string | null;
  warmth?: number;
  archived?: boolean;
  tombstone?: boolean;
};

function garment(p: Raw): Garment {
  const fit = p.fit === "slim" || p.fit === "relaxed" || p.fit === "regular" ? p.fit : undefined;
  return {
    id: p.id,
    name: p.name ?? "",
    category: (p.category ?? "top") as Garment["category"],
    subtype: p.subtype ?? "",
    colors: p.colors ?? [],
    material: p.material ?? "",
    brand: p.brand ?? "",
    notes: "",
    formality: 3,
    warmth: Math.min(5, Math.max(1, p.warmth ?? 3)) as Garment["warmth"],
    seasons: [],
    imageSrc: "",
    cutoutSrc: "",
    imageSource: "photo",
    matteQuality: "ok",
    demo: false,
    wornOn: [],
    ...(fit ? { fit } : {}),
    archived: false,
    createdAt: "2026-09-30T00:00:00.000Z",
  };
}

const GONE = new Set<string>(platesFile.deleted_garments as string[]);
const RACK: Garment[] = (platesFile.plates as Raw[])
  .filter((p) => p.id && !p.tombstone && !p.archived && !GONE.has(p.id))
  .map(garment);
const POOL = lookbookPool(RACK);
const BY = new Map(POOL.map((g) => [g.id, g]));

const CELLS: { occasion: Occasion; season: Season }[] = [
  { occasion: "weekday", season: "fall" },
  { occasion: "weekend", season: "fall" },
  { occasion: "out", season: "fall" },
  { occasion: "weekend", season: "winter" },
];

const pieces = (look: Look) => look.garmentIds.map((id) => BY.get(id)).filter((g): g is Garment => Boolean(g));
const real = (look: Look) => !look.gate && !look.needsPieces && look.garmentIds.length >= 3;
const ids = (row: Look[]) => row.map((look) => look.id);

/* The ALL row is the base. Built once per cell; the house rows reuse the matrix. */
const ALL = new Map(
  CELLS.map(({ occasion, season }) => [
    `${occasion}:${season}`,
    realWeekLooks(buildReshuffleRow(RACK, occasion, { season, cap: 8, salt: 1 })),
  ]),
);

describe("a house ranks This week and never shrinks it", () => {
  for (const { occasion, season } of CELLS) {
    const allReal = ALL.get(`${occasion}:${season}`)!;
    it(`${occasion} · ${season}: ALL has ${allReal.length} real looks, every house keeps them all`, () => {
      assert.ok(allReal.length >= 3, `ALL ${allReal.length}`);
      assert.equal(houseFirstRow(allReal, "all", RACK, occasion, season), allReal);
      assert.equal(houseFirstRow(allReal, undefined, RACK, occasion, season), allReal);
      for (const { id: house, label } of HOUSE_CHIPS) {
        const fits = (look: Look) => lookFitsHouse(pieces(look), house, occasion, POOL, season);
        const matches = allReal.filter(fits).length;
        const row = houseFirstRow(allReal, house, RACK, occasion, season);
        const at = `${label} on ${occasion} · ${season} (${matches} match)`;
        assert.equal(row.length, Math.min(8, allReal.length), at);
        for (const look of row) assert.ok(real(look), `${at}: ${look.name}`);
        assert.equal(new Set(row.map((look) => comboKey(look.garmentIds))).size, row.length, at);
        assert.deepEqual([...ids(row)].sort(), [...ids(allReal)].sort(), at);
        for (const look of row.slice(0, matches)) assert.ok(fits(look), `${at}: ${look.name} leads without fitting`);
        for (const look of row.slice(matches)) assert.equal(fits(look), false, `${at}: ${look.name} fits but trails`);
        const alreadyLed = allReal.slice(0, matches).every(fits);
        if (matches >= 1 && !alreadyLed) assert.notDeepEqual(ids(row), ids(allReal), at);
      }
    });
  }

  it("drops nothing when a card in the row is a gate or a note, and still leads with the house", () => {
    const allReal = ALL.get("weekend:fall")!;
    const gate: Look = {
      id: "gate",
      name: "Switch to out · summer",
      occasion: "weekend",
      garmentIds: [],
      source: "ai",
      lookbook: false,
      gate: { occasion: "out", season: "summer", text: "Switch to out · summer" },
      createdAt: "2026-10-06T00:00:00.000Z",
    };
    const note: Look = {
      id: "note",
      name: "Needs pieces from this house.",
      occasion: "weekend",
      garmentIds: [],
      source: "ai",
      lookbook: false,
      needsPieces: true,
      createdAt: "2026-10-06T00:00:00.000Z",
    };
    const row = houseFirstRow([gate, ...allReal, note], "polo", RACK, "weekend", "fall");
    assert.equal(row.length, allReal.length);
    assert.equal(row.some((look) => look.gate || look.needsPieces), false);
    assert.ok(lookFitsHouse(pieces(row[0]!), "polo", "weekend", POOL, "fall"));
  });
});

describe("the library house row never zeros a cell the rack can dress", () => {
  for (const { occasion, season } of CELLS) {
    const allReal = ALL.get(`${occasion}:${season}`)!;
    it(`${occasion} · ${season}: every house row has at least three real looks`, () => {
      assert.ok(allReal.length >= 3);
      for (const { id: house, label } of HOUSE_CHIPS) {
        const row = buildReshuffleRow(RACK, occasion, { house, season, cap: 8, salt: 1 });
        const at = `${label} on ${occasion} · ${season}`;
        const shown = realWeekLooks(row);
        assert.ok(shown.length >= 3, `${at}: ${shown.length} real of ${row.length}`);
        assert.ok(row.length <= 8, at);
        assert.equal(row.some((look) => /None in/i.test(`${look.name} ${look.gap ?? ""}`)), false, at);
        assert.equal(row.every((look) => look.gate), false, `${at}: only a gate card`);
        assert.equal(new Set(row.map((look) => comboKey(look.garmentIds))).size, row.length, at);
      }
    });
  }
});

describe("a colour on a gated house still ranks", () => {
  it("Sweet Stable on Out · Fall and Italian winter on Weekend · Summer show the brown row, not a gate", () => {
    for (const [occasion, season, house] of [
      ["out", "fall", "sweetStable"],
      ["weekend", "summer", "italianWinter"],
    ] as const) {
      const at = `${house} on ${occasion} · ${season} in brown`;
      const all = realWeekLooks(buildReshuffleRow(RACK, occasion, { color: "brown", season, cap: 8, salt: 1 }));
      assert.ok(all.length >= 3, `ALL brown ${occasion} · ${season}: ${all.length}`);
      const row = buildReshuffleRow(RACK, occasion, { house, color: "brown", season, cap: 8, salt: 1 });
      const shown = realWeekLooks(row);
      assert.ok(shown.length >= 3, `${at}: ${shown.length} real of ${row.length}`);
      assert.ok(row.length <= 8, at);
      assert.equal(row.some((look) => look.gate || look.needsPieces), false, at);
      assert.equal(row.some((look) => /None in/i.test(`${look.name} ${look.gap ?? ""}`)), false, at);
      assert.equal(new Set(row.map((look) => comboKey(look.garmentIds))).size, row.length, at);
    }
  });
});

describe("a colour and a house compose", () => {
  it("colour + house returns the same looks as colour alone, that house's looks first", () => {
    for (const color of ["brown", "navy"]) {
      for (const { occasion, season } of CELLS) {
        const alone = realWeekLooks(buildReshuffleRow(RACK, occasion, { color, season, cap: 8, salt: 1 }));
        assert.ok(alone.length >= 3, `${color} alone on ${occasion} · ${season}: ${alone.length}`);
        for (const { id: house, label } of HOUSE_CHIPS) {
          const at = `${label} + ${color} on ${occasion} · ${season}`;
          const row = buildReshuffleRow(RACK, occasion, { house, color, season, cap: 8, salt: 1 });
          assert.equal(row.length, alone.length, at);
          assert.equal(row.some((look) => look.gate || look.needsPieces), false, at);
          assert.deepEqual([...ids(row)].sort(), [...ids(alone)].sort(), at);
          const fits = (look: Look) => lookFitsHouse(pieces(look), house, occasion, POOL, season);
          const matches = alone.filter(fits).length;
          for (const look of row.slice(0, matches)) assert.ok(fits(look), `${at}: ${look.name} leads without fitting`);
          for (const look of row.slice(matches)) assert.equal(fits(look), false, `${at}: ${look.name} fits but trails`);
        }
      }
    }
  });
});

describe("a house and a way compose", () => {
  it("the tapped way still leads a house-ranked row", () => {
    const allReal = ALL.get("weekday:fall")!;
    const way = visibleDetectors(RACK, { occasion: "weekday", season: "fall", color: null, weatherF: 73 }).find(
      (candidate) => !candidate.usual && (candidate.looks.weekday ?? []).length >= 1,
    );
    assert.ok(way, "Weekday · Fall has a way with a true look");
    for (const house of ["polo", "ald", "sweetStable"] as const) {
      const row = wayFirstRow(houseFirstRow(allReal, house, RACK, "weekday", "fall"), way, "weekday");
      assert.match(row[0]!.id, new RegExp(`^way:${way.id}:weekday:0:`), house);
      assert.ok(row.length <= 8, house);
      assert.equal(new Set(row.map((look) => comboKey(look.garmentIds))).size, row.length, house);
      assert.ok(row.length >= Math.min(8, allReal.length), house);
    }
  });

  it("the page ranks the base row by house, then by way, and shows every house chip", () => {
    const book = readFileSync(new URL("../routes/lookbook.tsx", import.meta.url), "utf8");
    assert.match(book, /const houseRow = houseFirstRow\(realRow, houseChip, garments, occasion, season\)/);
    assert.match(book, /const weekRow = wayFirstRow\(houseRow, activeWay, occasion\)/);
    assert.match(book, /data-house-row/);
    assert.match(book, /\.\.\.HOUSE_CHIPS\]/);
    assert.match(book, /setHouseChip/);
    assert.equal(book.includes("dressableHouses"), false);
    assert.equal(/filterKey = `[^`]*houseChip/.test(book), false);
    const effect = book.slice(book.indexOf("buildReshuffleRow(garments, occasion, {"), book.indexOf("setRanked("));
    assert.equal(effect.includes("house"), false);
  });
});

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Garment } from "./types.ts";

const { runEngine, SNAPSHOT_URL, ENGINE_NOW, engineGarments } = await import("./__fixtures__/engine-run.ts");
const { buildHouseMatrix, clearMatrixCache } = await import("./stylist/matrix.ts");
const { buildWeek, lookbookPool } = await import("./lookbook.ts");
const { sig } = await import("./house-profiles/evaluate.ts");
const { clashes, isHoodiePiece } = await import("./style.ts");
const { ENGINE_VERSION, ENGINE_VERSION_FALLBACK, engineVersionFrom, engineKey, liveRows, setEngineStore } =
  await import("./engine-store.ts");

const want = JSON.parse(readFileSync(SNAPSHOT_URL, "utf8")) as Record<string, unknown>;

function sameAsSnapshot(t: { diagnostic: (s: string) => void }, got: Record<string, unknown>, label: string) {
  assert.deepEqual(Object.keys(got).sort(), Object.keys(want).sort());
  for (const key of Object.keys(want)) {
    t.diagnostic(`${label} ${key} equal: ${JSON.stringify(got[key]) === JSON.stringify(want[key])}`);
    assert.deepEqual(got[key], want[key], `${label} ${key}`);
  }
}

/** Remembers every key asked for and every write. */
function spyStore(answer?: (key: string) => unknown) {
  const saved = new Map<string, unknown>();
  const asked: string[] = [];
  const puts: string[] = [];
  return {
    saved,
    asked,
    puts,
    store: {
      get: (key: string) => {
        asked.push(key);
        return answer ? answer(key) : saved.get(key);
      },
      put: (key: string, value: unknown) => {
        puts.push(key);
        saved.set(key, value);
      },
    },
  };
}

describe("engine speed: same outputs", () => {
  it("A) matrix, reshuffle rows, week, drop and ways match the 58d7b8c snapshot", (t) => {
    setEngineStore(null);
    clearMatrixCache();
    sameAsSnapshot(t, runEngine(), "fresh");
  });

  it("A) with the saved-results store: first run fills it, a fresh session reads it, outputs unchanged", (t) => {
    const spy = spyStore();
    setEngineStore(spy.store);
    try {
      clearMatrixCache();
      sameAsSnapshot(t, runEngine(), "filling");
      const written = spy.puts.length;
      assert.ok(written >= 3, `matrix builds saved: ${written}`);
      /* A new app open: memory caches and jacket counts are gone, the store is not. */
      clearMatrixCache();
      spy.puts.length = 0;
      sameAsSnapshot(t, runEngine(), "from store");
      assert.equal(spy.puts.length, 0, "every matrix came from the store");
    } finally {
      setEngineStore(null);
      clearMatrixCache();
    }
  });
});

describe("engine speed: sig keys the plate, not the id", () => {
  const lib = {
    navy_oxford: { slot: "top", any: ["oxford"], colors_any: ["navy"] },
  } as never;

  it("B) two plates with one id but different colour or name answer separately", () => {
    const a = { id: "g_same", category: "top", name: "Navy oxford", subtype: "oxford shirt", colors: ["navy"] };
    const b = { id: "g_same", category: "top", name: "Navy oxford", subtype: "oxford shirt", colors: ["white"] };
    const c = { id: "g_same", category: "top", name: "Navy tee", subtype: "tee", colors: ["navy"] };
    assert.equal(sig(a, "navy_oxford", lib), true);
    assert.equal(sig(b, "navy_oxford", lib), false);
    assert.equal(sig(c, "navy_oxford", lib), false);
    assert.equal(sig(a, "navy_oxford", lib), true);
  });

  it("B) a plate edited in place is read again", () => {
    const p = { id: "g_edit", category: "top", name: "Navy oxford", subtype: "oxford shirt", colors: ["navy"] };
    assert.equal(sig(p, "navy_oxford", lib), true);
    p.colors[0] = "white";
    assert.equal(sig(p, "navy_oxford", lib), false);
    p.colors[0] = "navy";
    p.name = "Navy tee";
    p.subtype = "tee";
    assert.equal(sig(p, "navy_oxford", lib), false);
  });

  it("B) garment classifiers and clashes follow in-place edits", () => {
    const base = engineGarments.find((g) => g.category === "top" && !isHoodiePiece(g))!;
    const g: Garment = structuredClone(base);
    assert.equal(isHoodiePiece(g), false);
    g.name = "Grey hoodie";
    assert.equal(isHoodiePiece(g), true);
    const bottom: Garment = structuredClone(engineGarments.find((x) => x.category === "bottom")!);
    const shoe: Garment = structuredClone(engineGarments.find((x) => x.category === "footwear")!);
    const blazer: Garment = { ...structuredClone(base), id: "g_blazer_test", name: "Blazer", subtype: "blazer", category: "outerwear" };
    /* Hoodie + blazer is a hard clash; renaming the hoodie away clears it. */
    assert.equal(clashes([g, bottom, shoe, blazer]), true);
    g.name = base.name;
    assert.equal(clashes([g, bottom, shoe, blazer]), clashes([structuredClone(base), bottom, shoe, blazer]));
  });
});

describe("engine speed: saved-results keys", () => {
  const pool = lookbookPool(engineGarments);
  const placeholder = { matrix: { occasion: "x", season: "x", houses: {}, all: [] }, jackets: [] };

  function matrixKey(garments: Garment[], occasion = "weekday", season = "fall"): string {
    const spy = spyStore(() => placeholder);
    setEngineStore(spy.store);
    try {
      clearMatrixCache();
      buildHouseMatrix(garments, occasion, season);
      assert.equal(spy.asked.length, 1);
      return spy.asked[0]!;
    } finally {
      setEngineStore(null);
      clearMatrixCache();
    }
  }

  it("C) identical inputs hit; every engine-read field, the set, occasion, season and version miss", () => {
    const base = matrixKey(pool);
    assert.ok(base.startsWith(`engine-cache:matrix:${ENGINE_VERSION}:`), base);
    assert.equal(matrixKey(structuredClone(pool)), base, "a copy of the same closet hits");

    const edits: [string, (g: Garment) => void][] = [
      ["name", (g) => (g.name = `${g.name} x`)],
      ["subtype", (g) => (g.subtype = `${g.subtype} x`)],
      ["category", (g) => (g.category = g.category === "top" ? "outerwear" : "top")],
      ["material", (g) => (g.material = `${g.material} x`)],
      ["colors", (g) => (g.colors = [...g.colors, "olive"])],
      ["brand", (g) => (g.brand = `${g.brand} x`)],
      ["fit", (g) => (g.fit = g.fit === "slim" ? "relaxed" : "slim")],
      ["warmth", (g) => (g.warmth = g.warmth === 5 ? 1 : ((g.warmth + 1) as Garment["warmth"]))],
      ["formality", (g) => (g.formality = g.formality === 5 ? 1 : ((g.formality + 1) as Garment["formality"]))],
      ["notes", (g) => (g.notes = `${g.notes ?? ""} x`)],
      ["seasons", (g) => (g.seasons = [...(g.seasons ?? []), "summer"])],
      ["archived", (g) => (g.archived = !g.archived)],
      ["wornOn", (g) => (g.wornOn = [...g.wornOn, "2026-10-08"])],
    ];
    for (const [field, edit] of edits) {
      const next = structuredClone(pool);
      edit(next[7]!);
      assert.notEqual(matrixKey(next), base, `${field} change must miss`);
    }
    assert.notEqual(matrixKey(pool.slice(1)), base, "one piece fewer misses");
    assert.notEqual(matrixKey([...pool.slice(1), pool[0]!]), base, "reordered closet misses");
    assert.notEqual(matrixKey(pool, "out"), base, "occasion misses");
    assert.notEqual(matrixKey(pool, "weekday", "spring"), base, "season misses");
    const parts = ["weekday", "fall", [], [], pool];
    assert.notEqual(engineKey("matrix", parts, "older"), engineKey("matrix", parts), "version misses");
  });

  it("C) a hit replays its jacket counts, and later builds key on them", () => {
    const counted = { ...placeholder, jackets: [["g_jacket_test", 2]] };
    const spy = spyStore(() => counted);
    setEngineStore(spy.store);
    try {
      clearMatrixCache();
      buildHouseMatrix(pool, "weekday", "fall");
      buildHouseMatrix(pool, "out", "fall");
      const afterReplay = spy.asked[1]!;
      clearMatrixCache();
      buildHouseMatrix(pool, "out", "fall");
      const fresh = spy.asked[2]!;
      assert.notEqual(afterReplay, fresh, "out/fall after a replayed weekday build is a different input");
    } finally {
      setEngineStore(null);
      clearMatrixCache();
    }
  });

  it("C) the week key follows today, the counts and the closet", () => {
    const keys: string[] = [];
    const spy = spyStore((key) => {
      keys.push(key);
      return [];
    });
    setEngineStore(spy.store);
    mock.timers.enable({ apis: ["Date"], now: ENGINE_NOW });
    try {
      /* Distinct closets so the in-memory copy never answers first. */
      const tag = (n: number) => engineGarments.map((g, i) => (i === 0 ? { ...g, notes: `${g.notes ?? ""}#${n}` } : g));
      buildWeek(tag(1), "2026-10-09");
      buildWeek(tag(2), "2026-10-09");
      buildWeek(tag(1), "2026-10-10");
      buildWeek(tag(1), "2026-10-09", { usedCount: new Map([["g_x", 1]]) });
      mock.timers.setTime(ENGINE_NOW + 86_400_000);
      buildWeek(tag(1), "2026-10-09");
      assert.equal(new Set(keys).size, keys.length, keys.join("\n"));
      assert.ok(keys.every((k) => k.startsWith(`engine-cache:week:${ENGINE_VERSION}:`)));
    } finally {
      mock.timers.reset();
      setEngineStore(null);
    }
  });

  it("C) version comes from the deploy commit; the fixed fallback when the build variable is absent", () => {
    /* node --test has no import.meta.env, so the build variable is absent here. */
    assert.equal(import.meta.env?.VITE_ENGINE_COMMIT, undefined);
    assert.equal(ENGINE_VERSION, ENGINE_VERSION_FALLBACK);
    assert.equal(engineVersionFrom(undefined), ENGINE_VERSION_FALLBACK);
    assert.equal(engineVersionFrom(""), ENGINE_VERSION_FALLBACK);
    assert.equal(engineVersionFrom("  "), ENGINE_VERSION_FALLBACK);
    const a = engineVersionFrom("1a2b3c4d5e6f7a8b9c0d1a2b3c4d5e6f7a8b9c0d");
    const b = engineVersionFrom("0d9c8b7a6f5e4d3c2b1a0d9c8b7a6f5e4d3c2b1a");
    assert.notEqual(a, ENGINE_VERSION_FALLBACK);
    assert.notEqual(a, b);
    const parts = ["weekday", "fall", [], [], lookbookPool(engineGarments)];
    assert.notEqual(engineKey("matrix", parts, a), engineKey("matrix", parts, b), "a new deploy misses");
    assert.notEqual(engineKey("matrix", parts, a), engineKey("matrix", parts), "a deploy misses the fallback's rows");
  });

  it("C) loading keeps this version only, newest first", () => {
    const rows = [
      { key: `engine-cache:matrix:${ENGINE_VERSION}:a`, at: 1 },
      { key: "engine-cache:matrix:0-old:b", at: 9 },
      { key: `engine-cache:week:${ENGINE_VERSION}:c`, at: 5 },
      { key: "idb:g_1:c", at: 10 },
    ];
    assert.deepEqual(
      liveRows(rows, 16).map((r) => r.key),
      [`engine-cache:week:${ENGINE_VERSION}:c`, `engine-cache:matrix:${ENGINE_VERSION}:a`],
    );
    assert.equal(liveRows(rows, 1).length, 1);
  });
});

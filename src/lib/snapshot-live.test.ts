/**
 * The closet snapshot: the fixture is the whole test closet and every piece in it is real, the
 * refresh script writes the shape the fixture already has and only ever selects, its
 * --from-file mode reduces an export the way the live row is reduced without touching the
 * network, and, when Supabase env is set, the live closet has as many pieces as the snapshot
 * (read-only; skipped without env).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  builtName,
  closetFromStored,
  exportGarments,
  FALLBACK_CREATED_AT,
  fetchLiveCloset,
  fixtureName,
  fixtureText,
  HOUSE_WORDS,
  liveGarments,
  parseArgs,
  readExportCloset,
  readSnapshotEnv,
  SNAPSHOT_URL,
  stripGarment,
} from "../../scripts/refresh-closet-snapshot.ts";
import { LIVE_SNAPSHOT_COUNT, TEST_CLOSET_COUNT, liveSnapshot, testCloset } from "./__fixtures__/snapshot.ts";

const SCRIPT_URL = new URL("../../scripts/refresh-closet-snapshot.ts", import.meta.url);
const ENV = readSnapshotEnv();

describe("the snapshot closet", () => {
  it("is the live snapshot alone: every id once, every id the account's, no hand-drafted piece", () => {
    expect(TEST_CLOSET_COUNT).toBe(LIVE_SNAPSHOT_COUNT);
    expect(testCloset).toBe(liveSnapshot);
    expect(new Set(testCloset.map((g) => g.id)).size).toBe(TEST_CLOSET_COUNT);
    for (const g of testCloset) {
      expect(g.id, g.name).toMatch(/^g_[a-z0-9]+$/);
      expect(g.id, g.name).not.toMatch(/^x_/);
    }
  });

  it("carries nothing personal: no brand, notes, wear dates or images; the day added is kept", () => {
    for (const g of testCloset) {
      expect(g.brand, g.id).toBe("");
      expect(g.notes, g.id).toBe("");
      expect(g.wornOn, g.id).toEqual([]);
      expect(Number.isNaN(Date.parse(g.createdAt)), g.id).toBe(false);
      expect("imageSrc" in g, g.id).toBe(false);
      expect("cutoutSrc" in g, g.id).toBe(false);
      expect("productUrl" in g, g.id).toBe(false);
    }
  });
});

describe("the refresh script", () => {
  const source = readFileSync(SCRIPT_URL, "utf8");

  it("only selects", () => {
    expect(source).toMatch(/\.from\("closet_meta"\)\.select\(/);
    expect(source.match(/\.from\(/g)?.length).toBe(1);
    for (const verb of ["insert", "update", "upsert", "delete", "rpc"]) {
      expect(source, verb).not.toMatch(new RegExp(`\\.${verb}\\b`));
    }
  });

  it("writes only the live snapshot file and takes keys from process.env alone", () => {
    expect(source.match(/writeFileSync\(/g)?.length).toBe(1);
    expect(source).toMatch(/writeFileSync\(SNAPSHOT_URL, next\)/);
    expect(source).not.toMatch(/supabase\.co/);
    expect(source).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
    expect(source).not.toMatch(/process\.env\.[A-Z_]+/);
    expect(SNAPSHOT_URL.pathname.endsWith("/src/lib/__fixtures__/engine-garments.json")).toBe(true);
  });

  it("reads an export file the way it reads the live row: rows list, one row or the bare array, no network", () => {
    const garments = [
      { id: "a", name: "kept", brand: "someone", notes: "secret", wornOn: ["2026-10-01"], createdAt: "2025-01-01" },
      { id: "b", archived: true, tombstone: true },
      { id: "c", demo: true },
      { id: "d", archived: true },
      { id: "e", colors: ["olive"], material: "linen", subtype: "shirt", category: "top" },
    ];
    expect(exportGarments([{ user_id: "u", garments }])).toBe(garments);
    expect(exportGarments({ user_id: "u", garments })).toBe(garments);
    expect(exportGarments(garments)).toBe(garments);
    expect(() => exportGarments([{ garments }, { garments }])).toThrow(/2 closet rows/);
    expect(() => exportGarments("nope")).toThrow(/neither/);

    const dir = mkdtempSync(join(tmpdir(), "closet-export-"));
    try {
      const path = join(dir, "closet_meta.json");
      writeFileSync(path, JSON.stringify([{ user_id: "u", garments }]));
      const closet = readExportCloset(path);
      expect(closet.pieces.map((g) => g.id)).toEqual(["a", "e"]);
      expect(closet).toMatchObject({ stored: 5, tombstones: 1, demo: 1, archived: 1 });
      expect(closet.pieces[0]).toMatchObject({ brand: "", notes: "", wornOn: [], createdAt: "2025-01-01" });
      expect(closet.pieces[1]!.name).toBe("olive linen shirt");
      expect(closet.pieces[1]!.id).toBe("e");
      writeFileSync(path, "{ not json");
      expect(() => readExportCloset(path)).toThrow(/Could not read the export/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(parseArgs(["--check", "--from-file", "x.json"])).toEqual({ check: true, fromFile: "x.json" });
    expect(parseArgs([])).toEqual({ check: false });
    expect(parseArgs(["--from-file"])).toEqual({ error: "--from-file needs a path" });
    expect(parseArgs(["--from-file", "--check"])).toEqual({ error: "--from-file needs a path" });
    expect(parseArgs(["--nope"])).toEqual({ error: "unknown argument --nope" });
  });

  it("the fixture is a fixed point of that reduction: reducing it again changes nothing", () => {
    const again = closetFromStored(liveSnapshot);
    expect(again.pieces).toEqual(liveSnapshot);
    expect(again).toMatchObject({ stored: LIVE_SNAPSHOT_COUNT, tombstones: 0, demo: 0, archived: 0 });
  });

  it("maps a stored piece to the shape the fixture already has", () => {
    for (const g of liveSnapshot) expect(stripGarment(g), g.id).toEqual(g);
    /* The stored name, lower-cased, keeps the pattern and colour words the engine reads; the maker goes. */
    expect(fixtureName("Light Blue plaid flannel", ["light blue"], "flannel", "flannel shirt", "top")).toBe("light blue plaid flannel");
    expect(fixtureName("Red gingham shirt", ["maroon", "white"], "", "shirt", "top")).toBe("red gingham shirt");
    expect(fixtureName("Black white check shirt", ["black", "white"], "", "shirt", "top")).toBe("black white check shirt");
    expect(fixtureName("Blue pinstripe trousers", ["light blue"], "", "trousers", "bottom")).toBe("blue pinstripe trousers");
    expect(fixtureName("Navy Someone & Co polo", ["navy"], "cotton", "polo", "top", "Someone & Co")).toBe("navy polo");
    expect(fixtureName("Navy R sweater", ["navy"], "knit", "sweater", "top", "Some Maker")).toBe("navy sweater");
    for (const word of HOUSE_WORDS) expect(fixtureName(`Navy ${word} sweater`, ["navy"], "knit", "sweater", "top"), word).toBe("navy sweater");
    /* A blank or placeholder name, or nothing but the maker, is built from colour, material and subtype. */
    expect(fixtureName("New piece", ["khaki"], "", "", "top")).toBe("khaki top");
    expect(fixtureName("", ["navy", "black"], "corduroy", "trousers", "bottom")).toBe("navy corduroy trousers");
    expect(fixtureName("Some Maker", ["navy"], "cotton", "polo", "top", "Some Maker")).toBe("navy cotton polo");
    expect(builtName(["light blue"], "flannel", "flannel shirt", "top")).toBe("light blue flannel shirt");
    /* The fixture names are a fixed point of the sanitizer and carry no maker, capital or placeholder. */
    for (const g of liveSnapshot) {
      expect(fixtureName(g.name, g.colors, g.material ?? "", g.subtype ?? "", g.category), g.id).toBe(g.name);
      expect(g.name, g.id).not.toMatch(/[A-Z]|\bnew piece\b/);
      for (const word of HOUSE_WORDS) expect(` ${g.name} `, g.id).not.toContain(` ${word} `);
    }
    const strippedText = fixtureText(liveSnapshot);
    expect(JSON.parse(strippedText)).toHaveLength(LIVE_SNAPSHOT_COUNT);
    expect(strippedText.endsWith("\n]\n")).toBe(true);
  });

  it("reads the stored array the way the app does: tombstones, demo and archived stay out", () => {
    const stored = [
      { id: "a", name: "kept" },
      { id: "b", tombstone: true, archived: true },
      { id: "c", demo: true },
      { id: "d", archived: true },
      { id: "e", name: "also kept" },
      null,
      { name: "no id" },
    ];
    expect(liveGarments(stored).map((g) => g.id)).toEqual(["a", "e"]);
    expect(liveGarments("nope")).toEqual([]);
    const stripped = stripGarment({ id: "a", brand: "someone", notes: "secret", wornOn: ["2026-10-01"], createdAt: "2025-01-01" });
    expect(stripped.brand).toBe("");
    expect(stripped.notes).toBe("");
    expect(stripped.wornOn).toEqual([]);
    /* The stored createdAt stays: the labels tell same-name pieces apart by it. An unreadable one gets the fallback. */
    expect(stripped.createdAt).toBe("2025-01-01");
    expect(stripGarment({ id: "b", createdAt: "not a date" }).createdAt).toBe(FALLBACK_CREATED_AT);
    expect(stripGarment({ id: "c" }).createdAt).toBe(FALLBACK_CREATED_AT);
  });

  it("explains missing env without touching a file", () => {
    const none = readSnapshotEnv({});
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.message).toMatch(/Nothing was written/);
    const some = readSnapshotEnv({ SUPABASE_URL: "x", SUPABASE_ANON_KEY: "y", CLOSET_USER_ID: "u" });
    expect(some.ok).toBe(true);
    if (some.ok) {
      expect(some.urlName).toBe("SUPABASE_URL");
      expect(some.keyName).toBe("SUPABASE_ANON_KEY");
      expect(some.userId).toBe("u");
    }
  });
});

describe("the live closet", () => {
  it.skipIf(!ENV.ok)("has as many pieces as the snapshot (read-only)", async () => {
    if (!ENV.ok) return;
    const live = await fetchLiveCloset(ENV);
    const liveIds = new Set(live.pieces.map((g) => g.id));
    const snapIds = new Set(liveSnapshot.map((g) => g.id));
    const added = [...liveIds].filter((id) => !snapIds.has(id)).length;
    const gone = [...snapIds].filter((id) => !liveIds.has(id)).length;
    expect(live.pieces.length, `live ${live.pieces.length} vs snapshot ${LIVE_SNAPSHOT_COUNT}: ${added} new, ${gone} gone`).toBe(
      LIVE_SNAPSHOT_COUNT,
    );
  });
});

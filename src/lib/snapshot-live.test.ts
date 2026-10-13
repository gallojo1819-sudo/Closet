/**
 * The closet snapshot: the fixture counts add up, the refresh script writes the shape the
 * fixture already has and only ever selects, and, when Supabase env is set, the live closet
 * has as many pieces as the snapshot (read-only; skipped without env).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EXTRA_URL,
  fetchLiveCloset,
  fixtureName,
  fixtureText,
  liveGarments,
  readSnapshotEnv,
  SNAPSHOT_URL,
  stripGarment,
} from "../../scripts/refresh-closet-snapshot.ts";
import {
  EXTRA_PIECE_COUNT,
  LIVE_SNAPSHOT_COUNT,
  TEST_CLOSET_COUNT,
  extraPieces,
  liveSnapshot,
  testCloset,
} from "./__fixtures__/snapshot.ts";

const SCRIPT_URL = new URL("../../scripts/refresh-closet-snapshot.ts", import.meta.url);
const ENV = readSnapshotEnv();

describe("the snapshot closet", () => {
  it("counts the live snapshot plus the hand-drafted extras, every id once", () => {
    expect(TEST_CLOSET_COUNT).toBe(LIVE_SNAPSHOT_COUNT + EXTRA_PIECE_COUNT);
    expect(testCloset.length).toBe(TEST_CLOSET_COUNT);
    expect(new Set(testCloset.map((g) => g.id)).size).toBe(TEST_CLOSET_COUNT);
    expect(LIVE_SNAPSHOT_COUNT).toBeGreaterThan(EXTRA_PIECE_COUNT);
    const liveIds = new Set(liveSnapshot.map((g) => g.id));
    for (const g of extraPieces) {
      expect(g.id, g.name).toMatch(/^x_/);
      expect(liveIds.has(g.id)).toBe(false);
    }
  });

  it("carries nothing personal: no brand, notes, wear dates, images or real dates", () => {
    for (const g of testCloset) {
      expect(g.brand, g.id).toBe("");
      expect(g.notes, g.id).toBe("");
      expect(g.wornOn, g.id).toEqual([]);
      expect(g.createdAt, g.id).toBe("2026-01-01T00:00:00.000Z");
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
    expect(source).not.toMatch(/writeFileSync\(EXTRA_URL/);
    expect(source).not.toMatch(/supabase\.co/);
    expect(source).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
    expect(source).not.toMatch(/process\.env\.[A-Z_]+/);
    expect(SNAPSHOT_URL.pathname.endsWith("/src/lib/__fixtures__/engine-garments.json")).toBe(true);
    expect(EXTRA_URL.pathname.endsWith("/src/lib/__fixtures__/redress-extra.json")).toBe(true);
  });

  it("maps a stored piece to the shape the fixture already has", () => {
    for (const g of liveSnapshot) expect(stripGarment(g), g.id).toEqual(g);
    expect(fixtureName(["light blue"], "flannel", "flannel shirt", "top")).toBe("light blue flannel shirt");
    expect(fixtureName(["khaki"], "", "", "top")).toBe("khaki top");
    expect(fixtureName(["navy", "black"], "corduroy", "trousers", "bottom")).toBe("navy corduroy trousers");
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
    expect(stripped.createdAt).toBe("2026-01-01T00:00:00.000Z");
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

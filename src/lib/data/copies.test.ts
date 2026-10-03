import { register } from "node:module";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pieceLabel } from "../piece-label.ts";
import type { Garment } from "../types.ts";

register(new URL("../../../scripts/ts-ext.mjs", import.meta.url), {
  parentURL: import.meta.url,
});

const { clearPendingEdit } = await import("../cloud/edit.ts");
const { useCloset } = await import("../store.ts");
import {
  DELETED_LEGACY_IDS,
  STRAY_LOOK_NAME,
  backfillDeletedIds,
  getCopyParity,
  memMarkDeleted,
  parityLine,
  resetCopyReconcileForTests,
  runCopyReconcile,
  strayLookId,
  type CopyIo,
} from "./copies.ts";
import { setV2Port } from "./v2-port.ts";
import { applyV2Write, type V2VersionRow } from "./v2-guard.ts";

const NOW = "2026-09-30T15:00:00.000Z";

function row(legacyId: string, version = 1, deletedAt: string | null = null): V2VersionRow {
  return { legacy_id: legacyId, version, deleted_at: deletedAt, status: "in_closet" };
}

function plate(partial: Pick<Garment, "id" | "name"> & Partial<Garment>): Garment {
  return {
    category: "footwear",
    subtype: "sneaker",
    colors: ["white", "gum"],
    material: "leather",
    brand: "",
    notes: "",
    formality: 2,
    warmth: 2,
    seasons: ["fall"],
    imageSrc: "",
    cutoutSrc: "",
    imageSource: "photo",
    matteQuality: "ok",
    demo: false,
    wornOn: [],
    archived: false,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...partial,
  };
}

describe("v2 deletes", () => {
  it("a delete then a stale write stays deleted in closet_meta and garments_v2", () => {
    const snap = useCloset.getState();
    const id = "g_test_delete_stale";
    let rows = [row(id, 1)];
    setV2Port({
      onGarmentRemoved: (legacyId) => {
        rows = memMarkDeleted(rows, legacyId, NOW);
      },
      onLookSaved: () => {},
      onLookRemoved: () => {},
    });
    try {
      useCloset.setState({ garments: [plate({ id, name: "Navy tee", category: "top", subtype: "tee" })] });
      useCloset.getState().removeGarment(id);
      assert.equal(
        useCloset.getState().garments.some((g) => g.id === id),
        false,
      );
      const kept = rows.find((r) => r.legacy_id === id);
      assert.equal(kept?.deleted_at, NOW);
      assert.equal(kept?.version, 2);
      assert.equal(rows.length, 1);
      const stale = applyV2Write(kept!, { version: 1, deleted_at: null, status: "in_closet" });
      assert.equal(stale.applied, false);
      assert.equal(kept?.deleted_at, NOW);
      assert.notEqual(kept?.status, "deleted");
      assert.equal(
        useCloset.getState().garments.some((g) => g.id === id),
        false,
      );
      const cas = applyV2Write(kept!, {
        expectedVersion: 1,
        version: 2,
        deleted_at: null,
        status: "in_closet",
      });
      assert.equal(cas.applied, false);
      assert.equal(kept?.deleted_at, NOW);

      setV2Port({
        onGarmentRemoved: () => {
          throw new Error("mirror down");
        },
        onLookSaved: () => {},
        onLookRemoved: () => {},
      });
      useCloset.setState({ garments: [plate({ id: "g_fail_mirror", name: "Grey tee", category: "top" })] });
      useCloset.getState().removeGarment("g_fail_mirror");
      assert.equal(
        useCloset.getState().garments.some((g) => g.id === "g_fail_mirror"),
        false,
      );

      let saved: string | null = null;
      let removed: string | null = null;
      setV2Port({
        onGarmentRemoved: () => {},
        onLookSaved: (look) => {
          saved = look.id;
        },
        onLookRemoved: (legacyId) => {
          removed = legacyId;
        },
      });
      const lookId = useCloset.getState().saveLook({
        name: "Parity look",
        occasion: "weekday",
        garmentIds: ["a", "b"],
        source: "manual",
      });
      assert.equal(saved, lookId);
      useCloset.getState().removeLook(lookId);
      assert.equal(removed, lookId);
      assert.equal(
        useCloset.getState().looks.some((l) => l.id === lookId),
        false,
      );
    } finally {
      useCloset.setState({
        garments: snap.garments,
        looks: snap.looks,
        drop: snap.drop,
        thisWeek: snap.thisWeek,
        journal: snap.journal,
        avoid: snap.avoid,
        messages: snap.messages,
      });
      setV2Port(null);
      clearPendingEdit();
    }
  });

  it("backfill sets deleted_at on the four ids and does not insert them into closet_meta", () => {
    const meta = ["g_keep"];
    let rows = [...DELETED_LEGACY_IDS.map((id) => row(id, 4)), row("g_keep", 1)];
    const before = rows.length;
    rows = backfillDeletedIds(rows, [...DELETED_LEGACY_IDS, "g_missing_from_v2"], NOW);
    assert.equal(rows.length, before);
    assert.equal(rows.some((r) => r.legacy_id === "g_missing_from_v2"), false);
    for (const id of DELETED_LEGACY_IDS) {
      assert.equal(meta.includes(id), false);
      const kept = rows.find((r) => r.legacy_id === id);
      assert.ok(kept?.deleted_at);
      assert.equal(kept?.status, "in_closet");
      const stale = applyV2Write(kept!, { version: 1, deleted_at: null, status: "in_closet" });
      assert.equal(stale.applied, false);
      assert.ok(kept?.deleted_at);
    }
    assert.equal(rows.find((r) => r.legacy_id === "g_keep")?.deleted_at, null);
  });
});

describe("copy parity", () => {
  it("names the gap and hides when the counts match", () => {
    assert.equal(parityLine(142, 601, 146, 598), "Closet copies differ · meta 142/601 · v2 146/598");
    assert.equal(parityLine(142, 600, 142, 598), "Closet copies differ · meta 142/600 · v2 142/598");
    assert.equal(parityLine(142, 598, 142, 598), null);
  });

  it("removes only the stray olive look, and only when it is not today's drop", async () => {
    resetCopyReconcileForTests();
    let calls = 0;
    let looks = [
      { id: "olive", name: STRAY_LOOK_NAME, garmentIds: ["j", "c", "s"] },
      { id: "keep", name: "Navy oxford · weekday", garmentIds: ["a", "b"] },
    ];
    const io = (): CopyIo => ({
      backfill: async () => {
        calls += 1;
      },
      counts: async () => ({ garments: 142, looks: 598 }),
      looks: () => looks,
      drop: () => ({ date: "2026-09-30", garmentIds: ["today-top", "today-shoe"] }),
      today: "2026-09-30",
      removeLook: (id) => {
        looks = looks.filter((look) => look.id === id ? false : true);
      },
      metaGarments: () => 142,
      metaLooks: () => looks.length,
    });
    const first = await runCopyReconcile("user-olive", io());
    await runCopyReconcile("user-olive", io());
    assert.equal(calls, 1);
    assert.equal(first.removed, "olive");
    assert.equal(looks.some((look) => look.name === STRAY_LOOK_NAME), false);
    assert.equal(looks.length, 1);
    assert.equal(first.metaG, 142);
    assert.equal(first.metaL, 1);
    assert.equal(first.v2G, 142);
    assert.equal(first.v2L, 598);
    assert.equal(getCopyParity(), "Closet copies differ · meta 142/1 · v2 142/598");

    resetCopyReconcileForTests();
    const dropLooks = [{ id: "olive", name: STRAY_LOOK_NAME, garmentIds: ["a", "b"] }];
    let removed = 0;
    await runCopyReconcile("user-drop", {
      backfill: async () => {},
      counts: async () => ({ garments: 142, looks: 598 }),
      looks: () => dropLooks,
      drop: () => ({ date: "2026-09-30", garmentIds: ["b", "a"] }),
      today: "2026-09-30",
      removeLook: () => {
        removed += 1;
      },
      metaGarments: () => 142,
      metaLooks: () => dropLooks.length,
    });
    assert.equal(removed, 0);
    assert.equal(dropLooks.length, 1);

    const none = strayLookId(
      [{ id: "other", name: "Olive field jacket · weekend", garmentIds: ["a"] }],
      null,
      "2026-09-30",
    );
    assert.equal(none, null);
    resetCopyReconcileForTests();
  });

  it("a failed count hides the line instead of inventing a difference", async () => {
    resetCopyReconcileForTests();
    await runCopyReconcile("user-fail", {
      backfill: async () => {},
      counts: async () => null,
      looks: () => [],
      drop: () => null,
      today: "2026-09-30",
      removeLook: () => {},
      metaGarments: () => 142,
      metaLooks: () => 600,
    });
    assert.equal(getCopyParity(), null);
    resetCopyReconcileForTests();
  });
});

describe("piece labels", () => {
  it("adds one distinguisher for a shared name and leaves the plate name alone", () => {
    const a = plate({ id: "s1", name: "White leather sneakers", brand: "Common Projects" });
    const b = plate({ id: "s2", name: "White leather sneakers", brand: "Koio", colors: ["white", "navy"] });
    const only = plate({ id: "s3", name: "Cream trousers", brand: "Incotex", category: "bottom", subtype: "trouser" });
    const pool = [a, b, only];
    assert.equal(pieceLabel(a, pool), "White leather sneakers · gum");
    assert.equal(pieceLabel(b, pool), "White leather sneakers · navy");
    assert.equal(pieceLabel(only, pool), "Cream trousers");
    assert.equal(a.name, "White leather sneakers");

    const named = plate({
      id: "j1",
      name: "Brown suede jacket",
      brand: "Brown suede jacket",
      fit: "relaxed",
      subtype: "suede jacket",
      category: "outerwear",
      colors: ["brown", "tan"],
    });
    const twin = plate({
      id: "j2",
      name: "Brown suede jacket",
      brand: "",
      fit: "slim",
      subtype: "jacket",
      category: "outerwear",
      colors: ["brown"],
    });
    assert.equal(pieceLabel(named, [named, twin]), "Brown suede jacket · tan");
    assert.equal(pieceLabel(twin, [named, twin]), "Brown suede jacket · leather");

    const jeansA = plate({
      id: "d1",
      name: "Light blue jeans",
      brand: "blue",
      subtype: "jeans",
      category: "bottom",
      colors: ["light blue", "indigo"],
    });
    const jeansB = plate({
      id: "d2",
      name: "Light blue jeans",
      brand: "",
      fit: undefined,
      subtype: "",
      category: "bottom",
      colors: ["light blue"],
      material: "",
    });
    assert.equal(pieceLabel(jeansA, [jeansA, jeansB]), "Light blue jeans · indigo");
    assert.equal(pieceLabel(jeansB, [jeansA, jeansB]), "Light blue jeans");

    const cashmere = plate({
      id: "k1",
      name: "Navy crew",
      category: "top",
      subtype: "crew",
      colors: ["navy"],
      brand: "",
      material: "cashmere",
    });
    const merino = plate({
      id: "k2",
      name: "Navy crew",
      category: "top",
      subtype: "crew",
      colors: ["navy"],
      brand: "",
      material: "merino",
    });
    assert.equal(pieceLabel(cashmere, [cashmere, merino]), "Navy crew · cashmere");
    assert.equal(pieceLabel(merino, [cashmere, merino]), "Navy crew · merino");
  });
});

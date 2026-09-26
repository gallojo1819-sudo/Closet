import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inClosetIds, LIVE_READ_SOURCE } from "./read.ts";
import {
  imageHeadFailures,
  migrateClosetMeta,
  migrationMatchesBlob,
  outfitSlot,
  PHASE0_UID,
  type ClosetBlob,
} from "./migrate.ts";

/** Fake user — tests never read or write closet.v6. */
void "fake-user-joe";

function g(
  id: string,
  patch: Partial<ClosetBlob["garments"][number]> = {},
): ClosetBlob["garments"][number] {
  return {
    id,
    name: patch.name ?? id,
    category: patch.category ?? "top",
    subtype: patch.subtype ?? "",
    colors: patch.colors ?? [],
    material: patch.material ?? "",
    brand: "",
    notes: "",
    formality: 3,
    warmth: 3,
    seasons: patch.seasons ?? [],
    imageSrc: patch.imageSrc ?? `sb:${PHASE0_UID}/${id}/o.jpg`,
    cutoutSrc: patch.cutoutSrc ?? `sb:${PHASE0_UID}/${id}/c.jpg`,
    imageSource: "photo",
    wornOn: patch.wornOn ?? [],
    archived: patch.archived,
    demo: patch.demo,
  };
}

describe("phase 0 migrator", () => {
  it("matches the blob: empty seasons stay empty, dropped looks are listed, no extra pieces", () => {
    const blob: ClosetBlob = {
      garments: [
        g("g_jacket", { name: "Brown jacket", category: "outerwear", subtype: "jacket", seasons: [] }),
        g("g_hoodie", { name: "Grey hoodie", category: "top", subtype: "hoodie" }),
        g("g_chino", { name: "Khaki chino", category: "bottom", subtype: "chino", wornOn: ["2026-09-01", "2026-09-01"] }),
        g("g_loafer", { name: "Brown loafer", category: "bottom", subtype: "loafer" }),
        g("g_gone", { name: "Archived tee", archived: true }),
      ],
      looks: [
        { id: "l1", name: "One", occasion: "weekday", garmentIds: ["g_jacket", "g_chino", "g_loafer"], source: "ai" },
        { id: "l2", name: "Thin", occasion: "weekday", garmentIds: ["g_hoodie", "missing_1"], source: "ai" },
        { id: "l3", name: "Gone", occasion: "out", garmentIds: ["missing_a", "missing_b"], source: "manual" },
      ],
      journal: [
        { date: "2026-09-02", garmentIds: ["g_chino", "g_jacket"], verdict: "worn", occasion: "weekday" },
        { date: "2026-09-03", garmentIds: ["g_hoodie"], verdict: "skipped" },
      ],
      avoid: { g_loafer: 4, g_hoodie: 2 },
    };
    const result = migrateClosetMeta(blob, PHASE0_UID);
    assert.equal(migrationMatchesBlob(blob, result), true);
    assert.equal(result.garments.length, 4);
    assert.equal(result.garments.every((row) => row.status === "in_closet"), true);
    assert.deepEqual(result.garments.find((row) => row.legacy_id === "g_jacket")?.seasons, []);
    assert.equal(result.garments.find((row) => row.legacy_id === "g_jacket")?.image_path, `${PHASE0_UID}/g_jacket/o.jpg`);
    assert.equal(result.garments.find((row) => row.legacy_id === "g_jacket")?.thumb_path, `${PHASE0_UID}/g_jacket/t.jpg`);
    assert.equal(result.outfits.length, 1);
    assert.equal(result.droppedLooks.length, 2);
    assert.equal(result.outfits.length + result.droppedLooks.length, blob.looks.length);
    assert.deepEqual(result.droppedLooks.find((row) => row.id === "l3")?.missingIds, ["missing_a", "missing_b"]);
    assert.equal(result.wear.filter((row) => row.garment_legacy_id === "g_chino").length, 2);
    assert.equal(result.feedback.filter((row) => row.kind === "skip").every((row) => !("penalty" in row)), true);
    assert.equal(result.feedback.some((row) => row.source === "avoid" && row.garment_legacy_id === "g_loafer"), true);
    assert.equal(result.garments.some((row) => row.legacy_id === "g_gone"), false);
    assert.equal(outfitSlot({ id: "x", name: "Brown loafer", subtype: "loafer", category: "bottom" } as never), "footwear");
    assert.equal(outfitSlot({ id: "x", name: "Grey hoodie", subtype: "hoodie", category: "outerwear" } as never), "top");
    assert.equal(outfitSlot({ id: "x", name: "Navy cardigan", subtype: "cardigan", category: "top" } as never), "mid");
    assert.equal(LIVE_READ_SOURCE, "closet_meta");
    assert.deepEqual(
      inClosetIds([
        { legacy_id: "g_jacket", status: "in_closet", deleted_at: null, name: "Brown jacket", category: "outerwear" },
        { legacy_id: "g_old", status: "in_closet", deleted_at: "2026-01-01", name: "Old", category: "top" },
      ]),
      ["g_jacket"],
    );
    const existing = new Set(result.imagePaths.filter((path) => !path.endsWith("/t.jpg")));
    const misses = imageHeadFailures(result.imagePaths, existing);
    assert.ok(misses.every((path) => path.endsWith("/t.jpg")));
  });

  it("refuses a different account", () => {
    assert.throws(
      () => migrateClosetMeta({ garments: [], looks: [], journal: [] }, "c75ad8d2-6fa7-4910-9289-b28ddcd7e436"),
      /joe@prereal.com/,
    );
  });
});

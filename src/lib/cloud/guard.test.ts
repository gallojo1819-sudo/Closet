import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideBlobPut, planStoragePuts, shrinkGuard } from "./guard.ts";

describe("shrinkGuard", () => {
  const looks = (ids: string[]) => ids.map((id) => ({ id, garmentIds: ["a", "b", "c"] }));

  it("allows exactly two unexplained garments and exactly ten unexplained looks", () => {
    const guard = shrinkGuard({
      baseGarmentIds: ["a", "b", "c", "d"],
      baseLookIds: Array.from({ length: 12 }, (_, i) => `l${i}`),
      baseLooks: looks(Array.from({ length: 12 }, (_, i) => `l${i}`)),
      nextGarmentIds: ["a", "b"],
      nextLookIds: ["l0", "l1"],
      deletedGarments: [],
      deletedLooks: [],
    });
    assert.equal(guard.ok, true);
  });

  it("explains a look that only existed because a deleted garment was in it", () => {
    const guard = shrinkGuard({
      baseGarmentIds: ["a", "b", "gone"],
      baseLookIds: ["stay", "die"],
      baseLooks: [
        { id: "stay", garmentIds: ["a", "b"] },
        { id: "die", garmentIds: ["gone", "a"] },
      ],
      nextGarmentIds: ["a", "b"],
      nextLookIds: ["stay"],
      deletedGarments: ["gone"],
      deletedLooks: [],
    });
    assert.equal(guard.ok, true);
  });

  it("refuses a drop of three garments or eleven looks", () => {
    const garments = shrinkGuard({
      baseGarmentIds: ["a", "b", "c", "d", "e"],
      baseLookIds: [],
      nextGarmentIds: ["a", "b"],
      nextLookIds: [],
      deletedGarments: [],
      deletedLooks: [],
    });
    assert.equal(garments.ok, false);
    const looks = shrinkGuard({
      baseGarmentIds: ["a"],
      baseLookIds: Array.from({ length: 11 }, (_, i) => `l${i}`),
      baseLooks: Array.from({ length: 11 }, (_, i) => ({ id: `l${i}`, garmentIds: ["a", "b"] })),
      nextGarmentIds: ["a"],
      nextLookIds: [],
      deletedGarments: [],
      deletedLooks: [],
    });
    assert.equal(looks.ok, false);
  });
});

describe("planStoragePuts", () => {
  const existing = new Set(["u/g1/o.jpg", "u/g1/c.jpg", "u/g1/t.jpg"]);

  it("an open, focus, reroll, or render puts nothing", () => {
    for (const reason of ["open", "focus", "reroll", "render"] as const) {
      assert.deepEqual(
        planStoragePuts({ reason, userId: "u", garments: [{ id: "g1" }, { id: "g2" }], existing: new Set() }),
        [],
      );
    }
  });

  it("uploads only missing objects and never reputs an existing o/c/t", () => {
    const puts = planStoragePuts({
      reason: "backup",
      userId: "u",
      garments: [{ id: "g1" }, { id: "g2" }],
      existing,
    });
    assert.deepEqual(puts, ["u/g2/o.jpg", "u/g2/c.jpg", "u/g2/t.jpg"]);
    assert.equal(puts.some((path) => existing.has(path)), false);
    assert.deepEqual(
      planStoragePuts({ reason: "edit", userId: "u", garments: [{ id: "g1" }], existing }),
      [],
    );
  });
});

describe("decideBlobPut", () => {
  it("skips an object that already exists or was already sent", () => {
    assert.equal(decideBlobPut({ alreadyUploaded: false, remoteExists: true, hasLocalBlob: true }), "skip");
    assert.equal(decideBlobPut({ alreadyUploaded: true, remoteExists: false, hasLocalBlob: true }), "skip");
    assert.equal(decideBlobPut({ alreadyUploaded: false, remoteExists: false, hasLocalBlob: false }), "skip");
    assert.equal(decideBlobPut({ alreadyUploaded: false, remoteExists: false, hasLocalBlob: true }), "put");
  });
});

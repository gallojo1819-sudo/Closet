import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { changedKeys, keepSameRefs } from "./keep-refs.ts";

function closet() {
  return {
    garments: [{ id: "g1", name: "Navy oxford" }],
    looks: [{ id: "l1", garmentIds: ["g1", "g2"] }],
    journal: [{ date: "2026-11-14", garmentIds: ["g1"] }],
    drop: { date: "2026-11-14", garmentIds: ["g1", "g2"] },
    taste: { vetoes: [] as string[] },
  };
}

describe("keepSameRefs", () => {
  it("returns the same references when the JSON matches, and no changed keys", () => {
    const cur = closet();
    const next = JSON.parse(JSON.stringify(cur)) as ReturnType<typeof closet>;
    const kept = keepSameRefs(cur, next);
    assert.equal(kept.garments, cur.garments);
    assert.equal(kept.looks, cur.looks);
    assert.equal(kept.journal, cur.journal);
    assert.equal(kept.drop, cur.drop);
    assert.equal(kept.taste, cur.taste);
    assert.deepEqual(changedKeys(cur, next), []);
  });

  it("returns a new garments array only when one garment field changes", () => {
    const cur = closet();
    const next = JSON.parse(JSON.stringify(cur)) as ReturnType<typeof closet>;
    next.garments[0]!.name = "Blue oxford";
    const kept = keepSameRefs(cur, next);
    assert.equal(kept.garments, next.garments);
    assert.notEqual(kept.garments, cur.garments);
    assert.equal(kept.looks, cur.looks);
    assert.equal(kept.journal, cur.journal);
    assert.equal(kept.drop, cur.drop);
    assert.equal(kept.taste, cur.taste);
    assert.deepEqual(changedKeys(cur, next), ["garments"]);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildLookbook, mergeLookbook, lookbookStats } from "./lookbook.ts";
import type { Garment, Look } from "./types.ts";

function piece(
  partial: Pick<Garment, "id" | "name" | "category" | "subtype"> & Partial<Garment>,
): Garment {
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

function closet(nTop: number, nBottom: number, nShoe: number, extra: Garment[] = []): Garment[] {
  const tops = Array.from({ length: nTop }, (_, i) =>
    piece({ id: `t${i + 1}`, name: `Oxford ${i + 1}`, category: "top", subtype: "oxford" }),
  );
  const bottoms = Array.from({ length: nBottom }, (_, i) =>
    piece({ id: `b${i + 1}`, name: `Chino ${i + 1}`, category: "bottom", subtype: "chino" }),
  );
  const shoes = Array.from({ length: nShoe }, (_, i) =>
    piece({
      id: `s${i + 1}`,
      name: i === 0 ? "Navy loafers" : `Mule ${i + 1}`,
      category: i === 0 ? "other" : "footwear",
      subtype: i === 0 ? "loafer" : "mule",
    }),
  );
  return [...tops, ...bottoms, ...shoes, ...extra];
}

describe("buildLookbook", () => {
  it("5×5×5 yields ~15–30 looks, every id used, not 125", () => {
    const g = closet(5, 5, 5);
    const looks = buildLookbook(g, "2026-09-12");
    assert.ok(looks.length >= 5 && looks.length <= 30, `looks=${looks.length}`);
    assert.ok(looks.length < 125);
    const ids = new Set(g.map((x) => x.id));
    const used = new Set(looks.flatMap((l) => l.garmentIds));
    for (const id of ids) assert.ok(used.has(id), `missing ${id}`);
    const stats = lookbookStats(looks, g);
    assert.equal(stats.pieces, 15);
    assert.equal(stats.everyPieceUsed, true);
    for (const l of looks) {
      assert.equal(l.lookbook, true);
      assert.equal(l.source, "ai");
      assert.ok(l.garmentIds.length >= 3);
    }
  });

  it("adding a 6th top includes it without wiping a saved outfit", () => {
    const g15 = closet(5, 5, 5);
    const saved: Look = {
      id: "l_saved",
      name: "Saturday market",
      occasion: "weekend",
      garmentIds: ["t1", "b1", "s1"],
      source: "manual",
      createdAt: "2026-09-01T12:00:00.000Z",
    };
    const first = mergeLookbook([saved], buildLookbook(g15, "2026-09-12"));
    assert.ok(first.some((l) => l.id === "l_saved"));
    const g16 = [
      ...g15,
      piece({ id: "t6", name: "Grey polo", category: "top", subtype: "polo" }),
    ];
    const second = mergeLookbook(
      first,
      buildLookbook(g16, "2026-09-12"),
    );
    assert.ok(second.some((l) => l.id === "l_saved" && l.source === "manual"));
    const book = second.filter((l) => l.lookbook);
    assert.ok(
      book.some((l) => l.garmentIds.includes("t6")),
      "new top must appear in lookbook",
    );
  });

  it("empty without a full weekday trio", () => {
    assert.equal(buildLookbook(closet(5, 5, 0)).length, 0);
  });
});

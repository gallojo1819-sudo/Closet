import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isFakeName, nameFromPixels, scrubLooks, scrubRack } from "./rack.ts";
import type { Garment, Look } from "./types.ts";

function g(
  partial: Pick<Garment, "id" | "name"> & Partial<Garment>,
): Garment {
  return {
    category: "top",
    subtype: "shirt",
    colors: ["navy"],
    material: "cotton",
    brand: "",
    notes: "",
    formality: 3,
    warmth: 2,
    seasons: [],
    imageSrc: "/x.jpg",
    cutoutSrc: "/x.jpg",
    imageSource: "photo",
    matteQuality: "ok",
    demo: false,
    archived: false,
    wornOn: [],
    createdAt: "2026-01-01T12:00:00.000Z",
    ...partial,
  };
}

describe("scrubRack", () => {
  it("drops demo rows when real pieces exist", () => {
    const real = g({ id: "r1", name: "Navy oxford", demo: false });
    const demo = g({ id: "d1", name: "Sample mule", demo: true, category: "footwear" });
    const looks: Look[] = [
      {
        id: "l1",
        name: "Navy oxford · Sample mule",
        occasion: "weekday",
        garmentIds: ["r1", "d1", "missing"],
        source: "ai",
        lookbook: true,
        createdAt: "2026-09-01T00:00:00.000Z",
      },
      {
        id: "l2",
        name: "ok",
        occasion: "weekday",
        garmentIds: ["r1", "r1"],
        source: "ai",
        lookbook: true,
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ];
    const next = scrubRack({
      garments: [real, demo],
      looks,
      drop: {
        date: "2026-09-14",
        garmentIds: ["r1", "d1"],
        worn: false,
        lockedIds: ["d1"],
      },
      journal: [{ date: "2026-09-13", garmentIds: ["d1"], verdict: "worn" }],
      seenLooks: { weekday: ["r1|d1", "r1|x"] },
    });
    assert.equal(next.garments.every((x) => x.demo !== true), true);
    assert.deepEqual(next.purgedIds, ["d1"]);
    assert.ok(!next.looks.some((l) => l.garmentIds.includes("d1")));
    assert.ok(!next.looks.some((l) => l.id === "l1"));
    assert.ok(!next.drop || !next.drop.garmentIds.includes("d1"));
  });

  it("same fileHash and name archives the newer and rewrites looks", () => {
    const a = g({
      id: "old",
      name: "Navy chino",
      fileHash: "abc",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const b = g({
      id: "new",
      name: "Navy chino",
      fileHash: "abc",
      createdAt: "2026-06-01T00:00:00.000Z",
    });
    const c = g({
      id: "other",
      name: "Navy chino",
      fileHash: "zzz",
      createdAt: "2026-03-01T00:00:00.000Z",
    });
    const next = scrubRack({
      garments: [a, b, c],
      looks: [
        {
          id: "l1",
          name: "pair",
          occasion: "weekday",
          garmentIds: ["new", "other"],
          source: "ai",
          createdAt: "t",
        },
      ],
      drop: null,
      journal: [],
    });
    assert.equal(next.garments.find((x) => x.id === "new")?.archived, true);
    assert.equal(next.garments.find((x) => x.id === "old")?.archived, false);
    assert.equal(next.garments.find((x) => x.id === "other")?.archived, false);
    assert.deepEqual(next.looks[0]?.garmentIds, ["old", "other"]);
  });
});

describe("isFakeName", () => {
  it("bans piece, IMG_, empty", () => {
    assert.equal(isFakeName("Khaki piece"), true);
    assert.equal(isFakeName("IMG_1234"), true);
    assert.equal(isFakeName(""), true);
    assert.equal(isFakeName("Navy oxford"), false);
  });
});

describe("nameFromPixels", () => {
  it("retitles Khaki piece from cream + navy to Cream varsity", () => {
    const name = nameFromPixels(
      { category: "outerwear", subtype: "jacket", name: "Khaki piece" },
      ["cream", "navy"],
    );
    assert.equal(name, "Cream varsity");
  });
});

describe("scrubLooks", () => {
  it("drops missing ids and looks with fewer than 2 pieces", () => {
    const allowed = new Set(["a", "b"]);
    const looks: Look[] = [
      {
        id: "1",
        name: "x",
        occasion: "weekday",
        garmentIds: ["a", "ghost", "b"],
        source: "ai",
        createdAt: "t",
      },
      {
        id: "2",
        name: "y",
        occasion: "weekday",
        garmentIds: ["ghost"],
        source: "ai",
        createdAt: "t",
      },
    ];
    const next = scrubLooks(looks, allowed);
    assert.equal(next.length, 1);
    assert.deepEqual(next[0]!.garmentIds, ["a", "b"]);
  });
});

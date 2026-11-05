import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LIVE_SNAPSHOT_COUNT, liveSnapshot } from "./__fixtures__/snapshot.ts";
import { pickDrop } from "./drop-pick.ts";
import { dressAcrossOccasions, dressThisPiece } from "./dress.ts";
import { buildLookbook, buildWeek, coverUnused, looksForHero } from "./lookbook.ts";
import { isUnslottedLock, slotOf } from "./style.ts";
import type { Garment, Occasion } from "./types.ts";

const OCCASIONS = ["weekday", "out", "weekend", "travel", "comfy"] as const satisfies readonly Occasion[];

function byId(pieces: readonly Garment[]): Map<string, Garment> {
  return new Map(pieces.map((g) => [g.id, g]));
}

function inSlot(ids: readonly string[], map: Map<string, Garment>, slot: "footwear" | "bottom" | "top") {
  return ids
    .map((id) => map.get(id))
    .filter((g): g is Garment => {
      if (!g) return false;
      const s = slotOf(g);
      if (slot === "top") return s === "top" || s === "dress";
      return s === slot;
    });
}

function assertOnlyAnchor(
  ids: readonly string[],
  map: Map<string, Garment>,
  anchor: Garment,
  slot: "footwear" | "bottom" | "top",
  where: string,
) {
  assert.ok(ids.includes(anchor.id), `${where}: missing ${anchor.id}`);
  const same = inSlot(ids, map, slot);
  assert.equal(same.length, 1, `${where}: ${slot} count ${same.length}`);
  assert.equal(same[0]?.id, anchor.id, where);
}

describe("new piece anchor", () => {
  it("counts the snapshot instead of a fixed closet size", () => {
    assert.equal(liveSnapshot.length, LIVE_SNAPSHOT_COUNT);
    assert.ok(LIVE_SNAPSHOT_COUNT > 0);
  });

  it("a footwear anchor is the only shoe in every hero look and every occasion that dresses", () => {
    const donor = liveSnapshot.find((g) => slotOf(g) === "footwear" && /loafer/i.test(`${g.subtype} ${g.name}`));
    assert.ok(donor);
    const anchor: Garment = {
      ...donor,
      id: "g_anchor_loafers",
      name: "Brown suede horsebit loafers",
      category: "footwear",
      subtype: "loafers",
      colors: ["brown"],
      material: "suede",
      notes: "",
      brand: "",
    };
    const rack = [...liveSnapshot, anchor];
    const map = byId(rack);
    const looks = looksForHero(anchor, rack);
    assert.ok(looks.length >= 3, `hero looks ${looks.length}`);
    for (const look of looks) assertOnlyAnchor(look.garmentIds, map, anchor, "footwear", look.id);
    const dressed: Occasion[] = [];
    for (const occasion of OCCASIONS) {
      const look = dressThisPiece({ lockedIds: [anchor.id], garments: rack, occasion });
      if (!look) continue;
      dressed.push(occasion);
      assertOnlyAnchor(look.garmentIds, map, anchor, "footwear", occasion);
    }
    assert.ok(dressed.length >= 1, "no occasion dressed the shoe");
    const across = dressAcrossOccasions({ lockedIds: [anchor.id], garments: rack, occasion: "out" });
    assert.ok(across);
    assertOnlyAnchor(across.garmentIds, map, anchor, "footwear", "outfit");
  });

  it("every snapshot shoe is the only shoe in its looks", () => {
    const map = byId(liveSnapshot);
    const shoes = liveSnapshot.filter((g) => slotOf(g) === "footwear");
    assert.ok(shoes.length > 0);
    const lines = ["id\tlooks\tone-shoe\toutfit"];
    let withLooks = 0;
    for (const shoe of shoes) {
      const looks = looksForHero(shoe, liveSnapshot);
      let one = 0;
      for (const look of looks) {
        const feet = inSlot(look.garmentIds, map, "footwear");
        assert.equal(feet.length, 1, `${shoe.id} ${look.id} shoes ${feet.length}`);
        assert.equal(feet[0]?.id, shoe.id, shoe.id);
        one += 1;
      }
      const outfit = dressAcrossOccasions({ lockedIds: [shoe.id], garments: liveSnapshot, occasion: "out" });
      if (outfit) assertOnlyAnchor(outfit.garmentIds, map, shoe, "footwear", `${shoe.id} outfit`);
      if (looks.length >= 1) withLooks += 1;
      lines.push(`${shoe.id}\t${looks.length}\t${one}\t${outfit ? "yes" : "no"}`);
    }
    lines.push(`dressed with >=1 look: ${withLooks} of ${shoes.length}`);
    console.log(lines.join("\n"));
    assert.equal(lines.length, shoes.length + 2);
    assert.ok(withLooks <= shoes.length);
  });

  it("a top anchor is the only top, and a bottom anchor the only bottom", () => {
    const map = byId(liveSnapshot);
    const top = liveSnapshot.find((g) => slotOf(g) === "top");
    const bottom = liveSnapshot.find((g) => slotOf(g) === "bottom");
    assert.ok(top && bottom);
    const topLooks = looksForHero(top, liveSnapshot);
    assert.ok(topLooks.length >= 1, top.name);
    for (const look of topLooks) {
      assertOnlyAnchor(look.garmentIds, map, top, "top", look.id);
      assert.ok(look.garmentIds.includes(top.id));
    }
    const bottomLooks = looksForHero(bottom, liveSnapshot);
    assert.ok(bottomLooks.length >= 1, bottom.name);
    for (const look of bottomLooks) assertOnlyAnchor(look.garmentIds, map, bottom, "bottom", look.id);
    const topOutfit = dressAcrossOccasions({ lockedIds: [top.id], garments: liveSnapshot, occasion: "weekday" });
    const bottomOutfit = dressAcrossOccasions({ lockedIds: [bottom.id], garments: liveSnapshot, occasion: "weekday" });
    assert.ok(topOutfit && bottomOutfit);
    assertOnlyAnchor(topOutfit.garmentIds, map, top, "top", "top outfit");
    assertOnlyAnchor(bottomOutfit.garmentIds, map, bottom, "bottom", "bottom outfit");
  });

  it("an unnamed other piece is in no look", () => {
    const row: Garment = {
      id: "g_jih4sve2486d",
      name: "New piece",
      category: "other",
      subtype: "",
      colors: [],
      material: "",
      brand: "",
      notes: "Already a catalog shot — centered on paper, pixels untouched.",
      formality: 3,
      warmth: 3,
      seasons: [],
      imageSrc: "",
      cutoutSrc: "",
      imageSource: "official",
      matteQuality: "ok",
      demo: false,
      archived: false,
      wornOn: [],
      createdAt: "2026-10-23T16:40:00.000Z",
    };
    assert.equal(slotOf(row), null);
    assert.equal(isUnslottedLock(row), true);
    const rack = [...liveSnapshot, row];
    const map = byId(rack);
    assert.equal(looksForHero(row, rack).length, 0);
    assert.equal(dressAcrossOccasions({ lockedIds: [row.id], garments: rack, occasion: "out" }), null);
    const book = coverUnused(rack, [...buildWeek(rack, "2026-10-23"), ...buildLookbook(rack, "2026-10-23")]);
    const today = pickDrop(rack, { f: 58, label: "Cool", code: 2 }, "weekday");
    const looks = [...book.map((l) => l.garmentIds), today];
    for (const ids of looks) {
      assert.equal(ids.includes(row.id), false);
      for (const id of ids) {
        const g = map.get(id);
        if (g) assert.equal(isUnslottedLock(g), false, `${g.id} ${g.name}`);
      }
    }
  });
});

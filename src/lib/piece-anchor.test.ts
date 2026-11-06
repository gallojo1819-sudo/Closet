import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LIVE_SNAPSHOT_COUNT, liveSnapshot } from "./__fixtures__/snapshot.ts";
import { pickDrop } from "./drop-pick.ts";
import { dressAcrossOccasions, dressThisPiece } from "./dress.ts";
import { buildLookbook, buildWeek, coverUnused, looksForHero } from "./lookbook.ts";
import { isUnslottedLock, slotOf, wornRole } from "./style.ts";
import type { Garment, Occasion } from "./types.ts";

const PINNED = "2026-11-05";

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
  const pieces = ids.map((id) => map.get(id)).filter((g): g is Garment => Boolean(g));
  if (slot === "top") {
    const role = wornRole(anchor, pieces);
    const same = pieces.filter((g) => wornRole(g, pieces) === role);
    assert.equal(same.length, 1, `${where}: ${role} count ${same.length}`);
    assert.equal(same[0]?.id, anchor.id, where);
    return;
  }
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
    const looks = looksForHero(anchor, rack, { today: PINNED });
    assert.ok(looks.length >= 3, `hero looks ${looks.length}`);
    for (const look of looks) assertOnlyAnchor(look.garmentIds, map, anchor, "footwear", look.id);
    const dressed: Occasion[] = [];
    for (const occasion of OCCASIONS) {
      const look = dressThisPiece({ lockedIds: [anchor.id], garments: rack, occasion, today: PINNED });
      if (!look) continue;
      dressed.push(occasion);
      assertOnlyAnchor(look.garmentIds, map, anchor, "footwear", occasion);
    }
    assert.ok(dressed.length >= 1, "no occasion dressed the shoe");
    const across = dressAcrossOccasions({ lockedIds: [anchor.id], garments: rack, occasion: "out", today: PINNED });
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
      const looks = looksForHero(shoe, liveSnapshot, { today: PINNED });
      let one = 0;
      for (const look of looks) {
        const feet = inSlot(look.garmentIds, map, "footwear");
        assert.equal(feet.length, 1, `${shoe.id} ${look.id} shoes ${feet.length}`);
        assert.equal(feet[0]?.id, shoe.id, shoe.id);
        one += 1;
      }
      const outfit = dressAcrossOccasions({ lockedIds: [shoe.id], garments: liveSnapshot, occasion: "out", today: PINNED });
      if (outfit) assertOnlyAnchor(outfit.garmentIds, map, shoe, "footwear", `${shoe.id} outfit`);
      if (looks.length >= 1) withLooks += 1;
      lines.push(`${shoe.id}\t${looks.length}\t${one}\t${outfit ? "yes" : "no"}`);
    }
    lines.push(`dressed with >=1 look: ${withLooks} of ${shoes.length}`);
    console.log(lines.join("\n"));
    assert.equal(lines.length, shoes.length + 2);
    assert.equal(withLooks, shoes.length);
  });

  it("a top anchor is the only top, and a bottom anchor the only bottom", () => {
    const map = byId(liveSnapshot);
    const top = liveSnapshot.find((g) => slotOf(g) === "top");
    const bottom = liveSnapshot.find((g) => slotOf(g) === "bottom");
    assert.ok(top && bottom);
    const topLooks = looksForHero(top, liveSnapshot, { today: PINNED });
    assert.ok(topLooks.length >= 1, top.name);
    for (const look of topLooks) {
      assertOnlyAnchor(look.garmentIds, map, top, "top", look.id);
      assert.ok(look.garmentIds.includes(top.id));
    }
    const bottomLooks = looksForHero(bottom, liveSnapshot, { today: PINNED });
    assert.ok(bottomLooks.length >= 1, bottom.name);
    for (const look of bottomLooks) assertOnlyAnchor(look.garmentIds, map, bottom, "bottom", look.id);
    const topOutfit = dressAcrossOccasions({ lockedIds: [top.id], garments: liveSnapshot, occasion: "weekday", today: PINNED });
    const bottomOutfit = dressAcrossOccasions({ lockedIds: [bottom.id], garments: liveSnapshot, occasion: "weekday", today: PINNED });
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
    assert.equal(looksForHero(row, rack, { today: PINNED }).length, 0);
    assert.equal(dressAcrossOccasions({ lockedIds: [row.id], garments: rack, occasion: "out", today: PINNED }), null);
    const book = coverUnused(rack, [...buildWeek(rack, "2026-10-23"), ...buildLookbook(rack, "2026-10-23")]);
    const today = pickDrop(rack, { f: 58, label: "Cool", code: 2 }, "weekday", {}, new Date("2026-11-05T15:00:00.000Z"));
    const looks = [...book.map((l) => l.garmentIds), today];
    for (const ids of looks) {
      assert.equal(ids.includes(row.id), false);
      for (const id of ids) {
        const g = map.get(id);
        if (g) assert.equal(isUnslottedLock(g), false, `${g.id} ${g.name}`);
      }
    }
  });

  it("top-role pieces keep a hero look on the dates a dual-role layer used to wipe", () => {
    /* On base 6f3206bb every top-role piece in this snapshot has 5 hero looks on each of these days. */
    const days = ["2026-10-08", "2026-11-03", "2026-11-05"] as const;
    const named = new Set([
      "g_qn51qgub6tu3",
      "g_8m17f0l0tss9",
      "g_i2191l774tad",
      "g_mq1ob9uc1npn",
      "g_o739106dt8ym",
    ]);
    /* Ids with at least one hero look on base 6f3206bb, measured for these three days (each had 5). */
    const baseIds = [
      "g_1gb6slz8h71n", "g_1khiworawkt7", "g_1zteshjh31ac", "g_21b6d3qcohmu", "g_2b6fao81vqrs",
      "g_2rtuat7aheik", "g_3821acdhupu9", "g_6lolc7ma0mk8", "g_6qz38nwsrupx", "g_6uhygeskozw8",
      "g_7iyagp6doqqz", "g_7z48xpoqh5tx", "g_8m17f0l0tss9", "g_939onlwfrg9j", "g_9eip7wdtsxzd",
      "g_9t24uvtl10wd", "g_ap5v0s67pg9d", "g_bq9qnaa1vkon", "g_d1awqw83gd3c", "g_dk92xcrfjmq8",
      "g_dsqnx6ckt81v", "g_e0tjgy0tzq08", "g_e4y3rjpn57gj", "g_gp53xkrmem9b", "g_h7dy95xdgnh8",
      "g_hslm9n4nmc79", "g_i2191l774tad", "g_i80zb0yen5gn", "g_j1n1vh1wvbo4", "g_j4qu90fgv347",
      "g_j5og5jmzh5tx", "g_jhyr10t2vo13", "g_kh5r3xy9r1i5", "g_ko7zz8iktplc", "g_kp1ps7qww1ar",
      "g_m7bg5j5z10wc", "g_mir3akjyhwnr", "g_mpvyy87tse1c", "g_mq1ob9uc1npn", "g_mqjsmpqgwwvm",
      "g_n955igwlvcl4", "g_o739106dt8ym", "g_oimadifuvalb", "g_pa7kfg14rtzl", "g_q3e47jxb10wb",
      "g_qn51qgub6tu3", "g_qrx875pbmh6n", "g_reesb6nbrmm4", "g_ri78lj9vspyj", "g_rpjfgscii90r",
      "g_salzdhuswyd3", "g_sxxi5soxomf3", "g_szj91ziihfpw", "g_teatot7o1lst", "g_teitg9jmpwxa",
      "g_tosucnfv40wc", "g_tqnnde1xmp0p", "g_ttw2m97ww8z5", "g_u0f8e90jp3ez", "g_u1ujhidqsibg",
      "g_ugyaieefqcxe", "g_upplq59rp8lp", "g_v2gxktsmsoov", "g_v7uvadckh79p", "g_vzqle7zdtpis",
      "g_xbt3gpjuo1p4", "g_xowln4uos3ug", "g_xuqvrfy5ocv4", "g_yo7mwga1xi3m", "g_z6syv3lx30tn",
      "g_z7nhuz8vidky", "g_z8gvd1zvrcif", "g_zc85ll18q9kn", "g_zzrq3j5n2njk",
    ];
    const tops = baseIds
      .map((id) => liveSnapshot.find((g) => g.id === id))
      .filter((g): g is Garment => Boolean(g));
    const map = byId(liveSnapshot);
    assert.equal(tops.length, baseIds.length);
    for (const id of named) assert.ok(tops.some((g) => g?.id === id), id);
    for (const day of days) {
      const lines = [`${day}\tpiece\tbase\tbranch`];
      for (const g of tops) {
        const looks = looksForHero(g, liveSnapshot, { today: day });
          assert.ok(looks.length >= 1, `${day} ${g.id} ${g.name}: ${looks.length}`);
          if (named.has(g.id)) assert.ok(looks.length >= 3, `${day} ${g.id} ${g.name}: ${looks.length}`);
          for (const look of looks) {
            const pieces = look.garmentIds.map((id) => map.get(id)).filter((p): p is Garment => Boolean(p));
            const role = wornRole(g, pieces);
            const same = pieces.filter((p) => wornRole(p, pieces) === role);
            assert.equal(same.length, 1, `${day} ${g.id} ${look.id} role ${role} × ${same.length}`);
            assert.equal(same[0]?.id, g.id, `${day} ${g.id} ${look.id}`);
          }
        lines.push(`${day}\t${g.name} (${g.id})\t5\t${looks.length}`);
      }
      console.log(lines.join("\n"));
    }
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReshuffleRow } from "./lookbook.ts";
import { lookTuck, pickLook, slotOf } from "./style.ts";
import {
  applyAtlas,
  emptyTaste,
  learnFromAsk,
  leftOffLine,
  techniqueLine,
  techniqueWeight,
  type TasteMemory,
  type TasteVeto,
} from "./taste.ts";
import { tuckDressingLines } from "./tuck.ts";
import type { Garment } from "./types.ts";

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

function tasteWith(weight: number, vetoes: TasteVeto[] = []): TasteMemory {
  const base = emptyTaste();
  return {
    ...base,
    vetoes,
    techniques: base.techniques.map((t) =>
      t.id === "workwear-stack" ? { ...t, weight } : t,
    ),
  };
}

const day = {
  occasion: "weekday" as const,
  moment: "day" as const,
  weather: { f: 55, label: "Cool", code: 3 },
  previousIds: ["none"],
  legalCombo: () => true,
};

describe("Atlas dresses Today and Lookbook", () => {
  const oxford = piece({ id: "ox", name: "White oxford", category: "top", subtype: "oxford" });
  const chino = piece({ id: "ch", name: "Khaki chinos", category: "bottom", subtype: "chino" });
  const loafer = piece({ id: "lf", name: "Navy loafers", category: "footwear", subtype: "loafer" });
  const field = piece({
    id: "field",
    name: "field jacket",
    category: "outerwear",
    subtype: "field jacket",
    formality: 2,
  });
  const blazer = piece({
    id: "navy",
    name: "Navy blazer",
    category: "outerwear",
    subtype: "blazer",
    imageSrc: "sb:u/blazer/o.jpg",
    cutoutSrc: "sb:u/blazer/c.jpg",
    plated: true,
    notes: "keep the navy plate",
  });
  const toggle = piece({
    id: "toggle",
    name: "White beige toggle jacket",
    category: "outerwear",
    subtype: "toggle",
    imageSrc: "sb:u/toggle/o.jpg",
    cutoutSrc: "sb:u/toggle/c.jpg",
    plated: true,
    notes: "keep the toggle plate",
  });

  it("a piece veto removes that jacket from an unlocked weekday pick", () => {
    const rack = [oxford, chino, loafer, field];
    const open = pickLook(rack, day);
    assert.ok(open.includes("field"), `unlocked pick dropped the jacket: ${open.join(",")}`);
    const vetoed = pickLook(rack, {
      ...day,
      taste: tasteWith(0, [{ kind: "piece", id: "field" }]),
    });
    assert.ok(!vetoed.includes("field"), `veto kept the jacket: ${vetoed.join(",")}`);
    assert.ok(vetoed.includes("ox") && vetoed.includes("ch") && vetoed.includes("lf"));
  });

  it("a pairing veto is not returned when another top and shoe exist", () => {
    const hoodie = piece({
      id: "hd",
      name: "Black hoodie",
      category: "top",
      subtype: "hoodie",
      formality: 2,
    });
    const jeans = piece({
      id: "jn",
      name: "Indigo jeans",
      category: "bottom",
      subtype: "jean",
      formality: 2,
    });
    const sneaker = piece({
      id: "sn",
      name: "White sneakers",
      category: "footwear",
      subtype: "sneaker",
      formality: 2,
    });
    const rack = [hoodie, oxford, jeans, chino, loafer, sneaker];
    const weekend = {
      occasion: "weekend" as const,
      moment: "day" as const,
      weather: { f: 64, label: "Fair", code: 2 },
      previousIds: ["none"],
      legalCombo: () => true,
    };
    const blocked = tasteWith(0, [{ kind: "pairing", a: "hoodie", b: "loafer" }]);
    for (let salt = 1; salt <= 6; salt++) {
      const ids = pickLook(rack, { ...weekend, salt, taste: blocked });
      const names = ids.map((id) => rack.find((g) => g.id === id)?.name ?? "").join(" ");
      assert.equal(/hoodie/i.test(names) && /loafer/i.test(names), false, names);
    }
    const rowA = buildReshuffleRow(rack, "weekend", { salt: 1, cap: 8, season: "fall", taste: blocked });
    const rowB = buildReshuffleRow(rack, "weekend", { salt: 9, cap: 8, season: "fall", taste: blocked });
    assert.ok(rowA.length >= 1 && rowB.length >= 1);
    for (const look of [...rowA, ...rowB]) {
      const names = look.garmentIds.map((id) => rack.find((g) => g.id === id)?.name ?? "").join(" ");
      assert.equal(/hoodie/i.test(names) && /loafer/i.test(names), false, names);
    }
  });

  it("never-tuck keeps the shirt and does not tuck it", () => {
    const shirt = piece({ id: "ox", name: "White oxford", category: "top", subtype: "oxford" });
    const rack = [shirt, chino, loafer];
    const taste = tasteWith(0, [{ kind: "habit", id: "ox", habit: "never tuck" }]);
    const ids = pickLook(rack, { ...day, taste });
    assert.ok(ids.includes("ox"), `shirt was dropped: ${ids.join(",")}`);
    const pieces = ids.map((id) => rack.find((g) => g.id === id)!);
    assert.equal(lookTuck(shirt, "weekday", pieces, taste), "out");
    assert.equal(shirt.tuck, undefined);
    const line = tuckDressingLines(pieces, "weekday", ["ox"]);
    assert.match(line, /UNTUCKED/);
    assert.equal(/Tuck THIS shirt/.test(line), false);
  });

  it("weight 3 on workwear stack beats an equal look that is not that stack", () => {
    const flannel = piece({
      id: "fl",
      name: "Grey flannel shirt",
      category: "top",
      subtype: "flannel",
      formality: 3,
    });
    const jeans = piece({
      id: "jn",
      name: "Indigo jeans",
      category: "bottom",
      subtype: "jean",
      formality: 3,
    });
    const boots = piece({
      id: "bt",
      name: "Brown boots",
      category: "footwear",
      subtype: "boot",
      formality: 3,
    });
    const bomber = piece({
      id: "bm",
      name: "Black bomber",
      category: "outerwear",
      subtype: "bomber",
      formality: 3,
    });
    const rack = [flannel, oxford, jeans, chino, boots, loafer, field, bomber];
    const quiet = pickLook(rack, { ...day, taste: tasteWith(0) });
    const loud = pickLook(rack, { ...day, taste: tasteWith(3) });
    const stack = (ids: string[]) => ids.includes("field") && ids.includes("jn") && ids.includes("bt");
    assert.equal(stack(quiet), false, `weight 0 forced the stack: ${quiet.join(",")}`);
    assert.ok(quiet.includes("ch") && quiet.includes("lf"), `weight 0 lost the equal look: ${quiet.join(",")}`);
    assert.equal(stack(loud), true, `weight 3 lost: ${loud.join(",")}`);
    assert.ok(!loud.includes("lf"), `weight 3 kept the loafer: ${loud.join(",")}`);
    const pieces = [field, flannel, jeans, boots];
    assert.equal(techniqueWeight(tasteWith(0), pieces), 0);
    assert.ok(techniqueWeight(tasteWith(3), pieces) > techniqueWeight(tasteWith(0), pieces));
    const only = pickLook([flannel, jeans, boots, field], { ...day, taste: tasteWith(0) });
    assert.ok(only.includes("fl") && only.includes("jn") && only.includes("bt") && only.includes("field"), `weight 0 banned the stack: ${only.join(",")}`);
    assert.equal(techniqueLine(tasteWith(0), pieces), null);
    assert.equal(
      techniqueLine(tasteWith(3), pieces),
      "Workwear stack. field jacket, Grey flannel shirt, Indigo jeans, Brown boots.",
    );
  });

  it("a locked piece stays even if it is vetoed", () => {
    const rack = [oxford, chino, loafer, field, blazer];
    const ids = pickLook(rack, {
      ...day,
      lockedIds: ["field"],
      taste: tasteWith(0, [{ kind: "piece", id: "field" }]),
    });
    assert.ok(ids.includes("field"), `lock lost to the veto: ${ids.join(",")}`);
    assert.equal(ids.filter((id) => id === "field").length, 1);
  });

  it("the navy blazer and toggle jacket are not rewritten", () => {
    const before = {
      blazer: { ...blazer },
      toggle: { ...toggle },
    };
    const rack = [oxford, chino, loafer, blazer, toggle, field];
    pickLook(rack, { ...day, taste: tasteWith(3, [{ kind: "piece", id: "field" }]) });
    buildReshuffleRow(rack, "weekday", {
      salt: 2,
      cap: 8,
      season: "fall",
      taste: tasteWith(3, [{ kind: "piece", id: "field" }]),
    });
    for (const g of [blazer, toggle] as const) {
      const snap = g.id === "navy" ? before.blazer : before.toggle;
      assert.equal(g.name, snap.name);
      assert.equal(g.subtype, snap.subtype);
      assert.equal(g.imageSrc, snap.imageSrc);
      assert.equal(g.cutoutSrc, snap.cutoutSrc);
      assert.equal(g.plated, snap.plated);
      assert.equal(g.notes, snap.notes);
      assert.equal(slotOf(g), "outerwear");
    }
  });

  it("a typed 'not the field jacket' leaves it off the next drop, in one line", () => {
    const rack = [oxford, chino, loafer, field, blazer];
    const skipped = ["field", "ox", "ch", "lf"];
    const taste = learnFromAsk(emptyTaste(), {
      text: "not the field jacket",
      garments: rack,
      previousIds: skipped,
      now: Date.parse("2026-10-03T15:00:00.000Z"),
    });
    const nextIds = pickLook(rack, { ...day, taste });
    assert.ok(!nextIds.includes("field"), `next drop kept the jacket: ${nextIds.join(",")}`);
    const next = nextIds.map((id) => rack.find((g) => g.id === id)!);
    const skippedPieces = skipped.map((id) => rack.find((g) => g.id === id)!);
    assert.equal(leftOffLine({ skipped: skippedPieces, next, taste }), "Left the field jacket off.");
  });

  it("a vetoed jacket does not fill three Lookbook cards", () => {
    const tops = [1, 2, 3].map((n) =>
      piece({ id: `t${n}`, name: `Oxford ${n}`, category: "top", subtype: "oxford" }),
    );
    const bottoms = [1, 2, 3].map((n) =>
      piece({ id: `b${n}`, name: `Chino ${n}`, category: "bottom", subtype: "chino" }),
    );
    const shoes = [1, 2, 3].map((n) =>
      piece({ id: `s${n}`, name: `Loafer ${n}`, category: "footwear", subtype: "loafer" }),
    );
    const vetoJacket = piece({
      id: "veto_blazer",
      name: "Olive field blazer",
      category: "outerwear",
      subtype: "blazer",
    });
    const other = piece({
      id: "other_blazer",
      name: "Taupe blazer",
      category: "outerwear",
      subtype: "blazer",
    });
    const rack = [...tops, ...bottoms, ...shoes, vetoJacket, other];
    const taste = tasteWith(0, [{ kind: "piece", id: "veto_blazer" }]);
    for (const salt of [1, 4, 11]) {
      const row = buildReshuffleRow(rack, "weekday", { salt, cap: 8, season: "fall", taste });
      assert.ok(row.length >= 3, `row ${salt} was ${row.length}`);
      const hits = row.filter((look) => look.garmentIds.includes("veto_blazer")).length;
      assert.ok(hits < 3, `salt ${salt} put the vetoed jacket on ${hits} cards`);
      assert.equal(hits, 0);
    }
    const houseLook = applyAtlas(
      [oxford, chino, loafer, vetoJacket],
      taste,
    );
    assert.deepEqual(
      houseLook?.map((g) => g.id),
      ["ox", "ch", "lf"],
    );
  });
});

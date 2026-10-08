import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cutoutsForOnYou, heroPieces, kitBand, kitCells, layersForOnMe, nameLook, spreadTitle, unwornLine } from "./look.ts";
import { readingToSnap } from "./weather.ts";
import type { Garment } from "./types.ts";

function g(
  partial: Pick<Garment, "id" | "name" | "category" | "subtype"> & Partial<Garment>,
): Garment {
  return {
    colors: ["navy"],
    material: "cotton",
    brand: "",
    notes: "",
    formality: 3,
    warmth: 2,
    seasons: [],
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

describe("cutoutsForOnYou", () => {
  it("does not send a jacket whose plate failed the check", () => {
    const look = [
      g({ id: "t", name: "Navy oxford", category: "top", subtype: "oxford" }),
      g({ id: "b", name: "Stone trouser", category: "bottom", subtype: "trouser" }),
      g({ id: "s", name: "Brown loafer", category: "footwear", subtype: "loafer" }),
      g({
        id: "j",
        name: "Brown suede jacket",
        category: "outerwear",
        subtype: "jacket",
        imageSrc: "photo://jacket",
        cutoutSrc: "",
        imageSource: "cutout",
        reprint: true,
      }),
    ];
    const plan = cutoutsForOnYou(look);
    assert.equal(plan.blocked, null);
    assert.equal(plan.skipped, "Brown suede jacket");
    assert.deepEqual(plan.layers.map((x) => x.id), ["t", "b", "s"]);
    assert.equal(plan.layers.some((x) => x.cutoutSrc === "photo://jacket"), false);
    const dirtyTop = cutoutsForOnYou([
      g({
        id: "t2",
        name: "Navy oxford",
        category: "top",
        subtype: "oxford",
        imageSrc: "photo://shirt",
        cutoutSrc: "photo://shirt",
        imageSource: "photo",
      }),
      look[1]!,
      look[2]!,
    ]);
    assert.equal(dirtyTop.blocked, "Navy oxford");
    assert.deepEqual(dirtyTop.layers, []);
    const onMe = readFileSync(new URL("../components/closet/on-me.tsx", import.meta.url), "utf8");
    const dress = onMe.slice(
      onMe.indexOf("export async function dressLook"),
      onMe.indexOf("export async function isLegsOnlyBody"),
    );
    assert.ok(dress.indexOf("plan.blocked") < dress.indexOf("onMePreview"));
    assert.ok(dress.indexOf("cutoutsForOnYou") < dress.indexOf("onMePreview"));
    assert.match(dress, /loadPlateCovers/);
    assert.equal(dress.includes("loadLookCovers"), false);
    assert.equal(dress.includes("imageSrc"), false);
  });
});

describe("layersForOnMe", () => {
  it("sends one knit, not fair isle fused with a 90s hoodie", () => {
    const look = [
      g({ id: "fair", name: "Cream fair isle", category: "top", subtype: "knit" }),
      g({ id: "hood", name: "Black 90s hoodie", category: "top", subtype: "hoodie" }),
      g({ id: "b", name: "Navy chinos", category: "bottom", subtype: "chino" }),
      g({ id: "s", name: "Brown loafers", category: "footwear", subtype: "loafer" }),
    ];
    const sent = layersForOnMe(look);
    const topIds = sent.filter((x) => x.category === "top" || /hoodie|knit|fair/i.test(x.name));
    const ids = sent.map((x) => x.id);
    assert.ok(ids.includes("b") && ids.includes("s"));
    assert.ok(ids.includes("fair"), `fair isle missing: ${ids.join(",")}`);
    assert.ok(!ids.includes("hood"), `90s hoodie sent with fair isle: ${ids.join(",")}`);
    assert.ok(topIds.length <= 2);
  });

  it("camp collar is the only top — no hoodie", () => {
    const look = [
      g({ id: "camp", name: "Linen camp collar", category: "top", subtype: "shirt" }),
      g({ id: "hood", name: "Black 90s hoodie", category: "outerwear", subtype: "hoodie" }),
      g({ id: "b", name: "Cream trousers", category: "bottom", subtype: "trouser" }),
      g({ id: "s", name: "Navy loafers", category: "footwear", subtype: "loafer" }),
    ];
    const sent = layersForOnMe(look);
    const ids = sent.map((x) => x.id);
    assert.ok(ids.includes("camp"));
    assert.ok(!ids.includes("hood"), `hoodie sent on camp collar: ${ids.join(",")}`);
  });

  it("does not send hoodie as a second outer on a knit", () => {
    const look = [
      g({ id: "flag", name: "Flag sweatshirt", category: "top", subtype: "sweatshirt" }),
      g({ id: "hood", name: "Navy hoodie", category: "outerwear", subtype: "hoodie" }),
      g({ id: "b", name: "Khaki chinos", category: "bottom", subtype: "chino" }),
      g({ id: "s", name: "White mules", category: "footwear", subtype: "mule" }),
    ];
    const sent = layersForOnMe(look);
    const ids = sent.map((x) => x.id);
    assert.equal(
      [ids.includes("flag"), ids.includes("hood")].filter(Boolean).length,
      1,
      `fused graphics: ${ids.join(",")}`,
    );
  });

  it("does not send a blazer when the look is three pieces", () => {
    const look = [
      g({ id: "polo", name: "Pink polo", category: "top", subtype: "polo" }),
      g({ id: "tr", name: "Blue trousers", category: "bottom", subtype: "trouser" }),
      g({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer" }),
      g({ id: "blz", name: "Navy blazer", category: "outerwear", subtype: "blazer" }),
    ];
    const three = layersForOnMe(look.slice(0, 3));
    assert.deepEqual(
      three.map((x) => x.id),
      ["polo", "tr", "lf"],
    );
    const four = layersForOnMe(look);
    assert.ok(four.some((x) => x.id === "blz"));
  });
});

describe("kitCells", () => {
  it("shows polo, trousers, blazer, loafers as four tiles", () => {
    const look = [
      g({ id: "polo", name: "Pink polo", category: "top", subtype: "polo" }),
      g({ id: "tr", name: "Blue trousers", category: "bottom", subtype: "trouser" }),
      g({ id: "blz", name: "Navy blazer", category: "outerwear", subtype: "blazer" }),
      g({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer" }),
    ];
    const cells = kitCells(look);
    assert.deepEqual(
      cells.map((x) => x.id),
      ["polo", "tr", "blz", "lf"],
    );
  });

  it("three pieces put footwear on the full second row", () => {
    const look = [
      g({ id: "polo", name: "Pink polo", category: "top", subtype: "polo" }),
      g({ id: "tr", name: "Blue trousers", category: "bottom", subtype: "trouser" }),
      g({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer" }),
    ];
    assert.deepEqual(
      kitCells(look).map((x) => x.id),
      ["polo", "tr", "lf"],
    );
  });
});

describe("heroPieces", () => {
  it("uses the strip look when that cell has a thumbnail", () => {
    const drop: Garment[] = [];
    const strip = [
      g({ id: "a", name: "Navy oxford", category: "top", subtype: "oxford" }),
      g({ id: "b", name: "Cream chino", category: "bottom", subtype: "chino" }),
      g({ id: "c", name: "Brown loafers", category: "footwear", subtype: "loafer" }),
    ];
    const hero = heroPieces(drop, strip);
    assert.equal(nameLook(drop), "Nothing on the rack");
    assert.notEqual(nameLook(hero), "Nothing on the rack");
    assert.deepEqual(hero.map((piece) => piece.id), ["a", "b", "c"]);
  });

  it("keeps the drop when the strip cell has no thumbnail", () => {
    const drop = [g({ id: "a", name: "Navy oxford", category: "top", subtype: "oxford" })];
    assert.equal(heroPieces(drop, []).length, 1);
    assert.equal(heroPieces([], [drop[0]!]).length, 0);
  });
});

describe("today agrees", () => {
  it("does not invent a temperature or a last-worn date", () => {
    assert.equal(readingToSnap(undefined, 2), null);
    assert.equal(readingToSnap(Number.NaN, 1), null);
    const snap = readingToSnap(74.2, 1);
    assert.equal(snap?.f, 74);
    assert.equal(snap?.measured, true);
    assert.equal(snap?.label, "Mostly clear");
    const never = g({
      id: "n",
      name: "Navy oxford",
      category: "top",
      subtype: "oxford",
      createdAt: "2020-01-01T00:00:00.000Z",
      wornOn: [],
    });
    const ago = new Date();
    ago.setUTCDate(ago.getUTCDate() - 40);
    const old = g({
      id: "o",
      name: "Grey flannel",
      category: "bottom",
      subtype: "trouser",
      wornOn: [ago.toISOString().slice(0, 10)],
    });
    assert.equal(unwornLine([never], []), null);
    assert.equal(unwornLine([old, never], []), "You haven't worn Grey flannel in 30 days.");
    assert.equal(unwornLine([old], ["o"]), null);
    const page = readFileSync(new URL("../routes/index.tsx", import.meta.url), "utf8");
    assert.equal(page.includes("heroPieces"), false);
    assert.match(page, /weekCells\.find\(\(c\) => c\.iso === today\)/);
    assert.match(page, /unwornLine/);
    assert.match(page, /Placeholder name/);
    assert.equal(page.includes("{ f: 68"), false);
  });
});

describe("kitBand", () => {
  // Flipped: Joe overruled the Sep 30 jacket call. The Khaki varsity is a crew-neck top.
  it("files the khaki varsity as a top, not a jacket", () => {
    const varsity = g({ id: "g_j5og5jmzh5tx", name: "Khaki varsity", category: "top", subtype: "" });
    assert.equal(kitBand(varsity), "top");
  });
});

describe("spreadTitle", () => {
  it("is editorial, not a SKU dump", () => {
    const look = [
      g({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford", colors: ["navy"] }),
      g({ id: "ch", name: "Cream chino", category: "bottom", subtype: "chino", colors: ["cream"] }),
      g({ id: "lf", name: "Brown loafers", category: "footwear", subtype: "loafer", colors: ["brown"] }),
    ];
    // A passed house no longer names the card: Joe took house names out of the UI.
    const HOUSE_NAMES = /\b(Polo|Purple Label|RRL|ALD|Faloni|545|Sweet Stable|Italian summer|Italian winter|Ralph)\b/;
    const week = spreadTitle(look, "weekday");
    assert.ok(!week.includes("Navy oxford ·"), week);
    assert.ok(/cream|navy|Quiet office/i.test(week), week);
    assert.equal(HOUSE_NAMES.test(week), false, week);
    const out = spreadTitle(look, "out");
    assert.ok(!out.includes("Navy oxford ·"), out);
    assert.ok(/cream|navy|Out/i.test(out), out);
    assert.equal(HOUSE_NAMES.test(out), false, out);
    const polo = spreadTitle(look, "weekday", "polo");
    assert.equal(polo.includes("Polo"), false, polo);
    assert.equal(HOUSE_NAMES.test(polo), false, polo);
  });
});

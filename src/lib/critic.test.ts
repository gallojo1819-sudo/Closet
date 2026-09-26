import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyCritic,
  badCriticName,
  clearCriticCache,
  criticCacheKey,
  criticKey,
  criticRows,
  CRITIC_SYSTEM,
  dropSharedTrios,
  fallbackChapter,
  holdsLine,
  judgeOnce,
  parseCriticVerdict,
} from "./critic.ts";
import { lookClashes, lookFitsOccasion } from "./lookbook.ts";
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
    imageSource: "photo",
    matteQuality: "ok",
    demo: false,
    archived: false,
    wornOn: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function look(id: string, ids: string[], occasion: string): Look {
  return {
    id,
    name: id,
    occasion,
    garmentIds: ids,
    source: "ai",
    lookbook: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const hoodie = piece({ id: "hd", name: "Grey hoodie", category: "top", subtype: "hoodie" });
const loafer = piece({ id: "lf", name: "Brown loafer", category: "footwear", subtype: "loafer" });
const trouser = piece({ id: "tr", name: "Grey trousers", category: "bottom", subtype: "trouser" });
const shirt = piece({ id: "ox", name: "Navy oxford", category: "top", subtype: "oxford" });
const jean = piece({ id: "jn", name: "Indigo jean", category: "bottom", subtype: "jean" });
const sneaker = piece({ id: "sn", name: "White sneaker", category: "footwear", subtype: "sneaker" });

describe("chapter critic", () => {
  it("a hoodie + loafer + trouser is not a weekday card", () => {
    const costume = [hoodie, trouser, loafer];
    assert.equal(lookClashes(costume), true);
    assert.equal(lookFitsOccasion(costume, "weekday"), false);
    const rows = [
      look("bad", ["hd", "tr", "lf"], "weekday"),
      look("good", ["ox", "tr", "lf"], "weekday"),
    ];
    const pool = [hoodie, loafer, trouser, shirt];
    const verdict = parseCriticVerdict(
      JSON.stringify({
        keep: ["ox,tr,lf"],
        reject: ["hd,tr,lf"],
        why: "Hoodie with loafers is a costume.",
      }),
    );
    assert.ok(verdict);
    const shown = applyCritic(rows, pool, verdict!);
    assert.equal(shown.some((l) => l.garmentIds.includes("hd")), false);
    assert.equal(shown.some((l) => criticKey(l.garmentIds) === criticKey(["ox", "tr", "lf"])), true);
  });

  it("a shirt + trouser + loafer can be a weekday card", () => {
    const row = [shirt, trouser, loafer];
    assert.equal(lookClashes(row), false);
    assert.equal(lookFitsOccasion(row, "weekday"), true);
    const shown = applyCritic(
      [look("good", ["ox", "tr", "lf"], "weekday")],
      [shirt, trouser, loafer],
      { keep: ["lf,ox,tr"], reject: [], why: "Ralph." },
    );
    assert.equal(shown.length, 1);
    assert.equal(holdsLine(shown.length), "1 look that holds.");
  });

  it("weekday and weekend are not the same three pieces", () => {
    const shared = look("w1", ["ox", "tr", "lf"], "weekday");
    const weekendSame = look("e1", ["ox", "tr", "lf"], "weekend");
    const weekendOther = look("e2", ["hd", "jn", "sn"], "weekend");
    const weekend = dropSharedTrios([weekendSame, weekendOther], [shared]);
    assert.equal(weekend.length, 1);
    assert.equal(criticKey(weekend[0]!.garmentIds), criticKey(["hd", "jn", "sn"]));
    assert.notEqual(
      criticCacheKey("weekday", "fall", "polo", criticRows([shared], [shirt, trouser, loafer])),
      criticCacheKey("weekend", "fall", "polo", criticRows([weekendOther], [hoodie, jean, sneaker])),
    );
  });

  it("one chip change is one chat call, not one call per card", async () => {
    clearCriticCache();
    let calls = 0;
    const run = () => {
      calls += 1;
      return Promise.resolve({
        ok: true as const,
        verdict: { keep: ["ox,tr,lf"], reject: [], why: "one" },
      });
    };
    const weekday = criticCacheKey("weekday", "fall", "polo", [
      { key: "lf,ox,tr", pieces: [] },
      { key: "jn,ox,sn", pieces: [] },
    ]);
    const polo = await judgeOnce(weekday, run);
    const again = await judgeOnce(weekday, run);
    assert.equal(polo.called, true);
    assert.equal(again.called, false);
    assert.equal(calls, 1);
    const ald = criticCacheKey("weekday", "fall", "ald", [
      { key: "lf,ox,tr", pieces: [] },
      { key: "jn,ox,sn", pieces: [] },
    ]);
    await judgeOnce(ald, run);
    assert.equal(calls, 2);
    const rows = criticRows(
      [look("a", ["ox", "tr", "lf"], "weekday"), look("b", ["ox", "jn", "sn"], "weekday")],
      [shirt, trouser, loafer, jean, sneaker],
    );
    assert.equal(rows.length, 2);
    assert.ok(rows.length <= 8);
    assert.equal(CRITIC_SYSTEM.includes("Do not invent a piece"), true);
    assert.equal(badCriticName("Brown top"), true);
    assert.equal(badCriticName("New piece"), true);
  });

  it("a 403 does not pad, and a rejected name never renders", () => {
    const named = look("good", ["ox", "tr", "lf"], "weekday");
    const unnamed = look("new", ["hd", "jn", "sn"], "weekday");
    const pool = [
      shirt,
      trouser,
      loafer,
      piece({ ...hoodie, id: "hd", name: "New piece" }),
      jean,
      sneaker,
    ];
    const shown = fallbackChapter([named, unnamed], pool, (pieces) => lookClashes(pieces));
    assert.equal(shown.length, 1);
    assert.equal(shown[0]!.id, "good");
    assert.equal(shown.some((l) => l.garmentIds.includes("hd")), false);
    const one = applyCritic([named], [shirt, trouser, loafer], {
      keep: ["ox,tr,lf"],
      reject: [],
      why: "Holds.",
    });
    assert.equal(holdsLine(one.length), "1 look that holds.");
    assert.equal(holdsLine(2), null);
  });
});

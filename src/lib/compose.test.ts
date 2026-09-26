import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  allIdsInvented,
  chapterPaint,
  COMPOSE_MAX_TOKENS,
  COMPOSE_MODEL,
  COMPOSE_SYSTEM,
  COMPOSE_TEMPERATURE,
  COMPOSE_TIMEOUT_MS,
  clearComposeCache,
  composeCacheKey,
  composeMessage,
  composeOnce,
  composeRack,
  keepCardsOnFail,
  parseCompose,
  peekCompose,
  rememberCompose,
  settleCompose,
  STYLIST_HOLDS,
  STYLIST_SILENT,
  stylistMiss,
  validateCompose,
} from "./compose.ts";
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
    seasons: [],
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

const shirt = piece({ id: "g_ox", name: "Navy oxford", category: "top", subtype: "oxford", formality: 3 });
const polo = piece({ id: "g_po", name: "Navy polo", category: "top", subtype: "polo", formality: 2 });
const trouser = piece({ id: "g_tr", name: "Grey trousers", category: "bottom", subtype: "trouser", formality: 3 });
const jean = piece({ id: "g_jn", name: "Indigo jean", category: "bottom", subtype: "jean", formality: 2 });
const loafer = piece({ id: "g_lf", name: "Brown loafer", category: "footwear", subtype: "loafer", colors: ["brown"], formality: 3 });
const sneaker = piece({ id: "g_sn", name: "White sneaker", category: "footwear", subtype: "sneaker", colors: ["white"], formality: 2 });
const hoodie = piece({ id: "g_hd", name: "Grey hoodie", category: "top", subtype: "hoodie", formality: 1 });
const knit = piece({ id: "g_kn", name: "Grey merino", category: "top", subtype: "merino", formality: 3 });
const rack = [shirt, polo, trouser, jean, loafer, sneaker, hoodie, knit];

describe("stylist compose", () => {
  it("weekday cards are the model's ids, and the line under the card is why", () => {
    assert.equal(COMPOSE_MODEL, "grok-4.5");
    assert.equal(COMPOSE_TEMPERATURE, 0.2);
    const text = JSON.stringify({
      looks: [
        { ids: ["g_ox", "g_tr", "g_lf"], name: "Quiet office", why: "A navy shirt and a leather shoe." },
        { ids: ["g_po", "g_jn", "g_sn"], name: "Polo day", why: "The polo is enough." },
        { ids: ["g_kn", "g_tr", "g_sn"], name: "Knit jean", why: "Merino with a clean jean." },
        { ids: ["g_made", "g_tr", "g_lf"], name: "Invented", why: "No such shirt." },
      ],
    });
    const parsed = parseCompose(text);
    assert.ok(parsed);
    const shown = validateCompose(parsed!, rack);
    assert.equal(shown.length, 3);
    assert.deepEqual(shown[0]!.ids, ["g_ox", "g_tr", "g_lf"]);
    assert.equal(shown[0]!.why, "A navy shirt and a leather shoe.");
    assert.equal(shown.some((l) => l.ids.includes("g_made")), false);
  });

  it("a hoodie is not paired with a loafer", () => {
    const shown = validateCompose(
      [
        { ids: ["g_hd", "g_jn", "g_lf"], name: "Costume", why: "No." },
        { ids: ["g_hd", "g_jn", "g_sn"], name: "Weekend", why: "Hoodie, jean, sneaker." },
      ],
      rack,
    );
    assert.equal(shown.some((l) => l.ids.includes("g_hd") && l.ids.includes("g_lf")), false);
    assert.equal(shown.some((l) => l.ids.includes("g_sn")), true);
  });

  it("reshuffle does not repeat the same three pieces", () => {
    const first = ["g_ox", "g_tr", "g_lf"];
    const shown = validateCompose(
      [
        { ids: first, name: "Again", why: "Same." },
        { ids: ["g_po", "g_jn", "g_sn"], name: "Next", why: "Different pieces." },
      ],
      rack,
      [first],
    );
    assert.equal(shown.length, 1);
    assert.deepEqual(shown[0]!.ids, ["g_po", "g_jn", "g_sn"]);
    const base = composeCacheKey("weekday", "fall", "polo", rack.map((g) => g.id));
    const again = composeCacheKey("weekday", "fall", "polo", rack.map((g) => g.id), [first]);
    assert.notEqual(base, again);
    assert.equal(again.includes("not"), true);
  });

  it("one chip is one chat call, and the rack is every confirmed piece", async () => {
    clearComposeCache();
    const worn = piece({
      id: "g_old",
      name: "Old oxford",
      category: "top",
      subtype: "oxford",
      wornOn: ["2026-09-20"],
    });
    const fresh = piece({ id: "g_new", name: "New oxford", category: "top", subtype: "oxford", wornOn: [] });
    const unnamed = piece({ id: "g_np", name: "New piece", category: "top", subtype: "" });
    const listed = composeRack([worn, fresh, unnamed, trouser, loafer], "fall", "2026-09-26");
    assert.equal(listed.some((g) => g.id === "g_np"), false);
    const order = listed.map((g) => g.id);
    assert.ok(order.indexOf("g_new") < order.indexOf("g_old"));
    const message = composeMessage(listed, { occasion: "weekday", season: "fall", house: "polo" });
    assert.equal(message.includes("g_new"), true);
    assert.equal(message.includes("g_old"), true);
    assert.equal(message.includes("6000"), false);
    assert.ok(message.length > 20);
    let calls = 0;
    const run = () => {
      calls += 1;
      return Promise.resolve({
        ok: true as const,
        looks: [{ ids: ["g_ox", "g_tr", "g_lf"], name: "Office", why: "Shirt and loafer." }],
      });
    };
    const weekday = composeCacheKey("weekday", "fall", "polo", ["g_ox", "g_tr", "g_lf"]);
    const first = await composeOnce(weekday, run);
    const second = await composeOnce(weekday, run);
    assert.equal(first.called, true);
    assert.equal(second.called, false);
    assert.equal(calls, 1);
    const weekend = composeCacheKey("weekend", "fall", "polo", ["g_ox", "g_tr", "g_lf"]);
    await composeOnce(weekend, run);
    assert.equal(calls, 2);
  });

  it("a timeout is not the same sentence as an empty chapter", () => {
    assert.equal(COMPOSE_TIMEOUT_MS, 45_000);
    assert.equal(COMPOSE_MAX_TOKENS, 1200);
    assert.equal(COMPOSE_SYSTEM.includes("g_..."), false);
    assert.equal(COMPOSE_SYSTEM.includes("character for character"), true);
    assert.notEqual(STYLIST_SILENT, STYLIST_HOLDS);
    assert.equal(stylistMiss("timeout"), "silent");
    assert.equal(stylistMiss("403"), "silent");
    assert.equal(stylistMiss("empty"), "silent");
    assert.equal(stylistMiss("compose"), "silent");
    assert.equal(stylistMiss("holds"), "holds");
    assert.equal(STYLIST_SILENT, "The stylist didn’t answer — try again.");
    const invented = [{ ids: ["g_...", "g_...", "g_..."], name: "Fake", why: "No." }];
    assert.equal(allIdsInvented(invented, rack), true);
    const kept = settleCompose(invented, rack);
    assert.equal(kept.length, 0);
  });

  it("three real looks survive when the clash check would delete all of them", () => {
    const blazer = piece({ id: "g_bz", name: "Navy blazer", category: "outerwear", subtype: "blazer" });
    const rugby = piece({ id: "g_rg", name: "Navy rugby", category: "top", subtype: "rugby" });
    const mule = piece({ id: "g_mu", name: "Brown mule", category: "footwear", subtype: "mule", colors: ["brown"] });
    const wide = [...rack, blazer, rugby, mule];
    const shown = settleCompose(
      [
        { ids: ["g_hd", "g_jn", "g_lf"], name: "One", why: "The model wrote this." },
        { ids: ["g_bz", "g_rg", "g_sn"], name: "Two", why: "Still the model." },
        { ids: ["g_bz", "g_tr", "g_mu"], name: "Three", why: "A blazer and a mule." },
      ],
      wide,
    );
    assert.equal(shown.length, 3);
    assert.equal(shown.every((look) => look.ids.every((id) => wide.some((g) => g.id === id))), true);
    const onlyHoodie = settleCompose(
      [{ ids: ["g_hd", "g_jn", "g_lf"], name: "Costume", why: "No." }],
      rack,
    );
    assert.equal(onlyHoodie.length, 0);
  });

  it("a chip change clears unless that chapter is already cached", async () => {
    clearComposeCache();
    const key = composeCacheKey("weekend", "fall", "polo", ["g_ox", "g_tr", "g_lf"]);
    assert.deepEqual(chapterPaint(peekCompose(key)), { showCards: false, building: true, call: true });
    assert.equal(keepCardsOnFail(false, "silent"), false);
    assert.equal(keepCardsOnFail(true, "silent"), true);
    assert.equal(keepCardsOnFail(true, "holds"), false);
    const weekday = ["g_ox", "g_tr", "g_lf"];
    const weekend = validateCompose(
      [
        { ids: weekday, name: "Same", why: "Weekday again." },
        { ids: ["g_po", "g_jn", "g_sn"], name: "Weekend", why: "Jean and a sneaker." },
      ],
      rack,
      [weekday],
    );
    assert.deepEqual(weekend[0]!.ids, ["g_po", "g_jn", "g_sn"]);
    rememberCompose(key, weekend);
    let calls = 0;
    const again = await composeOnce(key, () => {
      calls += 1;
      return Promise.resolve({ ok: true as const, looks: weekend });
    });
    assert.equal(calls, 0);
    assert.equal(again.called, false);
    assert.equal(chapterPaint(peekCompose(key)).call, false);
  });

  it("a failed call does not invent a regex trio", () => {
    const previous = [{ ids: ["g_ox", "g_tr", "g_lf"], name: "Office", why: "Holds." }];
    const failed = validateCompose([], rack);
    assert.deepEqual(failed, []);
    assert.deepEqual(previous[0]!.ids, ["g_ox", "g_tr", "g_lf"]);
    const dropped = validateCompose(
      [{ ids: ["nope", "g_tr"], name: "Short", why: "Missing a shoe." }],
      rack,
    );
    assert.equal(dropped.length, 0);
  });
});

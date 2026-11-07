/**
 * R9 jacket edit, weather gate, and session draft. Fixture pieces only.
 * No network, no closet.v6 write, no paid check.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { testCloset } from "./__fixtures__/snapshot.ts";
import {
  editJacket,
  jacketChoices,
  lastResortNote,
  legacyJacketAction,
  NOTE_LAST,
  NOTE_NONE,
  NOTE_NO_JACKET,
  NOTE_ONLY_TOP,
  NOTE_UNLOCK,
  NOTE_WHICH,
  reconcileOpenLook,
  selectedOuter,
} from "./jacket-edit.ts";
import {
  clearJacketDrafts,
  draftStamp,
  effectiveIds,
  jacketDraftCount,
  readJacketDraft,
  rememberJacketDraft,
  setJacketDraftAccount,
} from "./jacket-draft.ts";
import { assistantConditions, atlasPick, jacketTempOf, pageJacketWeather } from "./jacket-weather.ts";
import { composeAtlasLook, emptyTaste } from "./taste.ts";
import { dressThisPiece } from "./dress.ts";
import { ruleHits } from "./stylist/legal.ts";
import { countsAsOuter, jacketRequired } from "./stylist/jackets.ts";
import { slotOf } from "./style.ts";
import { renderedSectionLooks, rowWays, visibleDetectors, weekRotationRow } from "./detectors.ts";
import { todayLookPieces } from "./today-look.ts";
import { emptyRotation } from "./rotation.ts";
import { leadTop, lookTuckDecision } from "./look.ts";
import { tuckMark } from "./tuck.ts";
import { shortOuterHits } from "./stylist/short-outer.ts";
import type { Garment, Occasion, Season } from "./types.ts";

const closet = testCloset.filter((g) => !g.archived);
const byId = new Map(closet.map((g) => [g.id, g]));

function pieces(ids: string[]): Garment[] {
  return ids.map((id) => {
    const g = byId.get(id);
    assert.ok(g, id);
    return g;
  });
}

function coreIds(ids: string[]): string[] {
  const selected = selectedOuter(pieces(ids)).jacket;
  return ids.filter((id) => id !== selected?.id).sort();
}

const CHORE = "g_8qqqzpwxuwti";
const SHIRT = "g_6lolc7ma0mk8";
const CHINOS = "g_xi3w7tz3aren";
const STARS = "g_rxglifsoqobm";
const WEEKDAY_CORE = [SHIRT, CHINOS, STARS];

const FORM_CARDS: { clock: string; occasion: Occasion; season: Season; ids: string[] }[] = [
  { clock: "2026-11-06", occasion: "weekday", season: "fall", ids: ["g_5gfabeezh485", "g_21b6d3qcohmu", "g_m6ri2fgg2hmd", "g_yae8h1k9pjm1"] },
  { clock: "2026-11-06", occasion: "out", season: "fall", ids: ["g_5gfabeezh485", "g_3821acdhupu9", "g_lad85rg9nxs3", "g_5g4fqg77s4rw"] },
  { clock: "2026-11-06", occasion: "out", season: "fall", ids: ["g_8qqqzpwxuwti", "g_oimadifuvalb", "g_66xj06nllgf2", "g_wymz2j18s6wh"] },
  { clock: "2026-11-06", occasion: "out", season: "fall", ids: ["g_qnmo5yzgl50b", "g_xbt3gpjuo1p4", "g_bee1dg9rnfe5", "g_5g4fqg77s4rw"] },
  { clock: "2026-11-06", occasion: "out", season: "fall", ids: ["g_oyyiaxx6rls7", "g_3821acdhupu9", "g_btael28aebgu", "g_om0dh5nps1ke"] },
  { clock: "2026-11-06", occasion: "out", season: "fall", ids: ["g_vtbi91noucd3", "g_xuqvrfy5ocv4", "g_bee1dg9rnfe5", "g_8nrtffa2s13s"] },
  { clock: "2026-11-06", occasion: "out", season: "fall", ids: ["g_sb0mc7s7v346", "g_ugyaieefqcxe", "g_btael28aebgu", "g_wymz2j18s6wh"] },
  { clock: "2026-11-06", occasion: "out", season: "fall", ids: ["g_5gfabeezh485", "g_rpjfgscii90r", "g_cfm8n594jea7", "g_b4zsf3dfrhdv"] },
  { clock: "2026-11-04", occasion: "weekday", season: "fall", ids: ["g_5gfabeezh485", "g_pa7kfg14rtzl", "g_v3ovns4bv344", "g_rxglifsoqobm"] },
  { clock: "2026-11-04", occasion: "out", season: "fall", ids: ["g_5gfabeezh485", "g_oimadifuvalb", "g_yfkavdj5irwe", "g_yae8h1k9pjm1"] },
  { clock: "2026-11-04", occasion: "out", season: "fall", ids: ["g_oyyiaxx6rls7", "g_3821acdhupu9", "g_bee1dg9rnfe5", "g_5g4fqg77s4rw"] },
  { clock: "2026-11-04", occasion: "out", season: "fall", ids: ["g_ulv8tgkujvjh", "g_bq9qnaa1vkon", "g_66xj06nllgf2", "g_wymz2j18s6wh"] },
  { clock: "2026-11-04", occasion: "out", season: "fall", ids: ["g_qnmo5yzgl50b", "g_xbt3gpjuo1p4", "g_btael28aebgu", "g_om0dh5nps1ke"] },
  { clock: "2026-11-04", occasion: "out", season: "fall", ids: ["g_sb0mc7s7v346", "g_xuqvrfy5ocv4", "g_cfm8n594jea7", "g_b4zsf3dfrhdv"] },
  { clock: "2026-11-04", occasion: "out", season: "fall", ids: ["g_8qqqzpwxuwti", "g_dk92xcrfjmq8", "g_lad85rg9nxs3", "g_8nrtffa2s13s"] },
  { clock: "2027-03-15", occasion: "weekday", season: "spring", ids: ["g_5gfabeezh485", "g_7z48xpoqh5tx", "g_6xkkzn06sbdm", "g_b4zsf3dfrhdv"] },
  { clock: "2027-03-15", occasion: "out", season: "spring", ids: ["g_5gfabeezh485", "g_ugyaieefqcxe", "g_j994h3k9l8ot", "g_wymz2j18s6wh"] },
  { clock: "2027-03-15", occasion: "out", season: "spring", ids: ["g_8qqqzpwxuwti", "g_teitg9jmpwxa", "g_lxqx9egrqg14", "g_8ukg5mi9r3fc"] },
];

describe("jacket edit", () => {
  it("off, on, and try another keep the Nov 6 weekday core", () => {
    const ids = [CHORE, ...WEEKDAY_CORE];
    const optional = { occasion: "weekend" as const, season: "fall" as const };
    const off = editJacket({ ids, closet, action: "off", ctx: optional });
    assert.deepEqual(coreIds(off.ids), [...WEEKDAY_CORE].sort());
    assert.equal(off.jacketId, null);
    assert.equal(off.warning, null);
    assert.equal(off.outdoorsValid, true);
    assert.equal(off.ids.includes(CHORE), false);
    const back = editJacket({ ids: off.ids, closet, action: "on", ctx: optional, lastJacketId: off.lastJacketId });
    assert.equal(back.jacketId, CHORE);
    assert.deepEqual(coreIds(back.ids), [...WEEKDAY_CORE].sort());
    const next = editJacket({ ids, closet, action: "next", ctx: optional });
    assert.notEqual(next.jacketId, CHORE);
    assert.deepEqual(coreIds(next.ids), [...WEEKDAY_CORE].sort());
    assert.equal(next.ids.filter((id) => countsAsOuter(byId.get(id)!)).length, 1);
  });

  it("required weather allows off and marks the warning", () => {
    const ids = [CHORE, ...WEEKDAY_CORE];
    const ctx = { occasion: "weekday" as const, season: "fall" as const, weatherF: 48, measured: true };
    assert.equal(jacketRequired("weekday", "fall", 48), true);
    const off = editJacket({ ids, closet, action: "off", ctx });
    assert.equal(off.off, true);
    assert.equal(off.weatherWarned, true);
    assert.equal(off.outdoorsValid, false);
    assert.match(off.warning ?? "", /you'll want a jacket/);
    assert.deepEqual(coreIds(off.ids), [...WEEKDAY_CORE].sort());
  });

  it("a locked jacket, an only-top overshirt, a mid, and two jackets stay put", () => {
    const ids = [CHORE, ...WEEKDAY_CORE];
    const locked = editJacket({ ids, closet, action: "off", ctx: { occasion: "weekend", season: "fall", lockedIds: [CHORE] } });
    assert.equal(locked.changed, false);
    assert.equal(locked.note, NOTE_UNLOCK);
    assert.deepEqual(locked.ids, pieces(ids).map((g) => g.id));
    const over = editJacket({
      ids: ["g_v7uvadckh79p", CHINOS, STARS],
      closet,
      action: "off",
      ctx: { occasion: "weekend", season: "fall" },
    });
    assert.equal(over.changed, false);
    assert.equal(over.note, NOTE_ONLY_TOP);
    assert.equal(over.ids.includes("g_v7uvadckh79p"), true);
    const mid = editJacket({
      ids: ["g_xc4gr022xmvm", SHIRT, CHINOS, STARS],
      closet,
      action: "off",
      ctx: { occasion: "weekend", season: "fall" },
    });
    assert.equal(mid.changed, false);
    assert.equal(mid.note, NOTE_NO_JACKET);
    assert.equal(mid.ids.includes("g_xc4gr022xmvm"), true);
    const both = editJacket({
      ids: [CHORE, "g_qnmo5yzgl50b", ...WEEKDAY_CORE],
      closet,
      action: "off",
      ctx: { occasion: "weekend", season: "fall" },
    });
    assert.equal(both.changed, false);
    assert.match(both.note ?? "", new RegExp(NOTE_WHICH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("roomy chore over the black cable is not a layering failure, and oversized still is", () => {
    const cable = pieces(["g_8qqqzpwxuwti", "g_teitg9jmpwxa", "g_lxqx9egrqg14", "g_8ukg5mi9r3fc"]);
    const hits = ruleHits(cable, { occasion: "out", season: "spring", pool: closet });
    assert.equal(hits.hard.includes("JKT-LAY-5"), false);
    assert.equal(hits.hard.includes("JKT-LAY-9"), false);
    assert.equal(hits.soft.includes("JKT-LAY-5"), false);
    assert.equal(hits.soft.includes("JKT-LAY-9"), false);
    const lay9 = ruleHits(pieces(["g_8qqqzpwxuwti", "g_gp53xkrmem9b", "g_6xkkzn06sbdm", "g_2djvq6l9qxbb"]), {
      occasion: "out",
      season: "fall",
      pool: closet,
    });
    assert.equal(lay9.hard.includes("JKT-LAY-9"), true);
    const cord = ruleHits(pieces(["g_x4adkv9zu9yu", "g_gp53xkrmem9b", "g_6xkkzn06sbdm", "g_2djvq6l9qxbb"]), {
      occasion: "out",
      season: "fall",
      pool: closet,
    });
    assert.equal(cord.hard.includes("JKT-LAY-9"), false);
    const vest = shortOuterHits(pieces(["g_ef0u3ljnwa09", "g_gp53xkrmem9b", CHINOS, STARS]));
    assert.ok(vest.length > 0);
    const knit = pieces(["g_teitg9jmpwxa", CHINOS, STARS]);
    assert.equal(tuckMark(lookTuckDecision(knit, "out"), leadTop(knit)), null);
  });

  it("the 18 formality cards offer a strict jacket before a toggle or denim over pleats", () => {
    assert.equal(FORM_CARDS.length, 18);
    let strictCores = 0;
    let lastOnly = 0;
    for (const card of FORM_CARDS) {
      const worn = pieces(card.ids);
      const jacket = selectedOuter(worn).jacket;
      assert.ok(jacket, card.ids.join(","));
      const core = worn.filter((g) => g.id !== jacket.id);
      const choices = jacketChoices(core, closet, { occasion: card.occasion, season: card.season });
      const strict = choices.filter((row) => row.tier === "strict");
      if (strict.length) {
        strictCores += 1;
        assert.equal(choices.every((row) => row.tier === "strict"), true, card.ids.join(","));
        assert.equal(choices.some((row) => row.formality.length > 0), false);
      } else if (choices.length) {
        lastOnly += 1;
        assert.equal(choices.every((row) => row.tier === "lastResort"), true);
      } else {
        const next = editJacket({
          ids: card.ids,
          closet,
          action: "next",
          ctx: { occasion: card.occasion, season: card.season },
        });
        assert.equal(next.changed, false);
        assert.equal(next.note, NOTE_NONE);
      }
      const next = editJacket({
        ids: card.ids,
        closet,
        action: "next",
        ctx: { occasion: card.occasion, season: card.season },
      });
      assert.deepEqual(coreIds(next.ids), core.map((g) => g.id).sort());
    }
    assert.ok(strictCores + lastOnly > 0);
  });

  it("an archived last jacket is not restored, and a vetoed jacket is not offered", () => {
    const archived = closet.map((g) => (g.id === CHORE ? { ...g, archived: true } : g));
    const off = editJacket({
      ids: WEEKDAY_CORE,
      closet: archived,
      action: "on",
      ctx: { occasion: "weekend", season: "fall" },
      lastJacketId: CHORE,
    });
    assert.notEqual(off.jacketId, CHORE);
    const vetoed = editJacket({
      ids: [CHORE, ...WEEKDAY_CORE],
      closet,
      action: "next",
      ctx: {
        occasion: "weekend",
        season: "fall",
        taste: { ...emptyTaste(), vetoes: [{ kind: "piece", id: "g_qnmo5yzgl50b", source: "ask" }] },
      },
    });
    assert.equal(vetoed.choices.some((row) => row.id === "g_qnmo5yzgl50b"), false);
  });

  it("Off then On replaces a toggle over pleats when a strict jacket fits", () => {
    const ids = ["g_5gfabeezh485", "g_oimadifuvalb", "g_yfkavdj5irwe", "g_yae8h1k9pjm1"];
    const ctx = { occasion: "out" as const, season: "fall" as const };
    const core = pieces(ids).filter((g) => g.id !== "g_5gfabeezh485");
    const choices = jacketChoices(core, closet, ctx);
    assert.ok(choices.some((row) => row.tier === "strict"));
    const off = editJacket({ ids, closet, action: "off", ctx });
    const on = editJacket({ ids: off.ids, closet, action: "on", ctx, lastJacketId: "g_5gfabeezh485" });
    assert.notEqual(on.jacketId, "g_5gfabeezh485");
    assert.equal(on.tier, "strict");
    assert.equal(on.note, null);
    assert.equal(on.outdoorsValid, true);
    assert.deepEqual(coreIds(on.ids), core.map((g) => g.id).sort());
  });

  it("week and detector rows seat a strict jacket before a toggle or denim over pleats", () => {
    const cases: { date: string; occasion: Occasion; core: string[] }[] = [
      { date: "2026-11-06", occasion: "out", core: ["g_3821acdhupu9", "g_5g4fqg77s4rw", "g_lad85rg9nxs3"] },
      { date: "2026-11-06", occasion: "out", core: ["g_3821acdhupu9", "g_5g4fqg77s4rw", "g_yfkavdj5irwe"] },
      { date: "2026-11-04", occasion: "weekday", core: ["g_1zteshjh31ac", "g_bee1dg9rnfe5", "g_yae8h1k9pjm1"] },
      { date: "2026-11-04", occasion: "out", core: ["g_oimadifuvalb", "g_yae8h1k9pjm1", "g_yfkavdj5irwe"] },
      { date: "2026-11-04", occasion: "out", core: ["g_8ukg5mi9r3fc", "g_salzdhuswyd3", "g_yfkavdj5irwe"] },
    ];
    const found = new Map<string, string>();
    for (const row of cases) {
      const season = "fall" as const;
      const week = weekRotationRow(closet, {
        occasion: row.occasion,
        season,
        salt: 0,
        today: row.date,
        cap: 8,
        rotation: emptyRotation(),
      });
      const ways = rowWays(visibleDetectors(closet, { occasion: row.occasion, season, salt: 0, today: row.date }), closet, {
        occasion: row.occasion,
        season,
        salt: 0,
        today: row.date,
        rotation: emptyRotation(),
      });
      const cards = [
        ...week.looks,
        ...renderedSectionLooks(ways, row.occasion).map((card) =>
          card.garmentIds.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g)),
        ),
      ];
      for (const look of cards) {
        const core = look.filter((g) => slotOf(g) !== "outerwear" && !countsAsOuter(g));
        const key = `${row.date}|${row.occasion}|${[...core.map((g) => g.id)].sort().join("+")}`;
        const jacket = selectedOuter(look).jacket;
        const sameCore = row.core.every((id) => look.some((g) => g.id === id)) && look.every((g) => row.core.includes(g.id) || g.id === jacket?.id);
        if (sameCore) found.set(`${row.date}|${row.occasion}|${[...row.core].sort().join("+")}`, jacket?.id ?? "");
        if (!lastResortNote(look)) continue;
        const strict = jacketChoices(core, closet, { occasion: row.occasion, season }).filter((choice) => choice.tier === "strict");
        assert.equal(strict.length, 0, `${key} kept ${jacket?.id}`);
        assert.equal(lastResortNote(look), NOTE_LAST);
      }
    }
    for (const row of cases) {
      const key = `${row.date}|${row.occasion}|${[...row.core].sort().join("+")}`;
      const jacket = found.get(key);
      assert.ok(jacket, key);
      assert.equal(lastResortNote(pieces([...row.core, jacket!])), null, key);
    }
  });

  it("a closet with only a toggle over pleats labels that jacket a last resort", () => {
    const ids = ["g_5gfabeezh485", "g_oimadifuvalb", "g_yfkavdj5irwe", "g_yae8h1k9pjm1"];
    const tiny = pieces(ids);
    const week = weekRotationRow(tiny, {
      occasion: "out",
      season: "fall",
      salt: 0,
      today: "2026-11-06",
      cap: 4,
      rotation: emptyRotation(),
    });
    const look = week.looks.find((row) => row.some((g) => g.id === "g_5gfabeezh485"));
    assert.ok(look);
    assert.equal(lastResortNote(look), NOTE_LAST);
    assert.equal(jacketChoices(look.filter((g) => g.id !== "g_5gfabeezh485"), tiny, { occasion: "out", season: "fall" }).some((row) => row.tier === "strict"), false);
  });
});

describe("jacket weather", () => {
  it("dry, wet, windy, cold, summer wind, and a missing reading", () => {
    const dry = atlasPick({ occasion: "weekday", season: "fall", weatherF: 73, conditions: { measured: true } });
    assert.equal(dry.requireOuter, false);
    assert.equal(dry.weather?.measured, true);
    assert.equal(dry.weather?.wet, undefined);
    const wet = atlasPick({ occasion: "weekday", season: "fall", weatherF: 73, conditions: { measured: true, wet: true } });
    assert.equal(wet.requireOuter, true);
    assert.equal(wet.weather?.wet, true);
    const windy = atlasPick({ occasion: "weekday", season: "fall", weatherF: 73, conditions: { measured: true, windy: true } });
    assert.equal(windy.requireOuter, true);
    const cold = atlasPick({ occasion: "weekday", season: "fall", weatherF: 48, conditions: { measured: true, highF: 48 } });
    assert.equal(cold.requireOuter, true);
    const summer = atlasPick({ occasion: "weekday", season: "summer", weatherF: 86, conditions: { measured: true, windy: true } });
    assert.equal(summer.requireOuter, false);
    const absent = atlasPick({ occasion: "weekday", season: "fall" });
    assert.equal(absent.gated, false);
    assert.equal(absent.requireOuter, undefined);
    const bucket = atlasPick({ occasion: "weekday", season: "fall", weatherF: 64 });
    assert.equal(bucket.gated, false);
    assert.equal(bucket.weather?.measured, undefined);
    assert.equal(bucket.requireOuter, undefined);
    const standIn = pageJacketWeather({ f: 64, label: "Mild" });
    assert.equal(standIn.measured, false);
    assert.equal(standIn.weatherF, undefined);
    assert.equal(jacketTempOf({ weatherF: 64, measured: false, label: "Mild" }), undefined);
  });

  it("a season preview keeps the season and still uses today's rain and wind", () => {
    const today = pageJacketWeather({ f: 64, label: "Mild", measured: true, highF: 48, wet: true, windy: true });
    assert.equal(jacketRequired("weekday", "spring", today.weatherF, today.conditions), true);
    assert.equal(jacketRequired("weekday", "summer", 86, { windy: true }), false);
    assert.equal(jacketRequired("weekday", "fall", 73), false);
    assert.equal(jacketRequired("weekend", "fall", 73, { wet: true }), true);
    const springDry = pageJacketWeather({ f: 73, label: "Warm", measured: true });
    assert.equal(jacketRequired("weekday", "spring", springDry.weatherF, springDry.conditions), false);
  });

  it("measured-only 73 and 48 keep the measured flag through the assistant builder", () => {
    const warm = pageJacketWeather({ f: 73, label: "Clear", measured: true });
    const warmCtx = assistantConditions(warm);
    assert.equal(warmCtx?.wet, undefined);
    assert.equal(warmCtx?.windy, undefined);
    assert.deepEqual(warmCtx, { measured: true });
    const warmPick = atlasPick({ occasion: "weekday", season: "fall", weatherF: warm.weatherF, conditions: warmCtx });
    assert.equal(warmPick.gated, true);
    assert.equal(warmPick.requireOuter, false);
    assert.equal(warmPick.weather?.measured, true);
    const cold = pageJacketWeather({ f: 48, label: "Clear", measured: true });
    const coldPick = atlasPick({
      occasion: "weekday",
      season: "fall",
      weatherF: cold.weatherF,
      conditions: assistantConditions(cold),
    });
    assert.equal(coldPick.gated, true);
    assert.equal(coldPick.requireOuter, true);
    const full = pageJacketWeather({ f: 64, label: "Mild", measured: true, highF: 48, wet: true, windy: true });
    const fullCtx = assistantConditions(full);
    assert.equal(fullCtx?.measured, true);
    assert.equal(fullCtx?.highF, 48);
    assert.equal(fullCtx?.wet, true);
    assert.equal(fullCtx?.windy, true);
    const bucket = assistantConditions(pageJacketWeather({ f: 64, label: "Mild" }));
    assert.equal(bucket, undefined);
    const absent = assistantConditions(pageJacketWeather(null));
    assert.equal(absent, undefined);
    const preview = atlasPick({
      occasion: "weekday",
      season: "spring",
      weatherF: 48,
      conditions: assistantConditions(pageJacketWeather({ f: 64, label: "Mild", measured: true, highF: 48, windy: true })),
    });
    assert.equal(preview.requireOuter, true);
  });

  it("composeAtlasLook and the locked dresser keep the gate", () => {
    const taste = emptyTaste();
    const dry = composeAtlasLook({
      garments: closet,
      prompt: "weekday",
      occasion: "weekday",
      season: "fall",
      weatherF: 73,
      conditions: { measured: true },
      taste,
      today: "2026-11-06",
      salt: 1,
    });
    const dryPieces = pieces(dry.garmentIds);
    const dryHits = ruleHits(dryPieces, {
      occasion: "weekday",
      season: "fall",
      weatherF: 73,
      pool: closet,
    });
    assert.equal(dryHits.hard.includes("JKT-COV-1"), false);
    const wetLook = dressThisPiece({
      lockedIds: [SHIRT],
      garments: closet,
      occasion: "weekday",
      season: "fall",
      weather: { f: 73, label: "Fair", code: 2, measured: true, wet: true },
      taste,
      today: "2026-11-06",
    });
    assert.ok(wetLook);
    assert.equal(wetLook.garmentIds.includes(SHIRT), true);
    assert.equal(wetLook.pieces.some((g) => countsAsOuter(g)), true);
  });
});

describe("jacket draft storage", () => {
  const writes: string[] = [];
  const storage = globalThis.localStorage;
  beforeEach(() => {
    writes.length = 0;
    clearJacketDrafts();
    setJacketDraftAccount("acct-a");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        setItem: (key: string) => writes.push(key),
        getItem: () => null,
        removeItem: () => undefined,
      },
    });
  });
  afterEach(() => {
    clearJacketDrafts();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  });

  it("on, off, and try another write no storage and die on sign-out", () => {
    const stamp = draftStamp({ date: "2026-11-06", occasion: "weekday", season: "fall", weather: null });
    const base = [CHORE, ...WEEKDAY_CORE];
    for (const action of ["off", "on", "next"] as const) {
      const result = editJacket({ ids: base, closet, action, ctx: { occasion: "weekend", season: "fall" } });
      rememberJacketDraft({
        baseIds: base,
        ids: result.ids,
        stamp,
        accountId: "",
        off: result.off,
        jacketId: result.jacketId,
        lastJacketId: result.lastJacketId,
        weatherWarned: result.weatherWarned,
        warning: result.warning,
        note: result.note,
        outdoorsValid: result.outdoorsValid,
      });
    }
    assert.equal(writes.length, 0);
    assert.equal(jacketDraftCount(), 1);
    const owned = new Set(closet.map((g) => g.id));
    assert.ok(effectiveIds(base, stamp, owned));
    assert.equal(readJacketDraft(base, draftStamp({ date: "2026-11-07", occasion: "weekday", season: "fall", weather: null })), null);
    setJacketDraftAccount("acct-b");
    assert.equal(jacketDraftCount(), 0);
    assert.equal(effectiveIds(base, stamp, owned), null);
    const draftSrc = readFileSync(new URL("./jacket-draft.ts", import.meta.url), "utf8");
    const editSrc = readFileSync(new URL("./jacket-edit.ts", import.meta.url), "utf8");
    for (const src of [draftSrc, editSrc]) {
      assert.equal(src.includes("noteUserEdit("), false);
      assert.equal(/from ["'][^"']*store/.test(src), false);
      assert.equal(/from ["'][^"']*cloud\/sync/.test(src), false);
      assert.equal(src.includes("localStorage"), false);
      assert.equal(src.includes("indexedDB"), false);
    }
    const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
    assert.equal(store.includes("jacket-draft"), false);
    const sheet = readFileSync(new URL("../components/closet/look-sheet.tsx", import.meta.url), "utf8");
    assert.match(sheet, /saveLook\(\{/);
    assert.match(sheet, /garmentIds: activePieces\.map/);
    assert.match(sheet, /rememberJacketDraft/);
  });

  it("a fit change, an archive, and a date or account change drop a stale jacket", () => {
    const cord = byId.get("g_x4adkv9zu9yu")!;
    const knit = byId.get("g_gp53xkrmem9b")!;
    const bottom = byId.get("g_6xkkzn06sbdm")!;
    const shoe = byId.get("g_2djvq6l9qxbb")!;
    const ids = [cord.id, knit.id, bottom.id, shoe.id];
    const stamp = draftStamp({ date: "2026-11-06", occasion: "out", season: "fall", weather: null });
    const ctx = { occasion: "out" as const, season: "fall" as const };
    rememberJacketDraft({
      baseIds: ids,
      ids,
      stamp,
      accountId: "",
      off: false,
      jacketId: cord.id,
      lastJacketId: cord.id,
      weatherWarned: false,
      warning: null,
      note: null,
      outdoorsValid: true,
    });
    const changed = closet.map((g) => (g.id === cord.id ? { ...g, oversized: false } : g));
    const owned = new Set(changed.filter((g) => !g.archived).map((g) => g.id));
    const repaired = effectiveIds(ids, stamp, owned, { closet: changed, ctx });
    assert.ok(repaired);
    const hits = ruleHits(
      repaired.map((id) => changed.find((g) => g.id === id)!),
      { occasion: "out", season: "fall", pool: changed },
    );
    assert.equal(hits.hard.includes("JKT-LAY-9"), false);
    assert.equal(hits.hard.includes("JKT-LAY-5"), false);
    const archived = changed.map((g) => (g.id === cord.id ? { ...g, archived: true } : g));
    const still = new Set(archived.filter((g) => !g.archived).map((g) => g.id));
    rememberJacketDraft({
      baseIds: ids,
      ids,
      stamp,
      accountId: "",
      off: false,
      jacketId: cord.id,
      lastJacketId: cord.id,
      weatherWarned: false,
      warning: null,
      note: null,
      outdoorsValid: true,
    });
    assert.equal(effectiveIds(ids, stamp, still, { closet: archived, ctx }), null);
    rememberJacketDraft({
      baseIds: ids,
      ids,
      stamp,
      accountId: "",
      off: false,
      jacketId: cord.id,
      lastJacketId: cord.id,
      weatherWarned: false,
      warning: null,
      note: null,
      outdoorsValid: true,
    });
    assert.equal(readJacketDraft(ids, draftStamp({ date: "2026-11-07", occasion: "out", season: "fall", weather: null })), null);
    setJacketDraftAccount("someone-else");
    assert.equal(readJacketDraft(ids, stamp), null);
    const open = reconcileOpenLook(ids, changed, ctx);
    assert.equal(ruleHits(open.ids.map((id) => changed.find((g) => g.id === id)!), { occasion: "out", season: "fall", pool: changed }).hard.includes("JKT-LAY-9"), false);
  });

  it("Today and a detector card show the edited ids and reopen on the original look", () => {
    const base = [CHORE, ...WEEKDAY_CORE];
    const weather = { f: 48, label: "Cold", code: 3, measured: true as const, highF: 48, wet: true };
    const stamp = draftStamp({ date: "2026-11-06", occasion: "weekday", season: "fall", weather });
    const ctx = { occasion: "weekday" as const, season: "fall" as const, weatherF: 48, measured: true, highF: 48, wet: true };
    const off = editJacket({ ids: base, closet, action: "off", ctx });
    rememberJacketDraft({
      baseIds: base,
      ids: off.ids,
      stamp,
      accountId: "",
      off: off.off,
      jacketId: off.jacketId,
      lastJacketId: off.lastJacketId,
      weatherWarned: off.weatherWarned,
      warning: off.warning,
      note: off.note,
      outdoorsValid: off.outdoorsValid,
    });
    const owned = new Set(closet.map((g) => g.id));
    const card = effectiveIds(base, stamp, owned, { closet, ctx });
    assert.ok(card);
    assert.equal(card.includes(CHORE), false);
    assert.match(readJacketDraft(base, stamp)?.warning ?? "", /jacket/);
    const shown = todayLookPieces(
      {
        drop: { date: "2026-11-06", garmentIds: base, worn: false, verdict: "pending", occasion: "weekday", weather },
        garments: closet,
        season: "fall",
      },
      "2026-11-06",
    );
    assert.equal(shown.some((g) => g.id === CHORE), false);
    assert.deepEqual(shown.map((g) => g.id).sort(), card.sort());
    const next = editJacket({ ids: card, closet, action: "next", ctx, lastJacketId: CHORE });
    rememberJacketDraft({
      baseIds: base,
      ids: next.ids,
      stamp,
      accountId: "",
      off: next.off,
      jacketId: next.jacketId,
      lastJacketId: next.lastJacketId,
      weatherWarned: next.weatherWarned,
      warning: next.warning,
      note: next.note,
      outdoorsValid: next.outdoorsValid,
    });
    const reopened = effectiveIds(base, stamp, owned, { closet, ctx });
    assert.ok(reopened);
    assert.notEqual(reopened.join(","), card.join(","));
    assert.equal(reopened.includes(CHORE), false);
    assert.deepEqual(readJacketDraft(base, stamp)?.baseIds, base);
  });
});

describe("legacy jacket controls", () => {
  it("routes the overshirt, a locked jacket, two outers, and adding a jacket through the resolver", () => {
    const over = byId.get("g_v7uvadckh79p")!;
    const base = byId.get("g_6lolc7ma0mk8")!;
    const bottom = byId.get("g_xi3w7tz3aren")!;
    const shoe = byId.get("g_rxglifsoqobm")!;
    const worn = [over, base, bottom, shoe];
    assert.equal(selectedOuter(worn).jacket?.id, over.id);
    assert.equal(legacyJacketAction(over, worn, "swap"), "next");
    assert.equal(legacyJacketAction(over, worn, "remove"), "off");
    assert.equal(legacyJacketAction(base, worn, "swap"), "plain");
    const only = [over, bottom, shoe];
    assert.equal(selectedOuter(only).blocked, "only-top");
    assert.equal(legacyJacketAction(over, only, "remove"), "plain");
    const chore = byId.get("g_8qqqzpwxuwti")!;
    const field = byId.get("g_qnmo5yzgl50b")!;
    const two = [chore, field, base, bottom, shoe];
    assert.equal(legacyJacketAction(chore, two, "remove"), "blocked");
    assert.equal(legacyJacketAction(field, two, "swap"), "blocked");
    const bare = [base, bottom, shoe];
    assert.equal(legacyJacketAction(chore, bare, "add"), "set");
    const locked = editJacket({
      ids: [chore.id, base.id, bottom.id, shoe.id],
      closet,
      action: "off",
      ctx: { occasion: "weekend", season: "fall", lockedIds: [chore.id] },
    });
    assert.equal(locked.changed, false);
    assert.equal(locked.note, NOTE_UNLOCK);
    const ctx = { occasion: "weekday" as const, season: "fall" as const };
    const swapped = editJacket({ ids: worn.map((g) => g.id), closet, action: "next", ctx });
    assert.notEqual(swapped.jacketId, over.id);
    const restored = editJacket({ ids: swapped.ids, closet, action: "set", chooseId: over.id, ctx });
    assert.equal(restored.jacketId, over.id);
    assert.equal(restored.ids.filter((id) => id === over.id).length, 1);
    assert.equal(selectedOuter(pieces(restored.ids)).jacket?.id, over.id);
  });
});

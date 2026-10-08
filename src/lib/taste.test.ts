import { register } from "node:module";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Garment, Look, Occasion, WeatherSnap } from "./types.ts";
import type { CloudMeta } from "./cloud/merge.ts";
import platesFile from "./stylist/__tests__/fixtures/plates-2026-09-30.json" with { type: "json" };

register(new URL("../../scripts/ts-ext.mjs", import.meta.url), {
  parentURL: import.meta.url,
});

const {
  acceptTrend,
  buildStylistSystem,
  composeAtlasLook,
  emptyTaste,
  embedTasteAvoid,
  learnFromAsk,
  logWear,
  peelTasteAvoid,
  swapDraft,
  swapSlot,
  tasteBlank,
  trendSentenceOk,
  tuckHabitIds,
} = await import("./taste.ts");
const { mergeAccount } = await import("./cloud/merge.ts");
const { rowToCloud } = await import("./cloud/commit.ts");
const { recordStylistQuestion } = await import("./stylist-thread.ts");
const { useCloset, pickDrop } = await import("./store.ts");
const { explain, isLegal } = await import("./stylist/legal.ts");
const { defaultOccasion, isTrueOuter, slotOf, todayOccasion } = await import("./style.ts");
const { comboKey } = await import("./lookbook.ts");
const { todayISO } = await import("./utils.ts");

const NOW = Date.parse("2026-10-02T15:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function g(partial: Pick<Garment, "id" | "name" | "category" | "subtype"> & { brand?: string; notes?: string }): Garment {
  return {
    colors: ["navy"],
    material: "cotton",
    brand: partial.brand ?? "",
    notes: partial.notes ?? "",
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

function rack(): Garment[] {
  return [
    g({ id: "g_ox", name: "Navy oxford", category: "top", subtype: "oxford" }),
    g({ id: "g_tee", name: "White tee", category: "top", subtype: "tee", brand: "" }),
    g({ id: "g_camp", name: "Olive printed camp", category: "top", subtype: "camp shirt" }),
    g({ id: "g_knit", name: "Fine merino crew", category: "top", subtype: "merino knit" }),
    g({ id: "g_chino", name: "Khaki chinos", category: "bottom", subtype: "chino" }),
    g({ id: "g_jean", name: "Indigo jeans", category: "bottom", subtype: "jean" }),
    g({ id: "g_loafer", name: "Brown loafers", category: "footwear", subtype: "loafer" }),
    g({ id: "g_boot", name: "Brown boots", category: "footwear", subtype: "boot" }),
    g({ id: "g_field", name: "Navy field jacket", category: "outerwear", subtype: "field jacket" }),
    g({ id: "g_chore", name: "Olive chore coat", category: "outerwear", subtype: "chore coat" }),
    g({ id: "g_blazer", name: "Navy blazer", category: "outerwear", subtype: "blazer" }),
  ];
}

function openStack(): Garment[] {
  return rack().filter((item) => ["g_camp", "g_tee", "g_chino", "g_loafer"].includes(item.id));
}

describe("taste memory", () => {
  it("an ask stores a veto and does not change looks or Today", () => {
    const garments = rack();
    const drop = {
      date: "2026-10-02",
      garmentIds: ["g_ox", "g_chino", "g_loafer"],
      worn: false,
      verdict: "pending" as const,
      occasion: "weekday" as const,
    };
    const olive: Look = {
      id: "l_olive",
      name: "Olive field jacket · weekday",
      occasion: "weekday",
      garmentIds: ["g_field", "g_chino", "g_loafer"],
      source: "manual",
      lookbook: false,
      createdAt: "2026-09-01T00:00:00.000Z",
    };
    useCloset.setState({ garments, looks: [olive], drop, taste: emptyTaste(), messages: [] });
    const before = useCloset.getState();
    const question = "Dinner in the West Village, not the navy field jacket";
    const staged = recordStylistQuestion(before, question);
    const taste = learnFromAsk(before.taste, {
      text: question,
      garments,
      previousIds: [],
      now: NOW,
    });
    useCloset.setState({ taste });
    assert.equal(staged.looks, before.looks.length);
    assert.equal(useCloset.getState().looks.length, before.looks.length);
    assert.equal(useCloset.getState().drop, before.drop);
    assert.equal(useCloset.getState().looks[0]?.name, "Olive field jacket · weekday");
    assert.ok(taste.vetoes.some((v) => v.kind === "piece" && v.id === "g_field"));

    const src = readFileSync(new URL("../components/shell/stylist-dock.tsx", import.meta.url), "utf8");
    const send = src.slice(src.indexOf("const send"), src.indexOf("const wearDraft"));
    assert.equal(send.includes("saveLook"), false);
    assert.equal(send.includes("setDrop"), false);
    assert.equal(send.includes("learnFromAsk"), true);
  });

  it("every returned id is in the live pool, and a fake id is thrown out", () => {
    const garments = rack();
    const look = composeAtlasLook({
      garments,
      prompt: "Weekday office",
      weatherF: 62,
      taste: emptyTaste(),
      modelText: "A Fortela blazer that does not exist\nLOOK: g_ox,g_fake,g_loafer",
    });
    const owned = new Set(garments.map((item) => item.id));
    assert.ok(look.garmentIds.length >= 2);
    assert.equal(look.garmentIds.includes("g_fake"), false);
    assert.ok(look.garmentIds.every((id) => owned.has(id)));
    assert.equal(look.text.includes("Fortela"), false);
    assert.equal(look.text.includes("g_fake"), false);
  });

  it("never tuck on one id is in the next prompt and not on every shirt", () => {
    const garments = rack();
    const taste = learnFromAsk(emptyTaste(), {
      text: "Never tuck this",
      garments,
      previousIds: ["g_ox", "g_chino", "g_loafer"],
      now: NOW,
    });
    assert.deepEqual(tuckHabitIds(taste), ["g_ox"]);
    assert.equal(
      taste.vetoes.some((v) => v.kind === "habit" && v.id === "g_tee"),
      false,
    );
    const prompt = buildStylistSystem({ garments, taste, weatherF: 62, occasion: "weekday", now: NOW });
    assert.match(prompt, /Never tuck g_ox/);
    assert.match(prompt, /only that piece/);
    assert.match(prompt, /not apply it to every shirt/i);
    assert.equal(/Never tuck g_tee/.test(prompt), false);
    assert.equal(/Never tuck g_camp/.test(prompt), false);
  });

  it("three open-shirt wears raise Open overshirt and do not name Fortela", () => {
    const pieces = openStack();
    let taste = emptyTaste();
    taste = logWear(taste, pieces, pieces.map((item) => item.id), NOW);
    taste = logWear(taste, pieces, pieces.map((item) => item.id), NOW + DAY);
    const before = taste.techniques.find((t) => t.id === "open-overshirt");
    assert.equal(before?.weight, 0);
    taste = logWear(taste, pieces, pieces.map((item) => item.id), NOW + 2 * DAY);
    const after = taste.techniques.find((t) => t.id === "open-overshirt");
    assert.equal(after?.weight, 1);
    const prompt = buildStylistSystem({
      garments: pieces,
      taste,
      weatherF: 74,
      occasion: "weekend",
      now: NOW + 2 * DAY,
    });
    const active = prompt.split("DORMANT")[0] ?? prompt;
    assert.match(active, /Open overshirt/);
    assert.match(active, /Camp or print worn open over a tee/);
    assert.equal(prompt.includes("Fortela"), false);
    assert.equal(prompt.includes("Ralph"), false);
    assert.equal(prompt.includes("ALD"), false);

    const branded = pieces.map((item) => (item.id === "g_camp" ? { ...item, brand: "Fortela" } : item));
    const withBrand = buildStylistSystem({
      garments: branded,
      taste,
      weatherF: 74,
      occasion: "weekend",
      now: NOW + 2 * DAY,
    });
    const rules = withBrand.split("CLOSET")[0] ?? "";
    assert.equal(rules.includes("Fortela"), false);
    assert.match(withBrand, /Fortela/);
  });

  it("a vetoed jacket is absent from the next look", () => {
    const garments = rack();
    const taste = learnFromAsk(emptyTaste(), {
      text: "Dinner in the West Village, not the navy field jacket",
      garments,
      now: NOW,
    });
    const look = composeAtlasLook({
      garments,
      prompt: "Dinner in the West Village",
      weatherF: 64,
      taste,
    });
    assert.equal(look.garmentIds.includes("g_field"), false);
    assert.ok(look.garmentIds.every((id) => garments.some((item) => item.id === id)));
    assert.ok(look.garmentIds.length >= 2);
  });

  it("a new account with no wears does not get Joe's house list", () => {
    const prompt = buildStylistSystem({
      garments: rack().filter((item) => ["g_ox", "g_chino", "g_loafer"].includes(item.id)),
      taste: emptyTaste(),
      weatherF: 62,
      occasion: "weekday",
      now: NOW,
    });
    assert.equal(tasteBlank(emptyTaste()), true);
    assert.equal(/Joe's master stylist/.test(prompt), false);
    assert.equal(/HIS houses only/.test(prompt), false);
    assert.equal(/Ralph:/.test(prompt), false);
    assert.equal(/\bALD\b/.test(prompt), false);
    assert.equal(/Faloni/.test(prompt), false);
    assert.equal(/FiveFourFive|Sweet Stable|Italian winter/.test(prompt), false);
    assert.equal(prompt.includes("Fortela"), false);
    const ai = readFileSync(new URL("./ai.ts", import.meta.url), "utf8");
    assert.equal(ai.includes("Joe's master stylist"), false);
    assert.equal(ai.includes("HIS houses only"), false);
    const houses = readFileSync(new URL("./houses.ts", import.meta.url), "utf8");
    assert.equal(houses.includes("export const HOUSE_LABEL"), true);
  });

  it("swap the shirt edits the previous ids and does not invent a piece", () => {
    assert.equal(swapSlot("Swap the shirt"), "top");
    const garments = rack();
    const look = swapDraft({
      ids: ["g_ox", "g_chino", "g_loafer"],
      slot: "top",
      garments,
      taste: emptyTaste(),
      occasion: "weekday",
      weatherF: 62,
    });
    assert.ok(look);
    assert.equal(look.garmentIds.includes("g_ox"), false);
    assert.equal(look.garmentIds.includes("g_chino"), true);
    assert.equal(look.garmentIds.includes("g_loafer"), true);
    assert.ok(look.garmentIds.every((id) => garments.some((item) => item.id === id)));
    assert.equal(look.occasion, "weekday");
  });

  it("a trend sentence cannot name a brand he does not own or clear a veto", () => {
    const garments = rack();
    assert.equal(trendSentenceOk("A light knit over a shirt still works.", garments), true);
    assert.equal(trendSentenceOk("Fortela layering is the move.", garments), false);
    const taste = learnFromAsk(emptyTaste(), {
      text: "Don't use the navy field jacket",
      garments,
      now: NOW,
    });
    const vetoes = taste.vetoes.map((v) => (v.kind === "piece" ? v.id : ""));
    const next = acceptTrend(taste, "A light knit over a shirt still works.", garments, NOW);
    assert.ok(next);
    assert.deepEqual(
      next.vetoes.map((v) => (v.kind === "piece" ? v.id : "")),
      vetoes,
    );
    assert.equal(next.trendNote, "A light knit over a shirt still works.");
    assert.equal(acceptTrend(taste, "Try Fortela this week.", garments, NOW), null);
  });

  it("the account blob carries a veto onto the next phone", () => {
    const garments = rack();
    const taste = learnFromAsk(emptyTaste(), {
      text: "Don't use the navy field jacket",
      garments,
      now: NOW,
    });
    const wire = embedTasteAvoid({ g_ox: 1 }, taste);
    const peeled = peelTasteAvoid(wire);
    assert.equal(peeled.avoid.g_ox, 1);
    assert.equal((peeled.avoid as { __taste?: unknown }).__taste, undefined);
    assert.ok(peeled.taste?.vetoes.some((v) => v.kind === "piece" && v.id === "g_field"));

    const row = rowToCloud({
      garments: [{ id: "g_ox" }],
      looks: [],
      journal: [],
      avoid: wire,
      drop: null,
      ref_photo: false,
      v: 6,
    });
    assert.equal(row?.avoid.g_ox, 1);
    assert.equal((row?.avoid as { __taste?: unknown }).__taste, undefined);
    assert.ok(row?.taste?.vetoes.some((v) => v.kind === "piece" && v.id === "g_field"));

    const local: CloudMeta = {
      garments: [{ id: "g_ox" }, { id: "g_chino" }],
      looks: [],
      journal: [],
      avoid: {},
      drop: null,
      refPhoto: false,
      v: 6,
    };
    const cloud: CloudMeta = { ...local, taste };
    const merged = mergeAccount({ local, cloud, lastCloudIds: null });
    assert.ok(merged.next.taste?.vetoes.some((v) => v.kind === "piece" && v.id === "g_field"));
    assert.equal(merged.next.garments.length >= 2, true);
  });
});

describe("today skip", () => {
  type Raw = {
    id: string;
    name?: string | null;
    category?: string;
    subtype?: string;
    material?: string;
    colors?: string[];
    brand?: string;
    fit?: string | null;
    warmth?: number;
    archived?: boolean;
    tombstone?: boolean;
  };
  function plate(p: Raw): Garment {
    const fit = p.fit === "slim" || p.fit === "relaxed" || p.fit === "regular" ? p.fit : undefined;
    return {
      id: p.id,
      name: p.name ?? "",
      category: (p.category ?? "top") as Garment["category"],
      subtype: p.subtype ?? "",
      colors: p.colors ?? [],
      material: p.material ?? "",
      brand: p.brand ?? "",
      notes: "",
      formality: 3,
      warmth: Math.min(5, Math.max(1, p.warmth ?? 3)) as Garment["warmth"],
      seasons: [],
      imageSrc: "",
      cutoutSrc: "",
      imageSource: "photo",
      matteQuality: "ok",
      demo: false,
      wornOn: [],
      ...(fit ? { fit } : {}),
      archived: false,
      createdAt: "2026-09-30T00:00:00.000Z",
    };
  }
  const GONE = new Set<string>(platesFile.deleted_garments as string[]);
  const RACK: Garment[] = (platesFile.plates as Raw[])
    .filter((p) => p.id && !p.tombstone && !p.archived && !GONE.has(p.id))
    .map(plate);
  const BY = new Map(RACK.map((g) => [g.id, g]));
  const DELETED = ["g_37e5eqjwgd3d", "g_c6qdv5c3gkor", "g_x0ro1mg2gu0a"];
  const SUMMER = ["g_zh2l854ghu1t", "g_lqf1mrlsure9", "g_jkj2nzfzpf1o"];
  const VARSITY = "g_j5og5jmzh5tx";
  /* A Thursday in October: fall with no reading, weekday by default. */
  const OCT = new Date(2026, 9, 8, 9);
  /* A true outer in the outerwear slot. isTrueOuter alone reads "suede" on a loafer. */
  const isOuter = (g: Garment) => slotOf(g) === "outerwear" && isTrueOuter(g);
  const resolve = (ids: readonly string[]) => ids.map((id) => BY.get(id)).filter((g): g is Garment => Boolean(g));
  const names = (ids: readonly string[]) => ids.map((id) => BY.get(id)?.name ?? id).join(" / ");
  const slots = (pieces: Garment[]) => ({
    tops: pieces.filter((g) => slotOf(g) === "top" || slotOf(g) === "dress").length,
    bottoms: pieces.filter((g) => slotOf(g) === "bottom").length,
    shoes: pieces.filter((g) => slotOf(g) === "footwear").length,
    outers: pieces.filter(isOuter).length,
  });
  const hasCore = (ids: readonly string[]) => {
    const s = slots(resolve(ids));
    return s.tops >= 1 && s.bottoms >= 1 && s.shoes >= 1;
  };
  function clean(ids: readonly string[], at: string) {
    for (const id of ids) {
      assert.equal(SUMMER.includes(id), false, `${at}: summer shirt ${names([id])}`);
      assert.equal(DELETED.includes(id), false, `${at}: deleted sneaker ${id}`);
      if (id === VARSITY) assert.equal(slotOf(BY.get(id)!), "top", `${at}: varsity is not a top`);
    }
  }
  const pick = (weather: WeatherSnap | undefined, occasion: Occasion, rack: Garment[] = RACK) =>
    pickDrop(rack, weather, occasion, undefined, undefined, undefined, undefined, undefined, { salt: 1 }, OCT);
  const mild: WeatherSnap = { f: 62, label: "Mild", code: 2, measured: true };
  const warm: WeatherSnap = { f: 73, label: "Warm", code: 1, measured: true };
  const cold: WeatherSnap = { f: 40, label: "Cold", code: 3, measured: true };

  it("pickDrop dresses weekday and out with a jacket at no reading and at 62, and legally at 73", (t) => {
    for (const occasion of ["weekday", "out"] as const) {
      for (const [label, weather] of [["no reading", undefined], ["62", mild], ["73", warm]] as const) {
        const t0 = performance.now();
        const ids = pick(weather, occasion);
        const ms = Math.round(performance.now() - t0);
        const pieces = resolve(ids);
        const at = `${occasion} @ ${label}`;
        t.diagnostic(`pickDrop ${at}: ${names(ids)} (${ms} ms)`);
        const s = slots(pieces);
        assert.equal(s.tops, 1, `${at}: ${s.tops} tops`);
        assert.equal(s.bottoms, 1, `${at}: ${s.bottoms} bottoms`);
        assert.equal(s.shoes, 1, `${at}: ${s.shoes} shoes`);
        assert.ok(s.outers <= 1, `${at}: ${s.outers} outers`);
        const ctx = { occasion, season: "fall" as const, ...(weather ? { weatherF: weather.f } : {}) };
        assert.equal(isLegal(pieces, ctx), true, `${at}: not legal`);
        clean(ids, at);
        if (label !== "73") {
          /* A jacket day. The outer is there, and the core alone was not enough: no reading became 68. */
          assert.equal(s.outers, 1, `${at}: no true outer`);
          assert.equal(isLegal(pieces.filter((g) => !isOuter(g)), ctx), false, `${at}: legal without the jacket`);
          const why = explain(pieces, ctx).hits.map((h) => h.why).join(" | ");
          assert.equal(why.includes("68"), false, why);
        }
      }
    }
  });

  it("five skips on weekday and five on out never leave Today empty and never repeat", (t) => {
    for (const occasion of ["weekday", "out"] as const) {
      const first = pick(undefined, occasion);
      assert.ok(hasCore(first), `${occasion}: no first look`);
      useCloset.setState({
        garments: RACK,
        looks: [],
        thisWeek: [],
        journal: [],
        avoid: {},
        skipCount: 0,
        reshuffleCount: 0,
        taste: emptyTaste(),
        drop: { date: todayISO(), garmentIds: first, worn: false, verdict: "pending", occasion },
      });
      const keys = new Set([comboKey(first)]);
      t.diagnostic(`${occasion} open: ${names(first)}`);
      for (let i = 1; i <= 5; i += 1) {
        useCloset.getState().skipDrop();
        const d = useCloset.getState().drop!;
        const at = `${occasion} skip ${i}`;
        assert.ok(d.garmentIds.length >= 3, `${at}: ${d.garmentIds.length} ids`);
        assert.ok(hasCore(d.garmentIds), `${at}: no core`);
        assert.equal(d.date, todayISO(), at);
        assert.equal(todayOccasion(d), occasion, at);
        clean(d.garmentIds, at);
        keys.add(comboKey(d.garmentIds));
        t.diagnostic(`${at}: ${names(d.garmentIds)}${d.lockNote ? ` (${d.lockNote})` : ""}`);
      }
      assert.equal(keys.size, 6, `${occasion}: ${keys.size} distinct looks of 6`);
      assert.equal(useCloset.getState().skipCount, 5, occasion);
    }
  });

  it("the occasion chip survives a skip: out stays out", () => {
    const first = pick(undefined, "weekday");
    useCloset.setState({
      garments: RACK,
      looks: [],
      thisWeek: [],
      journal: [],
      avoid: {},
      skipCount: 0,
      taste: emptyTaste(),
      drop: { date: todayISO(), garmentIds: first, worn: false, verdict: "pending", occasion: "weekday" },
    });
    const wrote = useCloset.getState().rerollDrop(undefined, "out", first);
    assert.equal(wrote, true);
    assert.equal(useCloset.getState().drop?.occasion, "out");
    useCloset.getState().skipDrop();
    const d = useCloset.getState().drop!;
    assert.equal(d.occasion, "out");
    assert.equal(todayOccasion(d), "out");
    assert.ok(d.garmentIds.length >= 3);
  });

  it("a pick that finds nothing keeps today's look with a note and logs no skip", () => {
    /* No outerwear on a fall weekday: no core at all, never an empty list written. */
    const bare = RACK.filter((g) => slotOf(g) !== "outerwear" && !isTrueOuter(g));
    const none = pick(mild, "weekday", bare);
    assert.equal(hasCore(none), false, names(none));
    /* Three pieces and a cold reading: winter in any month, a jacket required, none to find. */
    const top = RACK.find((g) => slotOf(g) === "top" && !SUMMER.includes(g.id))!;
    const bottom = RACK.find((g) => slotOf(g) === "bottom")!;
    const shoe = RACK.find((g) => slotOf(g) === "footwear" && !DELETED.includes(g.id))!;
    const prior = {
      date: todayISO(),
      garmentIds: [top.id, bottom.id, shoe.id],
      worn: false,
      verdict: "pending" as const,
      occasion: "weekday" as const,
      weather: cold,
    };
    useCloset.setState({
      garments: [top, bottom, shoe],
      looks: [],
      thisWeek: [],
      journal: [],
      avoid: {},
      skipCount: 0,
      taste: emptyTaste(),
      drop: prior,
    });
    useCloset.getState().skipDrop();
    const s = useCloset.getState();
    assert.deepEqual(s.drop?.garmentIds, prior.garmentIds);
    assert.equal(s.drop?.lockNote, "No other look fits right now. This one stays.");
    assert.equal(s.journal.some((j) => j.verdict === "skipped"), false);
    assert.equal(s.skipCount, 0);
    assert.deepEqual(s.avoid, {});
    /* The occasion chip still moves, even when nothing else fits. */
    assert.equal(s.rerollDrop(cold, "out", prior.garmentIds), false);
    assert.equal(useCloset.getState().drop?.occasion, "out");
    assert.deepEqual(useCloset.getState().drop?.garmentIds, prior.garmentIds);
  });

  it("skip on a past Saturday drop makes today's drop and logs no skip", () => {
    const first = pick(undefined, "weekend");
    useCloset.setState({
      garments: RACK,
      looks: [],
      thisWeek: [],
      journal: [],
      avoid: {},
      skipCount: 0,
      taste: emptyTaste(),
      drop: { date: "2026-10-03", garmentIds: first, worn: false, verdict: "pending", occasion: "weekend" },
    });
    useCloset.getState().skipDrop();
    const s = useCloset.getState();
    assert.equal(s.drop?.date, todayISO());
    assert.equal(s.drop?.occasion, defaultOccasion());
    assert.equal(todayOccasion(s.drop), defaultOccasion());
    assert.ok((s.drop?.garmentIds.length ?? 0) >= 3, names(s.drop?.garmentIds ?? []));
    assert.equal(s.journal.some((j) => j.verdict === "skipped"), false);
    assert.equal(s.skipCount, 0);
  });
});

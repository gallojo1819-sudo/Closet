import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import platesFile from "./stylist/__tests__/fixtures/plates-2026-09-30.json" with { type: "json" };
import {
  FALLBACK_REASON,
  HOUSE_WORDS,
  MIN_CONFIDENCE,
  REASON_BY_RULE,
  RULE_ID,
  allOwned,
  checkAlternative,
  checkSwaps,
  checkVerdict,
  isPhotoGarment,
  legalCtx,
  lookFromPieces,
  orderReasons,
  parseOutfitRead,
  pieceName,
  type CheckCtx,
  type PhotoPiece,
} from "./outfit-check.ts";
import { DELETED_SNEAKERS, isLegal, legalWithJacket, missingJacketOnly, type LegalCtx } from "./stylist/legal.ts";
import { jacketRequired } from "./stylist/jackets.ts";
import { isTrueOuter, slotOf, coreComboKey } from "./style.ts";
import { lookFitsSeason } from "./season.ts";
import { clashSentence } from "./detectors.ts";
import { normalizeTaste, pieceLine } from "./taste.ts";
import type { Garment, Occasion, Season } from "./types.ts";

/* The gaps.test.ts list, copied. Case-sensitive, so a garment word like "knit polo" does not trip it. */
const HOUSE_NAMES = /\b(Polo|Purple Label|RRL|ALD|Faloni|545|Sweet Stable|Italian summer|Italian winter|Ralph)\b/;

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

function garment(p: Raw): Garment {
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
  .map(garment);
const BY = new Map(RACK.map((g) => [g.id, g]));
const BRANDS = [...new Set(RACK.map((g) => g.brand.trim()).filter(Boolean))];
const DELETED = new Set<string>(DELETED_SNEAKERS);
const SUMMER_SHIRT = "g_zh2l854ghu1t";
const VARSITY = "g_j5og5jmzh5tx";

const own = (id: string): Garment => {
  const g = BY.get(id);
  assert.ok(g, `fixture lost ${id}`);
  return g;
};
const names = (ids: readonly string[]) => ids.map((id) => BY.get(id)?.name ?? id).join(" / ");
const resolve = (ids: readonly string[], extra: Garment[] = []) =>
  ids.map((id) => BY.get(id) ?? extra.find((g) => g.id === id)).filter((g): g is Garment => Boolean(g));

function synthetic(id: string, name: string, category: Garment["category"], subtype: string, colors: string[]): Garment {
  return garment({ id, name, category, subtype, colors, material: "cotton" });
}

function hasBrand(s: string): boolean {
  return BRANDS.some((b) => new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(s));
}

function assertClean(s: string, at: string) {
  assert.equal(HOUSE_NAMES.test(s), false, `${at}: house name in "${s}"`);
  assert.equal(RULE_ID.test(s), false, `${at}: rule id in "${s}"`);
  assert.equal(hasBrand(s), false, `${at}: brand in "${s}"`);
}

function assertOwnedLegal(ids: string[], ctx: CheckCtx, at: string) {
  assert.ok(allOwned(ids, RACK), `${at}: not all owned: ${ids.join(",")}`);
  for (const id of ids) {
    assert.equal(id.startsWith("photo_"), false, `${at}: photo id ${id}`);
    assert.equal(DELETED.has(id), false, `${at}: deleted sneaker ${id}`);
  }
  const pieces = resolve(ids);
  assert.equal(isLegal(pieces, legalCtx(ctx)), true, `${at}: not legal: ${names(ids)}`);
  assert.equal(lookFitsSeason(pieces, ctx.season), true, `${at}: out of season: ${names(ids)}`);
  if (ctx.season === "fall" || ctx.season === "winter") assert.equal(ids.includes(SUMMER_SHIRT), false, at);
  const outer = pieces.find((g) => slotOf(g) === "outerwear");
  if (outer) assert.notEqual(outer.id, VARSITY, `${at}: varsity as the outer`);
}

const TRIO = ["g_21b6d3qcohmu", "g_k75fdfdsnak0", "g_8nrtffa2s13s"];
const PRINTS = [
  synthetic("s_top", "Navy printed shirt", "top", "shirt", ["navy"]),
  synthetic("s_bot", "Olive printed trousers", "bottom", "trousers", ["olive"]),
  own("g_8nrtffa2s13s"),
];
const HOODIE_PIECES: PhotoPiece[] = [
  { slot: "top", name: "Grey hoodie", colors: ["grey"], subtype: "hoodie", material: "cotton", box: null, ownedId: null, confidence: 0.9 },
  { slot: "bottom", name: "Light grey pleated trousers", colors: ["light grey"], subtype: "trousers", material: "", box: null, ownedId: "g_k75fdfdsnak0", confidence: 0.9 },
  { slot: "footwear", name: "Brown suede tassel loafers", colors: ["brown"], subtype: "loafers", material: "suede", box: null, ownedId: "g_8nrtffa2s13s", confidence: 0.9 },
];
const HOODIE = lookFromPieces(HOODIE_PIECES, RACK);
const HOODIE_CTX: CheckCtx = { occasion: "weekday", season: "fall", weatherF: 62 };
const OCT = new Date(2026, 9, 8, 9);

describe("outfit check", () => {
  it("a) fall weekday trio with no jacket is works_with_jacket, naming an owned outer", (t) => {
    const look = resolve(TRIO);
    const ctx: CheckCtx = { occasion: "weekday", season: "fall", weatherF: 62 };
    const v = checkVerdict(look, ctx, RACK);
    assert.equal(v.state, "works_with_jacket", v.reason);
    assert.ok(v.jacketId, "no jacket id");
    const jacket = own(v.jacketId!);
    assert.equal(isTrueOuter(jacket), true);
    assert.equal(slotOf(jacket), "outerwear");
    assert.notEqual(jacket.id, VARSITY);
    assert.equal(isLegal([...look, jacket], legalCtx(ctx)), true);
    assert.ok(v.reason.includes(pieceName(jacket, RACK)), v.reason);
    assert.deepEqual(v.ruleIds, ["JKT-COV-1"]);
    t.diagnostic(`a) jacket at 62: ${jacket.name}`);
    const warm = checkVerdict(look, { occasion: "weekday", season: "fall", weatherF: 73 }, RACK);
    assert.equal(warm.state, "works", warm.reason);
    assert.equal(warm.jacket, undefined);
    assert.match(warm.reason, /Right for 73°F\.$/);
  });

  it("b) two prints is doesnt with Two prints.", () => {
    const v = checkVerdict(PRINTS, { occasion: "weekend", season: "fall" }, RACK);
    assert.equal(v.state, "doesnt");
    assert.equal(v.reason, "Two prints.");
    assert.ok(v.ruleIds.includes("XC-PAT-1"), v.ruleIds.join(","));
    assert.ok(v.reasons.indexOf("Two patterns at the same scale.") > 0, v.reasons.join(" | "));
  });

  it("c) occasion and weather reasons come first, a missing jacket last", () => {
    assert.deepEqual(orderReasons(["COL-7", "XC-SEA-2", "JKT-FORM-1", "CLASH"]), ["JKT-FORM-1", "XC-SEA-2", "CLASH", "COL-7"]);
    assert.deepEqual(orderReasons(["JKT-COV-1", "COL-7"]), ["COL-7", "JKT-COV-1"]);
    assert.deepEqual(orderReasons(["JKT-COV-1"]), ["JKT-COV-1"]);
    const shorts = [
      synthetic("s_top", "Navy printed shirt", "top", "shirt", ["navy"]),
      synthetic("s_shorts", "Olive printed shorts", "bottom", "shorts", ["olive"]),
      own("g_8nrtffa2s13s"),
    ];
    const v = checkVerdict(shorts, { occasion: "weekend", season: "winter", weatherF: 40 }, RACK);
    assert.equal(v.state, "doesnt");
    assert.equal(v.reason, "Shorts in winter.");
    assert.ok(v.reasons.indexOf("Two prints.") > 0, v.reasons.join(" | "));
  });

  it("d) the summer shirt in fall is doesnt, caught by the season", () => {
    const look = resolve([SUMMER_SHIRT, "g_k75fdfdsnak0", "g_8nrtffa2s13s"]);
    const ctx: CheckCtx = { occasion: "weekend", season: "fall" };
    assert.equal(isLegal(look, legalCtx(ctx)), true, "isLegal alone passes; the season must catch it");
    const v = checkVerdict(look, ctx, RACK);
    assert.equal(v.state, "doesnt");
    assert.equal(v.reason, "A summer shirt in fall.");
    assert.ok(v.ruleIds.includes("SEASON"));
  });

  it("e) cant_tell for a missing slot or an unclear core piece", () => {
    const noShoe = checkVerdict(resolve(["g_21b6d3qcohmu", "g_k75fdfdsnak0"]), HOODIE_CTX, RACK);
    assert.equal(noShoe.state, "cant_tell");
    assert.equal(noShoe.reason, "No shoes in the photo.");
    const dim = lookFromPieces(
      [{ ...HOODIE_PIECES[0]!, confidence: 0.2 }, HOODIE_PIECES[1]!, HOODIE_PIECES[2]!],
      RACK,
    );
    const v = checkVerdict(dim, HOODIE_CTX, RACK);
    assert.equal(v.state, "cant_tell");
    assert.equal(v.reason, "The photo is too unclear to tell.");
    assert.equal(MIN_CONFIDENCE, 0.4);
  });

  it("f) an unowned piece is judged, never swapped in or saved", () => {
    assert.equal(isPhotoGarment(HOODIE[0]!), true);
    const v = checkVerdict(HOODIE, HOODIE_CTX, RACK);
    assert.equal(v.state, "doesnt", v.reason);
    assert.ok(v.ruleIds.includes("XC-TEX-4"), v.ruleIds.join(","));
    assert.ok(v.ruleIds.includes("CLASH"), v.ruleIds.join(","));
    assert.equal(allOwned(HOODIE.map((g) => g.id), RACK), false);
    const swaps = checkSwaps(HOODIE, RACK, HOODIE_CTX);
    for (const s of swaps) {
      assert.ok(BY.has(s.inId) && !s.inId.startsWith("photo_"), s.inId);
      for (const id of s.ids) assert.ok(BY.has(id) && !id.startsWith("photo_"), id);
      if (s.outId === HOODIE[0]!.id) assert.equal(allOwned(s.ids, RACK), true);
    }
    const alt = checkAlternative(HOODIE, RACK, HOODIE_CTX, undefined, OCT);
    if (alt) for (const id of alt.ids) assert.ok(BY.has(id) && !id.startsWith("photo_"), id);
    const src = readFileSync(new URL("./outfit-check.ts", import.meta.url), "utf8");
    assert.equal(/from "\.\/store/.test(src), false);
    assert.equal(/from "\.\/ai/.test(src), false);
    for (const word of ["saveLook", "wearToday", "setDrop", "localStorage"]) assert.equal(src.includes(word), false, word);
  });

  it("g) swaps: at most two, owned, legal, different slots, vetoes respected", () => {
    for (const [label, look, ctx] of [
      ["hoodie", HOODIE, HOODIE_CTX],
      ["prints", PRINTS, { occasion: "weekend", season: "fall" } as CheckCtx],
    ] as const) {
      const swaps = checkSwaps(look, RACK, ctx);
      assert.ok(swaps.length <= 2, label);
      assert.equal(new Set(swaps.map((s) => s.slot)).size, swaps.length, `${label}: slots repeat`);
      for (const s of swaps) {
        assertOwnedLegal(s.ids, ctx, `${label} swap`);
        assertClean(s.line, `${label} swap line`);
        assert.match(s.line, /^Swap the .+ for your .+\.$/);
      }
    }
    const first = checkSwaps(HOODIE, RACK, HOODIE_CTX);
    assert.ok(first.length >= 1, "the hoodie look has a swap");
    const best = first[0]!;
    const vetoed = normalizeTaste({ vetoes: [{ kind: "piece", id: best.inId }] });
    const again = checkSwaps(HOODIE, RACK, HOODIE_CTX, vetoed);
    for (const s of again) {
      assert.notEqual(s.inId, best.inId);
      assert.equal(s.ids.includes(best.inId), false);
    }
    const inPiece = own(best.inId);
    const other = HOODIE.find((g) => g.id !== best.outId && slotOf(g) === "footwear")!;
    /* A pairing veto is one word a side, stemmed. The last word of each name is that piece's kind. */
    const word = (g: Garment) => g.name.trim().split(/\s+/).pop() ?? g.name;
    const pairVeto = normalizeTaste({ vetoes: [{ kind: "pairing", a: word(inPiece), b: word(other) }] });
    const third = checkSwaps(HOODIE, RACK, HOODIE_CTX, pairVeto);
    assert.equal(third.some((s) => s.inId === best.inId), false, "pairing veto removes the best swap");
  });

  it("h) the alternative is re-checked before it is offered", (t) => {
    const alt = checkAlternative(HOODIE, RACK, HOODIE_CTX, undefined, OCT);
    assert.ok(alt, "no alternative for the hoodie look");
    assert.deepEqual(alt!.kept, ["g_k75fdfdsnak0"], "the first lock is the owned trousers");
    t.diagnostic(`h) alternative: ${names(alt!.ids)}`);
    const check = (res: { ids: string[]; kept: string[]; line: string } | null, look: Garment[], ctx: CheckCtx, at: string) => {
      if (!res) return;
      assertOwnedLegal(res.ids, ctx, at);
      const pieces = resolve(res.ids);
      if (jacketRequired(ctx.occasion, ctx.season, ctx.weatherF)) {
        assert.ok(pieces.some((g) => slotOf(g) === "outerwear"), `${at}: no outer`);
      }
      assert.notEqual(coreComboKey(res.ids, RACK), coreComboKey(look.map((g) => g.id), [...RACK, ...look]), `${at}: same core`);
      assertClean(res.line, at);
      assert.match(res.line, /^Or wear: .+\.$/);
    };
    check(alt, HOODIE, HOODIE_CTX, "hoodie");
    for (const [occasion, season, weatherF] of [
      ["out", "fall", undefined],
      ["weekend", "winter", 40],
    ] as const) {
      const ctx: CheckCtx = { occasion, season, ...(weatherF !== undefined ? { weatherF } : {}) };
      check(checkAlternative(PRINTS, RACK, ctx, undefined, OCT), PRINTS, ctx, `${occasion} ${season}`);
    }
  });

  it("i) parseOutfitRead validates ids and boxes", () => {
    const text = [
      "```json",
      JSON.stringify({
        pieces: [
          { slot: "top", name: "Brown blue plaid shirt", ownedId: "g_21b6d3qcohmu", box: { x: 10, y: 20, w: 30, h: 40 }, colors: ["Brown", "Cream", "Tan", "Navy"], confidence: 0.9 },
          { slot: "top", name: "Blue oxford", ownedId: "g_fake123", confidence: 2 },
          { slot: "top", name: "Navy knit", ownedId: "g_8nrtffa2s13s" },
          { slot: "footwear", name: "Grey sneakers", ownedId: "g_37e5eqjwgd3d" },
          { slot: "bottom", name: "Grey trousers", ownedId: "g_k75fdfdsnak0" },
          { slot: "bottom", name: "Grey cords", ownedId: "g_k75fdfdsnak0" },
          { slot: "top", name: "face", box: { x: 0.4, y: 0.05, w: 0.2, h: 0.2 } },
          { slot: "accessory", name: "Brown belt" },
        ],
      }),
      "```",
    ].join("\n");
    const pieces = parseOutfitRead(text, RACK);
    const by = new Map(pieces.map((p) => [p.name, p]));
    assert.equal(by.get("Brown blue plaid shirt")?.ownedId, "g_21b6d3qcohmu");
    assert.deepEqual(by.get("Brown blue plaid shirt")?.box, { x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
    assert.deepEqual(by.get("Brown blue plaid shirt")?.colors, ["brown", "cream", "tan"]);
    assert.equal(by.get("Blue oxford")?.ownedId, null, "fake id");
    assert.equal(by.get("Blue oxford")?.confidence, 1, "confidence clamped");
    assert.equal(by.get("Navy knit")?.ownedId, null, "footwear id on a top");
    assert.equal(by.get("Navy knit")?.confidence, 0.5, "missing confidence");
    assert.equal(by.get("Grey sneakers")?.ownedId, null, "deleted sneaker");
    assert.equal(by.get("Grey trousers")?.ownedId, "g_k75fdfdsnak0");
    assert.equal(by.get("Grey cords")?.ownedId, null, "same id twice");
    assert.equal(by.has("face"), false, "face row dropped");
    assert.equal(by.has("Brown belt"), false, "accessory dropped");
    assert.ok(pieces.length <= 6);
    assert.deepEqual(parseOutfitRead("not json", RACK), []);
    assert.deepEqual(parseOutfitRead("[]", RACK), []);
  });

  it("j) no output string names a house, brand or rule id", () => {
    const tops = RACK.filter((g) => slotOf(g) === "top").slice(0, 8);
    const bottoms = RACK.filter((g) => slotOf(g) === "bottom").slice(0, 4);
    const shoes = RACK.filter((g) => slotOf(g) === "footwear").slice(0, 3);
    const poloBear = own("g_6qz38nwsrupx");
    if (!tops.includes(poloBear)) tops.push(poloBear);
    assert.equal(pieceName(poloBear, RACK).includes("Polo"), false, pieceName(poloBear, RACK));
    assert.equal(HOUSE_WORDS.source, HOUSE_NAMES.source);
    const ctxs: CheckCtx[] = [];
    for (const occasion of ["weekday", "out", "weekend"] as Occasion[]) {
      for (const season of ["fall", "winter"] as Season[]) ctxs.push({ occasion, season });
    }
    const failing: { look: Garment[]; ctx: CheckCtx }[] = [];
    let seen = 0;
    for (const ctx of ctxs) {
      for (const top of tops) {
        for (const bottom of bottoms) {
          for (const shoe of shoes) {
            const look = [top, bottom, shoe];
            const v = checkVerdict(look, ctx, RACK);
            seen += 1;
            const at = `${names(look.map((g) => g.id))} @ ${ctx.occasion} ${ctx.season}`;
            assertClean(v.reason, at);
            for (const line of v.reasons) assertClean(line, at);
            if (v.jacket) assertClean(v.jacket, at);
            assert.ok(v.reasons.length >= 1 && v.reasons.length <= 3, at);
            assert.equal(v.reasons[0], v.reason, at);
            if (v.state === "doesnt" && failing.length < 12) failing.push({ look, ctx });
          }
        }
      }
    }
    assert.ok(seen >= 500, `${seen} looks swept`);
    assert.ok(failing.length >= 1, "no failing look to suggest for");
    for (const { look, ctx } of failing) {
      const at = `${names(look.map((g) => g.id))} @ ${ctx.occasion} ${ctx.season}`;
      for (const s of checkSwaps(look, RACK, ctx)) {
        assertClean(s.line, at);
        if (s.jacket) assertClean(s.jacket, at);
        assertOwnedLegal(s.ids, ctx, at);
      }
      const alt = checkAlternative(look, RACK, ctx, undefined, OCT);
      if (alt) {
        assertClean(alt.line, at);
        assertOwnedLegal(alt.ids, ctx, at);
      }
    }
  });

  it("k) REASON_BY_RULE covers the hard rules, unknown ids fall back", () => {
    const ids = [
      "JKT-FORM-1", "JKT-FORM-2", "XC-TEX-3", "XC-TEX-8",
      "JKT-COV-1", "JKT-COV-2", "JKT-COV-3", "XC-SEA-1", "XC-SEA-2", "XC-SEA-3", "XC-SEA-4",
      "XC-SEA-5", "XC-TEX-1", "XC-TEX-2", "XC-TEX-4", "XC-TEX-5", "XC-TEX-6", "XC-TEX-7", "XC-TEX-9",
      "XC-PROP-1", "XC-PROP-2", "XC-PAT-1", "XC-DEN-1", "XC-DEN-2",
      "COL-7", "COL-8", "COL-9", "COL-10", "COL-11", "COL-12", "COL-13",
      "JKT-LAY-1", "JKT-LAY-2", "JKT-LAY-3", "JKT-LAY-4", "JKT-LAY-5", "JKT-LAY-6", "JKT-LAY-7", "JKT-LAY-8",
      "GRAPHIC_COAT", "SLOTS",
    ];
    for (const id of ids) {
      const line = REASON_BY_RULE[id];
      assert.ok(line, id);
      assertClean(line!, id);
      assert.equal(/\d/.test(line!), false, `${id}: a number in "${line}"`);
    }
    assert.equal(REASON_BY_RULE["ZZ-1"], undefined);
    assert.equal(clashSentence(PRINTS), "Two prints.");
    assert.equal(clashSentence(resolve(TRIO)), null);
    assert.equal(FALLBACK_REASON, "These don't sit well together.");
    assertClean(FALLBACK_REASON, "fallback");
  });

  it("l) legalWithJacket keeps pickDrop's behaviour", () => {
    const tops = RACK.filter((g) => slotOf(g) === "top").slice(0, 6);
    const bottoms = RACK.filter((g) => slotOf(g) === "bottom").slice(0, 5);
    const shoes = RACK.filter((g) => slotOf(g) === "footwear").slice(0, 4);
    const outers = RACK.filter((g) => slotOf(g) === "outerwear" && isTrueOuter(g)).slice(0, 3);
    const ctxs: LegalCtx[] = [];
    for (const occasion of ["weekday", "out", "weekend"]) {
      ctxs.push({ occasion, season: "fall" });
      ctxs.push({ occasion, season: "fall", weatherF: 62 });
      ctxs.push({ occasion, season: "fall", weatherF: 73 });
      ctxs.push({ occasion, season: "winter", weatherF: 40 });
    }
    let n = 0;
    for (const top of tops) {
      for (const bottom of bottoms) {
        for (const shoe of shoes) {
          const looks = [[top, bottom, shoe], ...outers.map((o) => [top, bottom, shoe, o])];
          for (const p of looks) {
            for (const ctx of ctxs) {
              const expected =
                isLegal(p, ctx) ||
                (jacketRequired(String(ctx.occasion), String(ctx.season), ctx.weatherF) &&
                  !p.some((g) => slotOf(g) === "outerwear") &&
                  missingJacketOnly(p, ctx));
              assert.equal(legalWithJacket(p, ctx), expected, `${names(p.map((g) => g.id))} @ ${JSON.stringify(ctx)}`);
              n += 1;
            }
          }
        }
      }
    }
    assert.ok(n >= 5000, `${n} checks`);
    const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
    assert.equal(store.includes("legalWithJacket(pieces, ctx)"), true);
    assert.equal(store.includes("missingJacketOnly("), false);
  });

  it("m) pieceLine is exported", () => {
    const line = pieceLine(own("g_21b6d3qcohmu"));
    assert.match(line, /^- .+ \[g_21b6d3qcohmu\] \(.+\)$/);
  });
});

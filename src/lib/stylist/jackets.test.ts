import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Plate } from "../house-profiles/evaluate.ts";
import { LIVE_SNAPSHOT_COUNT, testCloset } from "../__fixtures__/snapshot.ts";
import { HOUSES } from "../houses.ts";
import type { Garment } from "../types.ts";
import platesFile from "./__tests__/fixtures/plates-2026-09-30.json" with { type: "json" };
import classFile from "./data/2026-09-30-jacket-classification.json" with { type: "json" };
import jacketRules from "./data/2026-09-30-jacket-rules.json" with { type: "json" };
import { isLegal } from "./legal.ts";
import { buildHouseMatrix, clearMatrixCache, type MatrixLook } from "./matrix.ts";
import { wash } from "./rules.ts";
import {
  CUT_CONFIRM,
  SUEDE_FAMILY,
  allowedJackets,
  fwEligibleJackets,
  houseCode,
  jacketHits,
  jacketInfo,
  jacketRequired,
  slotPieces,
  wearSlot,
  type JacketHit,
} from "./jackets.ts";

const by = new Map<string, Plate>(
  (platesFile.plates as Plate[]).filter((p) => p.id).map((p) => [p.id, p]),
);

type RuleTest = {
  look?: Record<string, string | undefined>;
  expected: string;
  context?: { occasion?: string; season?: string };
  house?: string;
  why?: string;
};

type Rule = { id: string; tests?: RuleTest[] };

function pieces(look: Record<string, string | undefined>): Partial<Record<string, Plate>> {
  const ps: Partial<Record<string, Plate>> = {};
  for (const [slot, id] of Object.entries(look)) {
    if (!id) continue;
    const g = by.get(id);
    if (g) ps[slot] = g;
  }
  return ps;
}

function kept(ruleId: string, hits: JacketHit[]): JacketHit[] {
  const ids = new Set([ruleId]);
  if (ruleId === "JKT-LAY-6") ids.add("JKT-COV-1");
  if (ruleId === "JKT-HX-1") ids.add("JKT-LAY-2");
  return hits.filter((h) => ids.has(h.id));
}

function grade(expected: string, hits: JacketHit[]): boolean {
  const hard = hits.some((h) => h.severity === "hard");
  if (expected === "fail" || expected.startsWith("fail")) return hard;
  if (expected === "pass") return hits.length === 0;
  const m = /^soft (-?\d+)$/.exec(expected);
  if (!m) return false;
  const sum = hits.reduce((s, h) => s + (h.severity === "soft" ? h.delta : 0), 0);
  return !hard && sum === Number(m[1]);
}

const groups: Rule[] = [
  ...(jacketRules.cross_chip_layering_rules as Rule[]),
  ...(jacketRules.cross_chip_formality_rules as Rule[]),
  ...(jacketRules.cross_chip_coverage_rules as Rule[]),
  ...(jacketRules.per_house_additions as Rule[]).filter((r) => (r.tests?.length ?? 0) > 0),
];

const flat = groups.flatMap((rule) =>
  (rule.tests ?? []).filter((t) => t.look && (t.expected === "fail" || t.expected === "pass" || t.expected.startsWith("soft"))).map((test, i) => ({ rule, test, i })),
);

/*
 * The rule JSON is a law file pinned by hash (profiles.test.ts), so a case the owner's later
 * rule overrides is graded here against the override, not edited there. JKT-LAY-2 (probability
 * round): a woven shirt, a fine knit, a zip knit or a tee under a soft sport coat passes; a
 * chunky or cable knit, a graphic or collegiate piece, or a plain tee or henley under a
 * structured sport coat fails (#1 is graded as the document wrote it).
 */
const SUPERSEDED: Record<string, string> = {
  "JKT-LAY-2#2": "pass",
  "JKT-LAY-2#4": "pass",
};

describe("T1 jacket rules", () => {
  it("loads 63 graded tests", () => {
    expect(flat).toHaveLength(63);
  });

  for (const { rule, test: given, i } of flat) {
    const override = SUPERSEDED[`${rule.id}#${i + 1}`];
    const test = override ? { ...given, expected: override, why: `${given.why ?? ""} (superseded: ${override})` } : given;
    it(`${rule.id} #${i + 1} ${test.expected} ${test.why ?? ""}`, () => {
      const hits = jacketHits(pieces(test.look ?? {}), {
        occasion: test.context?.occasion ?? "weekday",
        season: test.context?.season ?? "fall",
        house: test.house,
      });
      const mine = kept(rule.id, hits);
      const seen = mine.map((h) => `${h.id}:${h.severity}:${h.delta}:${h.why}`).join(" | ") || "(no hit)";
      expect(grade(test.expected, mine), seen).toBe(true);
    });
  }
});

/* Joe 2026-10-18: "jeans can go with blazer sometimes if it works". On the owner's real closet, ecru and
   mid-wash clean jeans under the navy blazer are a soft mark-down (-15 weekday, out and comfy; -10 weekend
   and travel), never a block; light-wash, white, striped and distressed jeans stay hard everywhere. */
describe("JKT-LAY-3 jeans with a sport coat on the live snapshot", () => {
  const live = (id: string): Garment => {
    const g = testCloset.find((x) => x.id === id);
    if (!g) throw new Error(`${id} is not in the snapshot`);
    return g;
  };
  const BLAZER = "g_5josnvyoi4z9"; /* navy blazer */
  const SHIRT = "g_pa7kfg14rtzl"; /* white button-up shirt */
  const LOAFERS = "g_8nrtffa2s13s"; /* brown suede tassel loafers */
  const SOFT = [
    { id: "g_j994h3k9l8ot", wash: 0 } /* cream straight-leg jeans: ecru */,
    { id: "g_btael28aebgu", wash: 2 } /* beige patchwork jeans: mid */,
  ];
  const HARD = ["g_rvrs9hibr981", "g_8t9o3g4r78c2", "g_lxqx9egrqg14", "g_zw51yaqdsx0q"]; /* light, light, striped, white distressed */
  const OCCASIONS = ["weekday", "out", "comfy", "weekend", "travel"] as const;
  const lay3 = (look: Garment[], occasion: string) =>
    jacketHits(slotPieces(look as unknown as Plate[]), { occasion, season: "fall" }).filter((h) => h.id === "JKT-LAY-3");

  it("reads the real snapshot", () => {
    expect(testCloset).toHaveLength(LIVE_SNAPSHOT_COUNT);
    for (const { id, wash: w } of SOFT) expect(wash(live(id) as unknown as Plate), id).toBe(w);
  });

  for (const { id } of SOFT) {
    for (const occasion of OCCASIONS) {
      const delta = occasion === "weekend" || occasion === "travel" ? -10 : -15;
      it(`${id} under the navy blazer on ${occasion}: soft LAY-3 ${delta}, no hard ${occasion === "comfy" ? "LAY-3" : "hit"}`, () => {
        const look = [live(SHIRT), live(id), live(BLAZER), live(LOAFERS)];
        /* Comfy keeps its own formality block on a sport coat (JKT-FORM-1); the denim itself is never the block. */
        const all = jacketHits(slotPieces(look as unknown as Plate[]), { occasion, season: "fall" }).filter((h) => occasion !== "comfy" || h.id === "JKT-LAY-3");
        expect(all.filter((h) => h.severity === "hard")).toEqual([]);
        expect(lay3(look, occasion).map((h) => [h.severity, h.delta])).toEqual([["soft", delta]]);
      });
    }
  }

  it("weekday navy blazer with the cream straight-leg jeans is a legal look", () => {
    const look = [live(SHIRT), live("g_j994h3k9l8ot"), live(BLAZER), live(LOAFERS)];
    expect(isLegal(look, { occasion: "weekday", season: "fall" })).toBe(true);
  });

  for (const id of HARD) {
    it(`${id} under the navy blazer stays a hard LAY-3 on every occasion`, () => {
      for (const occasion of OCCASIONS) {
        const look = [live(SHIRT), live(id), live(BLAZER), live(LOAFERS)];
        expect(lay3(look, occasion).some((h) => h.severity === "hard"), `${id} on ${occasion}`).toBe(true);
      }
    });
  }
});

describe("T2 screenshot cards", () => {
  const card1 = { top: "g_gp53xkrmem9b", outer: "g_juk45cokjxxy", bottom: "g_rvrs9hibr981", shoe: "g_8ukg5mi9r3fc" };
  const card2 = { top: "g_xbt3gpjuo1p4", bottom: "g_k75fdfdsnak0", shoe: "g_rxglifsoqobm" };
  const card3 = { mid: "g_j2id379jo424", bottom: "g_v3ovns4bv344", shoe: "g_b4zsf3dfrhdv" };

  for (const season of ["fall", "winter"] as const) {
    for (const occasion of ["weekday", "weekend"] as const) {
      it(`card 1 fails LAY-1 and LAY-3 on ${occasion}/${season}`, () => {
        const hits = jacketHits(pieces(card1), { occasion, season });
        expect(hits.some((h) => h.id === "JKT-LAY-1" && h.severity === "hard")).toBe(true);
        expect(hits.some((h) => h.id === "JKT-LAY-3" && h.severity === "hard")).toBe(true);
      });
    }
  }

  it("card 2 and card 3 fail COV-1 on weekday/fall", () => {
    for (const look of [card2, card3]) {
      const hits = jacketHits(pieces(look), { occasion: "weekday", season: "fall" });
      expect(hits.some((h) => h.id === "JKT-COV-1" && h.severity === "hard")).toBe(true);
    }
  });

  const fixes = [
    { top: "g_gp53xkrmem9b", outer: "g_1pg9y05mlkek", bottom: "g_dzsh3qh7v6sb", shoe: "g_8ukg5mi9r3fc" },
    { top: "g_2rtuat7aheik", outer: "g_juk45cokjxxy", bottom: "g_dzsh3qh7v6sb", shoe: "g_8ukg5mi9r3fc" },
    { top: "g_gp53xkrmem9b", outer: "g_wwy9b2pusds3", bottom: "g_v3ovns4bv344", shoe: "g_8ukg5mi9r3fc" },
    { top: "g_xbt3gpjuo1p4", outer: "g_1pg9y05mlkek", bottom: "g_k75fdfdsnak0", shoe: "g_8ukg5mi9r3fc" },
    { mid: "g_j2id379jo424", outer: "g_8qqqzpwxuwti", bottom: "g_v3ovns4bv344", shoe: "g_b4zsf3dfrhdv" },
    { mid: "g_j2id379jo424", outer: "g_1pg9y05mlkek", bottom: "g_v3ovns4bv344", shoe: "g_b4zsf3dfrhdv" },
    { mid: "g_j2id379jo424", outer: "g_3qjmw7n4wj2a", bottom: "g_v3ovns4bv344", shoe: "g_b4zsf3dfrhdv" },
    { mid: "g_j2id379jo424", outer: "g_wwy9b2pusds3", bottom: "g_v3ovns4bv344", shoe: "g_b4zsf3dfrhdv" },
  ];

  it("listed fixes have no hard jacket hit", () => {
    for (const look of fixes) {
      const season = look.outer === "g_wwy9b2pusds3" ? "winter" : "fall";
      const hits = jacketHits(pieces(look), { occasion: "weekday", season });
      const hard = hits.filter((h) => h.severity === "hard").map((h) => h.why);
      expect(hard, JSON.stringify(look)).toEqual([]);
    }
  });
});

describe("T3 classification", () => {
  // 16 casual, not 17: Joe overruled the Sep 30 call; the Khaki varsity is a top, so it left plates[].
  it("counts 4 sport coats, 16 casual, 5 mid, 0 coats", () => {
    const counts = { sport_coat_soft: 0, sport_coat_structured: 0, casual: 0, coat: 0, mid: 0 };
    for (const row of classFile.plates as { id: string }[]) {
      const g = by.get(row.id);
      expect(g, row.id).toBeTruthy();
      const info = jacketInfo(g!);
      if (info.class && info.class !== null) counts[info.class] += 1;
    }
    expect(counts).toEqual({ sport_coat_soft: 2, sport_coat_structured: 2, casual: 16, coat: 0, mid: 5 });
  });

  // Flipped: the Khaki varsity is a crew-neck top, not a jacket. No id row, no wear-slot override.
  it("varsity is a top, and the zip knit is mid despite the stored category", () => {
    const varsity = by.get("g_j5og5jmzh5tx")!;
    const zip = by.get("g_j2id379jo424")!;
    expect(varsity.category).toBe("top");
    expect(wearSlot(varsity)).toBeNull();
    expect(jacketInfo(varsity).class).toBeNull();
    expect(jacketInfo(varsity).countsAsJacket).toBe(false);
    expect(zip.category).toBe("outerwear");
    expect(wearSlot(zip)).toBe("mid");
    expect(jacketInfo(zip).countsAsJacket).toBe(false);
  });

  it("flags the four cuts Joe still has to confirm", () => {
    for (const id of CUT_CONFIRM) {
      const info = jacketInfo(by.get(id)!);
      expect(info.confirm, id).toBe(true);
    }
    const cuts: Record<string, string | null> = {
      g_3qjmw7n4wj2a: "roomy",
      g_5gfabeezh485: "roomy",
      g_x4adkv9zu9yu: "waist",
      g_py2swfwot1ed: "waist",
    };
    for (const [id, cut] of Object.entries(cuts)) expect(jacketInfo(by.get(id)!).cut).toBe(cut);
  });

  it("sha256 of the copied jacket files matches", () => {
    /* LF bytes, whatever the checkout did to line endings. The pins were taken from LF. */
    const sha = (path: string) =>
      createHash("sha256").update(readFileSync(path, "utf8").replace(/\r\n/g, "\n")).digest("hex");
    expect(sha("src/lib/stylist/data/2026-09-30-jacket-rules.json")).toBe(
      // Re-pinned 2026-10-18: JKT-LAY-3 ecru/mid jeans on weekday/out are a -15 mark-down, not hard (Joe).
      "093441455afa5614e9a68b83767d0dd25e47465a006ba073b0ee7511c8542c07",
    );
    expect(sha("src/lib/stylist/data/2026-09-30-jacket-classification.json")).toBe(
      // Re-pinned: the Khaki varsity left plates[] and misfiled[] (it is a top), casual count 17 -> 16.
      "184ffd3fd7b8ad77ae809bc5c3b8ab7e5ddf7743d54dee78a94be9615d1a83a0",
    );
    expect(sha("docs/stylist/2026-09-30-jacket-rules.md")).toBe(
      "e78ace3ac0e01ed3943f169dc2b94e6b69c912eeaf5721c601aaa93ac2c97b0a",
    );
    expect(sha("src/lib/stylist/__tests__/fixtures/plates-2026-09-30.json")).toBe(
      "dd4788a465042c9f22519a8880fd90bfbbb3459fa6ad0a32d6aef4c09abae126",
    );
  });
});

describe("T4 allowed jackets", () => {
  const codes = ["rrl", "polo", "purple", "ald", "faloni", "545", "sweetstable", "italiansummer", "italianwinter"];

  function afterSet(code: string, season: string): string[] {
    const ids: string[] = [];
    for (const plate of classFile.plates as { id: string; seasons?: string[]; houses_after?: string[]; counts_as_jacket?: boolean }[]) {
      if (plate.counts_as_jacket === false) continue;
      const seasons = plate.seasons ?? [];
      if (seasons.length && !seasons.includes(season)) continue;
      const hit = (plate.houses_after ?? []).some((h) => {
        const winterOnly = h.includes("winter only");
        const name = h.replace(" (winter only)", "");
        if (name !== code) return false;
        if (winterOnly && season !== "winter") return false;
        return true;
      });
      if (hit) ids.push(plate.id);
    }
    return ids.sort();
  }

  it("matches houses_after for every house and season", () => {
    for (const code of codes) {
      for (const season of ["spring", "summer", "fall", "winter"]) {
        expect(allowedJackets(code, season), `${code}/${season}`).toEqual(afterSet(code, season));
      }
    }
  });

  it("545 has the cord jacket, and 545 and Faloni have the shearling in winter only", () => {
    expect(allowedJackets("545", "fall")).toContain("g_x4adkv9zu9yu");
    expect(allowedJackets("fiveFourFive", "winter")).toContain("g_x4adkv9zu9yu");
    expect(allowedJackets("545", "winter")).toContain("g_wwy9b2pusds3");
    expect(allowedJackets("545", "fall")).not.toContain("g_wwy9b2pusds3");
    expect(allowedJackets("faloni", "winter")).toContain("g_wwy9b2pusds3");
    expect(allowedJackets("faloni", "fall")).not.toContain("g_wwy9b2pusds3");
    expect(houseCode("fiveFourFive")).toBe("545");
  });

  it("the mint field jacket is Polo-only", () => {
    for (const code of codes) {
      for (const season of ["fall", "summer"]) {
        const list = allowedJackets(code, season);
        if (code === "polo") expect(list).toContain("g_oyyiaxx6rls7");
        else expect(list, `${code}/${season}`).not.toContain("g_oyyiaxx6rls7");
      }
    }
    expect(fwEligibleJackets().length).toBeGreaterThan(18);
  });
});

const DELETED = ["g_37e5eqjwgd3d", "g_c6qdv5c3gkor", "g_x0ro1mg2gu0a"];
const VARSITY = "g_j5og5jmzh5tx";
const SUEDE = new Set<string>(SUEDE_FAMILY);

function rackGarment(p: Plate & { archived?: boolean; tombstone?: boolean }): Garment {
  const warmth = Math.min(5, Math.max(1, p.warmth ?? 3)) as Garment["warmth"];
  const fit = p.fit === "slim" || p.fit === "relaxed" || p.fit === "regular" ? p.fit : "regular";
  return {
    id: p.id,
    name: p.name ?? "",
    category: (p.category ?? "top") as Garment["category"],
    subtype: p.subtype ?? "",
    colors: p.colors ?? [],
    material: p.material ?? "",
    brand: p.brand ?? "",
    notes: p.notes ?? "",
    formality: 3,
    warmth,
    seasons: [],
    imageSrc: "",
    cutoutSrc: "",
    imageSource: "photo",
    matteQuality: "ok",
    demo: false,
    wornOn: [],
    fit,
    archived: Boolean(p.archived || p.tombstone),
    createdAt: "2026-09-30T00:00:00.000Z",
  };
}

describe("T5 caps on the fixture", () => {
  const contexts = ["weekday", "out", "weekend", "travel"].flatMap((occasion) =>
    ["fall", "winter"].map((season) => [occasion, season] as const),
  );
  const rack = (platesFile.plates as (Plate & { archived?: boolean; tombstone?: boolean })[])
    .filter((p) => p.id && !p.tombstone && !p.archived && !DELETED.includes(p.id))
    .map(rackGarment);
  const rackBy = new Map(rack.map((g) => [g.id, g]));

  function slots(look: MatrixLook): Partial<Record<string, Plate>> {
    const ps: Partial<Record<string, Plate>> = {};
    const put = (slot: string, id?: string) => {
      const g = id ? rackBy.get(id) : undefined;
      if (g) ps[slot] = g;
    };
    put("top", look.top);
    put("bottom", look.bottom);
    put("shoe", look.shoe);
    put("outer", look.outer);
    return ps;
  }

  it("ROT-1, ROT-2, ROT-4, coverage, and the old grey-knit blazer", () => {
    clearMatrixCache();
    const built = contexts.map(([occasion, season]) => ({
      occasion,
      season,
      matrix: buildHouseMatrix(rack, occasion, season),
    }));
    const demoted: string[] = [];
    const misses: string[] = [];
    const sportOverChunky: string[] = [];
    const rot1: string[] = [];
    const rot2: string[] = [];
    const varsityOuter: string[] = [];
    const seenDeleted: string[] = [];
    const fwOuters = new Set<string>();

    for (const { occasion, season, matrix } of built) {
      const housesOf = new Map<string, Set<string>>();
      const suedeHouses = new Set<string>();
      for (const house of HOUSES) {
        const cell = matrix.houses[house];
        if (!cell || cell.gate) continue;
        const ids = new Map<string, number>();
        let suede = 0;
        cell.looks.forEach((look, index) => {
          const key = `${house}/${occasion}/${season}#${index}`;
          for (const id of [look.top, look.bottom, look.shoe, look.outer]) {
            if (id && DELETED.includes(id)) seenDeleted.push(`${key}:${id}`);
          }
          if (look.outer === VARSITY) varsityOuter.push(key);
          if (look.demoted) demoted.push(`${key}:${look.top}|${look.bottom}|${look.shoe}`);
          if (jacketRequired(occasion, season) && !look.outer && !look.demoted) misses.push(key);
          if (look.outer) {
            fwOuters.add(look.outer);
            ids.set(look.outer, (ids.get(look.outer) ?? 0) + 1);
            if (SUEDE.has(look.outer)) suede += 1;
            const info = jacketInfo(rackBy.get(look.outer)!);
            if (info.class === "sport_coat_soft" || info.class === "sport_coat_structured") {
              const hard = jacketHits(slots(look), { occasion, season, house }).some(
                (hit) => hit.id === "JKT-LAY-1" && hit.severity === "hard",
              );
              if (hard) sportOverChunky.push(key);
            }
            const owners = housesOf.get(look.outer) ?? new Set<string>();
            owners.add(house);
            housesOf.set(look.outer, owners);
            if (SUEDE.has(look.outer)) suedeHouses.add(house);
          }
        });
        for (const [id, n] of ids) if (n > 1) rot1.push(`${house}/${occasion}/${season}:${id}x${n}`);
        if (suede > 1) rot1.push(`${house}/${occasion}/${season}:suede x${suede}`);
      }
      for (const [id, owners] of housesOf) if (owners.size > 2) rot2.push(`${occasion}/${season}:${id} in ${owners.size}`);
      if (suedeHouses.size > 3) rot2.push(`${occasion}/${season}:suede houses ${suedeHouses.size}`);
    }

    const missing = fwEligibleJackets().filter((id) => !fwOuters.has(id));
    const distinct = fwOuters.size;
    expect(rot1, "ROT-1").toEqual([]);
    expect(rot2, "ROT-2").toEqual([]);
    expect(missing, "ROT-4").toEqual([]);
    expect(misses, "required jacket").toEqual([]);
    expect(sportOverChunky, "sport coat over chunky").toEqual([]);
    // Flipped: the varsity is a top now, so it may stand alone and must never be the outer.
    expect(varsityOuter, "varsity as the outer").toEqual([]);
    expect(seenDeleted, "deleted sneakers").toEqual([]);
    expect(distinct).toBeGreaterThanOrEqual(18);

    const grey = jacketHits(
      pieces({ top: "g_gp53xkrmem9b", outer: "g_juk45cokjxxy", bottom: "g_rvrs9hibr981", shoe: "g_8ukg5mi9r3fc" }),
      { occasion: "weekday", season: "fall" },
    );
    expect(grey.some((hit) => hit.severity === "hard")).toBe(true);
  }, 600_000);
});

describe("weather jacket gate", () => {
  const OCCASIONS = ["weekday", "out", "weekend", "comfy", "travel"] as const;
  const SEASONS = ["spring", "summer", "fall", "winter"] as const;
  const CONDS = [undefined, { wet: true }, { windy: true }] as const;
  const TEMPS = [60, 73] as const;
  const TOP = "g_pa7kfg14rtzl";
  const BOTTOM = "g_v3ovns4bv344";
  const LEATHER = "g_om0dh5nps1ke";
  const SUEDE_SHOE = "g_8nrtffa2s13s";
  const CHORE = "g_8qqqzpwxuwti";
  const LIGHT = "g_ed0ga2v0q2yo";
  const KNITS = ["g_xc4gr022xmvm", "g_k0mfejxiu5f8", "g_hhbz4ghpjmd1", "g_j2id379jo424"] as const;

  function gateSeason(season: string, windy: boolean): string {
    if (!windy) return season;
    if (season === "spring") return "fall";
    if (season === "fall") return "winter";
    return season;
  }

  function required(occasion: string, season: string, temp: number, cond?: { wet?: boolean; windy?: boolean }): boolean {
    if (occasion === "comfy") return false;
    const wet = cond?.wet === true;
    const windy = cond?.windy === true;
    const gate = gateSeason(season, windy);
    let hard = false;
    if ((occasion === "weekday" || occasion === "out") && (gate === "fall" || gate === "winter")) hard = true;
    if ((occasion === "weekend" || occasion === "travel") && gate === "winter") hard = true;
    if (wet && season === "fall" && (occasion === "weekend" || occasion === "travel")) hard = true;
    if (!hard) return false;
    if (wet || windy) return true;
    if (temp >= 72 && (occasion === "weekday" || occasion === "out")) return false;
    return true;
  }

  it("covers 5 occasions × 4 seasons × dry/wet/windy × 60/73; wind leaves summer as summer", () => {
    for (const occasion of OCCASIONS) {
      for (const season of SEASONS) {
        for (const cond of CONDS) {
          for (const temp of TEMPS) {
            const wet = cond !== undefined && "wet" in cond;
            const windy = cond !== undefined && "windy" in cond;
            const name = `${occasion} ${season} ${wet ? "wet" : windy ? "windy" : "dry"} ${temp}`;
            expect(jacketRequired(occasion, season, temp, cond), name).toBe(required(occasion, season, temp, cond));
          }
        }
      }
    }
    expect(jacketRequired("weekday", "fall", 73)).toBe(false);
    expect(jacketRequired("weekday", "fall", 73, { wet: true })).toBe(true);
    expect(jacketRequired("weekday", "fall", 73, { windy: true })).toBe(true);
    expect(jacketRequired("weekday", "summer", 80)).toBe(false);
    expect(jacketRequired("weekday", "summer", 80, { windy: true })).toBe(false);
    expect(jacketRequired("weekday", "summer", 86, { windy: true })).toBe(false);
    expect(jacketRequired("out", "summer", 86, { windy: true })).toBe(false);
    expect(jacketRequired("weekday", "spring", 86, { windy: true })).toBe(true);
    expect(jacketRequired("weekend", "summer", 80, { windy: true })).toBe(false);
    expect(jacketRequired("comfy", "winter", 60, { wet: true, windy: true })).toBe(false);
  });

  it("a wet day hard-fails suede and shearling outers and only demotes suede shoes", () => {
    const ctx = { occasion: "weekend", season: "fall", wet: true, tempF: 60, highF: 60 };
    for (const id of [...SUEDE_FAMILY, "g_wwy9b2pusds3", "g_491tzu2suiv7"]) {
      const hits = jacketHits(pieces({ top: TOP, outer: id, bottom: BOTTOM, shoe: LEATHER }), ctx);
      expect(hits.some((h) => h.id === "JKT-WET-1" && h.severity === "hard"), id).toBe(true);
    }
    const filedDenim = by.get("g_491tzu2suiv7")!;
    const byName = jacketHits(pieces({ top: TOP, outer: filedDenim.id, bottom: BOTTOM, shoe: LEATHER }), ctx);
    expect(byName.some((h) => h.id === "JKT-WET-1" && h.severity === "hard")).toBe(true);
    const leather = jacketHits(pieces({ top: TOP, outer: CHORE, bottom: BOTTOM, shoe: LEATHER }), ctx);
    expect(leather.some((h) => h.id === "JKT-WET-1" || h.id === "JKT-WET-2")).toBe(false);
    const suedeShoe = jacketHits(pieces({ top: TOP, outer: CHORE, bottom: BOTTOM, shoe: SUEDE_SHOE }), ctx);
    expect(suedeShoe.filter((h) => h.id === "JKT-WET-2").map((h) => h.severity)).toEqual(["soft"]);
    const copy = { ...by.get("g_1pg9y05mlkek")!, id: "g_attr_suede" };
    const attr = jacketHits({ top: by.get(TOP), outer: copy, bottom: by.get(BOTTOM), shoe: by.get(LEATHER) }, ctx);
    expect(attr.some((h) => h.id === "JKT-WET-1" && h.severity === "hard")).toBe(true);
  });

  it("a warm dry fall demotes shearling below a light outer; a cool high does not", () => {
    const shoe = LEATHER;
    const cov = (outer: string, highF?: number) =>
      jacketHits(pieces({ top: TOP, outer, bottom: BOTTOM, shoe }), {
        occasion: "weekday",
        season: "fall",
        ...(highF !== undefined ? { highF, tempF: highF } : {}),
      }).filter((h) => h.id === "JKT-COV-3");
    expect(cov("g_wwy9b2pusds3", 65).map((h) => h.delta)).toEqual([-20]);
    expect(cov("g_491tzu2suiv7", 70).map((h) => h.delta)).toEqual([-20]);
    expect(cov("g_wwy9b2pusds3", 64).map((h) => h.delta)).toEqual([-5]);
    expect(cov("g_wwy9b2pusds3").map((h) => h.delta)).toEqual([-5]);
    expect(cov(LIGHT, 70)).toEqual([]);
    const warm = cov("g_wwy9b2pusds3", 70)[0]?.delta ?? 0;
    expect(warm).toBeLessThan(0);
  });

  it("a knit filed as outerwear never satisfies a required jacket", () => {
    for (const id of KNITS) {
      const plate = by.get(id)!;
      expect(plate.category, id).toBe("outerwear");
      const hits = jacketHits(
        { top: by.get(TOP), outer: plate, bottom: by.get(BOTTOM), shoe: by.get(LEATHER) },
        { occasion: "weekday", season: "fall" },
      );
      expect(hits.some((h) => h.id === "JKT-COV-1" && h.severity === "hard"), id).toBe(true);
    }
  });
});

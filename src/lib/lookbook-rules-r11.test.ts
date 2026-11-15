/**
 * R11 Lookbook outfit rules. The R10 fixture and bench, cold, with no network.
 * Out keeps 10 cards: the cold-top rule and the cap of two leave that chapter short of 12.
 */
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Garment, Occasion } from "./types.ts";

register(new URL("../../scripts/ts-ext.mjs", import.meta.url), { parentURL: import.meta.url });

const { benchPage } = await import("./__fixtures__/lookbook-bench.ts");
const { ruleFails } = await import("./stylist/legal.ts");
const { jacketRequired } = await import("./stylist/jackets.ts");
const { twinGroups } = await import("./detectors.ts");
const { lookTuckDecision } = await import("./look.ts");
const { sittingPieceId } = await import("./gaps.ts");
const { livePool } = await import("./rack.ts");
const { RULE_SENTENCES } = await import("./stylist/rule-copy.ts");
const {
  cardiganPiece,
  collaredShirt,
  nonCollaredKnit,
  sneakerPiece,
  sportCoatPiece,
  suedeShoe,
  thinSoloTop,
} = await import("./outfit-rules.ts");

const CLOSET = livePool(JSON.parse(readFileSync(new URL("./__fixtures__/lookbook-closet-2026-11-14.json", import.meta.url), "utf8")) as Garment[]);
const BY_ID = new Map(CLOSET.map((g) => [g.id, g]));
const TWINS = twinGroups(CLOSET);

function cardsOf(page: { week: string[][]; rows: { looks: string[][] }[] }): Garment[][] {
  const ids = [...page.week, ...page.rows.flatMap((row) => row.looks)];
  return ids.map((row) => row.map((id) => BY_ID.get(id)).filter((g): g is Garment => Boolean(g)));
}

function blob(g: Garment): string {
  return `${g.subtype} ${g.name} ${g.material ?? ""}`.toLowerCase();
}

function layered(look: Garment[]): boolean {
  const shirt = look.some(collaredShirt);
  const knit = look.some(nonCollaredKnit);
  const coat = look.some(sportCoatPiece);
  return (shirt && knit) || (shirt && coat);
}

function thinAlone(look: Garment[]): boolean {
  const tops = look.filter((g) => g.category === "top" || g.category === "dress");
  return tops.length > 0 && tops.every(thinSoloTop) && !look.some((g) => nonCollaredKnit(g) && !thinSoloTop(g));
}

function cardiganAlone(look: Garment[]): boolean {
  return look.some(cardiganPiece) && !look.some((g) => collaredShirt(g) || /\btees?\b|\bt-?shirts?\b/.test(blob(g)) || (/\bpolos?\b/.test(blob(g)) && /knit/.test(blob(g))));
}

function jean(look: Garment[]): boolean {
  return look.some((g) => /\bjeans?\b|denim/.test(blob(g)) && g.category === "bottom");
}

function loafer(look: Garment[]): boolean {
  return look.some((g) => /loafer/.test(blob(g)));
}

function maxTwin(looks: Garment[][]): number {
  const counts = new Map<string, number>();
  for (const look of looks) {
    const seen = new Set<string>();
    for (const g of look) seen.add(TWINS.key(g));
    for (const key of seen) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Math.max(0, ...counts.values());
}

describe("R11 lookbook outfit rules", { timeout: 600_000 }, () => {
  const pages = new Map<string, Garment[][]>();
  const load = (occasion: Occasion, high: number, wet = false) => {
    const key = `${occasion}:${high}:${wet}`;
    const hit = pages.get(key);
    if (hit) return hit;
    const built = cardsOf(benchPage(occasion, CLOSET, { weatherF: high, conditions: { highF: high, wet, windy: false } }));
    pages.set(key, built);
    return built;
  };

  for (const high of [44.4, 42]) {
    for (const occasion of ["weekend", "weekday", "out"] as const) {
      it(`${occasion} at ${high}F dresses within the rules`, () => {
        const looks = load(occasion, high);
        const floor = occasion === "out" ? 10 : 12;
        assert.ok(looks.length >= floor, `${occasion} has ${looks.length} cards`);
        assert.ok(looks.some(layered), "a layered card");
        assert.equal(looks.filter(thinAlone).length, 0, "no thin top alone");
        assert.equal(looks.filter(cardiganAlone).length, 0, "no cardigan alone");
        const sneakers = looks.filter((look) => look.some(sneakerPiece)).length;
        assert.ok(sneakers / looks.length <= 0.4, `sneakers ${sneakers}/${looks.length}`);
        assert.ok(maxTwin(looks) <= 2, "twin cap");
        if (occasion === "out") assert.ok(looks.some((look) => look.some(collaredShirt)), "a collared shirt");
        if (occasion !== "weekend") {
          for (const look of looks) {
            const frayed = look.some((g) => /fray|distress|ripped/.test(blob(g)) && g.category === "bottom");
            const lounge = look.some((g) => /lounge|track|fleece pant|ribbed knit pant/.test(blob(g)));
            if (frayed || lounge) assert.equal(look.some((g) => /loafer/.test(blob(g))), false);
          }
        }
        for (const look of looks) {
          const decision = lookTuckDecision(look, occasion);
          const knit = look.find(nonCollaredKnit);
          if (knit) assert.notEqual(decision, "in");
        }
      });
    }
  }

  it("weekday or out has a blazer under a casual outer when it is cold", () => {
    const looks = [...load("weekday", 44.4), ...load("out", 44.4)];
    const hit = looks.find((look) => look.some(sportCoatPiece));
    assert.ok(hit, "a blazer card");
    assert.ok(hit!.some((g) => /field|chore|suede|shearling|toggle|plaid/.test(blob(g)) && /jacket|coat/.test(blob(g))));
    assert.equal(hit!.some((g) => /cable|chunky/.test(blob(g)) && /knit|sweater/.test(blob(g))), false);
  });

  it("a wet cold page has no suede shoe or suede outer and few sneakers", () => {
    for (const occasion of ["weekend", "weekday", "out"] as const) {
      const looks = load(occasion, 44.4, true);
      const sneakers = looks.filter((look) => look.some(sneakerPiece)).length;
      assert.ok(sneakers / looks.length <= 0.4, `${occasion} sneakers ${sneakers}/${looks.length}`);
      assert.equal(looks.some((look) => look.some(suedeShoe)), false, occasion);
      assert.equal(looks.some((look) => look.some((g) => /suede|shearling/.test(blob(g)) && /jacket|coat/.test(blob(g)))), false);
      assert.ok(maxTwin(looks) <= 2);
    }
  });

  it("Joe's look passes, and a knit on it is untucked", () => {
    const shoe = ["g_8ukg5mi9r3fc", "g_8nrtffa2s13s"];
    for (const season of ["fall", "winter"] as const) {
      const high = season === "fall" ? 58 : 44.4;
      for (const occasion of ["weekday", "weekend", "out"] as const) {
        for (const id of shoe) {
          const pieces = ["g_mqjsmpqgwwvm", "g_v3ovns4bv344", id, "g_3qjmw7n4wj2a"].map((item) => BY_ID.get(item)!);
          const failed = ruleFails(pieces, {
            occasion,
            season,
            weatherF: high,
            conditions: { highF: high, wet: false, windy: false },
            pool: CLOSET,
          });
          assert.deepEqual(failed, [], `${season} ${occasion} ${id}`);
        }
      }
    }
    const worn = ["g_mqjsmpqgwwvm", "g_v3ovns4bv344", "g_8ukg5mi9r3fc", "g_3qjmw7n4wj2a"].map((id) => BY_ID.get(id)!);
    assert.equal(lookTuckDecision(worn, "weekday"), "out");
  });

  it("the sitting piece and the grey knit can lead a cold page", () => {
    const sitting = sittingPieceId(CLOSET);
    assert.ok(sitting);
    const weekend = load("weekend", 44.4);
    const weekday = load("weekday", 44.4);
    const onPage = [...weekend, ...weekday].some((look) => look.some((g) => g.id === sitting));
    assert.equal(onPage, true, sitting!);
    const grey = cardsOf(benchPage("weekend", CLOSET, { weatherF: 44.4, conditions: { highF: 44.4, wet: false, windy: false }, pin: "g_gp53xkrmem9b" }));
    assert.equal(grey.some((look) => look.some((g) => g.id === "g_gp53xkrmem9b")), true);
  });

  it("keeps the owner's rules", () => {
    const weekend = load("weekend", 44.4);
    const weekday = load("weekday", 44.4);
    assert.ok(weekend.some(loafer) || weekday.some(loafer));
    assert.ok(weekend.some(jean));
    assert.ok(weekday.some(jean));
    for (const look of [...weekend, ...weekday, ...load("out", 44.4)]) {
      const linen = look.some((g) => /linen/.test(blob(g)));
      const flannel = look.some((g) => /flannel/.test(blob(g)));
      assert.equal(linen && flannel, false);
    }
    const cable = CLOSET.find((g) => /cable/.test(blob(g)) && /knit|sweater/.test(blob(g)))!;
    const navy = CLOSET.find((g) => sportCoatPiece(g) && /navy/.test(blob(g)))!;
    const chore = BY_ID.get("g_8qqqzpwxuwti")!;
    const bottom = weekday[0]!.find((g) => g.category === "bottom")!;
    const shoe = weekday[0]!.find((g) => g.category === "footwear")!;
    assert.ok(ruleFails([cable, bottom, shoe, navy], { occasion: "weekday", season: "fall", weatherF: 58, pool: CLOSET }).includes("JKT-LAY-1"));
    assert.equal(ruleFails([cable, bottom, shoe, chore], { occasion: "weekend", season: "fall", weatherF: 58, pool: CLOSET }).some((id) => id === "JKT-LAY-1"), false);
    assert.equal(jacketRequired("weekday", "fall", 72, { wet: false, windy: false }), false);
    assert.equal(jacketRequired("weekday", "fall", 60, { wet: false, windy: false }), true);
    for (const sentence of Object.values(RULE_SENTENCES)) assert.equal(/\b\d+(?:\.\d+)?\s*\/\s*10\b/.test(sentence), false);
  });
});

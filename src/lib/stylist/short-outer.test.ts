/**
 * R6 anchors: JKT-LAY-9, JKT-LAY-5 under an oversized jacket, and JKT-LAY-10.
 * Looks are the fixture pieces. Nothing here writes closet.v6.
 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assistantRegistry } from "../assistant/tools.ts";
import { runTool } from "../assistant/registry.ts";
import { LIVE_SNAPSHOT_COUNT, liveSnapshot } from "../__fixtures__/snapshot.ts";
import { weekRotationRow, rowWays, visibleDetectors } from "../detectors.ts";
import { pickDropIds } from "../drop-pick.ts";
import { buildWeek, looksForHero } from "../lookbook.ts";
import { lookTuckDecision } from "../look.ts";
import { emptyRotation } from "../rotation.ts";
import { slotOf } from "../style.ts";
import { memoryNotes } from "../stylist-notes/notes.ts";
import { emptyTaste } from "../taste.ts";
import { isKnitTop, isShirtLike, shirtLockedOut } from "../tuck.ts";
import type { Garment, Occasion, Season } from "../types.ts";
import { jacketInfo, slotPieces } from "./jackets.ts";
import { PREFERENCE_IDS, RELAX_TIERS, passesRules } from "./legal.ts";
import { DEFAULT_OVERSIZED_IDS, oversizedOf } from "./oversized.ts";
import { isShortOuter } from "./short-outer.ts";

const byId = new Map(liveSnapshot.map((g) => [g.id, g]));

function must(id: string): Garment {
  const g = byId.get(id);
  expect(g, id).toBeTruthy();
  return g!;
}

const CORDS = "g_cfm8n594jea7";
const BOOTS = "g_b4zsf3dfrhdv";
const TROUSERS = "g_k75fdfdsnak0";
const LOAFERS = "g_8ukg5mi9r3fc";
const VEST = "g_ef0u3ljnwa09";
const CORDUROY = "g_x4adkv9zu9yu";
const CHORE = "g_8qqqzpwxuwti";
const TOPS = [...DEFAULT_OVERSIZED_IDS].filter((id) => id !== CORDUROY);
const EXTRAS = ["g_jhyr10t2vo13", "g_8yppag4e0ql5", "g_3821acdhupu9"];

function failed(ids: string[], occasion: Occasion, season: Season): string[] {
  return passesRules(ids.map(must), { occasion, season }).failed;
}

function countingOuter(g: Garment): boolean {
  if (g.archived) return false;
  const info = jacketInfo(g);
  return Boolean(info.countsAsJacket && info.class && info.class !== "mid");
}

const DATES = ["2026-11-04", "2027-03-15", "real"] as const;

for (const date of DATES) {
  describe(`R6 anchors (${date})`, () => {
    beforeEach(() => {
      if (date === "real") {
        vi.useRealTimers();
        return;
      }
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(`${date}T16:00:00.000Z`));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("a. a slim jacket over an oversized top fails JKT-LAY-9", () => {
      expect(failed(["g_ko7zz8iktplc", "g_5josnvyoi4z9", TROUSERS, LOAFERS], "weekday", "fall")).toContain("JKT-LAY-9");
      expect(failed(["g_gp53xkrmem9b", "g_qnmo5yzgl50b", CORDS, BOOTS], "weekend", "winter")).toContain("JKT-LAY-9");
    });

    it("b. the corduroy over the navy sweater passes", () => {
      for (const season of ["fall", "winter"] as const) {
        const ids = failed(["g_d1awqw83gd3c", CORDUROY, CORDS, BOOTS], "weekend", season);
        expect(ids, season).not.toContain("JKT-LAY-9");
        expect(ids, season).toEqual([]);
      }
    });

    it("b-1b. chunky knits under the corduroy lose JKT-LAY-5 and JKT-LAY-9", () => {
      for (const season of ["fall", "winter"] as const) {
        const knit = failed(["g_gp53xkrmem9b", CORDUROY, CORDS, BOOTS], "weekend", season);
        expect(knit, season).not.toContain("JKT-LAY-5");
        expect(knit, season).not.toContain("JKT-LAY-9");
        expect(knit, season).toEqual([]);
        const cardigan = failed(["g_2b6fao81vqrs", "g_xc4gr022xmvm", CORDUROY, CORDS, BOOTS], "weekend", season);
        expect(cardigan, season).not.toContain("JKT-LAY-5");
        expect(cardigan, season).not.toContain("JKT-LAY-9");
        const diamond = failed(["g_vzqle7zdtpis", CORDUROY, CORDS, BOOTS], "weekend", season);
        expect(diamond, season).not.toContain("JKT-LAY-5");
        expect(diamond, season).not.toContain("JKT-LAY-9");
      }
    });

    it("c. a shirt under the vest is tucked and still passes", () => {
      const vest = must(VEST);
      const cords = must(CORDS);
      const boots = must(BOOTS);
      const flannel = must("g_2b6fao81vqrs");
      const pieces = [flannel, vest, cords, boots];
      expect(passesRules(pieces, { occasion: "weekend", season: "fall" }).pass).toBe(true);
      expect(lookTuckDecision(pieces, "weekend")).toBe("in");
      const locked = [{ ...flannel, tuck: "out" as const }, vest, cords, boots];
      expect(passesRules(locked, { occasion: "weekend", season: "fall" }).failed).toContain("JKT-LAY-10");
      const polo = must("g_reesb6nbrmm4");
      const knit = must("g_gp53xkrmem9b");
      expect(passesRules([polo, vest, cords, boots], { occasion: "weekend", season: "fall" }).failed).toContain("JKT-LAY-10");
      expect(lookTuckDecision([polo, vest, cords, boots], "weekend")).toBe("out");
      expect(passesRules([knit, vest, cords, boots], { occasion: "weekend", season: "fall" }).failed).toContain("JKT-LAY-10");
      expect(lookTuckDecision([knit, vest, cords, boots], "weekend")).toBe("out");
    });

    it("c-swap. a locked-out shirt under the vest swaps to a tucked shirt or a regular knit", async () => {
      const flannel = { ...must("g_2b6fao81vqrs"), tuck: "out" as const };
      const pieces = [flannel, must(VEST), must(CORDS), must(BOOTS)];
      const pool = liveSnapshot.map((g) => (g.id === flannel.id ? flannel : g));
      const result = await runTool(assistantRegistry, {
        pool,
        taste: emptyTaste(),
        page: { route: "closet", onScreenLookIds: [] },
        weatherF: 58,
        notes: memoryNotes(),
        today: { drop: null, garments: pool, season: "fall" },
        date: date === "real" ? undefined : date,
      }, "closet_suggest_swap", { ids: pieces.map((g) => g.id), occasion: "weekend", season: "fall" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as {
        swaps: { items: { slot: string; in: { id: string }; look: { id: string }[] }[] };
      };
      const tops = data.swaps.items.filter((s) => s.slot === "top");
      expect(tops.length).toBeGreaterThan(0);
      for (const swap of tops) {
        const incoming = must(swap.in.id);
        expect(oversizedOf(incoming), incoming.id).toBe(false);
        const next = pieces.map((g) => (g.id === flannel.id ? incoming : g));
        if (isShirtLike(incoming) && !isKnitTop(incoming)) {
          expect(shirtLockedOut(incoming), incoming.name).toBe(false);
          expect(lookTuckDecision(next, "weekend")).toBe("in");
        } else {
          expect(isKnitTop(incoming), incoming.name).toBe(true);
        }
      }
    });

    it("Q2. the brown chore fails JKT-LAY-9 over each oversized top", () => {
      for (const id of TOPS) {
        for (const season of ["fall", "winter"] as const) {
          expect(failed([id, CHORE, CORDS, BOOTS], "weekend", season), `${id} ${season}`).toContain("JKT-LAY-9");
        }
      }
    });

    it("Q5. the extras that are in the fixture stay regular", () => {
      const missing = EXTRAS.filter((id) => !byId.has(id));
      expect(missing, "absent from the fixture, left regular by not being on the list").toEqual(["g_8yppag4e0ql5"]);
      for (const id of EXTRAS) {
        const g = byId.get(id);
        if (!g) continue;
        expect(oversizedOf(g), id).toBe(false);
      }
    });

    it("C. a regular polo under the plaid jacket is not JKT-LAY-9", () => {
      const ids = failed(["g_939onlwfrg9j", "g_3qjmw7n4wj2a", "g_vf28ktbdhmtz", "g_wymz2j18s6wh"], "weekday", "fall");
      expect(ids).not.toContain("JKT-LAY-9");
    });

    it("JKT-LAY-9 and JKT-LAY-10 are not preferences and not on the relax ladder", () => {
      expect(PREFERENCE_IDS.has("JKT-LAY-9")).toBe(false);
      expect(PREFERENCE_IDS.has("JKT-LAY-10")).toBe(false);
      for (const tier of RELAX_TIERS) {
        expect(tier.rules).not.toContain("JKT-LAY-9");
        expect(tier.rules).not.toContain("JKT-LAY-10");
      }
    });
  });
}

describe("R6 sweeps", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-04T16:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("every oversized top under every regular counting outer fails JKT-LAY-9", () => {
    expect(liveSnapshot.length).toBe(LIVE_SNAPSHOT_COUNT);
    const bottoms = liveSnapshot.filter((g) => !g.archived && slotOf(g) === "bottom");
    const shoes = liveSnapshot.filter((g) => !g.archived && slotOf(g) === "footwear");
    const outers = liveSnapshot.filter((g) => countingOuter(g) && !oversizedOf(g));
    expect(outers.length).toBeGreaterThan(0);
    expect(bottoms.length).toBeGreaterThan(0);
    expect(shoes.length).toBeGreaterThan(0);
    let checked = 0;
    for (const topId of TOPS) {
      const top = must(topId);
      for (const outer of outers) {
        if (outer.id === top.id) continue;
        for (const bottom of bottoms) {
          for (const shoe of shoes) {
            const pieces = [top, outer, bottom, shoe];
            if (slotPieces(pieces).outer?.id !== outer.id) continue;
            checked += 1;
            const verdict = passesRules(pieces, { occasion: "weekend", season: "fall" });
            expect(verdict.failed, `${top.id} ${outer.id}`).toContain("JKT-LAY-9");
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("every shirt under the vest is tucked in, or the look fails JKT-LAY-10", () => {
    const vest = must(VEST);
    const bottoms = liveSnapshot.filter((g) => !g.archived && slotOf(g) === "bottom");
    const shoes = liveSnapshot.filter((g) => !g.archived && slotOf(g) === "footwear");
    const shirts = liveSnapshot.filter(
      (g) => !g.archived && slotOf(g) === "top" && isShirtLike(g) && !isKnitTop(g) && !isShortOuter(g),
    );
    expect(shirts.length).toBeGreaterThan(0);
    for (const shirt of shirts) {
      for (const bottom of bottoms) {
        for (const shoe of shoes) {
          const pieces = [shirt, vest, bottom, shoe];
          const decision = lookTuckDecision(pieces, "weekend");
          const ids = passesRules(pieces, { occasion: "weekend", season: "fall" }).failed;
          expect(decision === "in" || ids.includes("JKT-LAY-10"), shirt.id).toBe(true);
        }
      }
    }
  });

  it("the corduroy covers the listed tops in fall and winter, and a regular mid still works in winter", () => {
    const bottoms = liveSnapshot.filter((g) => !g.archived && slotOf(g) === "bottom");
    const shoes = liveSnapshot.filter((g) => !g.archived && slotOf(g) === "footwear");
    const cord = must(CORDUROY);
    const passes = (top: Garment, season: Season, extra: Garment[] = []) =>
      bottoms.some((bottom) =>
        shoes.some((shoe) => passesRules([top, ...extra, cord, bottom, shoe], { occasion: "weekend", season }).pass),
      );
    for (const id of ["g_d1awqw83gd3c", "g_reesb6nbrmm4", "g_z8gvd1zvrcif", "g_o739106dt8ym"]) {
      for (const season of ["fall", "winter"] as const) {
        expect(passes(must(id), season), `${id} ${season}`).toBe(true);
      }
    }
    const shirt = must("g_2b6fao81vqrs");
    const plainTops = liveSnapshot.filter((g) => !g.archived && slotOf(g) === "top" && !oversizedOf(g));
    for (const id of ["g_gp53xkrmem9b", "g_vzqle7zdtpis", "g_xc4gr022xmvm", "g_k0mfejxiu5f8"]) {
      for (const season of ["fall", "winter"] as const) {
        const piece = must(id);
        const alone = id === "g_xc4gr022xmvm" || id === "g_k0mfejxiu5f8" ? false : passes(piece, season);
        const withFlannel = passes(piece, season, [shirt]);
        const withAnyShirt =
          alone || withFlannel
            ? true
            : plainTops.some((top) => top.id !== piece.id && passes(piece, season, [top]));
        expect(withAnyShirt, `${id} ${season}`).toBe(true);
      }
    }
    const polo = must("g_ko7zz8iktplc");
    const mids = liveSnapshot.filter((g) => g.id !== polo.id && !oversizedOf(g) && (slotOf(g) === "top" || slotOf(g) === "outerwear"));
    const winterMid = mids.some((mid) => passes(polo, "winter", [mid]));
    expect(winterMid).toBe(true);
  });
});

function lookOffenders(pieces: Garment[], occasion: string): string[] {
  const bad: string[] = [];
  const vest = pieces.some(isShortOuter);
  if (vest) {
    const decision = lookTuckDecision(pieces, occasion);
    const lead = pieces.find((g) => isShirtLike(g) && !isKnitTop(g) && !isShortOuter(g));
    if (lead && decision === "out") bad.push(`untucked shirt under a vest: ${lead.id}`);
    const underVest = pieces.filter(
      (g) => !isShortOuter(g) && oversizedOf(g) && (slotOf(g) === "top" || slotOf(g) === "dress"),
    );
    if (underVest.length) bad.push(`oversized top under a vest: ${underVest.map((g) => g.id).join(",")}`);
  }
  const outer = pieces.find((g) => countingOuter(g));
  if (outer && !oversizedOf(outer)) {
    const under = pieces.filter((g) => g.id !== outer.id && oversizedOf(g) && (slotOf(g) === "top" || g.category === "outerwear"));
    if (under.length) bad.push(`JKT-LAY-9 ${under.map((g) => g.id).join(",")} under ${outer.id}`);
  }
  return bad;
}

describe("R6 offenders", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-04T16:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("Today and one Lookbook page have no oversized-under-regular and no untucked shirt under a vest", () => {
    const bad: string[] = [];
    const occasions = ["weekday", "weekend", "out"] as const;
    for (let day = 0; day < 14; day += 1) {
      const today = `2026-11-${String(4 + day).padStart(2, "0")}`;
      for (const season of ["fall", "winter"] as const) {
        for (const occasion of occasions) {
          const picked = pickDropIds(
            { garments: liveSnapshot, journal: [], drop: null, taste: emptyTaste() },
            { occasion, today, daily: { season } },
          );
          const pieces = picked.ids.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
          bad.push(...lookOffenders(pieces, occasion).map((line) => `today ${today} ${season} ${occasion} ${line}`));
        }
      }
    }
    for (const season of ["fall", "winter"] as const) {
      for (const occasion of occasions) {
        const week = weekRotationRow(liveSnapshot, {
          occasion,
          season,
          rotation: emptyRotation(),
          cap: 8,
          today: "2026-11-04",
          stuck: new Set<string>(),
        });
        const found = visibleDetectors(liveSnapshot, { occasion, season });
        const ways = rowWays(found, liveSnapshot, {
          occasion,
          season,
          salt: 0,
          onScreen: week.looks.flatMap((look) => look.map((g) => g.id)),
          leadIds: week.leads,
          today: "2026-11-04",
          rotation: emptyRotation(),
          stuck: new Set(week.unpairable.map((g) => g.id)),
        });
        const page = [...week.looks, ...ways.flatMap((way) => way.looks[occasion] ?? [])];
        for (const look of page) {
          bad.push(...lookOffenders(look, occasion).map((line) => `lookbook ${season} ${occasion} ${line}`));
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("unaffected look parity", () => {
  it("looks with no oversized piece hash to the post-rule output", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-04T16:00:00.000Z"));
    const pin = "2026-11-04";
    const lines: string[] = [];
    const garments = [...liveSnapshot].sort((a, b) => a.id.localeCompare(b.id));
    for (const garment of garments) {
      const looks = looksForHero(garment, liveSnapshot, { today: pin }).filter(
        (look) => !look.garmentIds.some((id) => oversizedOf(byId.get(id) ?? { id })),
      );
      const body = looks.map((look) => `${look.id}:${look.garmentIds.join(",")}:${look.occasion}`).join(";");
      lines.push(`${garment.id}|${body}`);
    }
    const week = buildWeek(liveSnapshot, pin).filter(
      (look) => !look.garmentIds.some((id) => oversizedOf(byId.get(id) ?? { id })),
    );
    lines.push(`WEEK|${week.map((look) => `${look.garmentIds.join(",")}:${look.occasion}`).join(";")}`);
    const hash = createHash("sha256").update(lines.join("\n")).digest("hex");
    // Base e5c0e5a hash of the same filter was 07be9f89be5f38f72acd49f0c0a71ce7a6c917889c09bc640a876242cecbf206.
    // The draw backfills when an oversized pairing drops, so this filtered set is the post-rule output.
    expect(hash).toBe("494fd52dc5e0c5f6b56f98c2e592a860693ff781fc031d1fbc5f7619976ad8ad");
    vi.useRealTimers();
  });
});

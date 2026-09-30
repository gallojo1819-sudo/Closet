import { describe, expect, it } from "vitest";
import platesFile from "./__tests__/fixtures/plates-2026-09-30.json" with { type: "json" };
import rules from "./data/2026-09-30-proposed-stylist-rules.json" with { type: "json" };
import type { Plate } from "../house-profiles/evaluate.ts";
import { piecesFromIds, stylistHits, type StylistHit } from "./rules.ts";
import { recipeOuterIssue, rep1Fails, rep2Fails, rep3Fails, rep4Same } from "./row.ts";

const by = new Map<string, Plate>(
  (platesFile.plates as Plate[]).filter((p) => p.id && p.name).map((p) => [p.id, p]),
);

type RuleTest = {
  look?: Record<string, string | undefined>;
  expected: string;
  context?: { occasion?: string; season?: string };
};

type Rule = {
  id: string;
  house?: string;
  tests?: RuleTest[];
};

function firedId(ruleId: string): string {
  if (ruleId.includes("P4b") || ruleId.toLowerCase().includes("pastel")) return "PASTEL-b";
  return ruleId;
}

function houseFor(rule: Rule): string | undefined {
  if (rule.id.includes("P4b")) return "polo";
  if (rule.id.startsWith("POLO")) return "polo";
  if (rule.id.startsWith("FAL")) return "faloni";
  if (rule.id.startsWith("545")) return "545";
  if (rule.id.startsWith("SS")) return "sweetstable";
  if (rule.id.startsWith("IS")) return "italiansummer";
  if (rule.id.startsWith("IW")) return "italianwinter";
  if (rule.id.startsWith("PL")) return "purple";
  if (rule.id.startsWith("RRL")) return "rrl";
  return undefined;
}

function grade(expected: string, hits: StylistHit[], ruleId: string): boolean {
  const mine = hits.filter((h) => h.id === ruleId);
  const hard = mine.some((h) => h.severity === "hard");
  const soft = mine.some((h) => h.severity === "soft");
  if (expected.startsWith("fail")) return hard;
  if (expected.startsWith("soft")) return soft && !hard;
  if (expected === "pass") return mine.length === 0;
  if (expected.startsWith("pass")) return !hard;
  return false;
}

const groups = [
  ...(rules.cross_chip_color_rules as Rule[]),
  ...(rules.cross_chip_texture_rules as Rule[]),
  ...(rules.per_house_additions as Rule[]),
];

const flat = groups.flatMap((rule) =>
  (rule.tests ?? []).filter((t) => t.look).map((test, i) => ({ rule, test, i })),
);

describe("stylist rules", () => {
  it("loads the 79 stylist tests", () => {
    expect(flat).toHaveLength(79);
  });

  for (const { rule, test, i } of flat) {
    it(`${rule.id} #${i + 1} ${test.expected}`, () => {
      const occ = test.context?.occasion ?? "weekday";
      const season = test.context?.season ?? "fall";
      const id = firedId(rule.id);
      const hits = stylistHits(piecesFromIds(test.look ?? {}, by), occ, season, houseFor(rule));
      const ok = grade(test.expected, hits, id);
      const seen = hits
        .filter((h) => h.id === id)
        .map((h) => `${h.id}:${h.severity}`)
        .join(",") || "(no hit)";
      expect(ok, seen).toBe(true);
    });
  }
});

describe("row rules", () => {
  it("XC-REP-1 sage pleated in 6 chips fails", () => {
    expect(rep1Fails("g_66xj06nllgf2", 6, "bottom")).toBe(true);
    expect(rep1Fails("g_66xj06nllgf2", 2, "bottom")).toBe(false);
    expect(rep1Fails("g_b4zsf3dfrhdv", 9, "shoe")).toBe(false);
  });

  it("XC-REP-2 shared top and bottom fails", () => {
    const a = { top: "g_vzqle7zdtpis", bottom: "g_k75fdfdsnak0", shoe: "g_8ukg5mi9r3fc" };
    const b = { top: "g_vzqle7zdtpis", bottom: "g_k75fdfdsnak0", shoe: "g_other", outer: "g_blazer" };
    expect(rep2Fails(a, b)).toBe(true);
  });

  it("XC-REP-3 repeats a top three times and exempts the boot", () => {
    const row = [1, 2, 3].map((n) => ({ top: "g_same", bottom: `b${n}`, shoe: `s${n}` }));
    expect(rep3Fails(row)).toContain("g_same");
    const boots = [1, 2, 3, 4].map((n) => ({
      top: `t${n}`,
      bottom: `b${n}`,
      shoe: "g_b4zsf3dfrhdv",
    }));
    expect(rep3Fails(boots)).not.toContain("g_b4zsf3dfrhdv");
  });

  it("XC-REP-4 identical season rows fail the release check", () => {
    const row = [{ top: "t", bottom: "b", shoe: "s" }];
    expect(rep4Same(row, row)).toBe(true);
    expect(rep4Same(row, [{ top: "other", bottom: "b", shoe: "s" }])).toBe(false);
  });

  it("XC-REC-1 OUT_BLAZER_DINNER with no outer is a hard fail", () => {
    expect(recipeOuterIssue("OUT_BLAZER_DINNER", undefined)).toBe("hard");
  });

  it("XC-REC-1 WE_RRL_CHORE with the chore jacket passes", () => {
    const outer = by.get("g_8qqqzpwxuwti");
    expect(recipeOuterIssue("WE_RRL_CHORE", `${outer?.name ?? ""} ${outer?.subtype ?? ""}`)).toBe(null);
  });
});

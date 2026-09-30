import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bottomType } from "../houses.ts";
import type { Garment } from "../types.ts";
import { evaluateColor } from "../stylist/colorChip.ts";
import platesFile from "../stylist/__tests__/fixtures/plates-2026-09-30.json" with { type: "json" };
import { piecesFromIds } from "../stylist/rules.ts";
import { cross1Fails, cross3Fails, rep2Fails } from "../stylist/row.ts";
import { evaluate, sig, type Plate } from "./evaluate.ts";
import { APPROVED, COLOR_PROFILE, CROSS } from "./load.ts";

const HASHES: Record<string, string> = {
  "approved/545.json": "85d8d64727d77f55201ea847e748f866cf8af14b992cb91198e8d7bb26fb72ac",
  "approved/_cross_chip.json": "5850e61eb7fed90f0369d176bc2d1b8e5ad88f178ecc5d5cec1cba7da8317f8c",
  "approved/ald.json": "5a3ad3807a8e531b299a878715f3d26311e01f4e154276792cfc161179b5a9ee",
  "approved/color.json": "78af58830b8a87fbd566145090340a53062783ee031722c3bcc04ade1730800d",
  "approved/faloni.json": "6324362c2c7065786ce27e2da68a64ec9440915f6b55831aeb9e062f291e9246",
  "approved/italiansummer.json": "adec651dc8dd82b6d20dfd8eb99e5acd539a10f6e03aa0e081ad02d7c57c9001",
  "approved/italianwinter.json": "7eea06fdeb3bc44de85b577d9b25cce3590f9bf559801983037e22037cdaf79b",
  "approved/polo.json": "74d00b6e378d7829ae6735bb727248be5b3792521d445fe8a975f320ae7b65b7",
  "approved/purple.json": "23c03f38e62b359bc59bfd10e4c5f980ce41e2d654c33435f2f5ec882b23be62",
  "approved/rrl.json": "eed33d82b7375a3a715b29842bc42a05a7f3695171037107d597083ad7c9bf8f",
  "approved/sweetstable.json": "bebd2185bcb22cbba86a76112d771c505894a95f70785f09601887478e6e8f1c",
  "../stylist/data/color-value-map.json": "5a7e7012ba07969dfa3bdb252126ad672bd18c39a1ded509272b066be7e89dd0",
  "../stylist/data/2026-09-30-proposed-stylist-rules.json":
    "25037d15d2634ff4803b7be3a36b3f241213ce82f23523bc3326e78edbf017f3",
};

const by = new Map<string, Plate>(
  (platesFile.plates as Plate[]).filter((p) => p.id).map((p) => [p.id, p]),
);

type Case = {
  id: string;
  expected: string;
  rule_ids?: string[];
  look?: Record<string, string>;
  context?: { occasion?: string; season?: string; color?: string; house?: string };
  core?: string;
};

describe("approved profile sha256", () => {
  it("copied JSON matches the law file hashes", () => {
    for (const [rel, hex] of Object.entries(HASHES)) {
      const path = new URL(rel, import.meta.url);
      const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
      expect(digest, rel).toBe(hex);
    }
  });
});

describe("house test_cases", () => {
  const cases: { house: string; tc: Case }[] = [];
  for (const [house, profile] of Object.entries(APPROVED)) {
    for (const tc of (profile as { test_cases?: Case[] }).test_cases ?? []) cases.push({ house, tc });
  }

  it("covers the 28 house cases", () => {
    expect(cases).toHaveLength(28);
  });

  for (const { house, tc } of cases) {
    it(`${house} ${tc.id} ${tc.expected}`, () => {
      const ev = evaluate(
        APPROVED[house] as never,
        tc.look ?? {},
        tc.context ?? {},
        by,
      );
      const want = tc.rule_ids ?? [];
      if (tc.expected === "pass") {
        expect(ev.passed, ev.hardFails.join(",")).toBe(true);
      } else {
        expect(ev.passed, ev.hardFails.join(",")).toBe(false);
        for (const id of want) expect(ev.hardFails, ev.hardFails.join(",")).toContain(id);
      }
    });
  }
});

describe("keyword fixes", () => {
  const lib = (APPROVED.rrl as unknown as { keywords: Record<string, never> }).keywords;

  it("New Balance g_nq7il0e0glnn matches nb_dad_sneaker by brand", () => {
    const plate = by.get("g_nq7il0e0glnn");
    expect(plate).toBeTruthy();
    expect(sig(plate!, "nb_dad_sneaker", lib)).toBe(true);
  });

  it("Gurkha g_ayfv9c97ohmv is cord and work chino, not a drawstring", () => {
    const plate = by.get("g_ayfv9c97ohmv");
    expect(plate).toBeTruthy();
    expect(sig(plate!, "cord_bottom", lib)).toBe(true);
    expect(sig(plate!, "work_chino", lib)).toBe(true);
    const g = {
      id: plate!.id,
      name: plate!.name ?? "",
      subtype: plate!.subtype ?? "",
      material: plate!.material ?? "",
      brand: plate!.brand ?? "",
      category: "bottom",
      colors: plate!.colors ?? [],
    } as Garment;
    expect(bottomType(g)).toBe("cord");
    expect(bottomType(g)).not.toBe("drawstring");
  });
});

describe("color.json COL-T1..T3", () => {
  for (const tc of (COLOR_PROFILE as { test_cases: Case[] }).test_cases) {
    it(tc.id, () => {
      const ps = piecesFromIds(tc.look ?? {}, by);
      const house = tc.context?.house;
      const col = evaluateColor(ps, tc.context?.color ?? "", house);
      const houseEv = house
        ? evaluate(APPROVED[house] as never, tc.look ?? {}, tc.context ?? {}, by)
        : null;
      const hard = new Set([...(col.hardFails ?? []), ...(houseEv?.hardFails ?? [])]);
      if (tc.expected === "pass") {
        expect(col.passed, [...hard].join(",")).toBe(true);
        expect(houseEv?.passed ?? true).toBe(true);
      } else {
        expect(col.passed && (houseEv?.passed ?? true), [...hard].join(",")).toBe(false);
        for (const id of tc.rule_ids ?? []) expect(hard, [...hard].join(",")).toContain(id);
      }
    });
  }
});

describe("cross-chip X-T1..X-T3", () => {
  const cases = (CROSS as { test_cases: Case[] }).test_cases;

  it("X-T1 shared core fails CROSS-1", () => {
    const tc = cases.find((c) => c.id === "X-T1")!;
    const [top, bottom, shoe] = (tc.core ?? "").split("|");
    const look = { top, bottom, shoe };
    expect(cross1Fails([[look], [look]])).toBe(tc.expected === "fail");
  });

  it("X-T2 identical house and ALL rows fail CROSS-3", () => {
    const tc = cases.find((c) => c.id === "X-T2")!;
    const row = [{ top: "a", bottom: "b", shoe: "c" }];
    expect(cross3Fails(row, row)).toBe(tc.expected === "fail");
  });

  it("X-T3 shared shoe with different top and bottom passes", () => {
    const tc = cases.find((c) => c.id === "X-T3")!;
    const rrl = { top: "g_2b6fao81vqrs", bottom: "g_dzsh3qh7v6sb", shoe: "g_b4zsf3dfrhdv" };
    const ss = { top: "g_fair", bottom: "g_cord", shoe: "g_b4zsf3dfrhdv" };
    expect(cross1Fails([[rrl], [ss]])).toBe(false);
    expect(rep2Fails(rrl, ss)).toBe(false);
    expect(tc.expected).toBe("pass");
  });
});

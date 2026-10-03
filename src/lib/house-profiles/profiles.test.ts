import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bottomType } from "../houses.ts";
import type { Garment } from "../types.ts";
import { evaluateColor } from "../stylist/colorChip.ts";
import platesFile from "../stylist/__tests__/fixtures/plates-2026-09-30.json" with { type: "json" };
import { piecesFromIds } from "../stylist/rules.ts";
import { cross1Fails, cross3Fails, rep2Fails } from "../stylist/row.ts";
import library from "../detectors/library.json" with { type: "json" };
import { brandHits, evaluate, sig, type Plate } from "./evaluate.ts";
import { APPROVED, COLOR_PROFILE, CROSS } from "./load.ts";

const HASHES: Record<string, string> = {
  "approved/545.json": "8062768c5356a80322e0450be8e69e9af3d95296ff102bf7be5f7ba94ba661a5",
  "approved/_cross_chip.json": "5850e61eb7fed90f0369d176bc2d1b8e5ad88f178ecc5d5cec1cba7da8317f8c",
  "approved/ald.json": "fc5ac566d2f2c0a75e17c8d7229317146fca70417711a0aa896d8ec8f87d5476",
  "approved/color.json": "78af58830b8a87fbd566145090340a53062783ee031722c3bcc04ade1730800d",
  "approved/faloni.json": "aba57de608adeb1f1058445b360c20f0d67efef86a869585241cab4f04a993ed",
  "approved/italiansummer.json": "e6daff21a8c9091414560faa19e97576b14cce2656a5aa268d639634bcb51dd3",
  "approved/italianwinter.json": "146429c0dccb2d95f310d9e758f395a126589da599c3b73c6718b84b814cbbda",
  "approved/polo.json": "d31fff5fdc65d22cffd1c3ef625ec8fa4290f200aa3b0e4a29be7d35c1173fe3",
  "approved/purple.json": "f00dd98fbe6a3dbb9f34e8d11fc324eb47a1e28e45002a576a8b0ba3063844c1",
  "approved/rrl.json": "c72258b52c4b03edacb2da7f65f339d2ae4c543b4148a8ff01f7a68e47b59f7c",
  "approved/sweetstable.json": "d888abb2d5f3689e8fa50a3d498cabfc68a0a700ce7b355071438e732cb4b58c",
  "../stylist/data/color-value-map.json": "5a7e7012ba07969dfa3bdb252126ad672bd18c39a1ded509272b066be7e89dd0",
  "../stylist/data/2026-09-30-proposed-stylist-rules.json":
    "82ad36149e05feff3a5b60c8dea5e4ca3034cf26c0c49b531f22ab9bf7f4b54b",
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

describe("detector registry", () => {
  it("legacy_chip keeps the old label, and a brand is a whole word", () => {
    expect(library.detectors).toHaveLength(15);
    for (const [house, profile] of Object.entries(APPROVED)) {
      const row = library.detectors.find((d) => d.legacy_id === house);
      expect(row, house).toBeTruthy();
      expect((profile as { legacy_chip?: string }).legacy_chip).toBe(row?.legacy_chip);
      expect((profile as { detector_id?: string }).detector_id).toBe(row?.id);
    }
    expect(brandHits("amiri", ["AMI"])).toBe(false);
    expect(brandHits("ami paris", ["AMI"])).toBe(true);
  });
});

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

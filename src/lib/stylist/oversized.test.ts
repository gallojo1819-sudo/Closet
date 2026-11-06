import { describe, expect, it } from "vitest";
import { LIVE_SNAPSHOT_COUNT, liveSnapshot } from "../__fixtures__/snapshot.ts";
import { mergeGarmentFields, mergeGarments, type CloudGarment } from "../cloud/merge.ts";
import { passesRules } from "./legal.ts";
import { DEFAULT_OVERSIZED_IDS, oversizedOf } from "./oversized.ts";

type Row = CloudGarment & { oversized?: boolean };

function row(id: string, oversized?: boolean): Row {
  return { id, name: id, imageSrc: "img", cutoutSrc: "cut", ...(oversized === undefined ? {} : { oversized }) };
}

describe("oversizedOf", () => {
  it("is true for the default ids and false for every other snapshot piece", () => {
    expect(liveSnapshot.length).toBe(LIVE_SNAPSHOT_COUNT);
    expect(liveSnapshot.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const g of liveSnapshot) {
      seen.add(g.id);
      expect(oversizedOf(g), g.id).toBe(DEFAULT_OVERSIZED_IDS.has(g.id));
    }
    for (const id of DEFAULT_OVERSIZED_IDS) expect(seen.has(id), id).toBe(true);
  });

  it("an explicit false beats the list, and an explicit true makes a regular jacket a legal outer", () => {
    const navy = liveSnapshot.find((g) => g.id === "g_d1awqw83gd3c")!;
    const blazer = liveSnapshot.find((g) => g.id === "g_5josnvyoi4z9")!;
    const trousers = liveSnapshot.find((g) => g.id === "g_k75fdfdsnak0")!;
    const loafers = liveSnapshot.find((g) => g.id === "g_8ukg5mi9r3fc")!;
    const chore = liveSnapshot.find((g) => g.id === "g_8qqqzpwxuwti")!;
    expect(oversizedOf({ ...navy, oversized: false })).toBe(false);
    expect(oversizedOf({ ...blazer, oversized: true })).toBe(true);
    const blocked = passesRules([navy, blazer, trousers, loafers], { occasion: "weekday", season: "fall" });
    expect(blocked.failed).toContain("JKT-LAY-9");
    const open = passesRules([{ ...navy, oversized: false }, blazer, trousers, loafers], {
      occasion: "weekday",
      season: "fall",
    });
    expect(open.failed).not.toContain("JKT-LAY-9");
    const allowed = passesRules([navy, { ...chore, oversized: true }, trousers, loafers], {
      occasion: "weekend",
      season: "fall",
    });
    expect(allowed.failed).not.toContain("JKT-LAY-9");
  });

  it("round-trips oversized through the garment merge", () => {
    const base = row("g_merge");
    const localOn = row("g_merge", true);
    const cloudSame = row("g_merge");
    expect(mergeGarmentFields(base, localOn, cloudSame).oversized).toBe(true);
    const cloudOff = row("g_merge", false);
    expect(mergeGarmentFields(localOn, localOn, cloudOff).oversized).toBe(false);
    const merged = mergeGarments({
      local: [localOn],
      cloud: [cloudSame],
      lastCloudIds: ["g_merge"],
      base: [base],
    });
    expect(merged).toHaveLength(1);
    expect((merged[0] as Row).oversized).toBe(true);
    const back = mergeGarments({
      local: merged as Row[],
      cloud: [cloudOff],
      lastCloudIds: ["g_merge"],
      base: merged as Row[],
    });
    expect((back[0] as Row).oversized).toBe(false);
  });
});

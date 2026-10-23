/**
 * On me's xAI time budget and the Today/Lookbook parity. The image edit gets ONME_TIMEOUT_MS
 * (every other xAI call keeps XAI_TIMEOUT_MS), a 422 retry only the server budget left, and both
 * timeout strings read the same copy. Today (dressLook) and a Lookbook sheet (ensureLookOnMe,
 * occasion through mapOccasion) send onMePreview the same payload for the same snapshot pieces.
 * No network: onMePreview, the image store and the cover loader are mocked; the snapshot carries
 * no cover fields, so the clean-cover check is mocked to yes.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Garment } from "./types.ts";

const sent: { refImage: string; cutouts: string[]; pieces: string; tuck?: string }[] = [];

vi.mock("@/lib/ai", () => ({
  onMePreview: vi.fn(async ({ data }: { data: (typeof sent)[number] }) => {
    sent.push(data);
    return { ok: true, image: "data:image/png;base64,AAAA" };
  }),
}));
vi.mock("@/components/shell/top-bar", () => ({ openRefPhotoDialog: () => {} }));
vi.mock("@/lib/images", () => ({
  getImage: async (key: string) => (key === "ref-photo" ? new Blob(["ref"]) : null),
  putImage: async () => {},
  jpegDataUrl: async (blob: Blob, size: number, q: number) => `jpeg:${await blob.text()}:${size}:${q}`,
  blobToDataUrl: async () => "",
  dataUrlToBlob: () => new Blob([]),
  lookOnMeKey: (id: string, extra: string) => `onme:${id}:${extra}`,
}));
vi.mock("@/lib/plate-pass", () => ({ noteGarmentCoverBytes: async () => {} }));
vi.mock("@/lib/cloud/cover", () => ({
  coverLoadError: (name: string) => `cover ${name}`,
  liveCoverLoader: () => null,
  loadPlateCovers: async (worn: Garment[]) => ({ ok: true, blobs: worn.map((g) => new Blob([g.id])) }),
}));
vi.mock("./plate.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./plate.ts")>()),
  hasCleanCover: () => true,
}));

const { ONME_MIN_RETRY_MS, ONME_SERVER_BUDGET_MS, ONME_TIMEOUT_MS, onMeRetryMs } = await import("./ai-budget.ts");
const { ON_ME_SLOW, dressLook, ensureLookOnMe, onMeErrorText } = await import("@/components/closet/on-me");
const { persistGate, useCloset } = await import("./store.ts");
const { cutoutsForOnYou, kitBand } = await import("./look.ts");
const { tuckDressingLines } = await import("./tuck.ts");
const { mapOccasion } = await import("./types.ts");
const { liveSnapshot } = await import("./__fixtures__/snapshot.ts");

const CLOSET: Garment[] = liveSnapshot;
const band = (b: ReturnType<typeof kitBand>) => CLOSET.filter((g) => kitBand(g) === b);
const bottom = band("bottom")[0]!;
const shoe = band("shoe")[0]!;
const outer = band("jacket")[0]!;
/* A shirt the tuck lines speak to, so the occasion check compares real text. */
const top = band("top").find((g) => tuckDressingLines([g, bottom, shoe], "out") !== "")!;
const LOOK = [top, bottom, shoe, outer];

let gateWas = true;
beforeAll(() => {
  gateWas = persistGate.open;
  persistGate.open = false;
  (globalThis as { window?: unknown }).window ??= globalThis;
});
afterAll(() => {
  persistGate.open = gateWas;
});
beforeEach(() => {
  sent.length = 0;
  useCloset.setState({ refPhoto: "ref-photo", garments: CLOSET });
});

describe("On me server budget", () => {
  it("gives the first edit 50 s inside a 55 s budget", () => {
    expect(ONME_TIMEOUT_MS).toBe(50000);
    expect(ONME_SERVER_BUDGET_MS).toBe(55000);
    expect(ONME_MIN_RETRY_MS).toBe(20000);
  });

  it("retries a 422 with only the time left, and not at all under 20 s", () => {
    expect(onMeRetryMs(0)).toBe(55000);
    expect(onMeRetryMs(1200)).toBe(53800);
    expect(onMeRetryMs(30000)).toBe(25000);
    expect(onMeRetryMs(35000)).toBe(20000);
    expect(onMeRetryMs(35001)).toBeNull();
    expect(onMeRetryMs(50000)).toBeNull();
    expect(onMeRetryMs(60000)).toBeNull();
    for (const elapsed of [0, 10000, 34999, 35000]) {
      expect(elapsed + onMeRetryMs(elapsed)!).toBe(ONME_SERVER_BUDGET_MS);
    }
  });

  it("onMePreview passes ONME_TIMEOUT_MS and the retry budget; every other call keeps 20 s", () => {
    const src = readFileSync(new URL("./ai.ts", import.meta.url), "utf8");
    expect(src).toMatch(/export const XAI_TIMEOUT_MS = 20000;/);
    const fn = src.slice(src.indexOf("export const onMePreview"), src.indexOf("export function parseLookLine"));
    expect(fn.match(/xaiFetch\(/g)).toHaveLength(2);
    expect(fn).toMatch(/\},\s*ONME_TIMEOUT_MS,\s*\);/);
    expect(fn).toMatch(/onMeRetryMs\(Date\.now\(\) - start\)/);
    expect(fn).toMatch(/\},\s*retryMs,\s*\);/);
    expect(src.match(/ONME_TIMEOUT_MS/g)).toHaveLength(2);
  });

  it("logs one line per call with counts and timing only", () => {
    const src = readFileSync(new URL("./ai.ts", import.meta.url), "utf8");
    const logs = src.match(/console\.info\([^\n]*\);/g) ?? [];
    expect(logs).toHaveLength(1);
    const line = logs[0]!;
    expect(line).toBe('console.info("onMePreview", { images: urls.length, ms: Date.now() - start, status: r.status, retried });');
    expect(line).not.toMatch(/data|prompt|key|bearer|json|refImage|cutouts/i);
  });
});

describe("On me timeout copy", () => {
  it("reads the same for the client cap and the server abort", () => {
    expect(ON_ME_SLOW).toBe("The image service was slow — tap to try again.");
    expect(onMeErrorText("timeout")).toBe(ON_ME_SLOW);
    expect(onMeErrorText("xAI request timed out")).toBe(ON_ME_SLOW);
    expect(onMeErrorText("Edit came back empty.")).toBe("Edit came back empty.");
  });

  it("the look sheet maps both strings and dresses with mapOccasion at 65 s", () => {
    const sheet = readFileSync(new URL("../components/closet/look-sheet.tsx", import.meta.url), "utf8");
    expect(sheet).toContain("setDressError(onMeErrorText(msg));");
    expect(sheet).toMatch(/65_000,\s*mapOccasion\(look\.occasion\),/);
    expect(sheet).not.toContain("45_000");
    expect(sheet).not.toContain("Imagine timed out");
  });
});

describe("Today and Lookbook send one payload", () => {
  it("picks a jacket look from the snapshot", () => {
    expect(CLOSET.length).toBeGreaterThan(0);
    expect(cutoutsForOnYou(LOOK).layers.map((g) => g.id)).toEqual(LOOK.map((g) => g.id));
  });

  it("dressLook and ensureLookOnMe build the same refImage, cutouts and pieces", async () => {
    await dressLook(LOOK, "out");
    await ensureLookOnMe("look_parity", LOOK, 65_000, mapOccasion("out"));
    expect(sent).toHaveLength(2);
    const [today, book] = sent;
    expect(today!.cutouts).toHaveLength(4);
    expect(book!.refImage).toBe(today!.refImage);
    expect(book!.cutouts).toEqual(today!.cutouts);
    expect(book!.pieces).toBe(today!.pieces);
    expect(book!.tuck).toBe(today!.tuck);
  });

  it("a dinner look sends the tuck text of out", async () => {
    await dressLook(LOOK, "out");
    await ensureLookOnMe("look_dinner", LOOK, 65_000, mapOccasion("dinner"));
    const [out, dinner] = sent;
    expect(out!.tuck).not.toBe("");
    expect(dinner!.tuck).toBe(out!.tuck);
  });
});

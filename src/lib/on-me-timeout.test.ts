/**
 * On me's xAI time budget and the Today/Lookbook parity. The image edit gets ONME_TIMEOUT_MS
 * (every other xAI call keeps XAI_TIMEOUT_MS), a 422 retry only the server budget left, and both
 * timeout strings read the same copy. Today (dressLook) and a Lookbook sheet (ensureLookOnMe,
 * occasion through mapOccasion) send onMePreview the same payload for the same snapshot pieces.
 * No network: onMePreview, the image store and the cover loader are mocked; the snapshot carries
 * no cover fields, so the clean-cover check is mocked to yes.
 */
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
const { ONME_DOWNLOAD_DEADLINE_MS, ONME_MIN_RETRY_MS, ONME_SERVER_BUDGET_MS, ONME_TIMEOUT_MS, onMeDownloadMs, onMeRetryMs } =
  await import("./ai-budget.ts");
const {
  ON_ME_BUSY,
  ON_ME_BUSY_HINT,
  ON_ME_BUSY_SHORT,
  ON_ME_CLIENT_MS,
  ON_ME_SLOW,
  dressLook,
  ensureLookOnMe,
  onMeErrorText,
} = await import("@/components/closet/on-me");
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

  it("gives the result download whatever is left before 58 s, never under 1 s", () => {
    expect(ONME_DOWNLOAD_DEADLINE_MS).toBe(58000);
    expect(ONME_DOWNLOAD_DEADLINE_MS).toBe(ONME_SERVER_BUDGET_MS + 3000);
    expect(onMeDownloadMs(10000)).toBe(48000);
    expect(onMeDownloadMs(57500)).toBe(1000);
    expect(onMeDownloadMs(0)).toBe(58000);
    expect(onMeDownloadMs(58000)).toBe(1000);
    expect(onMeDownloadMs(60000)).toBe(1000);
  });

  it("onMePreview passes ONME_TIMEOUT_MS and the retry budget; every other call keeps 20 s", () => {
    const src = readFileSync(new URL("./ai.ts", import.meta.url), "utf8");
    expect(src).toMatch(/export const XAI_TIMEOUT_MS = 20000;/);
    const fn = src.slice(src.indexOf("export const onMePreview"), src.indexOf("export function parseLookLine"));
    expect(fn.match(/xaiFetch\(/g)).toHaveLength(2);
    expect(fn).toMatch(/\},\s*ONME_TIMEOUT_MS,\s*\);/);
    expect(fn).toMatch(/onMeRetryMs\(Date\.now\(\) - start\)/);
    expect(fn).toMatch(/\},\s*retryMs,\s*\);/);
    expect(fn).toMatch(/imageFromEditJson\(r\.json,\s*onMeDownloadMs\(Date\.now\(\) - start\)\)/);
    expect(fn).toMatch(/if \(!got\.ok\) return done\(\{ ok: false, error: got\.error \}\)/);
    expect(src).not.toContain("r.error || got.error");
    expect(src.match(/ONME_TIMEOUT_MS/g)).toHaveLength(2);
    const download = src.slice(
      src.indexOf("export async function imageFromEditJson"),
      src.indexOf("async function imagineEdit"),
    );
    expect(download).toMatch(/timeoutMs = XAI_TIMEOUT_MS/);
    expect(download).toMatch(/fetch\(url,\s*\{\s*signal\s*\}\)/);
    expect(download).toMatch(/AbortSignal\.timeout\(timeoutMs\)/);
    const imagine = src.slice(src.indexOf("async function imagineEdit"), src.indexOf("const STATUS_TTL"));
    expect(imagine).toMatch(/await imageFromEditJson\(r\.json\)/);
    expect(imagine).toMatch(/if \(!got\.ok\) return \{ ok: false, error: got\.error \}/);
    expect(imagine).not.toContain("onMeDownloadMs");
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
  it("reads the same for the client cap, the server abort, and a gateway timeout", () => {
    expect(ON_ME_SLOW).toBe("The image service was slow — tap to try again.");
    expect(onMeErrorText("timeout")).toBe(ON_ME_SLOW);
    expect(onMeErrorText("xAI request timed out")).toBe(ON_ME_SLOW);
    expect(onMeErrorText("FUNCTION_INVOCATION_TIMEOUT")).toBe(ON_ME_SLOW);
    expect(onMeErrorText("FUNCTION_INVOCATION_TIMEOUT: the function died")).toBe(ON_ME_SLOW);
    expect(onMeErrorText("Error 504")).toBe(ON_ME_SLOW);
    expect(onMeErrorText("504 Gateway Timeout")).toBe(ON_ME_SLOW);
    expect(onMeErrorText("Edit came back empty.")).toBe("Edit came back empty.");
    expect(onMeErrorText("Could not download the edit.")).toBe("Could not download the edit.");
    expect(onMeErrorText("504")).toBe("504");
  });

  it("the look sheet maps both strings and dresses with mapOccasion at the client cap", () => {
    const sheet = readFileSync(new URL("../components/closet/look-sheet.tsx", import.meta.url), "utf8");
    const onMe = readFileSync(new URL("../components/closet/on-me.tsx", import.meta.url), "utf8");
    expect(sheet).toContain("setDressError(onMeErrorText(msg));");
    expect(sheet).toMatch(/ON_ME_CLIENT_MS,\s*mapOccasion\(look\.occasion\),/);
    expect(sheet).not.toContain("45_000");
    expect(sheet).not.toContain("Imagine timed out");
    expect(sheet).not.toMatch(/65_000|65000/);
    expect(ON_ME_CLIENT_MS).toBe(65_000);
    expect(onMe.match(/65_000|65000/g)).toEqual(["65_000"]);
    expect(onMe).toMatch(/withTimeout\(dressLook\(pieces, occasion\), ON_ME_CLIENT_MS\)/);
    expect(onMe.match(/ms = ON_ME_CLIENT_MS/g)).toHaveLength(2);
    const run = onMe.slice(onMe.indexOf("const run = async"), onMe.indexOf("return {"));
    expect(run).toMatch(/onMeErrorText\(e\.message\)/);
    expect(run).toMatch(/setBusy\(false\)/);
  });

  it("keeps the busy words and puts the long half under the button", () => {
    const sheet = readFileSync(new URL("../components/closet/look-sheet.tsx", import.meta.url), "utf8");
    const onMe = readFileSync(new URL("../components/closet/on-me.tsx", import.meta.url), "utf8");
    expect(ON_ME_BUSY_SHORT).toBe("Dressing you…");
    expect(ON_ME_BUSY_HINT).toBe("This can take up to a minute");
    expect(ON_ME_BUSY).toBe("Dressing you… this can take up to a minute");
    expect(onMe).toContain("whitespace-nowrap");
    expect(onMe).toContain("{preview.busy && <p className=\"micro text-ink-soft\">{ON_ME_BUSY_HINT}</p>}");
    expect(sheet).toContain("whitespace-nowrap");
    expect(sheet).toContain("{dressing && <p className=\"micro text-ink-soft\">{ON_ME_BUSY_HINT}</p>}");
    expect(sheet).toContain("dressing ? ON_ME_BUSY_SHORT : \"On you\"");
    expect(onMe).toContain("? ON_ME_BUSY_SHORT");
  });
});

describe("Today and Lookbook send one payload", () => {
  it("picks a jacket look from the snapshot", () => {
    expect(CLOSET.length).toBeGreaterThan(0);
    expect(cutoutsForOnYou(LOOK).layers.map((g) => g.id)).toEqual(LOOK.map((g) => g.id));
  });

  it("dressLook and ensureLookOnMe build the same refImage, cutouts and pieces", async () => {
    await dressLook(LOOK, "out");
    await ensureLookOnMe("look_parity", LOOK, ON_ME_CLIENT_MS, mapOccasion("out"));
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
    await ensureLookOnMe("look_dinner", LOOK, ON_ME_CLIENT_MS, mapOccasion("dinner"));
    const [out, dinner] = sent;
    expect(out!.tuck).not.toBe("");
    expect(dinner!.tuck).toBe(out!.tuck);
  });
});

describe("edit result download", () => {
  const json = { data: [{ url: "https://example.invalid/edit.png" }] };

  async function realEditJson() {
    const mod = await vi.importActual<typeof import("./ai.ts")>("./ai.ts");
    return mod;
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns the timeout error when the result download never settles", async () => {
    const { imageFromEditJson, XAI_TIMEOUT_MS } = await realEditJson();
    expect(XAI_TIMEOUT_MS).toBe(20000);
    const elapsed = 10_000;
    const deadline = onMeDownloadMs(elapsed);
    expect(elapsed + deadline).toBe(ONME_DOWNLOAD_DEADLINE_MS);
    vi.useFakeTimers();
    const hung: Promise<unknown>[] = [];
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      const pending = new Promise(() => {});
      hung.push(pending);
      return pending;
    });
    let settled = false;
    const pending = imageFromEditJson(json, deadline).then((value) => {
      settled = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(deadline - 1);
    expect(settled).toBe(false);
    expect(hung).toHaveLength(1);
    expect(signal).toBeInstanceOf(AbortSignal);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ ok: false, error: "xAI request timed out" });
    let fetchSettled = false;
    void hung[0]!.then(
      () => {
        fetchSettled = true;
      },
      () => {
        fetchSettled = true;
      },
    );
    await Promise.resolve();
    expect(fetchSettled).toBe(false);
  });

  it("uses the 20 s default for a caller that does not pass a deadline", async () => {
    const { imageFromEditJson, XAI_TIMEOUT_MS } = await realEditJson();
    vi.useFakeTimers();
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    let settled = false;
    const pending = imageFromEditJson(json).then((value) => {
      settled = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(XAI_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ ok: false, error: "xAI request timed out" });
  });

  it("keeps any other download failure", async () => {
    const { imageFromEditJson } = await realEditJson();
    vi.stubGlobal("fetch", async () => new Response("no", { status: 500 }));
    await expect(imageFromEditJson(json, 1000)).resolves.toEqual({
      ok: false,
      error: "Could not download the edit.",
    });
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(imageFromEditJson(json, 1000)).resolves.toEqual({
      ok: false,
      error: "Could not download the edit.",
    });
    await expect(imageFromEditJson({})).resolves.toEqual({ ok: false, error: "Edit came back empty." });
    await expect(imageFromEditJson({ data: [{ b64_json: "AAAA" }] })).resolves.toEqual({
      ok: true,
      image: "data:image/png;base64,AAAA",
    });
  });

  it("times out when headers arrive and the body never ends", async () => {
    const { imageFromEditJson } = await realEditJson();
    vi.useFakeTimers();
    vi.stubGlobal("fetch", () => {
      const stream = new ReadableStream({
        start() {
          /* never enqueues or closes */
        },
      });
      return Promise.resolve(
        new Response(stream, { status: 200, headers: { "content-type": "image/jpeg" } }),
      );
    });
    let settled = false;
    const pending = imageFromEditJson(json, 1000).then((value) => {
      settled = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ ok: false, error: "xAI request timed out" });
  });

  it("keeps a hung download's timeout through the post-edit step", async () => {
    const { finishEdit, imageFromEditJson } = await realEditJson();
    vi.useFakeTimers();
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const raw = JSON.stringify({ data: [{ url: "https://example.invalid/x.png" }] });
    const deadline = onMeDownloadMs(0);
    let settled = false;
    const pending = imageFromEditJson(
      { data: [{ url: "https://example.invalid/x.png" }] },
      deadline,
    ).then((value) => {
      settled = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(deadline - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const got = await pending;
    const finished = finishEdit(got);
    expect(finished).toEqual({ ok: false, error: "xAI request timed out" });
    if (finished.ok) throw new Error("expected the download to fail");
    expect(finished.error).not.toBe(raw);
    expect(onMeErrorText(finished.error)).toBe(ON_ME_SLOW);
    expect(finishEdit({ ok: true, image: "data:image/png;base64,AA" })).toEqual({
      ok: true,
      image: "data:image/png;base64,AA",
    });
  });
});

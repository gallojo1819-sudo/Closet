import { register } from "node:module";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

register(new URL("../../scripts/ts-ext.mjs", import.meta.url), {
  parentURL: import.meta.url,
});

const { looksPage, frameRead, largestInkBounds, planMatte, chooseInkCrop, groundIsWhite, planForPixels } =
  await import("./matte.ts");
const { admitScanFile, clipboardWantsJpeg, legacyFileFingerprint, prepareClipboardFiles } =
  await import("./images.ts");
const {
  AlreadyInCloset,
  NEEDS_NAME_PROMPT,
  PageRejected,
  UPLOAD_MISS_COPY,
  claimNaming,
  classifyScanError,
  listingUrlFromClipboard,
  releaseNaming,
  tileCaption,
  uploadMissLine,
} = await import("./upload-read.ts");
const { decideCameraTag, nameWithRetry } = await import("./camera-tag.ts");
const { withTimeout, NEW_PIECE_NAME } = await import("./ingest.ts");
const { enqueueTag } = await import("./print-queue.ts");
const { useCloset } = await import("./store.ts");
const { persistGate } = await import("./store-persist.ts");
import type { Garment } from "./types.ts";

function paint(
  w: number,
  h: number,
  fill: (x: number, y: number) => [number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fill(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

function rect(
  x: number,
  y: number,
  x1: number,
  y1: number,
  px: number,
  py: number,
): boolean {
  return px >= x && px <= x1 && py >= y && py <= y1;
}

/** White store photo: one navy garment, plus a thin logo line that trips looksPage. */
function whiteProduct(): { data: Uint8ClampedArray; w: number; h: number } {
  const w = 90;
  const h = 120;
  const data = paint(w, h, (x, y) => {
    if (y <= 2 && x < 40) return [20, 20, 20];
    if (rect(22, 14, 68, 114, x, y)) return [18, 28, 72];
    return [255, 255, 255];
  });
  return { data, w, h };
}

/** Tall shopping page: three separated product tiles and a header line. */
function shoppingPage(): { data: Uint8ClampedArray; w: number; h: number } {
  const w = 80;
  const h = 220;
  const tiles = [
    [8, 28, 70, 70],
    [8, 90, 70, 132],
    [8, 154, 70, 196],
  ] as const;
  const data = paint(w, h, (x, y) => {
    if (y <= 4) return [12, 12, 12];
    for (const [x0, y0, x1, y1] of tiles) {
      if (rect(x0, y0, x1, y1, x, y)) return [24, 32, 80];
    }
    return [255, 255, 255];
  });
  return { data, w, h };
}

function png(bytes: number[], modified: number): File {
  return new File([Uint8Array.from(bytes)], "image.png", {
    type: "image/png",
    lastModified: modified,
  });
}

describe("white product is cut out, a page screenshot is not", () => {
  it("a white-background product that looksPage flags is a garment, not a page", () => {
    const shot = whiteProduct();
    assert.equal(looksPage(shot.data, shot.w, shot.h), true);
    assert.equal(frameRead(shot.data, shot.w, shot.h), "product");
    const plan = planMatte({
      read: "product",
      chrome: true,
      studio: false,
      whiteGround: true,
    });
    assert.equal(plan.kind, "phone");
    assert.equal(plan.crop, "ink");
    assert.notEqual(plan.kind, "page");
    const box = largestInkBounds(shot.data, shot.w, shot.h);
    assert.ok(box);
    assert.ok(box.minY > 4, "crop drops the logo line");
    assert.ok(box.maxX - box.minX < shot.w - 4);
    assert.ok(box.maxY - box.minY > shot.h * 0.5);
  });

  it("a tall multi-product page still gets the page message", () => {
    const shot = shoppingPage();
    assert.equal(looksPage(shot.data, shot.w, shot.h), true);
    assert.equal(frameRead(shot.data, shot.w, shot.h), "page");
    const plan = planMatte({
      read: "page",
      chrome: true,
      studio: false,
      whiteGround: true,
    });
    assert.equal(plan.kind, "page");
    const caught = classifyScanError(new PageRejected(), "pasted 1", false);
    assert.equal(caught.type, "miss");
    if (caught.type !== "miss") return;
    assert.equal(caught.miss.reason, "page");
    assert.equal(uploadMissLine(caught.miss), `pasted 1 — ${UPLOAD_MISS_COPY.page}`);
    assert.match(uploadMissLine(caught.miss), /crop to one piece or paste the product link/);
  });
});

describe("pasted image.png files", () => {
  it("numbers three different pastes and treats identical bytes as already in the closet", async () => {
    const files = [png([1, 2, 3, 4], 10), png([5, 6, 7, 8], 20), png([9, 10, 11, 12], 30)];
    const prepared = await prepareClipboardFiles(files);
    assert.deepEqual(
      prepared.ready.map((f) => f.name),
      ["pasted 1", "pasted 2", "pasted 3"],
    );
    assert.equal(prepared.misses.length, 0);
    const known = new Set<string>();
    for (const file of prepared.ready) {
      const admitted = await admitScanFile(file, known);
      assert.equal(admitted.duplicate, false);
    }
    const again = await admitScanFile(png([1, 2, 3, 4], 999), known);
    assert.equal(again.duplicate, true);
    const caught = classifyScanError(new AlreadyInCloset(), "pasted 1", false);
    assert.equal(caught.type, "dupe");
  });
});

describe("webp and avif clipboard blobs", () => {
  it("converts a webp paste to jpeg and the scan admits those bytes", async () => {
    assert.equal(clipboardWantsJpeg({ type: "image/webp", size: 12 }), true);
    assert.equal(clipboardWantsJpeg({ type: "image/avif", size: 12 }), true);
    assert.equal(clipboardWantsJpeg({ type: "image/svg+xml", size: 12 }), true);
    assert.equal(clipboardWantsJpeg({ type: "image/png", size: 0 }), true);
    assert.equal(clipboardWantsJpeg({ type: "image/png", size: 12 }), false);
    const jpeg = Uint8Array.from([9, 8, 7, 6, 5]);
    const webp = new File([Uint8Array.from([1, 2, 3, 4])], "image.png", {
      type: "image/webp",
      lastModified: 4,
    });
    const prepared = await prepareClipboardFiles([webp], async () => new Blob([jpeg], { type: "image/jpeg" }));
    assert.equal(prepared.misses.length, 0);
    assert.equal(prepared.ready.length, 1);
    const file = prepared.ready[0]!;
    assert.equal(file.type, "image/jpeg");
    assert.equal(file.name, "pasted 1");
    assert.equal(file.size, jpeg.byteLength);
    const known = new Set<string>();
    const admitted = await admitScanFile(file, known);
    assert.equal(admitted.duplicate, false);
    const sameBytes = new File([jpeg], "image.png", { type: "image/jpeg", lastModified: 80 });
    const dupe = await admitScanFile(sameBytes, known);
    assert.equal(dupe.duplicate, true);
  });

  it("an empty clipboard file is a format miss, not a shared image.png line", async () => {
    const empty = new File([], "image.png", { type: "image/png", lastModified: 1 });
    const prepared = await prepareClipboardFiles([empty], async () => {
      throw new Error("decode");
    });
    assert.equal(prepared.ready.length, 0);
    assert.equal(prepared.misses.length, 1);
    assert.equal(prepared.misses[0]?.name, "pasted 1");
    assert.equal(prepared.misses[0]?.reason, "format");
    assert.match(uploadMissLine(prepared.misses[0]!), /Couldn't open this image format/);
  });
});

describe("naming retry", () => {
  it("a timeout retries once and a second miss asks for a name", async () => {
    let calls = 0;
    const named = await nameWithRetry({
      firstMs: 25,
      retryMs: 25,
      read: async (ms) => {
        calls += 1;
        const waited = await withTimeout(
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  name: "Navy zip sweater",
                  category: "top",
                  subtype: "sweater",
                  colors: ["navy"],
                }),
              calls === 1 ? 80 : 0,
            );
          }),
          ms,
        );
        return decideCameraTag(
          waited as {
            ok: true;
            name: string;
            category: string;
            subtype: string;
            colors: string[];
          } | null,
        );
      },
    });
    assert.equal(calls, 2);
    assert.equal(named.step, "apply");
    if (named.step === "apply") {
      assert.equal(named.patch.name, "Navy zip sweater");
      assert.equal(named.patch.category, "top");
    }

    let misses = 0;
    const asked = await nameWithRetry({
      read: async () => {
        misses += 1;
        return { action: "keep" as const };
      },
    });
    assert.equal(misses, 2);
    assert.equal(asked.step, "ask");
    const caption = tileCaption({
      name: NEW_PIECE_NAME,
      category: "other",
      needsName: asked.step === "ask",
    });
    assert.equal(caption.title, NEEDS_NAME_PROMPT);
    assert.equal(caption.meta, "");
    assert.equal(caption.title.includes(NEW_PIECE_NAME), false);
    assert.equal(caption.meta.length, 0);

    const noFallback = await nameWithRetry({
      read: async () => ({ action: "worn" as const, fallback: null }),
      countWorn: async () => 0,
    });
    assert.equal(noFallback.step, "ask");
  });

  it("enqueueTag asks instead of leaving the tile unnamed with no prompt", async () => {
    assert.equal(persistGate.open, false);
    const prev = useCloset.getState().garments;
    const row: Garment = {
      id: "g_upload_name",
      name: NEW_PIECE_NAME,
      category: "other",
      subtype: "",
      colors: [],
      material: "",
      brand: "",
      notes: "",
      formality: 3,
      warmth: 3,
      seasons: [],
      imageSrc: "",
      cutoutSrc: "",
      imageSource: "photo",
      matteQuality: "ok",
      demo: false,
      archived: false,
      wornOn: [],
      createdAt: "2026-11-06T22:00:00.000Z",
    };
    useCloset.setState({ garments: [row] });
    try {
      let asked = 0;
      let named = 0;
      await enqueueTag(row.id, "data:image/jpeg;base64,aa", {
        timeoutMs: 15,
        onAsk: () => {
          asked += 1;
        },
        onNamed: () => {
          named += 1;
        },
        tag: () => Promise.reject(new Error("timeout")),
      });
      const failed = useCloset.getState().garments.find((g) => g.id === row.id);
      assert.equal(failed?.name, NEW_PIECE_NAME);
      assert.equal(failed?.needsCategory, true);
      assert.equal(asked, 1);
      assert.equal(named, 0);
      const caption = tileCaption({
        name: failed?.name ?? "",
        category: failed?.category ?? "other",
        needsName: true,
      });
      assert.equal(caption.title, NEEDS_NAME_PROMPT);
      assert.equal(caption.meta, "");
    } finally {
      useCloset.setState({ garments: prev });
    }
  });
});

describe("banner copy", () => {
  it("lists a reason on each file", () => {
    const lines = (["page", "format", "empty", "timeout", "read"] as const).map((reason, i) =>
      uploadMissLine({ name: `pasted ${i + 1}`, reason }),
    );
    assert.equal(lines[0], `pasted 1 — ${UPLOAD_MISS_COPY.page}`);
    assert.equal(lines[1], `pasted 2 — ${UPLOAD_MISS_COPY.format}`);
    assert.equal(lines[2], `pasted 3 — ${UPLOAD_MISS_COPY.empty}`);
    assert.equal(lines[3], `pasted 4 — ${UPLOAD_MISS_COPY.timeout}`);
    assert.equal(lines[4], `pasted 5 — ${UPLOAD_MISS_COPY.read}`);
    assert.equal(new Set(lines).size, lines.length);
    assert.equal(lines.some((line) => /Could not read \d+:/.test(line)), false);
    const timeout = classifyScanError(new Error("xAI request timed out"), "pasted 4", false);
    assert.equal(timeout.type, "miss");
    if (timeout.type === "miss") assert.equal(timeout.miss.reason, "timeout");
  });

  it("reads a listing url out of copied html", () => {
    const html =
      '<a href="https://www.farfetch.com/shopping/men/navy-knit-123">knit</a><img src="https://cdn.example/a.jpg">';
    assert.equal(
      listingUrlFromClipboard("", html),
      "https://www.farfetch.com/shopping/men/navy-knit-123",
    );
    assert.equal(
      listingUrlFromClipboard("https://www.ssense.com/en-us/men/product/navy", html),
      "https://www.ssense.com/en-us/men/product/navy",
    );
  });

  it("the add screen no longer collapses misses into one Could not read line", () => {
    const studio = readFileSync(new URL("../components/add/studio.tsx", import.meta.url), "utf8");
    assert.equal(studio.includes("Could not read {failed.length}"), false);
    assert.match(studio, /if \(matte\.kind === "page"\) throw new PageRejected\(\)/);
    assert.match(studio, /NO_GARMENT_REASON/);
    assert.match(studio, /prepareClipboardFiles/);
    assert.match(studio, /nameWithRetry/);
    assert.match(studio, /NEEDS_NAME_PROMPT/);
    const ai = readFileSync(new URL("./ai.ts", import.meta.url), "utf8");
    const log = ai.slice(ai.indexOf("function logTag"), ai.indexOf("export const tagGarment"));
    assert.match(log, /\[closet-name\] tagGarment/);
    assert.equal(log.includes("data.image"), false);
    assert.equal(log.includes("apiKey"), false);
    assert.equal(log.includes("XAI_API_KEY"), false);
  });

  it("does not offer an image url as a listing", () => {
    assert.equal(listingUrlFromClipboard("", '<img src="https://cdn.example/garment.jpg">'), null);
    assert.equal(
      listingUrlFromClipboard(
        "",
        '<a href="https://www.farfetch.com/shopping/men/navy">navy</a><img src="https://cdn.example/a.jpg">',
      ),
      "https://www.farfetch.com/shopping/men/navy",
    );
  });
});

describe("legacy closet hashes", () => {
  it("treats a photo saved under the old name-and-mtime hash as already in the closet", async () => {
    const bytes = [4, 5, 6, 7, 8];
    const stored = new File([Uint8Array.from(bytes)], "navy.png", {
      type: "image/png",
      lastModified: 1_700_000_000_000,
    });
    const legacy = await legacyFileFingerprint(stored);
    const known = new Set([legacy]);
    const again = new File([Uint8Array.from(bytes)], "navy.png", {
      type: "image/png",
      lastModified: 1_700_000_000_000,
    });
    const admitted = await admitScanFile(again, known);
    assert.equal(admitted.duplicate, true);
    assert.notEqual(admitted.hash, legacy);
    assert.equal(known.has(admitted.hash), true);
    assert.equal(known.has(legacy), true);

    const different = [
      png([1, 2, 3, 4], 11),
      png([5, 6, 7, 8], 22),
      png([9, 10, 11, 12], 33),
    ];
    const batch = new Set<string>();
    for (const file of different) {
      const one = await admitScanFile(file, batch);
      assert.equal(one.duplicate, false);
    }
    const sameBytes = new File([Uint8Array.from([1, 2, 3, 4])], "other-name.png", {
      type: "image/png",
      lastModified: 99,
    });
    const dupe = await admitScanFile(sameBytes, batch);
    assert.equal(dupe.duplicate, true);
  });
});

describe("crop gaps", () => {
  it("a near-white tee with a small dark logo is cropped to the tee", () => {
    const w = 200;
    const h = 320;
    const tee = { x0: 40, y0: 50, x1: 160, y1: 280 };
    const logo = { x0: 70, y0: 140, x1: 129, y1: 179 };
    const data = paint(w, h, (x, y) => {
      if (y <= 3 && x < 50) return [16, 16, 16];
      if (rect(logo.x0, logo.y0, logo.x1, logo.y1, x, y)) return [12, 12, 20];
      if (rect(tee.x0, tee.y0, tee.x1, tee.y1, x, y)) return [244, 244, 244];
      return [255, 255, 255];
    });
    const ink = largestInkBounds(data, w, h);
    assert.ok(ink);
    const inkArea = (ink.maxX - ink.minX + 1) * (ink.maxY - ink.minY + 1);
    assert.ok(inkArea / (w * h) < 0.04);
    const box = chooseInkCrop(data, w, h, { r: 255, g: 255, b: 255 });
    assert.ok(box);
    assert.ok(box.minX <= tee.x0 && box.minY <= tee.y0);
    assert.ok(box.maxX >= tee.x1 && box.maxY >= tee.y1);
    const cover = ((box.maxX - box.minX + 1) * (box.maxY - box.minY + 1)) / (w * h);
    assert.ok(cover > 0.2);
  });

  it("an off-white ground with a dark band takes the flood matte", () => {
    assert.equal(groundIsWhite({ r: 222, g: 222, b: 222 }), false);
    assert.equal(groundIsWhite({ r: 250, g: 250, b: 250 }), true);
    const w = 90;
    const h = 140;
    const data = paint(w, h, (x, y) => {
      if (y <= 6) return [20, 20, 20];
      if (rect(28, 36, 62, 110, x, y)) return [18, 28, 72];
      return [222, 222, 222];
    });
    assert.equal(looksPage(data, w, h), true);
    assert.equal(frameRead(data, w, h), "product");
    const plan = planForPixels(data, w, h);
    assert.equal(plan.crop, "flood");
    assert.equal(plan.kind, "phone");
    assert.equal(
      planMatte({ read: "product", chrome: true, studio: false, whiteGround: false }).crop,
      "flood",
    );
  });
});

describe("re-tag guard", () => {
  it("a second tap while naming is in flight does not start another run", async () => {
    const inFlight = new Set<string>();
    let runs = 0;
    let finish = () => {};
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const start = (id: string) => {
      if (!claimNaming(inFlight, id)) return null;
      runs += 1;
      return gate.finally(() => releaseNaming(inFlight, id));
    };
    const first = start("g_piece");
    const second = start("g_piece");
    assert.equal(runs, 1);
    assert.equal(second, null);
    assert.equal(inFlight.has("g_piece"), true);
    finish();
    await first;
    assert.equal(inFlight.has("g_piece"), false);
    assert.equal(claimNaming(inFlight, "g_piece"), true);
    const studio = readFileSync(new URL("../components/add/studio.tsx", import.meta.url), "utf8");
    assert.match(studio, /claimNaming\(namingRef\.current, id\)/);
    assert.match(studio, /disabled=\{namingIds\.includes\(g\.id\)\}/);
  });
});

describe("pasted names across pastes", () => {
  it("keeps numbering going instead of restarting at pasted 1", async () => {
    const seq = { n: 0 };
    const first = await prepareClipboardFiles([png([1, 1, 1], 1)], undefined, seq);
    const second = await prepareClipboardFiles([png([2, 2, 2], 2), png([3, 3, 3], 3)], undefined, seq);
    assert.equal(first.ready[0]?.name, "pasted 1");
    assert.deepEqual(
      second.ready.map((file) => file.name),
      ["pasted 2", "pasted 3"],
    );
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ADD_TILE_BUDGET_MS,
  ADDING_NAME,
  addProgress,
  addQueueConcurrency,
  ingestSteps,
  runIngestPiece,
  saveBeforeImagine,
} from "./ingest.ts";

/** Fake user — tests never read or write closet.v6. */
void "fake-user-joe";

describe("ingest order", () => {
  it("addGarment (save) happens before Imagine (print)", () => {
    assert.equal(saveBeforeImagine(), true);
    const steps = ingestSteps();
    assert.ok(steps.indexOf("preview") < steps.indexOf("matte"));
    assert.ok(steps.indexOf("save") < steps.indexOf("tag"));
    assert.ok(steps.indexOf("save") < steps.indexOf("print"));
  });
});

describe("addQueueConcurrency", () => {
  it("is 2 on cellular or a phone-width screen, 3 on desktop", () => {
    assert.equal(addQueueConcurrency({ width: 390 }), 2);
    assert.equal(addQueueConcurrency({ width: 1280, connectionType: "cellular" }), 2);
    assert.equal(addQueueConcurrency({ width: 1280, effectiveType: "3g" }), 2);
    assert.equal(addQueueConcurrency({ width: 1280, effectiveType: "4g" }), 3);
  });
});

describe("addProgress", () => {
  it("names the piece: 2/8 — Navy chino", () => {
    assert.equal(addProgress(2, 8, "Navy chino"), "2/8 — Navy chino");
    assert.equal(addProgress(2, 8, ADDING_NAME), "2/8");
  });
});

describe("runIngestPiece", () => {
  it("fake 4MB camera JPEG: tile <300ms; save before Imagine", async () => {
    const file = new File([new Uint8Array(4 * 1024 * 1024)], "IMG_0001.jpg", {
      type: "image/jpeg",
    });
    let shrinkArg: File | null = null;
    let matteArg: string | null = null;
    const { previewMs, steps } = await runIngestPiece(file, "g-fake", {
      now: (() => {
        let t = 0;
        return () => {
          t += 1;
          return t;
        };
      })(),
      shrink: async (f) => {
        shrinkArg = f;
        return { dataUrl: "data:image/jpeg;base64,xx", objectUrl: "blob:preview" };
      },
      matte: async (src) => {
        matteArg = src;
        return { cutoutSrc: "data:image/jpeg;base64,yy", kind: "phone" };
      },
      save: async () => {},
      tag: async () => ({ name: "Navy chino" }),
      enqueuePrint: () => {},
      onPreview: () => {},
    });
    assert.ok(previewMs < ADD_TILE_BUDGET_MS);
    assert.equal(shrinkArg, file);
    assert.equal(matteArg, "data:image/jpeg;base64,xx");
    assert.ok(steps.indexOf("preview") < steps.indexOf("matte"));
    assert.ok(steps.indexOf("save") < steps.indexOf("print"));
    assert.ok(steps.indexOf("save") < steps.indexOf("tag"));
  });
});

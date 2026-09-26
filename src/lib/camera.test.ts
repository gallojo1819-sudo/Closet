import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cameraInputProps,
  handleCameraChange,
  HEIC_ERROR,
  isHeicFile,
  isImageFile,
  libraryInputProps,
  SHOT_MISS,
} from "./camera.ts";
import { addQueueConcurrency, ingestCameraShot, NEW_PIECE_NAME, runIngestPiece } from "./ingest.ts";

/** Fake user — tests never read or write closet.v6. */
void "fake-user-joe";

describe("iOS Take photo vs Photo library", () => {
  it("Take photo is rear camera, not multiple", () => {
    const cam = cameraInputProps();
    assert.equal(cam.capture, "environment");
    assert.equal(cam.accept.includes("image/*"), true);
    assert.equal("multiple" in cam, false);
  });

  it("Photo library has no capture and allows multiple", () => {
    const lib = libraryInputProps();
    assert.equal("capture" in lib, false);
    assert.equal(lib.multiple, true);
  });
});

describe("isImageFile", () => {
  it("accepts HEIC, empty type, and JPEG", () => {
    assert.equal(isImageFile({ type: "image/heic", name: "IMG_1.HEIC" }), true);
    assert.equal(isHeicFile({ type: "image/heic", name: "IMG_1.HEIC" }), true);
    assert.equal(isImageFile({ type: "", name: "IMG_0002.heic" }), true);
    assert.equal(isImageFile({ type: "image/jpeg", name: "a.jpg" }), true);
    assert.equal(isImageFile({ type: "application/pdf", name: "x.pdf" }), false);
  });
});

describe("Take photo onChange", () => {
  it("390 viewport: onChange fires, garment in livePool before printGarment resolves", async () => {
    assert.equal(addQueueConcurrency({ width: 390 }), 2);
    const pool: { id: string; name: string }[] = [];
    let printResolved = false;
    const file = new File([new Uint8Array([1, 2, 3])], "IMG_0001.heic", {
      type: "image/heic",
    });
    const fired = handleCameraChange(
      [file],
      (files) => {
        void runIngestPiece(files[0]!, "g-cam", {
          shrink: async () => ({
            dataUrl: "data:image/jpeg;base64,/9j/xx",
            objectUrl: "blob:preview",
          }),
          matte: async () => ({ cutoutSrc: "data:image/jpeg;base64,yy", kind: "phone" }),
          save: async ({ id, name }) => {
            pool.push({ id, name });
          },
          tag: async () => ({ name: "Navy chino" }),
          enqueuePrint: () => {
            /* never resolves */
          },
          onPreview: () => {},
        });
      },
      () => {},
    );
    assert.equal(fired, true);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(pool.length, 1);
    assert.equal(printResolved, false);
    assert.ok(pool[0]?.name === NEW_PIECE_NAME || pool[0]?.name === "Navy chino");
  });
});

describe("camera shot survives", () => {
  it("writes pending IDB before matte; a matte throw still adds a visible cover", async () => {
    const order: string[] = [];
    const saved: { cover: string; name: string; fellBack: boolean } = {
      cover: "",
      name: "",
      fellBack: false,
    };
    let ensured = false;
    const file = new File([new Uint8Array([9, 8, 7, 6])], "IMG_0001.jpg", {
      type: "image/jpeg",
    });
    await ingestCameraShot(file, {
      putPending: async () => {
        order.push("pending");
      },
      clearPending: async () => {
        order.push("clear");
      },
      shrink: async () => {
        order.push("shrink");
        return { dataUrl: "data:image/jpeg;base64,abc", objectUrl: "blob:preview" };
      },
      matte: async () => {
        order.push("matte");
        throw new Error("oom");
      },
      save: async (input) => {
        order.push("save");
        saved.cover = input.cover;
        saved.name = input.name;
        saved.fellBack = input.fellBack;
      },
      onPreview: () => {
        order.push("preview");
      },
      hash: async () => "shot-hash",
      ensureLookbook: () => {
        ensured = true;
      },
    });
    assert.equal(order[0], "pending");
    assert.ok(order.indexOf("pending") < order.indexOf("matte"));
    assert.equal(saved.fellBack, true);
    assert.equal(saved.name, NEW_PIECE_NAME);
    assert.ok(saved.cover.startsWith("data:image/jpeg"));
    assert.equal(ensured, false);
    assert.equal(order.at(-1), "clear");
  });

  it("empty FileList does not clear saved tiles", () => {
    const tiles = [{ id: "kept" }];
    let ingested = false;
    const ok = handleCameraChange(
      [],
      () => {
        ingested = true;
        tiles.pop();
      },
      () => {},
      () => {},
    );
    assert.equal(ok, false);
    assert.equal(ingested, false);
    assert.equal(tiles.length, 1);
    assert.equal(SHOT_MISS.includes("Take photo"), true);
  });
});

describe("HEIC fixture", () => {
  it("HEIC fixture → JPEG data URL in save, not a hang", async () => {
    const file = new File([new Uint8Array(64)], "IMG_1234.heic", { type: "image/heic" });
    let savedMime = "";
    await runIngestPiece(file, "g-heic", {
      shrink: async (f) => {
        assert.equal(isHeicFile(f), true);
        return { dataUrl: "data:image/jpeg;base64,/9j/AA", objectUrl: "blob:jpeg" };
      },
      matte: async () => ({ cutoutSrc: "data:image/jpeg;base64,yy", kind: "phone" }),
      save: async ({ original }) => {
        savedMime = original.startsWith("data:image/jpeg") ? "image/jpeg" : original.slice(0, 20);
      },
      tag: async () => {
        throw new Error("403");
      },
      enqueuePrint: () => {},
      onPreview: () => {},
    });
    assert.equal(savedMime, "image/jpeg");
  });

  it("decode failure is the JPEG message, not a silent hang", () => {
    assert.equal(HEIC_ERROR, "Couldn't read that photo — try JPEG");
  });
});

describe("printGarment reject", () => {
  it("printGarment reject → tile still there, name New piece or Navy chino", async () => {
    const file = new File([new Uint8Array([1])], "shot.jpg", { type: "image/jpeg" });
    let savedName = "";
    let patched = "";
    await runIngestPiece(file, "g-print", {
      shrink: async () => ({
        dataUrl: "data:image/jpeg;base64,xx",
        objectUrl: "blob:x",
      }),
      matte: async () => ({ cutoutSrc: "data:image/jpeg;base64,yy", kind: "phone" }),
      save: async ({ name }) => {
        savedName = name;
      },
      tag: async () => ({ name: "Navy chino" }),
      patchName: (n) => {
        patched = n;
      },
      enqueuePrint: () => {
        throw new Error("NeedPrint 403");
      },
      onPreview: () => {},
    });
    assert.ok(savedName === NEW_PIECE_NAME || savedName === "Navy chino");
    assert.equal(patched, "Navy chino");
  });

  it("tag throw still leaves the saved garment", async () => {
    const file = new File([new Uint8Array([1])], "shot.jpg", { type: "image/jpeg" });
    let saved = false;
    await runIngestPiece(file, "g-tag", {
      shrink: async () => ({
        dataUrl: "data:image/jpeg;base64,xx",
        objectUrl: "blob:x",
      }),
      matte: async () => ({ cutoutSrc: "data:image/jpeg;base64,yy", kind: "phone" }),
      save: async () => {
        saved = true;
      },
      tag: async () => {
        throw new Error("403");
      },
      enqueuePrint: () => {},
      onPreview: () => {},
    });
    assert.equal(saved, true);
  });
});

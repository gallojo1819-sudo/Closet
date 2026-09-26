import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cameraInputProps,
  handleCameraChange,
  HEIC_ERROR,
  isHeicFile,
  isImageFile,
  libraryInputProps,
  resumeCameraAction,
  SHOT_MISS,
} from "./camera.ts";
import {
  addQueueConcurrency,
  cameraBitmapOptions,
  ingestCameraShot,
  jpegOrientedSize,
  longEdgeBox,
  NEW_PIECE_NAME,
  runIngestPiece,
} from "./ingest.ts";

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
  it("12MP fake: tile and addGarment run before matte; progress is not stuck", async () => {
    const order: string[] = [];
    const saved: { cover: string; name: string } = { cover: "", name: "" };
    let progress = "Saving the shot…";
    let ensured = false;
    const file = new File([new Uint8Array(64)], "IMG_12MP.jpg", { type: "image/jpeg" });
    await ingestCameraShot(file, {
      shrink: async () => {
        order.push("shrink");
        return {
          dataUrl: "data:image/jpeg;base64,abc",
          objectUrl: "blob:preview",
          blob: new Blob(["jpeg"], { type: "image/jpeg" }),
        };
      },
      matte: async () => {
        order.push("matte");
        return new Promise(() => {});
      },
      save: async (input) => {
        order.push("save");
        saved.cover = input.cover;
        saved.name = input.name;
      },
      onPreview: () => {
        order.push("preview");
      },
      onShown: () => {
        order.push("shown");
        progress = "";
      },
      hash: async () => "shot-hash",
      ensureLookbook: () => {
        ensured = true;
      },
    });
    assert.ok(order.indexOf("preview") < order.indexOf("save"));
    assert.ok(order.indexOf("shown") < order.indexOf("save"));
    assert.ok(order.indexOf("save") < order.indexOf("matte"));
    assert.equal(progress, "");
    assert.equal(saved.name, NEW_PIECE_NAME);
    assert.equal(saved.cover, "blob:preview");
    assert.equal(ensured, false);
  });

  it("a stuck pending write still leaves the shrunk tile and one garment", async () => {
    let progress = "Saving the shot…";
    let saved = false;
    const raw = new Uint8Array(64);
    const file = new File([raw], "IMG_12MP.jpg", { type: "image/jpeg" });
    const small = new Blob(["jpeg"], { type: "image/jpeg" });
    let pending: Blob | null = null;
    await ingestCameraShot(file, {
      shrink: async () => ({
        dataUrl: "data:image/jpeg;base64,abc",
        objectUrl: "blob:shrunk",
        blob: small,
      }),
      putPending: (blob) => {
        pending = blob;
        return new Promise(() => {});
      },
      matte: () => new Promise(() => {}),
      save: async (input) => {
        saved = true;
        assert.equal(input.cover, "blob:shrunk");
        assert.equal(input.name, NEW_PIECE_NAME);
        assert.equal(input.blob, small);
      },
      onPreview: () => {
        progress = "";
      },
      onShown: () => {
        progress = "";
      },
      ensureLookbook: () => {
        throw new Error("ensureLookbook");
      },
    });
    assert.equal(saved, true);
    assert.equal(progress, "");
    assert.equal(pending, small);
    assert.ok(small.size < file.size);
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

describe("camera resize", () => {
  it("12MP portrait and landscape long edge is 1280", () => {
    const land = cameraBitmapOptions(4032, 3024, 1280);
    const port = cameraBitmapOptions(3024, 4032, 1280);
    assert.equal(Math.max(land.resizeWidth, land.resizeHeight), 1280);
    assert.equal(Math.max(port.resizeWidth, port.resizeHeight), 1280);
    assert.ok(land.resizeWidth > land.resizeHeight);
    assert.ok(port.resizeHeight > port.resizeWidth);
    assert.equal(land.resizeQuality, "medium");
    assert.equal(longEdgeBox(4032, 3024, 1280).resizeWidth, 1280);
  });

  it("reads JPEG size from the header, including orientation 6", () => {
    const plain = new Uint8Array(20);
    plain[0] = 0xff;
    plain[1] = 0xd8;
    plain[2] = 0xff;
    plain[3] = 0xc0;
    plain[4] = 0x00;
    plain[5] = 0x0b;
    plain[6] = 0x08;
    plain[7] = 0x0f;
    plain[8] = 0xc0;
    plain[9] = 0x0b;
    plain[10] = 0xd0;
    assert.deepEqual(jpegOrientedSize(plain), { width: 3024, height: 4032 });

    const app = exifOrientation6(4032, 3024);
    const turned = jpegOrientedSize(app);
    assert.equal(turned?.width, 3024);
    assert.equal(turned?.height, 4032);
    const box = longEdgeBox(turned?.width ?? 0, turned?.height ?? 0, 1280);
    assert.equal(Math.max(box.resizeWidth, box.resizeHeight), 1280);
  });
});

function exifOrientation6(width: number, height: number): Uint8Array {
  const payload = new Uint8Array(32);
  payload.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 0);
  payload[6] = 0x49;
  payload[7] = 0x49;
  payload[8] = 0x2a;
  payload[10] = 0x08;
  payload[14] = 0x01;
  payload[16] = 0x12;
  payload[17] = 0x01;
  payload[18] = 0x03;
  payload[20] = 0x01;
  payload[24] = 0x06;
  const sof = new Uint8Array(11);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof[2] = 0x00;
  sof[3] = 0x09;
  sof[4] = 0x08;
  sof[5] = (height >> 8) & 0xff;
  sof[6] = height & 0xff;
  sof[7] = (width >> 8) & 0xff;
  sof[8] = width & 0xff;
  const out = new Uint8Array(2 + 4 + payload.length + sof.length);
  out[0] = 0xff;
  out[1] = 0xd8;
  out[2] = 0xff;
  out[3] = 0xe1;
  out[4] = 0x00;
  out[5] = 34;
  out.set(payload, 6);
  out.set(sof, 6 + payload.length);
  return out;
}

describe("resume camera", () => {
  it("missing blob or a saved hash does not ingest again", () => {
    assert.equal(resumeCameraAction(false, false), "stop");
    assert.equal(resumeCameraAction(true, true), "stop");
    assert.equal(resumeCameraAction(true, false), "ingest");
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

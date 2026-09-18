import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  coverLoadError,
  coverPathsForGarment,
  loadLookCovers,
  type CoverLoader,
} from "./cover.ts";

/** Fake user — tests never read or write closet.v6. */
const UID = "5d458205-b3ca-433a-8b75-4c0a2bbfa1ee";

function piece(id: string, name: string) {
  return {
    id,
    name,
    cutoutSrc: `sb:${UID}/${id}/c.jpg`,
    imageSrc: `sb:${UID}/${id}/o.jpg`,
  };
}

describe("coverPathsForGarment", () => {
  it("plans IDB c/t/o then storage paths from sb: srcs", () => {
    const plan = coverPathsForGarment(piece("g1", "Cream cable"), UID);
    assert.deepEqual(plan.idbKeys, ["idb:g1:c", "idb:g1:t", "idb:g1:o"]);
    assert.ok(plan.paths.includes(`${UID}/g1/c.jpg`));
    assert.ok(plan.paths.includes(`${UID}/g1/o.jpg`));
    assert.ok(plan.paths.includes(`${UID}/g1/t.jpg`));
  });
});

describe("loadLookCovers", () => {
  it("3 pieces with only sb: srcs (no IDB) produce 3 blobs", async () => {
    const pieces = [
      piece("g1", "Cream cable"),
      piece("g2", "Khaki chinos"),
      piece("g3", "Navy loafers"),
    ];
    const loader: CoverLoader = {
      getIdb: async () => null,
      download: async (path) => {
        if (path.endsWith("/c.jpg") || path.endsWith("/o.jpg")) {
          return new Blob([path], { type: "image/jpeg" });
        }
        return null;
      },
      signedFetch: async () => null,
      userId: UID,
    };
    const res = await loadLookCovers(pieces, loader);
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.blobs.length, 3);
      assert.ok(res.blobs.every((b) => b.size > 0));
    }
  });

  it("named load failure when every kind fails — never Missing a cover plate", async () => {
    const pieces = [piece("g1", "Cream cable"), piece("g2", "Khaki chinos"), piece("g3", "Navy loafers")];
    const loader: CoverLoader = {
      getIdb: async () => null,
      download: async () => null,
      signedFetch: async () => null,
      userId: UID,
    };
    const res = await loadLookCovers(pieces, loader);
    assert.equal(res.ok, false);
    if (!res.ok) {
      const msg = coverLoadError(res.name);
      assert.equal(msg.includes("Cream cable"), true);
      assert.equal(msg.includes("Missing a cover plate"), false);
    }
  });

  it("signed URL fetch fills a hole when download misses", async () => {
    const pieces = [piece("g1", "Cream cable")];
    const loader: CoverLoader = {
      getIdb: async () => null,
      download: async () => null,
      signedFetch: async (path) =>
        path.endsWith("/c.jpg") ? new Blob(["signed"], { type: "image/jpeg" }) : null,
      userId: UID,
    };
    const res = await loadLookCovers(pieces, loader);
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.blobs.length, 1);
  });

  it("t.jpg only in storage is a present plate", async () => {
    const pieces = [piece("g1", "Cream cable")];
    const loader: CoverLoader = {
      getIdb: async () => null,
      download: async (path) =>
        path.endsWith("/t.jpg") ? new Blob(["thumb"], { type: "image/jpeg" }) : null,
      signedFetch: async () => null,
      userId: UID,
    };
    const res = await loadLookCovers(pieces, loader);
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.blobs.length, 1);
  });

  it("zero-byte blobs are not plates — named failure", async () => {
    const pieces = [piece("g1", "Cream cable")];
    const loader: CoverLoader = {
      getIdb: async () => new Blob([]),
      download: async () => new Blob([]),
      signedFetch: async () => new Blob([]),
      userId: UID,
    };
    const res = await loadLookCovers(pieces, loader);
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(coverLoadError(res.name).includes("Missing a cover plate"), false);
    }
  });

  it("fetchKind (fetchCloudBlob) fills after IDB miss without calling download", async () => {
    const pieces = [piece("g1", "Cream cable")];
    let downloaded = 0;
    const loader: CoverLoader = {
      getIdb: async () => null,
      fetchKind: async (_id, kind) =>
        kind === "c" ? new Blob(["cloud-c"], { type: "image/jpeg" }) : null,
      download: async () => {
        downloaded += 1;
        return null;
      },
      signedFetch: async () => null,
      userId: UID,
    };
    const res = await loadLookCovers(pieces, loader);
    assert.equal(res.ok, true);
    assert.equal(downloaded, 0);
  });
});

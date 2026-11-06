import { register } from "node:module";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

register(new URL("../../scripts/ts-ext.mjs", import.meta.url), {
  parentURL: import.meta.url,
});

const { getSupabase } = await import("./cloud/client.ts");
const { NEW_PIECE_NAME } = await import("./ingest.ts");
const { enqueueTag, singleBoxHint } = await import("./print-queue.ts");
const { persistGate } = await import("./store-persist.ts");
const { useCloset } = await import("./store.ts");
import type { Garment } from "./types.ts";

function unnamed(): Garment {
  return {
    id: "g_tag_test",
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
    createdAt: "2026-10-23T16:40:00.000Z",
  };
}

function piece(id: string): Garment {
  return { ...unnamed(), id };
}

type GoodTag = {
  ok: true;
  name: string;
  category: "top";
  subtype: string;
  colors: string[];
};

describe("enqueueTag", () => {
  it("a timeout then a good retry updates the row; two failures keep New piece", async () => {
    assert.equal(getSupabase(), null);
    assert.equal(persistGate.open, false);
    const prev = useCloset.getState().garments;
    const row = unnamed();
    useCloset.setState({ garments: [row] });
    try {
      let calls = 0;
      await enqueueTag(row.id, "data:image/jpeg;base64,aa", {
        timeoutMs: 20,
        tag: () => {
          calls += 1;
          if (calls === 1) {
            return new Promise((resolve) => {
              setTimeout(() => resolve(null), 40);
            });
          }
          return Promise.resolve({
            ok: true,
            name: "Brown suede horsebit loafers",
            category: "footwear",
            subtype: "loafers",
            colors: ["brown"],
            count: 2,
          });
        },
      });
      const saved = useCloset.getState().garments.find((g) => g.id === row.id);
      assert.equal(saved?.name, "Brown suede horsebit loafers");
      assert.equal(saved?.category, "footwear");
      assert.equal(saved?.subtype, "loafers");
      assert.equal(saved?.needsCategory, false);
      assert.equal(calls, 2);

      useCloset.setState({ garments: [unnamed()] });
      await enqueueTag(row.id, "data:image/jpeg;base64,aa", {
        timeoutMs: 20,
        tag: () => Promise.reject(new Error("tag down")),
      });
      const failed = useCloset.getState().garments.find((g) => g.id === row.id);
      assert.equal(failed?.name, NEW_PIECE_NAME);
      assert.equal(failed?.category, "other");
      assert.equal(failed?.needsCategory, true);
      assert.equal(getSupabase(), null);
      assert.equal(persistGate.open, false);
    } finally {
      useCloset.setState({ garments: prev });
    }
  });

  it("applies a single-box scan name before the retry", async () => {
    const prev = useCloset.getState().garments;
    const row = unnamed();
    useCloset.setState({ garments: [row] });
    const hint = singleBoxHint({
      ok: true,
      kind: "garment",
      boxes: [
        {
          name: "Navy oxford",
          category: "top",
          box: { x: 0.1, y: 0.1, w: 0.4, h: 0.5 },
        },
      ],
    });
    assert.deepEqual(hint, { name: "Navy oxford", category: "top" });
    try {
      let seen = "";
      let calls = 0;
      await enqueueTag(row.id, "data:image/jpeg;base64,aa", {
        timeoutMs: 20,
        hint,
        tag: () => {
          calls += 1;
          if (calls === 1) return Promise.reject(new Error("timeout"));
          seen = useCloset.getState().garments.find((g) => g.id === row.id)?.name ?? "";
          return Promise.resolve({
            ok: true,
            name: "Navy oxford shirt",
            category: "top",
            subtype: "oxford",
            colors: ["navy"],
          });
        },
      });
      assert.equal(seen, "Navy oxford");
      const saved = useCloset.getState().garments.find((g) => g.id === row.id);
      assert.equal(saved?.name, "Navy oxford shirt");
      assert.equal(saved?.subtype, "oxford");
      assert.equal(saved?.needsCategory, false);
      assert.equal(persistGate.open, false);
    } finally {
      useCloset.setState({ garments: prev });
    }
  });

  it("a tag that lands after a rename leaves the edit and does not mirror", async () => {
    const prev = useCloset.getState().garments;
    const row = unnamed();
    useCloset.setState({ garments: [row] });
    let mirrors = 0;
    let release: (tag: { ok: true; name: string; category: "top"; subtype: string; colors: string[] }) => void = () => {};
    const pending = new Promise<{ ok: true; name: string; category: "top"; subtype: string; colors: string[] }>((resolve) => {
      release = resolve;
    });
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    try {
      const done = enqueueTag(row.id, "data:image/jpeg;base64,aa", {
        timeoutMs: 30,
        mirror: () => {
          mirrors += 1;
        },
        tag: () => {
          markStarted();
          return pending;
        },
      });
      await started;
      useCloset.getState().updateGarment(row.id, {
        name: "Brown suede horsebit loafers",
        category: "other",
        subtype: "",
      });
      release({
        ok: true,
        name: "Tagged shirt",
        category: "top",
        subtype: "shirt",
        colors: ["brown"],
      });
      await done;
      const saved = useCloset.getState().garments.find((g) => g.id === row.id);
      assert.equal(saved?.name, "Brown suede horsebit loafers");
      assert.equal(saved?.category, "other");
      assert.equal(saved?.subtype, "");
      assert.equal(mirrors, 0);
      assert.equal(persistGate.open, false);
    } finally {
      useCloset.setState({ garments: prev });
    }
  });

  it("a category picked before the retry is not replaced by the hint", async () => {
    const prev = useCloset.getState().garments;
    const row = unnamed();
    useCloset.setState({ garments: [row] });
    let mirrors = 0;
    let calls = 0;
    try {
      await enqueueTag(row.id, "data:image/jpeg;base64,aa", {
        timeoutMs: 20,
        hint: { name: "Navy oxford", category: "top" },
        mirror: () => {
          mirrors += 1;
        },
        tag: () => {
          calls += 1;
          if (calls === 1) {
            useCloset.getState().updateGarment(row.id, { category: "footwear" });
            return Promise.reject(new Error("tag down"));
          }
          return Promise.resolve({
            ok: true,
            name: "Tagged loafers",
            category: "footwear",
            subtype: "loafers",
            colors: ["brown"],
          });
        },
      });
      const saved = useCloset.getState().garments.find((g) => g.id === row.id);
      assert.equal(saved?.category, "footwear");
      assert.equal(saved?.name, NEW_PIECE_NAME);
      assert.equal(mirrors, 0);
      assert.equal(calls, 2);
    } finally {
      useCloset.setState({ garments: prev });
    }
  });

  it("an edit to a piece still queued behind another tag is kept and not mirrored", async () => {
    assert.equal(getSupabase(), null);
    assert.equal(persistGate.open, false);
    const prev = useCloset.getState().garments;
    const a = piece("g_tag_queued_a");
    const b = piece("g_tag_queued_b");
    useCloset.setState({ garments: [a, b] });
    let mirrorsA = 0;
    let mirrorsB = 0;
    let callsB = 0;
    let release: (tag: GoodTag) => void = () => {};
    const pending = new Promise<GoodTag>((resolve) => {
      release = resolve;
    });
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const taggedA: GoodTag = {
      ok: true,
      name: "Tagged A",
      category: "top",
      subtype: "shirt",
      colors: ["navy"],
    };
    try {
      const doneA = enqueueTag(a.id, "data:image/jpeg;base64,aa", {
        timeoutMs: 30,
        mirror: () => {
          mirrorsA += 1;
        },
        tag: () => {
          markStarted();
          return pending;
        },
      });
      const doneB = enqueueTag(b.id, "data:image/jpeg;base64,bb", {
        timeoutMs: 30,
        mirror: () => {
          mirrorsB += 1;
        },
        tag: () => {
          callsB += 1;
          return Promise.resolve({
            ok: true,
            name: "Tagged B",
            category: "top",
            subtype: "shirt",
            colors: ["blue"],
          });
        },
      });
      await started;
      useCloset.getState().updateGarment(b.id, {
        name: "Joe's blue oxford",
        category: "top",
      });
      release(taggedA);
      await doneA;
      await doneB;
      const savedA = useCloset.getState().garments.find((g) => g.id === a.id);
      const savedB = useCloset.getState().garments.find((g) => g.id === b.id);
      assert.deepEqual(
        {
          name: savedB?.name,
          category: savedB?.category,
          subtype: savedB?.subtype,
          needsCategory: savedB?.needsCategory === true,
          mirrorsB,
          callsB,
          nameA: savedA?.name,
          mirrorsA,
        },
        {
          name: "Joe's blue oxford",
          category: "top",
          subtype: "",
          needsCategory: false,
          mirrorsB: 0,
          callsB: 0,
          nameA: "Tagged A",
          mirrorsA: 1,
        },
      );
      assert.equal(persistGate.open, false);
      assert.equal(getSupabase(), null);
    } finally {
      release(taggedA);
      useCloset.setState({ garments: prev });
    }
  });

  it("a category change while a piece is still queued does not get the hint", async () => {
    assert.equal(getSupabase(), null);
    assert.equal(persistGate.open, false);
    const prev = useCloset.getState().garments;
    const a = piece("g_tag_hint_a");
    const b = piece("g_tag_hint_b");
    useCloset.setState({ garments: [a, b] });
    let mirrorsB = 0;
    let callsB = 0;
    let release: (tag: GoodTag) => void = () => {};
    const pending = new Promise<GoodTag>((resolve) => {
      release = resolve;
    });
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const taggedA: GoodTag = {
      ok: true,
      name: "Tagged A",
      category: "top",
      subtype: "shirt",
      colors: ["navy"],
    };
    const hint = { name: "Navy oxford", category: "top" as const };
    try {
      const doneA = enqueueTag(a.id, "data:image/jpeg;base64,aa", {
        timeoutMs: 30,
        tag: () => {
          markStarted();
          return pending;
        },
      });
      const doneB = enqueueTag(b.id, "data:image/jpeg;base64,bb", {
        timeoutMs: 30,
        hint,
        mirror: () => {
          mirrorsB += 1;
        },
        tag: () => {
          callsB += 1;
          return Promise.resolve({
            ok: true,
            name: "Tagged shirt",
            category: "top",
            subtype: "shirt",
            colors: ["navy"],
          });
        },
      });
      await started;
      useCloset.getState().updateGarment(b.id, { category: "footwear" });
      release(taggedA);
      await doneA;
      await doneB;
      const savedB = useCloset.getState().garments.find((g) => g.id === b.id);
      assert.deepEqual(
        {
          name: savedB?.name,
          category: savedB?.category,
          subtype: savedB?.subtype,
          needsCategory: savedB?.needsCategory === true,
          callsB,
          mirrorsB,
        },
        {
          name: NEW_PIECE_NAME,
          category: "footwear",
          subtype: "",
          needsCategory: false,
          callsB: 0,
          mirrorsB: 0,
        },
      );
      assert.equal(persistGate.open, false);
      assert.equal(getSupabase(), null);
    } finally {
      release(taggedA);
      useCloset.setState({ garments: prev });
    }
  });
});

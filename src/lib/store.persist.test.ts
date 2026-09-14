import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mergeClosetPersist,
  openPersistGate,
  packPersist,
  persistGate,
  persistHasGarments,
  type PersistedCloset,
} from "./store-persist.ts";
import type { Garment } from "./types.ts";

function g(id: string): Garment {
  return {
    id,
    name: "Navy oxford",
    category: "top",
    subtype: "oxford",
    colors: ["navy"],
    material: "cotton",
    brand: "",
    notes: "",
    formality: 3,
    warmth: 2,
    seasons: [],
    imageSrc: "idb:g:o",
    cutoutSrc: "idb:g:c",
    imageSource: "official",
    matteQuality: "clean",
    demo: false,
    archived: false,
    wornOn: [],
    createdAt: "2026-01-01T12:00:00.000Z",
  };
}

const empty = {
  garments: [] as Garment[],
  looks: [],
  journal: [],
  avoid: {},
  drop: null,
  refPhoto: null,
  messages: [],
  refPhotoBackup: null,
  seenLooks: {},
  hydrated: false,
};

describe("mergeClosetPersist", () => {
  it("uses persisted garments when current is empty", () => {
    const persisted: PersistedCloset = {
      garments: [g("a"), g("b")],
      looks: [],
      journal: [],
      avoid: {},
      drop: null,
      refPhoto: null,
      refPhotoBackup: null,
      messages: [],
    };
    const next = mergeClosetPersist(persisted, empty);
    assert.equal(next.garments.length, 2);
    assert.equal(next.garments[0]?.id, "a");
  });

  it("never replaces a non-empty closet with []", () => {
    const current = { ...empty, garments: [g("live")] };
    const next = mergeClosetPersist({ garments: [] }, current);
    assert.equal(next.garments.length, 1);
    assert.equal(next.garments[0]?.id, "live");
  });

  it("keeps Joe's photo when garments are empty", () => {
    const next = mergeClosetPersist(
      { garments: [], refPhoto: "idb:me:ref", refPhotoBackup: "data:image/jpeg;base64,xx" },
      empty,
    );
    assert.equal(next.refPhoto, "idb:me:ref");
    assert.equal(next.refPhotoBackup, "data:image/jpeg;base64,xx");
  });

  it("strips demo garments when real pieces exist", () => {
    const persisted: PersistedCloset = {
      garments: [g("real"), { ...g("sample"), demo: true }],
      looks: [
        {
          id: "l1",
          name: "mix",
          occasion: "weekday",
          garmentIds: ["real", "sample"],
          source: "ai",
          createdAt: "t",
        },
      ],
      journal: [],
      avoid: {},
      drop: null,
      refPhoto: null,
      refPhotoBackup: null,
      messages: [],
    };
    const next = mergeClosetPersist(persisted, empty);
    assert.equal(next.garments.every((x) => x.demo !== true), true);
    assert.equal(next.garments.length, 1);
    assert.ok(
      !(next.looks as { garmentIds: string[] }[]).some((l) =>
        l.garmentIds.includes("sample"),
      ),
    );
  });

  it("keeps seenLooks from persist without wiping garments", () => {
    const persisted: PersistedCloset = {
      garments: [g("a")],
      looks: [],
      journal: [],
      avoid: {},
      drop: null,
      refPhoto: null,
      refPhotoBackup: null,
      messages: [],
      seenLooks: { out: ["a"] },
    };
    const next = mergeClosetPersist(persisted, empty);
    assert.equal(next.garments[0]?.id, "a");
    assert.deepEqual(next.seenLooks, { out: ["a"] });
  });
});

describe("persistGate", { concurrency: false }, () => {
  it("openPersistGate allows writes after a closed gate", () => {
    persistGate.open = false;
    assert.equal(persistGate.open, false);
    openPersistGate();
    assert.equal(persistGate.open, true);
    persistGate.open = false;
  });
});

describe("persistHasGarments", () => {
  it("treats missing or empty persist as empty", () => {
    assert.equal(persistHasGarments(null), false);
    assert.equal(
      persistHasGarments(packPersist({ ...empty, garments: [] })),
      false,
    );
  });

  it("sees garments in packed closet.v6 JSON", () => {
    assert.equal(
      persistHasGarments(packPersist({ ...empty, garments: [g("a")] })),
      true,
    );
  });
});

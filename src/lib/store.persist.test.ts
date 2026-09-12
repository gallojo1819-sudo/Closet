import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeClosetPersist, persistGate, type PersistedCloset } from "./store-persist.ts";
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
});

describe("persistGate", () => {
  it("starts closed so a pre-hydrate empty set cannot write", () => {
    assert.equal(persistGate.open, false);
  });
});

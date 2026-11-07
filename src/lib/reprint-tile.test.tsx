/**
 * A refused TOP renders the garment-neutral reprint line. The store is not written:
 * closet.v6 and closet_meta stay untouched.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GarmentTile } from "@/components/closet/tile";
import { REPRINT_CAPTION } from "./plate.ts";
import { persistGate } from "./store-persist.ts";
import type { Garment } from "./types.ts";

const SWEATER: Garment = {
  id: "g_ukietgtd0g64",
  name: "Navy Zip Sweater",
  category: "top",
  subtype: "",
  colors: ["navy"],
  material: "",
  brand: "",
  notes: "Kept your real pixels — same fabric, same color — on paper.",
  formality: 2,
  warmth: 3,
  seasons: ["fall"],
  imageSrc: "sb:5d458205-b3ca-433a-8b75-4c0a2bbfa1ee/g_ukietgtd0g64/o.jpg",
  cutoutSrc: "sb:5d458205-b3ca-433a-8b75-4c0a2bbfa1ee/g_ukietgtd0g64/c-96a44251.jpg",
  imageSource: "cutout",
  matteQuality: "busy",
  reprint: true,
  cutoutCheck: {
    one: "no",
    why: "plain beige background visible",
    at: "2026-11-07T14:57:47.000Z",
  },
  demo: false,
  wornOn: [],
  archived: false,
  createdAt: "2026-11-07T14:56:20.000Z",
};

describe("a top reprint tile", () => {
  it("names the piece and never says jacket", () => {
    persistGate.open = false;
    const writes: string[] = [];
    const prior = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: (key: string) => {
          writes.push(key);
        },
        removeItem: () => undefined,
      },
    });
    try {
      const markup = renderToStaticMarkup(<GarmentTile garment={SWEATER} />);
      expect(markup).toContain("Navy Zip Sweater");
      expect(markup).toContain(">Reprint<");
      expect(markup).toContain(REPRINT_CAPTION);
      expect(markup).toContain("Photo cleanup needs another try — outline the piece.");
      expect(markup.toLowerCase()).not.toContain("jacket");
      expect(writes.filter((key) => key === "closet.v6" || key === "closet_meta")).toEqual([]);
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: prior });
      persistGate.open = false;
    }
  });
});

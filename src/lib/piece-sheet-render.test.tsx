import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GarmentDetailSheet } from "@/components/closet/detail";
import { liveSnapshot } from "./__fixtures__/snapshot.ts";
import { derivedCategory } from "./garment-category.ts";
import { NEW_PIECE_NAME } from "./ingest.ts";
import type { Garment } from "./types.ts";

function piece(partial: Partial<Garment> & Pick<Garment, "id" | "name" | "category">): Garment {
  return {
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
    ...partial,
  };
}

function selectedCategory(markup: string): string {
  const options = markup.match(/<option\b[^>]*>/g) ?? [];
  const selected = options.filter((tag) => /\sselected(?:=|"|\s|>)/.test(tag) || tag.includes("selected"));
  expect(selected.length).toBeGreaterThan(0);
  const value = selected[0]?.match(/value="([^"]*)"/);
  return value?.[1] ?? "";
}

describe("piece sheet markup", () => {
  it("shows the stored category, including when the notes say loafers", () => {
    const g = piece({
      id: "g_jih4sve2486d",
      name: NEW_PIECE_NAME,
      category: "other",
      notes: "Brown suede horsebit loafers",
    });
    expect(derivedCategory(g)).toBe("footwear");
    const markup = renderToStaticMarkup(<GarmentDetailSheet garment={g} onClose={() => {}} />);
    expect(selectedCategory(markup)).toBe("other");
    expect(markup).toContain("Looks like: footwear — tap to set");
    expect(markup).toContain("Use as name?");
    expect(markup).toContain(">Name<");
    expect(markup).toContain('aria-label="Name"');
    expect(markup).toContain("autofocus");
    expect(markup).not.toContain("Remove this piece?");
    expect(markup.indexOf("data-sheet-actions")).toBeLessThan(markup.indexOf("data-remove-piece"));
    expect(markup.slice(markup.indexOf("data-sheet-actions"), markup.indexOf("data-remove-piece"))).not.toContain(
      ">Remove<",
    );
  });

  it("every stored other in the snapshot renders that stored category", () => {
    const others = liveSnapshot.filter((g) => g.category === "other");
    expect(others.length).toBeGreaterThan(0);
    for (const g of others) {
      const markup = renderToStaticMarkup(<GarmentDetailSheet garment={g} onClose={() => {}} />);
      expect(selectedCategory(markup), g.id).toBe(g.category);
    }
  });

  it("a named piece does not focus the title, and the inputs show the stored name", () => {
    const g = piece({ id: "g_named", name: "Navy oxford", category: "top", subtype: "oxford" });
    const markup = renderToStaticMarkup(<GarmentDetailSheet garment={g} onClose={() => {}} />);
    expect(markup).toContain('value="Navy oxford"');
    expect(markup).toContain('value="oxford"');
    expect(markup).not.toContain("autofocus");
    const renamed = { ...g, name: "Blue oxford", subtype: "shirt" };
    const next = renderToStaticMarkup(<GarmentDetailSheet garment={renamed} onClose={() => {}} />);
    expect(next).toContain('value="Blue oxford"');
    expect(next).toContain('value="shirt"');
  });

  it("the sheet wires category, notes, and remove through the shared helpers", () => {
    const src = readFileSync(new URL("../components/closet/detail.tsx", import.meta.url), "utf8");
    expect(src).toContain("categoryWrite(");
    expect(src).toContain("notesBlurPlan(");
    expect(src).toContain("removeTap(false)");
    expect(src).toContain("removeTap(true)");
    expect(src).toContain("shownField(");
    expect(src).not.toContain("value={derivedCategory(garment)}");
  });
});

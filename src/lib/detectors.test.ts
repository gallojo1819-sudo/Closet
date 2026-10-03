import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  cellGateOpen,
  cellLooks,
  detectorTitles,
  maxDisjoint,
  titlesAreClothes,
  visibleDetectors,
  type Way,
} from "./detectors.ts";
import type { Garment } from "./types.ts";

const BANNED =
  /\b(Polo|Purple|RRL|ALD|Faloni|545|Sweet Stable|Italian summer|Italian winter)\b/;

function g(
  partial: Pick<Garment, "id" | "name" | "category" | "subtype"> & Partial<Garment>,
): Garment {
  return {
    colors: ["navy"],
    material: "cotton",
    brand: "",
    notes: "",
    formality: 3,
    warmth: 2,
    seasons: ["fall"],
    imageSrc: "/x.jpg",
    cutoutSrc: "/x.jpg",
    imageSource: "official",
    matteQuality: "clean",
    demo: false,
    archived: false,
    wornOn: [],
    createdAt: "2026-01-01T12:00:00.000Z",
    ...partial,
  };
}

async function renderSections(
  garments: Garment[],
  props: Record<string, unknown> = {},
): Promise<string> {
  const ts = await import("typescript");
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const src = readFileSync(
    new URL("../components/closet/detector-sections.tsx", import.meta.url),
    "utf8",
  );
  let js = ts.transpileModule(src, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    fileName: "detector-sections.tsx",
  }).outputText;
  const detectorsHref = new URL("./detectors.ts", import.meta.url).href;
  const jsxHref = import.meta.resolve("react/jsx-runtime");
  js = js.replaceAll(`from "@/lib/detectors"`, `from ${JSON.stringify(detectorsHref)}`);
  js = js.replaceAll(`from "react/jsx-runtime"`, `from ${JSON.stringify(jsxHref)}`);
  const dir = mkdtempSync(join(tmpdir(), "detectors-"));
  const file = join(dir, "detector-sections.mjs");
  writeFileSync(file, js);
  try {
    const mod = await import(pathToFileURL(file).href);
    return renderToStaticMarkup(createElement(mod.DetectorSections, { garments, ...props }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function titlesOf(html: string): string[] {
  return [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((hit) => hit[1] ?? "");
}

function many(prefix: string, name: string, category: Garment["category"], subtype: string, extra: Partial<Garment> = {}): Garment[] {
  return [0, 1, 2].map((i) =>
    g({ id: `${prefix}${i}`, name: `${name} ${i + 1}`, category, subtype, ...extra }),
  );
}

describe("detectors", () => {
  it("three graphic looks clear 13, and one keyword trio does not", async () => {
    const rack = [
      ...many("tee", "graphic tee", "top", "tee", { colors: ["navy"], material: "cotton" }),
      ...many("jean", "indigo jean", "bottom", "jean", { colors: ["navy"], material: "denim" }),
      ...many("shoe", "retro sneaker", "footwear", "sneaker", { colors: ["white"], material: "leather" }),
      g({ id: "fl", name: "grey flannel trouser", category: "bottom", subtype: "trouser", material: "flannel", colors: ["grey"] }),
    ];
    const ways = visibleDetectors(rack, { season: "fall" });
    assert.equal(ways.some((way) => way.usual), false);
    assert.ok(ways.some((way) => way.id === "13"));
    assert.equal(ways.some((way) => way.id === "9"), false);
    assert.equal(ways.some((way) => way.id === "8"), false);
    assert.ok(ways.length <= 4);
    const shown = ways.find((way) => way.id === "13")!;
    for (const looks of Object.values(shown.looks)) {
      if (!looks || looks.length < 3) continue;
      const used = new Set<string>();
      for (const look of looks) {
        assert.equal(look.length >= 3 && look.length <= 4, true);
        for (const piece of look) {
          assert.equal(used.has(piece.id), false);
          used.add(piece.id);
        }
      }
    }
    const html = await renderSections(rack, { season: "fall", occasion: "weekend" });
    const titles = titlesOf(html);
    assert.ok(titles.includes("Graphic tee and retro sneaker"));
    assert.equal(titles.includes("Flannel, cashmere, dark suede"), false);
    assert.equal(titles.includes("Linen and a soft jacket"), false);
    assert.equal(html.includes("None"), false);
    for (const title of titles) assert.equal(BANNED.test(title), false);
  });

  it("one linen look is not a finished cell, and a tiny closet still says Your usual", async () => {
    const rack = [
      g({ id: "shirt", name: "linen camp collar", category: "top", subtype: "camp shirt", material: "linen" }),
      g({ id: "bottom", name: "linen gurkha", category: "bottom", subtype: "gurkha", material: "linen" }),
      g({ id: "shoe", name: "suede loafer", category: "footwear", subtype: "loafer", material: "suede" }),
    ];
    const ways = visibleDetectors(rack, { season: "fall" });
    assert.equal(ways.some((way) => way.id === "5"), false);
    assert.equal(ways.some((way) => way.usual), true);
    assert.equal(ways.some((way) => way.title === "Linen and a soft jacket" && !way.usual), false);
    const html = await renderSections(rack, { season: "fall" });
    const titles = titlesOf(html);
    assert.equal(titles.includes("Shrunken grey suit"), false);
    assert.ok(titles.includes("Your usual"));
    assert.equal(html.includes("None"), false);
    const empty = visibleDetectors([], { season: "fall" });
    assert.equal(empty[0]?.title, "Your usual");
    assert.equal(empty[0]?.usual, true);
    const winter = visibleDetectors(rack, { season: "winter" });
    assert.equal(winter.some((way) => way.title === "Linen and a soft jacket" && !way.usual), false);
  });

  it("ranks by dressed cells, not by list order, and stops at four", () => {
    const rack = [
      ...many("tee", "graphic tee", "top", "tee", { colors: ["navy"], material: "cotton" }),
      ...many("jean", "indigo jean", "bottom", "jean", { colors: ["navy"], material: "denim" }),
      ...many("shoe", "retro sneaker", "footwear", "sneaker", { colors: ["white"], material: "leather" }),
      g({ id: "w", name: "western snap shirt", category: "top", subtype: "shirt", colors: ["indigo"], material: "denim" }),
      g({ id: "d", name: "raw denim", category: "bottom", subtype: "denim", colors: ["indigo"], material: "denim" }),
      g({ id: "r", name: "roper boot", category: "footwear", subtype: "boot", colors: ["brown"], material: "leather" }),
    ];
    const ways = visibleDetectors(rack, { season: "fall" });
    assert.ok(ways.length <= 4);
    assert.equal(ways[0]?.id, "13");
    assert.equal(ways.some((way) => way.id === "1"), false);
    assert.notDeepEqual(ways.map((way) => way.id), ["1", "2", "3", "4"]);
  });

  it("keeps the shipped gates, and a colour chip that clears nothing falls through", async () => {
    assert.equal(cellGateOpen("country_stable", "out", "fall"), false);
    assert.equal(cellGateOpen("country_stable", "weekday", "fall"), true);
    assert.equal(cellGateOpen("linen_soft", "comfy", "fall"), false);
    assert.equal(cellGateOpen("linen_soft", "weekend", "winter"), false);
    assert.equal(cellGateOpen("flannel_cashmere", "comfy", "fall"), false);
    assert.equal(cellGateOpen("flannel_cashmere", "weekend", "summer"), false);
    assert.equal(cellGateOpen("graphic_street", "weekday", "fall"), false);
    assert.equal(cellGateOpen("soft_outdoor", "travel", "fall"), false);
    assert.equal(cellGateOpen("soft_outdoor", "weekend", "summer"), false);
    assert.equal(cellGateOpen("glossy_formal", "comfy", "fall"), false);
    assert.equal(cellGateOpen("shrunken_suit", "weekend", "summer"), false);
    assert.equal(cellGateOpen("print_plain", "comfy", "fall"), false);
    assert.equal(cellGateOpen("worn_paris", "weekday", "fall"), false);
    const rack = [
      ...many("tee", "graphic tee", "top", "tee", { colors: ["navy"], material: "cotton" }),
      ...many("jean", "indigo jean", "bottom", "jean", { colors: ["navy"], material: "denim" }),
      ...many("shoe", "retro sneaker", "footwear", "sneaker", { colors: ["white"], material: "leather" }),
    ];
    const plain = visibleDetectors(rack, { season: "fall" });
    assert.equal(plain.some((way) => way.id === "13"), true);
    const chip = visibleDetectors(rack, { season: "fall", color: "pink" });
    assert.equal(chip.some((way) => way.usual), true);
    assert.equal(chip.some((way) => way.id === "13" && !way.usual), false);
    const html = await renderSections(rack, { season: "fall", color: "pink" });
    assert.ok(titlesOf(html).includes("Your usual"));
    const dead = g({
      id: "g_37e5eqjwgd3d",
      name: "white retro sneaker",
      category: "footwear",
      subtype: "sneaker",
      colors: ["white"],
      material: "leather",
    });
    const poisoned = [
      ...many("tee2", "graphic tee", "top", "tee", { colors: ["navy"], material: "cotton" }),
      ...many("jean2", "indigo jean", "bottom", "jean", { colors: ["navy"], material: "denim" }),
      ...many("ok", "retro sneaker", "footwear", "sneaker", { colors: ["white"], material: "leather" }),
      dead,
      g({ id: "g_c6qdv5c3gkor", name: "grey retro sneaker", category: "footwear", subtype: "sneaker", colors: ["grey"], material: "leather" }),
      g({ id: "g_x0ro1mg2gu0a", name: "black retro sneaker", category: "footwear", subtype: "sneaker", colors: ["black"], material: "leather" }),
    ];
    const looks = cellLooks("13", poisoned, "weekend", "fall");
    assert.ok(looks.length >= 3);
    assert.equal(looks.some((look) => look.some((piece) => piece.id.startsWith("g_"))), false);
  });

  it("hides a chapter under three and moves a short tap to the nearest open chapter", async () => {
    const look = (n: number): Garment[] => [
      g({ id: `t${n}`, name: `graphic tee ${n}`, category: "top", subtype: "tee" }),
      g({ id: `b${n}`, name: `indigo jean ${n}`, category: "bottom", subtype: "jean" }),
      g({ id: `s${n}`, name: `retro sneaker ${n}`, category: "footwear", subtype: "sneaker" }),
    ];
    const counts = { weekday: 1, out: 0, weekend: 4, travel: 0, comfy: 4 };
    const way: Way = {
      id: "13",
      title: "Graphic tee and retro sneaker",
      pieces: look(0),
      looks: { weekday: [look(0)], weekend: [look(1), look(2), look(3), look(4)], comfy: [look(5), look(6), look(7)] },
      counts,
    };
    const hidden = await renderSections([], { ways: [way], occasion: "out", season: "fall" });
    assert.equal(hidden.includes("Graphic tee and retro sneaker"), false);
    assert.equal(hidden.includes("None"), false);
    const short = await renderSections([], {
      ways: [way],
      occasion: "weekday",
      season: "fall",
      activeId: "13",
    });
    assert.match(short, /Not enough of your pieces for this here yet\./);
    assert.match(short, /Weekend/);
    assert.equal(short.includes("None"), false);
    const disjoint = maxDisjoint([
      [g({ id: "a", name: "a", category: "top", subtype: "tee" }), g({ id: "b", name: "b", category: "bottom", subtype: "jean" })],
      [g({ id: "a", name: "a", category: "top", subtype: "tee" }), g({ id: "c", name: "c", category: "bottom", subtype: "jean" })],
      [g({ id: "d", name: "d", category: "top", subtype: "tee" }), g({ id: "e", name: "e", category: "bottom", subtype: "jean" })],
    ]);
    assert.equal(disjoint.length, 2);
  });

  it("section titles are clothes, at most four, and Joe's labels are not headings", () => {
    assert.equal(titlesAreClothes(), true);
    assert.ok(detectorTitles().length <= 15);
    for (const title of detectorTitles()) assert.equal(BANNED.test(title), false);
    const sections = readFileSync(
      new URL("../components/closet/detector-sections.tsx", import.meta.url),
      "utf8",
    );
    const book = readFileSync(new URL("../routes/lookbook.tsx", import.meta.url), "utf8");
    assert.match(sections, /<h2[^>]*>\{way\.title\}<\/h2>/);
    assert.equal(BANNED.test(sections), false);
    assert.equal(book.includes("data-house-row"), false);
    assert.equal(BANNED.test(book), false);
  });
});

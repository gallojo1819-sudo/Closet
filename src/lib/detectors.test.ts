import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { detectorTitles, titlesAreClothes, visibleDetectors } from "./detectors.ts";
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

async function renderSections(garments: Garment[]): Promise<string> {
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
    return renderToStaticMarkup(createElement(mod.DetectorSections, { garments }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function titlesOf(html: string): string[] {
  return [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((hit) => hit[1] ?? "");
}

describe("detectors", () => {
  it("a graphic tee, a jean, and a retro sneaker show 13 and do not render 9", async () => {
    const rack = [
      g({ id: "tee", name: "graphic tee", category: "top", subtype: "tee", brand: "Polo" }),
      g({ id: "jean", name: "indigo jean", category: "bottom", subtype: "jean" }),
      g({ id: "shoe", name: "retro sneaker", category: "footwear", subtype: "sneaker" }),
    ];
    const ways = visibleDetectors(rack);
    assert.ok(ways.some((way) => way.id === "13"));
    assert.equal(ways.some((way) => way.id === "9"), false);
    const html = await renderSections(rack);
    const titles = titlesOf(html);
    assert.ok(titles.includes("Graphic tee and retro sneaker"));
    assert.equal(titles.includes("Flannel, cashmere, dark suede"), false);
    assert.equal(html.includes("Flannel, cashmere, dark suede"), false);
    for (const title of titles) assert.equal(BANNED.test(title), false);
  });

  it("linen and a loafer do not render the shrunken grey suit", async () => {
    const rack = [
      g({ id: "shirt", name: "linen camp collar", category: "top", subtype: "camp shirt" }),
      g({ id: "bottom", name: "linen gurkha", category: "bottom", subtype: "gurkha" }),
      g({ id: "shoe", name: "suede loafer", category: "footwear", subtype: "loafer", material: "suede" }),
    ];
    const ways = visibleDetectors(rack);
    assert.equal(ways.some((way) => way.id === "5"), false);
    assert.ok(ways.some((way) => way.id === "8"));
    const html = await renderSections(rack);
    const titles = titlesOf(html);
    assert.equal(titles.includes("Shrunken grey suit"), false);
    assert.ok(titles.includes("Linen and a soft jacket"));
    for (const title of titles) assert.equal(BANNED.test(title), false);
  });

  it("shows at most four finished ways, in list order", () => {
    const rack = [
      g({ id: "w", name: "western snap shirt", category: "top", subtype: "shirt" }),
      g({ id: "d", name: "raw denim", category: "bottom", subtype: "denim" }),
      g({ id: "r", name: "roper boot", category: "footwear", subtype: "boot" }),
      g({ id: "ox", name: "navy oxford", category: "top", subtype: "oxford" }),
      g({ id: "ch", name: "khaki chino", category: "bottom", subtype: "chino" }),
      g({ id: "pn", name: "brown penny loafer", category: "footwear", subtype: "loafer" }),
      g({ id: "gi", name: "gingham shirt", category: "top", subtype: "shirt" }),
      g({ id: "co", name: "tan cords", category: "bottom", subtype: "cord" }),
      g({ id: "bb", name: "brown boot", category: "footwear", subtype: "boot" }),
      g({ id: "sj", name: "structured suit jacket", category: "outerwear", subtype: "suit" }),
      g({ id: "st", name: "black suit trousers", category: "bottom", subtype: "trouser" }),
      g({ id: "oxs", name: "black calf oxford shoe", category: "footwear", subtype: "oxford" }),
      g({ id: "tee", name: "graphic tee", category: "top", subtype: "tee" }),
      g({ id: "jn", name: "indigo jean", category: "bottom", subtype: "jean" }),
      g({ id: "rs", name: "retro sneaker", category: "footwear", subtype: "sneaker" }),
    ];
    const ways = visibleDetectors(rack);
    assert.deepEqual(ways.map((way) => way.id), ["1", "2", "3", "4"]);
    assert.equal(ways.some((way) => way.id === "13"), false);
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

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import library from "./library.json" with { type: "json" };
import platesFile from "../stylist/__tests__/fixtures/plates-2026-09-30.json" with { type: "json" };
import {
  cellLooks,
  detectorTitle,
  maxDisjoint,
  renderedSectionLooks,
  sharedDetector,
  visibleDetectors,
  wayChipVisible,
  wayFirstRow,
  type Way,
} from "../detectors.ts";
import { cardTag } from "../look.ts";
import type { Garment, Look, Occasion, Season } from "../types.ts";

type Raw = {
  id: string;
  name?: string | null;
  category?: string;
  subtype?: string;
  material?: string;
  colors?: string[];
  brand?: string;
  fit?: string | null;
  warmth?: number;
  archived?: boolean;
  tombstone?: boolean;
};

function garment(p: Raw): Garment {
  const fit = p.fit === "slim" || p.fit === "relaxed" || p.fit === "regular" ? p.fit : undefined;
  return {
    id: p.id,
    name: p.name ?? "",
    category: (p.category ?? "top") as Garment["category"],
    subtype: p.subtype ?? "",
    colors: p.colors ?? [],
    material: p.material ?? "",
    brand: p.brand ?? "",
    notes: "",
    formality: 3,
    warmth: Math.min(5, Math.max(1, p.warmth ?? 3)) as Garment["warmth"],
    seasons: [],
    imageSrc: "",
    cutoutSrc: "",
    imageSource: "photo",
    matteQuality: "ok",
    demo: false,
    wornOn: [],
    ...(fit ? { fit } : {}),
    archived: false,
    createdAt: "2026-09-30T00:00:00.000Z",
  };
}

const GONE = new Set<string>(platesFile.deleted_garments as string[]);
const RACK: Garment[] = (platesFile.plates as Raw[])
  .filter((p) => p.id && !p.tombstone && !p.archived && !GONE.has(p.id))
  .map(garment);
const BY = new Map(RACK.map((g) => [g.id, g]));

const OCCASIONS: { id: Occasion; label: string }[] = [
  { id: "weekday", label: "Weekday" },
  { id: "out", label: "Out" },
  { id: "weekend", label: "Weekend" },
  { id: "comfy", label: "Comfy" },
  { id: "travel", label: "Travel" },
];
const SEASONS: { id: Season; label: string }[] = [
  { id: "spring", label: "Spring" },
  { id: "summer", label: "Summer" },
  { id: "fall", label: "Fall" },
  { id: "winter", label: "Winter" },
];
const TEMPS: (number | undefined)[] = [undefined, 73];

/* What a true look is, in plain words on the plate. Not the cell phrases. */
const said = (g: Garment) => `${g.name} ${g.subtype} ${g.material}`.toLowerCase();
const tops = (look: Garment[]) => look.filter((g) => g.category === "top");
const bottoms = (look: Garment[]) => look.filter((g) => g.category === "bottom");
const shoes = (look: Garment[]) => look.filter((g) => g.category === "footwear");
const outers = (look: Garment[]) => look.filter((g) => g.category === "outerwear");

function chunky(g: Garment): boolean {
  const t = said(g);
  if (/cable|chunky/.test(t)) return true;
  return /sweater|knit/.test(t) && !/polo|shirt/.test(t) && (g.warmth >= 4 || g.fit === "relaxed");
}

function fineKnit(g: Garment): boolean {
  const t = said(g);
  return (
    /knit|sweater|polo|merino|cashmere/.test(t) &&
    !/hoodie|sweatshirt|fleece|t-shirt|\btee\b/.test(t) &&
    !chunky(g)
  );
}

function navy(g: Garment): boolean {
  return /navy/.test(g.name.toLowerCase()) || g.colors.some((c) => /navy/.test(c.toLowerCase()));
}

/** Why this look does not belong under this way, or null when it does. */
function misfile(wayId: string, look: Garment[]): string | null {
  switch (wayId) {
    case "7":
      if (!tops(look).some((g) => /henley/.test(said(g)))) return "no henley";
      if (!bottoms(look).some((g) => /jean|denim/.test(said(g)))) return "no denim";
      return null;
    case "2": {
      const hits = [
        tops(look).some((g) => /oxford|button-down|button down/.test(said(g)) && !/cable/.test(said(g))),
        bottoms(look).some((g) => /chino/.test(said(g))),
        outers(look).some((g) => /blazer|sport ?coat/.test(said(g)) && navy(g)),
      ].filter(Boolean).length;
      return hits < 2 ? `${hits} of oxford, chino, navy blazer` : null;
    }
    case "6":
      if (!tops(look).length || !tops(look).every(fineKnit)) return "a top is not a fine knit";
      if (!shoes(look).some((g) => /suede/.test(said(g)) && /loafer/.test(said(g)))) return "no suede loafer";
      return null;
    case "3":
      if (!bottoms(look).some((g) => /cord/.test(said(g)))) return "no cords";
      if (!tops(look).some((g) => /gingham|fair isle|diamond|cable/.test(said(g)))) return "no country top";
      return null;
    case "8":
      return look.some((g) => /linen/.test(said(g))) ? null : "no linen";
    case "9": {
      const hits = [
        tops(look).some((g) => /cashmere|merino|fine knit/.test(said(g))),
        bottoms(look).some((g) => /flannel/.test(said(g))),
        shoes(look).some((g) => /suede/.test(said(g)) && !/sneaker/.test(said(g))),
      ].filter(Boolean).length;
      return hits < 2 ? `${hits} of cashmere, flannel, dark suede` : null;
    }
    case "10":
      if (!shoes(look).some((g) => /sneaker/.test(said(g)))) return "no sneaker";
      if (!bottoms(look).some((g) => /jean|chino|denim/.test(said(g)))) return "no jean or chino";
      return null;
    case "15":
      if (![...tops(look), ...outers(look)].some((g) => /fleece|quilt/.test(said(g)))) return "no fleece";
      if (!shoes(look).some((g) => /sneaker/.test(said(g)))) return "no sneaker";
      return null;
    case "12": {
      const prints = look.filter((g) =>
        /print|jacquard|paisley|embroider|pattern|abstract|plaid|gingham|stripe/.test(said(g)),
      ).length;
      return prints === 1 ? null : `${prints} prints`;
    }
    default:
      throw new Error(`unchecked way ${wayId}`);
  }
}

function waysAt(occasion: Occasion, season: Season, weatherF?: number): Way[] {
  return visibleDetectors(RACK, { occasion, season, color: null, weatherF });
}

function names(look: Garment[]): string {
  return look.map((g) => g.name).join(" / ");
}

const key = (ids: string[]) => [...ids].sort().join("|");

function pick(...ids: string[]): Garment[] {
  return ids.map((id) => {
    const g = BY.get(id);
    assert.ok(g, `fixture lost ${id}`);
    return g;
  });
}

async function renderSections(props: Record<string, unknown>): Promise<string> {
  const ts = await import("typescript");
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const src = readFileSync(
    new URL("../../components/closet/detector-sections.tsx", import.meta.url),
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
  const detectorsHref = new URL("../detectors.ts", import.meta.url).href;
  const jsxHref = import.meta.resolve("react/jsx-runtime");
  const dir = mkdtempSync(join(tmpdir(), "ways-"));
  const kit = join(dir, "kit.mjs");
  writeFileSync(
    kit,
    `import { jsx, jsxs } from ${JSON.stringify(jsxHref)};
export function LookKit({ pieces = [], layout }) {
  return jsxs("div", {
    "data-look-kit": layout ?? "",
    children: pieces.map((g) => jsx("span", { children: g.name }, g.id)),
  });
}
`,
  );
  js = js.replaceAll(`from "@/components/closet/look-kit"`, `from ${JSON.stringify(pathToFileURL(kit).href)}`);
  js = js.replaceAll(`from "@/lib/detectors"`, `from ${JSON.stringify(detectorsHref)}`);
  js = js.replaceAll(`from "react/jsx-runtime"`, `from ${JSON.stringify(jsxHref)}`);
  const file = join(dir, "detector-sections.mjs");
  writeFileSync(file, js);
  try {
    const mod = await import(pathToFileURL(file).href);
    return renderToStaticMarkup(createElement(mod.DetectorSections, { garments: [], ...props }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("a way holds only looks with that way's pieces", () => {
  for (const weatherF of TEMPS) {
    for (const season of SEASONS) {
      for (const occasion of OCCASIONS) {
        const ways = waysAt(occasion.id, season.id, weatherF);
        const counts =
          ways
            .filter((way) => !way.usual)
            .map((way) => `${way.title} ${(way.looks[occasion.id] ?? []).length}`)
            .join(", ") || "Your usual";
        const at = `${occasion.label} · ${season.label} · ${weatherF === undefined ? "no weather" : `${weatherF}°F`}`;
        it(`${at}: ${counts}`, () => {
          const wrong: string[] = [];
          for (const way of ways) {
            if (way.usual) continue;
            const looks = way.looks[occasion.id] ?? [];
            assert.ok(looks.length >= 1, `${way.title} shows with no look`);
            assert.ok(looks.length <= 5);
            for (const look of looks) {
              assert.ok(look.length >= 3);
              const why = misfile(way.id, look);
              if (why) wrong.push(`${way.title}: ${names(look)} (${why})`);
            }
          }
          assert.deepEqual(wrong, []);
        });
      }
    }
  }
});

describe("a short way is shown short", () => {
  const HENLEY = "g_m7bg5j5z10wc";
  const BUTTON_DOWNS = ["g_21b6d3qcohmu", "g_mq1ob9uc1npn"];
  const CHINOS = "g_vf28ktbdhmtz";
  const NAVY_BLAZER = "g_5josnvyoi4z9";
  const SUEDE_LOAFERS = ["g_8ukg5mi9r3fc", "g_8nrtffa2s13s"];

  it("this rack has one henley look, two oxford looks, two fine knit looks, at most", () => {
    for (const season of SEASONS) {
      for (const occasion of OCCASIONS) {
        const henley = maxDisjoint(cellLooks("7", RACK, occasion.id, season.id));
        assert.ok(henley.length <= 1, `${henley.length} henley looks`);
        for (const look of henley) assert.ok(look.some((g) => g.id === HENLEY));

        const oxford = maxDisjoint(cellLooks("2", RACK, occasion.id, season.id));
        assert.ok(oxford.length <= 2, `${oxford.length} oxford looks`);
        for (const look of oxford) {
          const anchors = [
            look.some((g) => BUTTON_DOWNS.includes(g.id)),
            look.some((g) => g.id === CHINOS),
            look.some((g) => g.id === NAVY_BLAZER),
          ].filter(Boolean).length;
          assert.ok(anchors >= 2, names(look));
        }

        const knit = maxDisjoint(cellLooks("6", RACK, occasion.id, season.id));
        assert.ok(knit.length <= 2, `${knit.length} fine knit looks`);
        for (const look of knit) assert.ok(look.some((g) => SUEDE_LOAFERS.includes(g.id)), names(look));
      }
    }
  });

  it("renders exactly its looks and says how many, never a filler line", async () => {
    const ways = waysAt("weekday", "fall", 73);
    const short = ways.filter((way) => !way.usual && (way.looks.weekday ?? []).length < 3);
    assert.ok(short.length >= 1, "Weekday · Fall has a short way on this rack");
    for (const way of short) {
      const looks = way.looks.weekday ?? [];
      assert.equal(wayChipVisible(way, "weekday"), true);
      assert.equal(renderedSectionLooks([way], "weekday").length, looks.length);
      const html = await renderSections({ ways: [way], occasion: "weekday", season: "fall" });
      assert.equal(html.split('data-look-kit="stack"').length - 1, looks.length);
      for (const look of looks) for (const g of look) assert.ok(html.includes(`>${g.name}<`), g.name);
      assert.ok(html.includes(`Only ${looks.length} in your closet.`));
      assert.equal(html.split("in your closet.").length - 1, 1);
      assert.equal(html.includes("None"), false);
      assert.equal(html.includes("Not enough"), false);
    }
  });

  it("a full way has no count line, an empty way has no chip and no section, and a tap hides nothing", async () => {
    const look = (n: number): Garment[] =>
      (["top", "bottom", "footwear"] as const).map((category) =>
        garment({ id: `${category}${n}`, name: `${category} ${n}`, category, subtype: category }),
      );
    const counts = { weekday: 0, out: 0, weekend: 0, travel: 0, comfy: 0 };
    const full: Way = {
      id: "10",
      title: "Clean city sportswear",
      pieces: look(1),
      looks: { weekday: [look(1), look(2), look(3)] },
      counts: { ...counts, weekday: 3 },
    };
    const one: Way = {
      id: "7",
      title: "Henley and relaxed denim",
      pieces: look(4),
      looks: { weekday: [look(4)] },
      counts: { ...counts, weekday: 1 },
    };
    const none: Way = {
      id: "2",
      title: "Oxford, chino, navy blazer",
      pieces: look(5),
      looks: { weekend: [look(5)] },
      counts: { ...counts, weekend: 1 },
    };
    assert.equal(wayChipVisible(none, "weekday"), false);
    assert.equal(renderedSectionLooks([none], "weekday").length, 0);
    const html = await renderSections({ ways: [full, one, none], occasion: "weekday", season: "fall" });
    const titles = [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((hit) => hit[1]);
    assert.deepEqual(titles, ["Clean city sportswear", "Henley and relaxed denim"]);
    assert.equal(html.split("in your closet.").length - 1, 1);
    assert.ok(html.includes("Only 1 in your closet."));
    const tapped = await renderSections({
      ways: [full, one, none],
      occasion: "weekday",
      season: "fall",
      activeId: "7",
    });
    const tappedTitles = [...tapped.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((hit) => hit[1]);
    assert.deepEqual(tappedTitles, ["Henley and relaxed denim", "Clean city sportswear"]);
    assert.equal(tapped.includes("Not enough"), false);
    assert.equal(tapped.includes("Weekend"), false);
    assert.deepEqual(
      renderedSectionLooks([full, one, none], "weekday", "7").map((row) => row.garmentIds[0]),
      ["top4", "top1", "top2", "top3"],
    );
  });
});

describe("the loose phrases stay out of henley and oxford", () => {
  type CellRow = { key: string; required: string[]; slots: Record<string, { core: string[]; compatible: string[] }> };
  const cell = (cellKey: string): CellRow => {
    const row = (library.cells as CellRow[]).find((c) => c.key === cellKey);
    assert.ok(row, cellKey);
    return row;
  };

  it("zip knit is not a henley, and a cable knit is not an oxford", () => {
    const henley = cell("henley_denim");
    assert.deepEqual(henley.slots.top!.core, ["henley"]);
    assert.equal(henley.slots.top!.core.includes("zip knit"), false);
    assert.equal(henley.slots.bottom!.compatible.includes("relaxed or dark trouser"), false);
    assert.deepEqual([...henley.required].sort(), ["bottom", "top"]);
    const ivy = cell("ivy_prep");
    assert.equal(ivy.slots.top!.core.includes("cable"), false);
    assert.equal(cell("country_stable").slots.top!.core.includes("cable"), true);
    assert.equal(cell("fine_knit_loafer").slots.top!.core.includes("linen shirt"), false);
    assert.deepEqual(cell("fine_knit_loafer").slots.shoe!.core, ["suede loafer"]);
  });

  it("the half-zip look is not Henley, and the cable-knit look is not Oxford", () => {
    const halfZip = pick("g_rpjfgscii90r", "g_yfkavdj5irwe", "g_5g4fqg77s4rw");
    const cable = pick("g_salzdhuswyd3", "g_x1vivoqz2ixd", "g_2djvq6l9qxbb");
    assert.match(names(halfZip), /half-zip/i);
    assert.match(names(cable), /cable/i);
    for (const season of SEASONS) {
      for (const occasion of OCCASIONS) {
        const ctx = { occasion: occasion.id, season: season.id, pool: RACK };
        assert.notEqual(sharedDetector(halfZip, ctx, RACK)?.title, "Henley and relaxed denim");
        assert.notEqual(detectorTitle(halfZip, ctx), "Henley and relaxed denim");
        assert.notEqual(sharedDetector(cable, ctx, RACK)?.title, "Oxford, chino, navy blazer");
        assert.notEqual(detectorTitle(cable, ctx), "Oxford, chino, navy blazer");
      }
    }
  });

  it("a navy blazer finishes an oxford look, and a chino alone does not start one", () => {
    const [polo, chinos, loafers, blazer] = pick(
      "g_bq9qnaa1vkon",
      "g_vf28ktbdhmtz",
      "g_8nrtffa2s13s",
      "g_5josnvyoi4z9",
    ) as [Garment, Garment, Garment, Garment];
    const ctx = { occasion: "out", season: "summer", pool: RACK };
    assert.notEqual(sharedDetector([polo, chinos, loafers], ctx, RACK)?.title, "Oxford, chino, navy blazer");
    assert.equal(sharedDetector([polo, chinos, loafers, blazer], ctx, RACK)?.title, "Oxford, chino, navy blazer");
  });
});

describe("a tapped way leads This week", () => {
  const ways = waysAt("weekday", "fall", 73).filter((way) => !way.usual);
  const way = ways[0]!;
  const mine = way.looks.weekday ?? [];
  const others = ways.slice(1).flatMap((other) => other.looks.weekday ?? []);
  const asLook = (pieces: Garment[], n: number): Look => ({
    id: `row${n}`,
    name: names(pieces),
    occasion: "weekday",
    garmentIds: pieces.map((g) => g.id),
    source: "ai",
    lookbook: true,
    createdAt: "2026-10-06T00:00:00.000Z",
  });
  const mineKeys = new Set(mine.map((look) => key(look.map((g) => g.id))));
  const row = others
    .filter((look) => !mineKeys.has(key(look.map((g) => g.id))))
    .slice(0, 3)
    .map(asLook);

  it("puts the way's true looks first and keeps the rest of the row", () => {
    assert.ok(mine.length >= 1);
    assert.equal(row.length, 3);
    const out = wayFirstRow(row, way, "weekday");
    const firstIds = mine[0]!.map((g) => g.id);
    assert.deepEqual(out[0]!.garmentIds, firstIds);
    assert.equal(out[0]!.id, `way:${way.id}:weekday:0:${firstIds.join(".")}`);
    assert.equal(out[0]!.source, "ai");
    assert.equal(out[0]!.lookbook, false);
    assert.equal(out[0]!.occasion, "weekday");
    assert.deepEqual(
      out.slice(0, mine.length).map((look) => look.garmentIds),
      mine.map((look) => look.map((g) => g.id)),
    );
    assert.deepEqual(out.slice(mine.length), row);
    assert.notDeepEqual(
      out.map((look) => look.id),
      row.map((look) => look.id),
    );
    for (const look of out.slice(0, mine.length)) assert.equal(misfile(way.id, pick(...look.garmentIds)), null);
    const keys = out.map((look) => key(look.garmentIds));
    assert.equal(new Set(keys).size, keys.length);
  });

  it("shows one card per combination, eight at most, and leaves the row alone with no way", () => {
    const again: Look = { ...asLook([...mine[0]!].reverse(), 90), id: "same-clothes" };
    const out = wayFirstRow([again, ...row], way, "weekday");
    assert.equal(out.some((look) => look.id === "same-clothes"), false);
    assert.equal(out.length, mine.length + row.length);
    const long = Array.from({ length: 10 }, (_, n) =>
      asLook(
        (["top", "bottom", "footwear"] as const).map((category) =>
          garment({ id: `${category}${n}`, name: `${category} ${n}`, category, subtype: category }),
        ),
        n,
      ),
    );
    const capped = wayFirstRow(long, way, "weekday");
    assert.equal(capped.length, 8);
    assert.deepEqual(capped.slice(mine.length), long.slice(0, 8 - mine.length));
    assert.equal(wayFirstRow(row, undefined, "weekday"), row);
    assert.deepEqual(wayFirstRow(row, way, "out").slice(-row.length), row);
  });
});

describe("the card tag says each thing once", () => {
  const words = (line: string) => line.toLowerCase().match(/[a-z]+/g) ?? [];

  it("joins the way, the occasion, and the season", () => {
    assert.equal(cardTag(null, "Weekday", "Fall"), "Weekday · Fall");
    assert.equal(
      cardTag("Henley and relaxed denim", "Weekday", "Fall"),
      "Henley and relaxed denim · Weekday · Fall",
    );
    assert.equal(cardTag("", "Weekday", "Fall"), "Weekday · Fall");
    for (const line of [cardTag(null, "Weekday", "Fall"), cardTag("Henley and relaxed denim", "Weekday", "Fall")]) {
      assert.equal(new Set(words(line)).size, words(line).length, line);
    }
  });

  it("the lookbook card renders the tag, with the label and not the id", () => {
    const book = readFileSync(new URL("../../routes/lookbook.tsx", import.meta.url), "utf8");
    assert.match(book, /\{cardTag\(wayTitle, occasionLabel, seasonLabel\)\}/);
    assert.equal(book.includes("?? chapterLabel"), false);
    assert.match(book, /occasionLabel=\{chapterLabel\}/);
    assert.equal(book.includes("shownWays"), false);
  });
});

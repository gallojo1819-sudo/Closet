import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ROW_MAX, rowWays, visibleDetectors } from "./detectors/cells.ts";
import { usualFromCloset } from "./detectors/usual.ts";
import {
  COLLAGE_GEOMETRY,
  collageLayout,
  collageSlots,
  lookTitle,
  pieceLine,
  plainName,
  tileTint,
  TINT_FALLBACK,
} from "./look-collage.ts";
import { lookFitsSeason } from "./season.ts";
import { wearSlot } from "./stylist/jackets.ts";
import { isLegal } from "./stylist/legal.ts";
import { slotOf } from "./style.ts";
import type { Garment, Occasion, Season } from "./types.ts";

const BANNED =
  /\b(Polo|Purple|RRL|ALD|Faloni|545|Sweet Stable|Italian summer|Italian winter)\b/;

const FIXTURE = JSON.parse(
  readFileSync(new URL("./__fixtures__/engine-garments.json", import.meta.url), "utf8"),
) as Garment[];

function g(partial: Pick<Garment, "id" | "name" | "category" | "subtype"> & Partial<Garment>): Garment {
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

const jacket = g({ id: "j", name: "Brown suede jacket", category: "outerwear", subtype: "jacket", material: "suede", colors: ["brown"] });
const shirt = g({ id: "t", name: "Cream oxford shirt", category: "top", subtype: "oxford", colors: ["cream"] });
const trousers = g({ id: "b", name: "Ivory pleated trousers", category: "bottom", subtype: "trouser", colors: ["ivory"] });
const loafers = g({ id: "s", name: "Black woven loafers", category: "footwear", subtype: "loafer", colors: ["black"] });
const dress = g({ id: "d", name: "Navy knit dress", category: "dress", subtype: "dress", colors: ["navy"] });
const belt = g({ id: "a", name: "Brown leather belt", category: "accessory", subtype: "belt", colors: ["brown"] });

const slotOfId = (pieces: Garment[], id: string) => collageSlots(pieces).find((p) => p.g.id === id)!;
const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("collageSlots", () => {
  it("jacket first: the outer is above the top, the shoes above all, the bottom lowest", () => {
    const slots = collageSlots([shirt, trousers, loafers, jacket]);
    assert.deepEqual(
      slots.map((p) => [p.g.id, p.slot]),
      [
        ["t", "top"],
        ["b", "bottom"],
        ["s", "shoes"],
        ["j", "outer"],
      ],
    );
    const z = Object.fromEntries(slots.map((p) => [p.slot, p.z]));
    assert.ok(z.outer! > z.top!, "the outer is never under the top");
    assert.ok(z.top! > z.bottom!);
    assert.ok(z.shoes! > z.outer!, "shoes sit above all");
    // Order is stable: the pieces come back as given.
    assert.deepEqual(
      collageSlots([jacket, loafers, shirt, trousers]).map((p) => p.g.id),
      ["j", "s", "t", "b"],
    );
  });

  it("with no outer, the top takes the outer geometry; a dress takes a taller top slot with no bottom", () => {
    const lay = collageLayout([shirt, trousers, loafers]);
    const top = lay.find((p) => p.slot === "top")!;
    assert.deepEqual({ left: top.left, top: top.top, w: top.w }, COLLAGE_GEOMETRY.outer);
    assert.equal(top.tall, false);
    const dressed = collageLayout([dress, loafers, jacket]);
    const d = dressed.find((p) => p.g.id === "d")!;
    assert.equal(d.slot, "top");
    assert.equal(d.tall, true);
    assert.equal(dressed.some((p) => p.slot === "bottom"), false);
    assert.equal(dressed.find((p) => p.slot === "outer")!.left, 0);
  });

  it("a second outer and an accessory are extra; one extra is drawn small, two are only listed", () => {
    const coat = g({ id: "c", name: "Navy overcoat", category: "outerwear", subtype: "overcoat", colors: ["navy"] });
    assert.equal(slotOfId([jacket, shirt, trousers, loafers, coat], "c").slot, "extra");
    assert.equal(slotOfId([jacket, shirt, trousers, loafers, belt], "a").slot, "extra");
    const one = collageLayout([jacket, shirt, trousers, loafers, belt]);
    assert.equal(one.find((p) => p.g.id === "a")!.drawn, true);
    const two = collageLayout([jacket, shirt, trousers, loafers, belt, coat]);
    assert.equal(two.filter((p) => p.slot === "extra").every((p) => !p.drawn), true);
    assert.equal(two.filter((p) => p.drawn).length, 4);
  });

  it("a mid layer over a shirt is the top and the shirt peeks out as top2", () => {
    const mid = FIXTURE.find((p) => wearSlot(p) === "mid" && slotOf(p) !== "outerwear");
    const shirtLike = FIXTURE.find((p) => slotOf(p) === "top" && wearSlot(p) !== "mid" && /shirt|oxford/i.test(`${p.name} ${p.subtype}`));
    if (!mid || !shirtLike) return;
    const slots = collageSlots([shirtLike, trousers, loafers, mid]);
    assert.equal(slots.find((p) => p.g.id === mid.id)!.slot, "top");
    assert.equal(slots.find((p) => p.g.id === shirtLike.id)!.slot, "top2");
    assert.ok(slots.find((p) => p.slot === "top")!.z > slots.find((p) => p.slot === "top2")!.z);
    const top2 = collageLayout([shirtLike, trousers, loafers, mid]).find((p) => p.slot === "top2")!;
    assert.deepEqual({ left: top2.left, top: top2.top, w: top2.w }, COLLAGE_GEOMETRY.top2);
  });

  it("the geometry is CD's, verbatim", () => {
    assert.deepEqual(COLLAGE_GEOMETRY.outer, { left: 0, top: 0, w: 57 });
    assert.deepEqual(COLLAGE_GEOMETRY.top, { left: 43, top: 3.5, w: 51 });
    assert.deepEqual(COLLAGE_GEOMETRY.bottom, { left: 47, top: 43, w: 47 });
    assert.deepEqual(COLLAGE_GEOMETRY.shoes, { left: 5, top: 62, w: 35 });
  });
});

describe("lookTitle and pieceLine", () => {
  it("is CD's short serif title from names only, colour words stripped, lowercase after the first word", () => {
    const halfZip = g({ id: "h", name: "Cream half-zip", category: "top", subtype: "half-zip", colors: ["cream"] });
    assert.equal(lookTitle([halfZip, trousers, loafers, jacket]), "Half-zip and suede jacket");
    assert.equal(lookTitle([shirt, trousers, loafers]), "Oxford shirt and pleated trousers");
    assert.equal(lookTitle([dress, loafers]), "Knit dress and woven loafers");
  });

  it("drops a brand that leaks into a name and never reads g.brand", () => {
    const branded = g({ id: "x", name: "X Brand navy oxford", brand: "X Brand", category: "top", subtype: "oxford" });
    assert.equal(plainName(branded), "oxford");
    assert.equal(lookTitle([branded, trousers, loafers]).includes("X Brand"), false);
    const lib = src("./look-collage.ts");
    assert.equal(lib.includes("pieceLabel"), false);
    assert.equal(/g\.brand/.test(lib.replace(/\(g\.brand \?\? ""\)/g, "")), false, "brand is read only to strip it");
  });

  it("pieceLine is the names in collage order, joined with a middle dot", () => {
    assert.equal(
      pieceLine([loafers, trousers, shirt, jacket]),
      "Brown suede jacket · Cream oxford shirt · Ivory pleated trousers · Black woven loafers",
    );
  });

  it("every look in the 142-piece fixture titles clean of house names", () => {
    for (const season of ["fall", "winter"] as Season[]) {
      for (const occasion of ["weekday", "weekend"] as Occasion[]) {
        for (const way of rowWays(visibleDetectors(FIXTURE, { occasion, season }), FIXTURE, { occasion, season })) {
          for (const look of way.looks[occasion] ?? []) {
            const title = lookTitle(look);
            assert.ok(title.length > 0);
            assert.equal(BANNED.test(title), false, title);
            assert.equal(BANNED.test(pieceLine(look)), false);
            assert.equal(title.charAt(0), title.charAt(0).toUpperCase());
          }
        }
      }
    }
  });
});

describe("tileTint", () => {
  it("is deterministic, a color-mix over paper from the first colour, with a flat fallback", () => {
    const a = tileTint(jacket);
    assert.equal(a, tileTint({ ...jacket }));
    assert.match(a, /^color-mix\(in oklab, (#[0-9a-f]{6}|rgb\(\d+, \d+, \d+\)) (1[89]|2[0-4])%, #f4efe6\)$/i);
    assert.notEqual(tileTint(jacket), tileTint(shirt));
    assert.equal(tileTint(g({ id: "n", name: "Plain tee", category: "top", subtype: "tee", colors: [] })), TINT_FALLBACK);
    assert.match(TINT_FALLBACK, /^#[0-9a-f]{6}$/);
  });
});

describe("rowWays on the 142-piece fixture", () => {
  const CTX: { occasion: Occasion; season: Season }[] = [
    { occasion: "weekday", season: "fall" },
    { occasion: "weekend", season: "fall" },
    { occasion: "weekday", season: "winter" },
    { occasion: "weekend", season: "winter" },
  ];
  const key = (look: Garment[]) => look.map((p) => p.id).sort().join("|");

  it("rows reach ROW_MAX when the cell has the rows, never repeat a combination, and every look is legal", (t) => {
    const report: string[] = [];
    let ms = 0;
    for (const { occasion, season } of CTX) {
      const found = visibleDetectors(FIXTURE, { occasion, season });
      const t0 = performance.now();
      const shown = rowWays(found, FIXTURE, { occasion, season });
      ms += performance.now() - t0;
      assert.equal(shown.length, found.length);
      for (const [i, way] of shown.entries()) {
        const looks = way.looks[occasion] ?? [];
        const before = found[i]!.looks[occasion] ?? [];
        assert.ok(looks.length <= ROW_MAX, `${way.title}: ${looks.length}`);
        assert.ok(looks.length >= before.length);
        // salt 0: the first looks are exactly visibleDetectors', in order.
        assert.deepEqual(looks.slice(0, before.length).map(key), before.map(key));
        assert.equal(new Set(looks.map(key)).size, looks.length, `${way.title} repeats a combo`);
        for (const look of looks) {
          assert.equal(isLegal(look, { occasion, season }), true, `${way.title}: ${look.map((p) => p.name).join(" / ")}`);
          assert.equal(lookFitsSeason(look, season), true);
        }
        report.push(`${occasion}/${season} ${way.title}: ${before.length} → ${looks.length}`);
      }
    }
    t.diagnostic(`rowWays ${ms.toFixed(1)} ms for 4 contexts; ${report.join("; ")}`);
    // At least one row grows past the engine's cap of 5 on this closet.
    assert.ok(report.some((line) => /→ [678]$/.test(line)), report.join("\n"));
  });

  it("a salt keeps every look legal and stored, and changes at least one row", () => {
    for (const { occasion, season } of CTX) {
      const found = visibleDetectors(FIXTURE, { occasion, season });
      const base = rowWays(found, FIXTURE, { occasion, season, salt: 0 });
      for (const salt of [1, 2, 3]) {
        const shown = rowWays(found, FIXTURE, { occasion, season, salt });
        const again = rowWays(found, FIXTURE, { occasion, season, salt });
        assert.deepEqual(shown.map((w) => (w.looks[occasion] ?? []).map(key)), again.map((w) => (w.looks[occasion] ?? []).map(key)));
        let differs = false;
        for (const [i, way] of shown.entries()) {
          const looks = way.looks[occasion] ?? [];
          assert.ok(looks.length <= ROW_MAX);
          assert.equal(new Set(looks.map(key)).size, looks.length);
          for (const look of looks) {
            assert.equal(isLegal(look, { occasion, season }), true);
            assert.equal(lookFitsSeason(look, season), true);
          }
          if (looks.map(key).join() !== (base[i]!.looks[occasion] ?? []).map(key).join()) differs = true;
        }
        assert.ok(differs, `${occasion}/${season} salt ${salt} changed nothing`);
      }
    }
  });

  it("usualFromCloset without max is the old three; max and salt only extend or rotate", () => {
    const base = usualFromCloset(FIXTURE, { occasion: "weekday", season: "fall" });
    assert.deepEqual(base, usualFromCloset(FIXTURE, { occasion: "weekday", season: "fall", max: 3, salt: 0 }));
    assert.ok(base.looks.length <= 3);
    const more = usualFromCloset(FIXTURE, { occasion: "weekday", season: "fall", max: ROW_MAX });
    assert.ok(more.looks.length <= ROW_MAX);
    assert.deepEqual(more.looks.slice(0, base.looks.length).map(key), base.looks.map(key));
    for (const look of more.looks) assert.equal(isLegal(look, { occasion: "weekday", season: "fall" }), true);
    const salted = usualFromCloset(FIXTURE, { occasion: "weekday", season: "fall", max: ROW_MAX, salt: 2 });
    for (const look of salted.looks) assert.equal(isLegal(look, { occasion: "weekday", season: "fall" }), true);
    assert.equal(new Set(salted.looks.map(key)).size, salted.looks.length);
  });
});

describe("source pins", () => {
  it("Re-dress and reshuffleWeek write nothing to taste, history or the store", () => {
    const book = src("../routes/lookbook.tsx");
    const at = book.indexOf("const reshuffleWeek = () => {");
    const end = book.indexOf("const getAnchor", at);
    assert.ok(at > 0 && end > at);
    const handlers = book.slice(at, end);
    assert.match(handlers, /const redress = \(\) => \{/);
    for (const banned of ["setTaste", "veto", "avoid", "skipDrop", "journal", "seenLooks", "saveLook", "closet.v6", "closet_meta"]) {
      assert.equal(handlers.includes(banned), false, banned);
    }
    assert.equal((book.match(/Re-dress\s*<\/button>/g) ?? []).length, 1, "one Re-dress button");
    assert.equal(/Reshuffle\s*<\/button>/.test(book), false, "the old Reshuffle button is gone");
    assert.match(book, /rowWays\(found, garments, \{ occasion, season, color, weatherF: pageWeather, salt: rowSalt \}\)/);
  });

  it("Today renders the collage with FlatLay's props and no new logic", () => {
    const today = src("../routes/index.tsx");
    assert.match(today, /<LookCollage\s+size="today"\s+pieces=\{shown\}\s+activeId=\{picked\?\.id \?\? null\}\s+onPick=\{setPick\}/);
    assert.equal(today.includes("FlatLay"), false);
  });

  it("the collage component is passive without onPick and stacks the jacket above the top", () => {
    const comp = src("../components/closet/look-collage.tsx");
    assert.match(comp, /tabIndex=\{onPick \? 0 : undefined\}/);
    assert.match(comp, /zIndex: picked \? 50 : p\.z/);
    assert.match(comp, /aria-label=\{p\.g\.name\}/);
    assert.match(comp, /aria-pressed=\{activeId === p\.g\.id\}/);
    const css = src("../styles.css");
    assert.match(css, /\.look-collage \{\s*aspect-ratio: 1 \/ 1\.28;/);
    assert.match(css, /\.collage-piece \{[^}]*aspect-ratio: 4 \/ 5;[^}]*border-radius: 3px;[^}]*background: var\(--tint, #ece5d8\);[^}]*isolation: isolate;/);
    assert.match(css, /\.collage-piece img \{\s*mix-blend-mode: multiply;/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.collage-piece \{\s*transition: none;/);
  });

  it("no house or brand names in the app-authored text", () => {
    for (const rel of [
      "../components/closet/detector-sections.tsx",
      "../components/closet/look-collage.tsx",
      "./look-collage.ts",
      "../routes/lookbook.tsx",
      "../routes/index.tsx",
    ]) {
      assert.equal(BANNED.test(src(rel)), false, rel);
    }
  });
});

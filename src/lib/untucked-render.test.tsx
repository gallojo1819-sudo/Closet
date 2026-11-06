import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GarmentDetailSheet } from "@/components/closet/detail";
import { FlatLay, flatLayBox } from "@/components/closet/flat-lay";
import { HeroLookCard } from "@/components/closet/hero-look-card";
import { liveSnapshot } from "./__fixtures__/snapshot.ts";
import { leadTop, lookTuckDecision } from "./look.ts";
import { buildWeek, looksForHero } from "./lookbook.ts";
import { slotOf } from "./style.ts";
import { isKnitTop, isShirtLike, tuckDressingLines, tuckMark } from "./tuck.ts";
import type { Garment, Occasion } from "./types.ts";

const PIN = "2026-11-05";
const PARITY_HASH = "9f1585b10f3522f775a856cfd72703e2bf8dff1028d44f6ac59993ecd7bb971d";

afterEach(() => {
  vi.useRealTimers();
});

/** The day passed as `today` is also the clock, so a stray Date read cannot drift. */
function pinDay(day: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${day}T16:00:00Z`));
}

const TODAY: Record<string, { left: number; top: number; w: number; z: number }> = {
  outerwear: { left: 4, top: 2, w: 88, z: 1 },
  top: { left: 6, top: 6, w: 82, z: 2 },
  dress: { left: 7, top: 7, w: 80, z: 2 },
  bottom: { left: 11, top: 28, w: 78, z: 3 },
  footwear: { left: 18, top: 60, w: 62, z: 4 },
  accessory: { left: 62, top: 68, w: 28, z: 5 },
  other: { left: 16, top: 36, w: 64, z: 3 },
};

function overlapArea(
  a: { left: number; top: number; w: number },
  b: { left: number; top: number; w: number },
): number {
  const x = Math.max(0, Math.min(a.left + a.w, b.left + b.w) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.top + a.w, b.top + b.w) - Math.max(a.top, b.top));
  return x * y;
}

function todayBox(slot: string, n: number, jit: number) {
  const base = TODAY[slot]!;
  const shift = (n - 1) * 5;
  return {
    left: base.left + shift + jit,
    top: base.top + shift * 0.6 + jit,
    w: base.w,
    z: base.z + n,
  };
}

function piece(partial: Partial<Garment> & Pick<Garment, "id" | "name" | "category">): Garment {
  return {
    subtype: "",
    colors: ["navy"],
    material: "cotton",
    brand: "",
    notes: "",
    formality: 3,
    warmth: 2,
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

function zOfPieces(markup: string): number[] {
  return markup.split('class="flat-piece absolute"').slice(1).map((chunk) => {
    const z = chunk.match(/z-index:(\d+)/);
    return z ? Number(z[1]) : Number.NaN;
  });
}

function captionOf(markup: string): string {
  return markup.match(/class="micro text-ink-soft">([^<]*)</)?.[1] ?? "";
}

const selection = JSON.parse(
  readFileSync(new URL("./__fixtures__/untucked-selection.json", import.meta.url), "utf8"),
) as {
  pieceCount: number;
  heroes: Record<string, { garmentIds: string[]; occasion: string }[]>;
  week: { garmentIds: string[]; occasion: string }[];
};

describe("flatLayBox", () => {
  it("tucked, none, and omitted match today's stack", () => {
    const jits = [-1.5, -0.25, 0, 0.4, 1.2];
    for (const slot of Object.keys(TODAY)) {
      for (const n of [1, 2, 3]) {
        for (const jit of jits) {
          const expected = todayBox(slot, n, jit);
          expect(flatLayBox(slot, n, jit, "in"), `${slot} n=${n}`).toEqual(expected);
          expect(flatLayBox(slot, n, jit, "none")).toEqual(expected);
          expect(flatLayBox(slot, n, jit)).toEqual(expected);
        }
      }
    }
  });

  it("untucked puts the hem over the waistband and the lead above the trousers", () => {
    const jits = [-1.5, -0.2, 0, 0.4, 1.2];
    for (const jit of jits) {
      const lead = flatLayBox("top", 1, jit, "out");
      const bottom = flatLayBox("bottom", 1, jit, "out");
      const shoe = flatLayBox("footwear", 1, jit, "out");
      expect(bottom.z).toBeLessThan(lead.z);
      expect(lead.z).toBeLessThan(shoe.z);
      expect(bottom.top).toBeLessThanOrEqual(50);
      const overlap = lead.top + lead.w - bottom.top;
      expect(overlap).toBeGreaterThanOrEqual(bottom.w * 0.08);
      expect(overlap).toBeLessThanOrEqual(bottom.w * 0.32);
      const trouserArea = bottom.w * bottom.w;
      expect(overlapArea(shoe, bottom) / trouserArea).toBeLessThanOrEqual(0.35);
      const leadOnTrouser = overlapArea(lead, bottom);
      const shoeOnTrouser = overlapArea(shoe, bottom);
      const both = overlapArea(
        {
          left: Math.max(lead.left, shoe.left),
          top: Math.max(lead.top, shoe.top),
          w: Math.max(
            0,
            Math.min(lead.left + lead.w, shoe.left + shoe.w) - Math.max(lead.left, shoe.left),
          ),
        },
        bottom,
      );
      // The intersection box above uses w for both axes; only count it when the
      // lead and the shoes actually meet. Otherwise both is zero.
      const leadShoeMeet =
        lead.top + lead.w > shoe.top && shoe.top + shoe.w > lead.top;
      const covered = leadOnTrouser + shoeOnTrouser - (leadShoeMeet ? both : 0);
      expect((trouserArea - covered) / trouserArea).toBeGreaterThanOrEqual(0.55);
      for (const n of [1, 2, 3]) {
        expect(flatLayBox("outerwear", n, jit, "out").z).toBeLessThan(lead.z);
      }
    }
    const lead = flatLayBox("top", 1, 0, "out");
    const second = flatLayBox("top", 2, 0.4, "out");
    expect(second.z).toBe(lead.z - 1);
    expect(second.left).toBe(lead.left + 4);
    expect(second.top).toBe(lead.top + 3);
    expect(second.w).toBeLessThanOrEqual(lead.w);
  });
});

describe("FlatLay markup", () => {
  const sweater = piece({
    id: "knit",
    name: "Grey knit sweater",
    category: "top",
    subtype: "sweater",
  });
  const shirt = piece({ id: "shirt", name: "Red gingham shirt", category: "top", subtype: "shirt" });
  const trousers = piece({
    id: "pants",
    name: "Charcoal trousers",
    category: "bottom",
    subtype: "trousers",
  });
  const shoes = piece({ id: "shoes", name: "Brown loafers", category: "footwear", subtype: "loafers" });

  function order(pieces: Garment[], markup: string) {
    const z = zOfPieces(markup);
    const leadAt = pieces.findIndex((g) => g.id === (leadTop(pieces)?.id ?? ""));
    const bottomAt = pieces.findIndex((g) => slotOf(g) === "bottom");
    return { lead: z[leadAt] ?? Number.NaN, bottom: z[bottomAt] ?? Number.NaN };
  }

  it("draws a sweater or a shirt over the trousers only when tuck is out", () => {
    for (const lead of [sweater, shirt]) {
      const pieces = [lead, trousers, shoes];
      const out = renderToStaticMarkup(
        <FlatLay pieces={pieces} tuck="out" leadId={lead.id} />,
      );
      const inn = renderToStaticMarkup(
        <FlatLay pieces={pieces} tuck="in" leadId={lead.id} />,
      );
      const plain = renderToStaticMarkup(<FlatLay pieces={pieces} />);
      const none = renderToStaticMarkup(
        <FlatLay pieces={pieces} tuck="none" leadId={lead.id} />,
      );
      expect(order(pieces, out).lead).toBeGreaterThan(order(pieces, out).bottom);
      expect(order(pieces, inn).bottom).toBeGreaterThan(order(pieces, inn).lead);
      expect(inn).toBe(plain);
      expect(none).toBe(plain);
    }
  });
});

describe("plate and label", () => {
  const byId = new Map(liveSnapshot.map((g) => [g.id, g]));

  it("says untucked exactly when the plate draws the hem out, and never tucked on a knit", () => {
    pinDay(PIN);
    const knitIn: string[] = [];
    for (const hero of liveSnapshot) {
      if (hero.archived) continue;
      const looks = looksForHero(hero, liveSnapshot, { today: PIN });
      for (const look of looks) {
        const pieces = look.garmentIds
          .map((id) => byId.get(id))
          .filter((g): g is Garment => Boolean(g));
        const again = lookTuckDecision(pieces, look.occasion, []);
        const cloned = lookTuckDecision(structuredClone(pieces), look.occasion, []);
        expect(again).toBe(cloned);
        expect(lookTuckDecision(pieces, look.occasion, [])).toBe(again);
        const lead = leadTop(pieces);
        const markup = renderToStaticMarkup(
          <HeroLookCard pieces={pieces} name={look.name} occasion={look.occasion} />,
        );
        const caption = captionOf(markup);
        const z = zOfPieces(markup);
        const leadAt = lead ? pieces.findIndex((g) => g.id === lead.id) : -1;
        const bottomAt = pieces.findIndex((g) => slotOf(g) === "bottom");
        const drawnOut =
          leadAt >= 0 && bottomAt >= 0 && (z[leadAt] ?? 0) > (z[bottomAt] ?? 0);
        const saysUntucked = /\buntucked\b/.test(caption);
        expect(saysUntucked, look.id).toBe(drawnOut);
        if (again === "in" && lead && isKnitTop(lead)) {
          knitIn.push(lead.id);
          expect(caption, lead.name).not.toMatch(/\btucked\b/);
          expect(caption, lead.name).not.toMatch(/\buntucked\b/);
        }
        if (again === "in" && tuckMark(again, lead) === "tucked") {
          expect(caption).toMatch(/\btucked\b/);
          expect(caption).not.toMatch(/\buntucked\b/);
        }
        if (again === "in" && tuckMark(again, lead) !== "tucked") {
          expect(caption, lead?.name).not.toMatch(/\btucked\b/);
        }
        if (again === "none") {
          expect(caption).not.toMatch(/\buntucked\b/);
          expect(caption).not.toMatch(/\btucked\b/);
        }
      }
    }
    expect(knitIn.length).toBeGreaterThan(0);
  });

  it("a knit that resolves in shows no tuck word on the card", () => {
    const knit = piece({
      id: "half",
      name: "Cream ribbed half-zip sweater",
      category: "top",
      subtype: "half-zip sweater",
      tuck: "either",
    });
    const trousers = piece({
      id: "pants",
      name: "Charcoal trousers",
      category: "bottom",
      subtype: "trousers",
    });
    const shoes = piece({ id: "shoes", name: "Brown loafers", category: "footwear", subtype: "loafers" });
    const pieces = [knit, trousers, shoes];
    expect(lookTuckDecision(pieces, "weekday")).toBe("in");
    expect(tuckMark("in", knit)).toBeNull();
    const markup = renderToStaticMarkup(
      <HeroLookCard pieces={pieces} name="Weekday knit" occasion="weekday" />,
    );
    expect(captionOf(markup)).toBe("weekday");
    expect(markup).not.toMatch(/\btucked\b/);
    expect(markup).not.toMatch(/\buntucked\b/);
    const out = renderToStaticMarkup(
      <HeroLookCard pieces={pieces} name="Weekend knit" occasion="weekend" />,
    );
    expect(captionOf(out)).toBe("weekend · untucked");
  });
});

describe("selection is unchanged", () => {
  const byId = new Map(liveSnapshot.map((g) => [g.id, g]));

  it("looksForHero and buildWeek match the pinned base on both dates", () => {
    expect(liveSnapshot.length).toBe(selection.pieceCount);
    for (const [key, expected] of Object.entries(selection.heroes)) {
      const splitAt = key.lastIndexOf("|");
      const id = key.slice(0, splitAt);
      const today = key.slice(splitAt + 1);
      const hero = byId.get(id);
      expect(hero, id).toBeTruthy();
      pinDay(today);
      const looks = looksForHero(hero!, liveSnapshot, { today }).map((look) => ({
        garmentIds: look.garmentIds,
        occasion: look.occasion,
      }));
      expect(looks, key).toEqual(expected);
    }
    pinDay(PIN);
    const week = buildWeek(liveSnapshot, PIN).map((look) => ({
      garmentIds: look.garmentIds,
      occasion: look.occasion,
    }));
    expect(week).toEqual(selection.week);
  });
});

describe("On You parity", () => {
  const byId = new Map(liveSnapshot.map((g) => [g.id, g]));

  it("a shirt lead's out line matches tuckDressingLines, and the lines hash to the base", () => {
    pinDay(PIN);
    const lines: string[] = [];
    const heroes = liveSnapshot
      .filter((g) => !g.archived && isShirtLike(g))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(heroes.length).toBeGreaterThan(0);
    for (const hero of heroes) {
      for (const look of looksForHero(hero, liveSnapshot, { today: PIN })) {
        const pieces = look.garmentIds
          .map((id) => byId.get(id))
          .filter((g): g is Garment => Boolean(g));
        const lead = leadTop(pieces);
        if (!lead || !isShirtLike(lead)) continue;
        const line = tuckDressingLines(pieces, look.occasion as Occasion, []);
        const decision = lookTuckDecision(pieces, look.occasion, []);
        expect(line.includes(`UNTUCKED (${lead.name})`), `${hero.id} ${look.occasion}`).toBe(
          decision === "out",
        );
        lines.push(`${hero.id}|${look.occasion}|${look.garmentIds.join(",")}|${line}`);
      }
    }
    expect(lines.length).toBeGreaterThan(0);
    expect(createHash("sha256").update(lines.join("\n")).digest("hex")).toBe(PARITY_HASH);
  });

  it("On You still asks tuckDressingLines and does not learn knits", () => {
    const onMe = readFileSync(new URL("../components/closet/on-me.tsx", import.meta.url), "utf8");
    const tuck = readFileSync(new URL("./tuck.ts", import.meta.url), "utf8");
    expect(onMe).toContain(
      "tuckDressingLines(worn, occasion, tuckHabitIds(useCloset.getState().taste ?? emptyTaste()))",
    );
    expect(onMe).not.toContain("lookTuckDecision");
    expect(onMe).not.toContain("isKnitTop");
    const dressing = tuck.slice(tuck.indexOf("export function tuckDressingLines"), tuck.indexOf("export function onlyTopIsUntucked"));
    expect(dressing).toContain("if (!isShirtLike(g)) continue;");
    expect(dressing).toContain("Wear THIS shirt UNTUCKED (${g.name})");
  });
});

describe("tuck chip", () => {
  it("outlines the guess when tuck is unset, and fills a saved untucked", () => {
    const unset = piece({ id: "g_unset", name: "Navy oxford", category: "top", subtype: "oxford" });
    const saved = piece({
      id: "g_saved",
      name: "Navy oxford",
      category: "top",
      subtype: "oxford",
      tuck: "out",
    });
    const open = renderToStaticMarkup(<GarmentDetailSheet garment={unset} onClose={() => {}} />);
    const shut = renderToStaticMarkup(<GarmentDetailSheet garment={saved} onClose={() => {}} />);
    const buttons = (markup: string) =>
      (markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).filter((b) =>
        /Tucked|Untucked|Either/.test(b),
      );
    const openButtons = buttons(open);
    const shutButtons = buttons(shut);
    expect(openButtons.filter((b) => b.includes("(guess)")).length).toBe(1);
    expect(openButtons.some((b) => b.includes("bg-ink"))).toBe(false);
    expect(openButtons.some((b) => b.includes("Tucked (guess)"))).toBe(true);
    const filled = shutButtons.find((b) => b.includes("bg-ink"));
    expect(filled).toContain(">Untucked<");
    expect(shutButtons.some((b) => b.includes("(guess)"))).toBe(false);
    expect(open).toContain("An oxford tucks in. A camp collar stays out.");
    expect(shut).toContain("An oxford tucks in. A camp collar stays out.");
  });

  it("tapping a chip writes that tuck through updateGarment", () => {
    const src = readFileSync(new URL("../components/closet/detail.tsx", import.meta.url), "utf8");
    expect(src).toContain("onClick={() => write({ tuck: id })}");
    expect(src).toMatch(/const write = \(patch: Partial<Garment>\) => \{\s*updateGarment\(garment\.id, patch\);/);
  });
});

describe("label wiring", () => {
  it("Today, the look sheet, and the lookbook use the same decision and leave spreadTitle alone", () => {
    const today = readFileSync(new URL("../routes/index.tsx", import.meta.url), "utf8");
    const book = readFileSync(new URL("../routes/lookbook.tsx", import.meta.url), "utf8");
    const sheet = readFileSync(new URL("../components/closet/look-sheet.tsx", import.meta.url), "utf8");
    expect(today).toContain("lookTuckDecision(shown, occasion, habits)");
    expect(today).toContain("<TuckNote d={todayTuck} lead={leadTop(shown)}");
    expect(today).not.toContain("FlatLay");
    expect(sheet).toContain("lookTuckDecision(activePieces, look.occasion, habits)");
    expect(sheet).toContain("{tuckText ? ` · ${tuckText}` : \"\"}");
    expect(book.match(/spreadTitle\(pieces, look\.occasion/g)?.length).toBe(2);
    expect(book).toContain("lookTuckDecision(pieces, look.occasion, habits)");
    expect(book).toContain("<TuckNote d={tuckDecision} lead={leadTop(pieces)}");
    const titleAt = book.indexOf("spreadTitle(pieces, look.occasion");
    const lineAt = book.indexOf("{cardTag(wayTitle, occasionLabel, seasonLabel)}");
    expect(book.slice(titleAt, lineAt)).toContain("<TuckNote");
  });
});

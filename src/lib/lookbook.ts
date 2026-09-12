import { harmony } from "./color.ts";
import { daysIdle, housesOf, slotOf } from "./style.ts";
import type { Garment, Look } from "./types.ts";
import { todayISO } from "./utils.ts";

const CAP = 48;
const PER = 2;
const PARTNER_K = 4;
const LOUD =
  /\b(plaid|checks?|gingham|stripes?|striped|floral|print|printed|houndstooth|paisley|camo|leopard|argyle)\b/i;

export function lookbookPool(garments: Garment[]): Garment[] {
  const real = garments.filter((g) => !g.archived && !g.demo);
  return real.length ? real : garments.filter((g) => !g.archived);
}

function bySlot(pool: Garment[], slot: "top" | "bottom" | "footwear" | "outerwear" | "dress") {
  return pool.filter((g) => slotOf(g) === slot);
}

function loud(g: Garment): boolean {
  return LOUD.test(`${g.name} ${g.subtype} ${g.notes}`);
}

function clashes(pieces: Garment[]): boolean {
  return pieces.filter(loud).length >= 2;
}

function pieceScore(g: Garment, today: string): number {
  let s = Math.min(daysIdle(g, today), 90) / 10;
  if (g.wornOn.at(-1) === today) s -= 6;
  return s;
}

function comboScore(pieces: Garment[], today: string): number {
  let s = 0;
  const forms = pieces.map((p) => p.formality);
  const spread = Math.max(...forms) - Math.min(...forms);
  s += 4 - Math.min(spread, 4);
  for (const g of pieces) s += pieceScore(g, today);
  const houseLists = pieces.map((p) => housesOf(p));
  const shared = houseLists.reduce((acc, hs) => acc.filter((h) => hs.includes(h)));
  if (shared.length) s += 1.5;
  s += harmony(pieces);
  return s;
}

function rank(list: Garment[], today: string): Garment[] {
  return [...list].sort((a, b) => {
    const d = pieceScore(b, today) - pieceScore(a, today);
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });
}

function occasionOf(pieces: Garment[]): string {
  const avg = pieces.reduce((n, g) => n + g.formality, 0) / pieces.length;
  if (avg >= 4) return "client";
  if (avg <= 2) return "weekend";
  return "weekday";
}

const NAME_ORDER = ["top", "dress", "bottom", "outerwear", "footwear", "accessory"];

function nameOf(pieces: Garment[]): string {
  return [...pieces]
    .sort((a, b) => {
      const sa = NAME_ORDER.indexOf(slotOf(a) ?? a.category);
      const sb = NAME_ORDER.indexOf(slotOf(b) ?? b.category);
      return (sa < 0 ? 99 : sa) - (sb < 0 ? 99 : sb);
    })
    .map((g) => g.name)
    .join(" · ");
}

function lookId(ids: string[]): string {
  return `lb_${ids.join("_")}`;
}

function shouldOuter(outer: Garment, core: Garment[]): boolean {
  const blob = `${outer.subtype} ${outer.name}`.toLowerCase();
  if (/overcoat|topcoat|coat\b/.test(blob)) return true;
  if (outer.warmth >= 4) return true;
  const avg = core.reduce((n, g) => n + g.formality, 0) / core.length;
  return outer.warmth >= 3 && Math.abs(outer.formality - avg) <= 1;
}

function attachOuter(core: Garment[], outers: Garment[], today: string): Garment[] {
  const ranked = rank(outers, today);
  for (const o of ranked) {
    if (core.some((g) => g.id === o.id)) continue;
    if (!shouldOuter(o, core)) continue;
    const next = [...core, o];
    if (clashes(next)) continue;
    return next;
  }
  return core;
}

/**
 * Best looks from this closet — not every combo.
 * A look is top + bottom + footwear. Outerwear only when it scores.
 * Cap 48. Every slotted top/bottom/shoe appears at least once (twice if partners exist).
 */
export function buildLookbook(garments: Garment[], today = todayISO()): Look[] {
  const pool = lookbookPool(garments);
  const tops = [...bySlot(pool, "top"), ...bySlot(pool, "dress")];
  const bottoms = bySlot(pool, "bottom");
  const shoes = bySlot(pool, "footwear");
  const outers = bySlot(pool, "outerwear");
  if (!tops.length || !bottoms.length || !shoes.length) return [];

  const todayWorn = today;
  const used = new Set<string>();
  const count = new Map<string, number>();
  const drafts: Look[] = [];

  const bump = (ids: string[]) => {
    for (const id of ids) count.set(id, (count.get(id) ?? 0) + 1);
  };

  const tryAdd = (core: Garment[]): boolean => {
    if (core.length < 3) return false;
    if (clashes(core)) return false;
    const pieces = attachOuter(core, outers, todayWorn);
    const ids = pieces.map((g) => g.id);
    const key = lookId(ids);
    if (used.has(key)) return false;
    if (drafts.length >= CAP) return false;
    used.add(key);
    drafts.push({
      id: key,
      name: nameOf(pieces),
      occasion: occasionOf(pieces),
      garmentIds: ids,
      source: "ai",
      lookbook: true,
      createdAt: `${todayWorn}T00:00:00.000Z`,
    });
    bump(ids);
    return true;
  };

  const partnersFor = (focus: Garment): Garment[][] => {
    const slot = slotOf(focus);
    const tCands = slot === "top" || slot === "dress" ? [focus] : rank(tops, todayWorn).slice(0, PARTNER_K);
    const bCands = slot === "bottom" ? [focus] : rank(bottoms, todayWorn).slice(0, PARTNER_K);
    const fCands = slot === "footwear" ? [focus] : rank(shoes, todayWorn).slice(0, PARTNER_K);
    const scored: { core: Garment[]; s: number; h: number }[] = [];
    for (const t of tCands) {
      for (const b of bCands) {
        for (const f of fCands) {
          if (new Set([t.id, b.id, f.id]).size < 3) continue;
          const core = [t, b, f];
          if (clashes(core)) continue;
          const h = harmony(core);
          const uncovered = core.filter((g) => (count.get(g.id) ?? 0) === 0).length;
          scored.push({ core, s: comboScore(core, todayWorn) + uncovered * 3, h });
        }
      }
    }
    scored.sort((a, b) => (b.s !== a.s ? b.s - a.s : lookId(a.core.map((g) => g.id)).localeCompare(lookId(b.core.map((g) => g.id)))));
    const good = scored.filter((x) => x.h >= 0);
    return (good.length ? good : scored).map((x) => x.core);
  };

  const slotted = [...tops, ...bottoms, ...shoes];
  const cover = (need: number) => {
    for (const g of rank(slotted, todayWorn)) {
      if (drafts.length >= CAP) break;
      if ((count.get(g.id) ?? 0) >= need) continue;
      for (const core of partnersFor(g)) {
        if ((count.get(g.id) ?? 0) >= need) break;
        tryAdd(core);
      }
    }
  };

  cover(1);
  cover(PER);

  return drafts;
}

export function lookbookStats(
  looks: Look[],
  garments: Garment[],
): { looks: number; pieces: number; everyPieceUsed: boolean } {
  const pool = lookbookPool(garments);
  const slotted = pool.filter((g) => {
    const s = slotOf(g);
    return s === "top" || s === "bottom" || s === "footwear" || s === "dress";
  });
  const used = new Set(looks.flatMap((l) => l.garmentIds));
  return {
    looks: looks.length,
    pieces: slotted.length,
    everyPieceUsed: slotted.length > 0 && slotted.every((g) => used.has(g.id)),
  };
}

export function mergeLookbook(existing: Look[], book: Look[]): Look[] {
  const kept = existing.filter((l) => !l.lookbook);
  return [...kept, ...book];
}

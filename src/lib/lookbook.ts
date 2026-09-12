import { harmony } from "./color.ts";
import { daysIdle, housesOf, slotOf } from "./style.ts";
import type { Garment, Look } from "./types.ts";
import { todayISO } from "./utils.ts";

const CAP = 96;
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

function hashSalt(id: string, salt: number): number {
  let h = salt >>> 0;
  for (const c of id) h = (Math.imul(h, 33) + c.charCodeAt(0)) >>> 0;
  return h;
}

function rank(list: Garment[], today: string, salt = 0): Garment[] {
  return [...list].sort((a, b) => {
    const d = pieceScore(b, today) - pieceScore(a, today);
    if (d !== 0 && salt === 0) return d;
    return hashSalt(a.id, salt) - hashSalt(b.id, salt) || a.id.localeCompare(b.id);
  });
}

function rotate<T>(list: T[], salt: number): T[] {
  if (list.length < 2) return list;
  const n = salt % list.length;
  return [...list.slice(n), ...list.slice(0, n)];
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
 * cover(1) places every slotted top, bottom, shoe, and outer once (no cap).
 * Then cover(2) up to CAP. Harmony cannot exile a piece from cover(1).
 */
export function buildLookbook(
  garments: Garment[],
  today = todayISO(),
  salt = 0,
): Look[] {
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

  const tryAdd = (core: Garment[], mustCover = false): boolean => {
    if (core.length < 3) return false;
    if (!mustCover && clashes(core)) return false;
    const hasOuter = core.some((g) => slotOf(g) === "outerwear");
    const pieces = hasOuter ? core : attachOuter(core, outers, todayWorn);
    const ids = pieces.map((g) => g.id);
    const key = lookId(ids);
    if (used.has(key)) return false;
    if (!mustCover && drafts.length >= CAP) return false;
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

  const partnersFor = (focus: Garment, mustCover: boolean): Garment[][] => {
    const slot = slotOf(focus);
    const tAll = slot === "top" || slot === "dress" ? [focus] : rank(tops, todayWorn, salt);
    const bAll = slot === "bottom" ? [focus] : rank(bottoms, todayWorn, salt);
    const fAll = slot === "footwear" ? [focus] : rank(shoes, todayWorn, salt);
    const tCands = mustCover ? tAll : tAll.slice(0, PARTNER_K);
    const bCands = mustCover ? bAll : bAll.slice(0, PARTNER_K);
    const fCands = mustCover ? fAll : fAll.slice(0, PARTNER_K);
    const scored: { core: Garment[]; s: number; h: number }[] = [];
    for (const t of tCands) {
      for (const b of bCands) {
        for (const f of fCands) {
          if (new Set([t.id, b.id, f.id]).size < 3) continue;
          let core: Garment[] = [t, b, f];
          if (slot === "outerwear") core = [...core, focus];
          if (!mustCover && clashes(core)) continue;
          const h = harmony(core);
          const uncovered = core.filter((g) => (count.get(g.id) ?? 0) === 0).length;
          scored.push({ core, s: comboScore(core, todayWorn) + uncovered * 3, h });
        }
      }
    }
    scored.sort((a, b) =>
      b.s !== a.s
        ? b.s - a.s
        : lookId(a.core.map((g) => g.id)).localeCompare(lookId(b.core.map((g) => g.id))),
    );
    if (mustCover) return scored.map((x) => x.core);
    const good = scored.filter((x) => x.h >= 0);
    return (good.length ? good : scored).map((x) => x.core);
  };

  const cover = (need: number, slotted: Garment[], mustCover: boolean) => {
    for (const g of rank(slotted, todayWorn, salt)) {
      if (!mustCover && drafts.length >= CAP) break;
      if ((count.get(g.id) ?? 0) >= need) continue;
      for (const core of partnersFor(g, mustCover)) {
        if ((count.get(g.id) ?? 0) >= need) break;
        tryAdd(core, mustCover);
      }
    }
  };

  const mustSlot = [...tops, ...bottoms, ...shoes, ...outers];
  cover(1, mustSlot, true);
  cover(PER, mustSlot, false);

  // Force: every leftover slotted piece gets a look. Clash is better than invisible.
  let forceSalt = salt + 1;
  for (const g of mustSlot) {
    if ((count.get(g.id) ?? 0) >= 1) continue;
    const slot = slotOf(g);
    if (!slot) continue;
    const Ts = rotate(slot === "top" || slot === "dress" ? [g] : tops.filter((x) => x.id !== g.id), forceSalt);
    const Bs = rotate(slot === "bottom" ? [g] : bottoms.filter((x) => x.id !== g.id), forceSalt + 3);
    const Fs = rotate(slot === "footwear" ? [g] : shoes.filter((x) => x.id !== g.id), forceSalt + 7);
    forceSalt += 11;
    if (!Ts.length || !Bs.length || !Fs.length) continue;
    let placed = false;
    outer: for (const t of Ts) {
      for (const b of Bs) {
        for (const f of Fs) {
          if (new Set([t.id, b.id, f.id]).size < 3) continue;
          const core = slot === "outerwear" ? [t, b, f, g] : [t, b, f];
          if (tryAdd(core, true)) {
            placed = true;
            break outer;
          }
        }
      }
    }
    void placed;
  }

  return drafts;
}

/** Two looks starring this piece — unused-rail tap. */
export function forceLooksForPiece(
  garmentId: string,
  garments: Garment[],
  n = 2,
): Look[] {
  const looks = buildLookbook(garments);
  return looks.filter((l) => l.garmentIds.includes(garmentId)).slice(0, n);
}

export function lookFitsOccasion(pieces: Garment[], occ: string): boolean {
  if (occ === "all") return true;
  const blob = pieces.map((g) => `${g.subtype} ${g.name}`).join(" ").toLowerCase();
  if (occ === "dinner") {
    if (/gym|runner|running|athletic/.test(blob)) return false;
    if (/\bsneakers?\b/.test(blob) && !/loafer/.test(blob)) return false;
    return true;
  }
  if (occ === "client") {
    if (/hoodie|\btee\b|t-shirt/.test(blob)) return false;
    return true;
  }
  return true;
}

export function lookHasColor(pieces: Garment[], color: string): boolean {
  const want = color.toLowerCase();
  return pieces.some((g) => g.colors.some((c) => c.toLowerCase() === want));
}

export function lookbookStats(
  looks: Look[],
  garments: Garment[],
): {
  looks: number;
  used: number;
  total: number;
  unusedNames: string[];
  everyPieceUsed: boolean;
} {
  const pool = lookbookPool(garments);
  const slotted = pool.filter((g) => {
    const s = slotOf(g);
    return s === "top" || s === "bottom" || s === "footwear" || s === "dress" || s === "outerwear";
  });
  const usedIds = new Set(looks.flatMap((l) => l.garmentIds));
  const unused = slotted.filter((g) => !usedIds.has(g.id));
  const used = slotted.filter((g) => usedIds.has(g.id)).length;
  return {
    looks: looks.length,
    used,
    total: pool.length,
    unusedNames: unused.map((g) => g.name),
    everyPieceUsed: slotted.length > 0 && unused.length === 0,
  };
}

export function mergeLookbook(existing: Look[], book: Look[]): Look[] {
  // Auto builder ids are lb_*. Stylist/manual lookbook cards must survive a rebuild.
  const kept = existing.filter((l) => !l.lookbook || !l.id.startsWith("lb_"));
  const keys = new Set(kept.map((l) => [...l.garmentIds].sort().join("|")));
  const extra = book.filter((b) => !keys.has([...b.garmentIds].sort().join("|")));
  return [...kept, ...extra];
}

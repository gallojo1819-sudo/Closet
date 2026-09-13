import { canonicalize, harmony } from "./color.ts";
import {
  daysIdle,
  housesOf,
  isCampCollar,
  isFairIsle,
  isGraphic,
  isHoodiePiece,
  leadHouse,
  lookHouses,
  pickLook,
  slotOf,
} from "./style.ts";
import { onlyTopIsUntucked } from "./tuck.ts";
import type { Garment, Look, Occasion } from "./types.ts";
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
  return LOUD.test(`${g.name} ${g.subtype} ${g.notes}`) || isGraphic(g);
}

function blobOf(g: Garment): string {
  return `${g.subtype} ${g.name}`.toLowerCase();
}

function isJeanOrChino(g: Garment): boolean {
  return /\b(chinos?|jeans?|denim)\b/.test(blobOf(g));
}

function isSneaker(g: Garment): boolean {
  return /sneaker|trainer|\b990\b/.test(blobOf(g));
}

function isLoaferOrMule(g: Garment): boolean {
  return /loafer|mule/.test(blobOf(g));
}

function isPleatedOrTrouser(g: Garment): boolean {
  const b = blobOf(g);
  if (isJeanOrChino(g)) return false;
  return /pleat|trouser/.test(b);
}

function isOxfordPiece(g: Garment): boolean {
  return /oxford/.test(blobOf(g)) && slotOf(g) === "top";
}

function isDressKnit(g: Garment): boolean {
  const b = blobOf(g);
  if (isGraphic(g)) return false;
  return /knit|sweater|merino|cable/.test(b) && (/burgundy|wine|dress|cable|merino/.test(b) || g.formality >= 3);
}

function isLayerTop(g: Garment): boolean {
  const s = slotOf(g);
  return s === "top" || s === "dress";
}

/** Graphic top + Italian/Ralph leather is costume. Two loud graphics don't share a look. */
export function lookClashes(pieces: Garment[]): boolean {
  if (pieces.filter(loud).length >= 2) return true;
  if (pieces.filter(isGraphic).length >= 2) return true;
  const camps = pieces.filter(isCampCollar);
  if (camps.length && pieces.filter(isLayerTop).length > 1) return true;
  const graphic = pieces.find(isGraphic);
  if (!graphic) return false;
  const rest = pieces.filter((g) => g.id !== graphic.id);
  if (rest.some(isLoaferOrMule)) return true;
  if (rest.some(isPleatedOrTrouser)) return true;
  if (rest.some(isOxfordPiece)) return true;
  if (rest.some(isCampCollar)) return true;
  if (rest.some(isFairIsle)) return true;
  if (rest.some(isDressKnit)) return true;
  return false;
}

function graphicPartnersOk(bottom: Garment, shoe: Garment): boolean {
  return isJeanOrChino(bottom) && isSneaker(shoe);
}

function clashes(pieces: Garment[]): boolean {
  return lookClashes(pieces);
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
  const lead = leadHouse(pieces);
  const houseLists = pieces.map((p) => housesOf(p));
  const shared = houseLists.reduce((acc, hs) => acc.filter((h) => hs.includes(h)));
  if (shared.length) s += 1.5;
  s += pieces.filter((g) => housesOf(g).includes(lead)).length * 0.4;
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
  if (lookFitsOccasion(pieces, "dinner")) return "dinner";
  if (lookFitsOccasion(pieces, "client")) return "client";
  if (lookFitsOccasion(pieces, "weekday")) return "weekday";
  if (lookFitsOccasion(pieces, "travel")) return "travel";
  if (lookFitsOccasion(pieces, "weekend")) return "weekend";
  if (pieces.some(isGraphic) || pieces.some(isHoodiePiece)) return "weekend";
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
  return `lb2_${ids.join("_")}`;
}

function shouldOuter(outer: Garment, core: Garment[]): boolean {
  const blob = `${outer.subtype} ${outer.name}`.toLowerCase();
  if (/overcoat|topcoat|coat\b/.test(blob)) return true;
  if (outer.warmth >= 4) return true;
  const avg = core.reduce((n, g) => n + g.formality, 0) / core.length;
  return outer.warmth >= 3 && Math.abs(outer.formality - avg) <= 1;
}

function attachOuter(core: Garment[], outers: Garment[], today: string): Garment[] {
  if (core.some(isGraphic)) return core;
  const ranked = rank(outers, today);
  for (const o of ranked) {
    if (core.some((g) => g.id === o.id)) continue;
    if (slotOf(o) !== "outerwear") continue;
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
    if (clashes(core)) return false;
    void mustCover;
    const hasOuter = core.some((g) => slotOf(g) === "outerwear");
    const pieces = hasOuter ? core : attachOuter(core, outers, todayWorn);
    if (clashes(pieces)) return false;
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
          if (isGraphic(t) && !graphicPartnersOk(b, f)) continue;
          let core: Garment[] = [t, b, f];
          if (slot === "outerwear") core = [...core, focus];
          if (clashes(core)) continue;
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
          if (isGraphic(t) && !graphicPartnersOk(b, f)) continue;
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

function pieceBlob(g: Garment): string {
  return `${g.subtype} ${g.name} ${g.notes ?? ""}`.toLowerCase();
}

function lookBlob(pieces: Garment[]): string {
  return pieces.map(pieceBlob).join(" ");
}

function topsOf(pieces: Garment[]): Garment[] {
  return pieces.filter((g) => {
    const s = slotOf(g);
    return s === "top" || s === "dress";
  });
}

function bottomsOf(pieces: Garment[]): Garment[] {
  return pieces.filter((g) => slotOf(g) === "bottom");
}

function shoesOf(pieces: Garment[]): Garment[] {
  return pieces.filter((g) => slotOf(g) === "footwear");
}

function hasKind(list: Garment[], re: RegExp): boolean {
  return list.some((g) => re.test(pieceBlob(g)));
}

export function lookFitsOccasion(pieces: Garment[], occ: string): boolean {
  if (occ === "all") return true;
  const blob = lookBlob(pieces);
  const tops = topsOf(pieces);
  const bottoms = bottomsOf(pieces);
  const shoes = shoesOf(pieces);
  const graphic = pieces.some(isGraphic);
  const hoodie = pieces.some(isHoodiePiece);
  const sneaker = hasKind(shoes, /sneaker|trainer|\b990\b|gym|runner|running|athletic/);
  const loafer = hasKind(shoes, /loafer/);
  const mule = hasKind(shoes, /mule/);
  const trouser = hasKind(bottoms, /trouser/) && !hasKind(bottoms, /\bjeans?\b|denim/);
  const chino = hasKind(bottoms, /chino/);
  const jean = hasKind(bottoms, /\bjeans?\b|denim/);
  const cargo = /cargo/.test(blob);
  const tee = hasKind(tops, /\btee\b|t-shirt/);
  const rugby = /rugby/.test(blob);
  const oxford = hasKind(tops, /oxford/);
  const polo = hasKind(tops, /polo/);
  const cable = hasKind(tops, /cable/);
  const fineKnit = hasKind(tops, /merino|cashmere|silk|fine/) && hasKind(tops, /knit|sweater/);
  const blazer = pieces.some((g) => /blazer/.test(pieceBlob(g)));
  const knit = hasKind(tops, /knit|sweater|merino|cable/) && !hoodie;
  const overshirt = pieces.some((g) => /overshirt/.test(pieceBlob(g)));
  const fairIsle = pieces.some(isFairIsle);
  const distressed = /distress|ripped|destroyed/.test(blob);

  if (occ === "client") {
    if (onlyTopIsUntucked(pieces)) return false;
    if (hoodie || graphic || rugby || /90s|90's/.test(blob)) return false;
    if (sneaker) return false;
    if (cargo || distressed) return false;
    if (jean && distressed) return false;
    if (!(oxford || polo || fineKnit || blazer)) return false;
    if (!(trouser || chino)) return false;
    if (jean && !chino && !trouser) return false;
    if (!loafer && !hasKind(shoes, /derby|monk|dress\s*shoe/)) return false;
    if (mule && !loafer) return false;
    return true;
  }

  if (occ === "dinner") {
    if (onlyTopIsUntucked(pieces)) return false;
    if (sneaker || hoodie || graphic || cargo || tee) return false;
    if (jean) return false;
    if (!trouser) return false;
    if (!loafer && !mule) return false;
    const lead = leadHouse(pieces);
    if (lead !== "ralph" && lead !== "faloni") return false;
    return true;
  }

  if (occ === "weekday") {
    if (hoodie || graphic) return false;
    if (sneaker) return false;
    if (!(oxford || polo || cable)) return false;
    if (!(chino || trouser)) return false;
    if (!loafer) return false;
    return true;
  }

  if (occ === "weekend") {
    if ((hoodie || graphic) && !((jean || chino) && sneaker)) return false;
    const tuxedo = oxford && trouser && loafer && !jean && !rugby && !fairIsle && !hoodie;
    if (tuxedo) return false;
    return jean || rugby || fairIsle || sneaker || hoodie;
  }

  if (occ === "travel") {
    if (!(knit || overshirt)) return false;
    if (!(chino || jean)) return false;
    if (!(sneaker || loafer)) return false;
    if (trouser && loafer && !knit && !overshirt && !jean && !chino) return false;
    return true;
  }

  return true;
}

/**
 * Extra looks for one occasion until `min` or the rack is exhausted.
 * Tagged with that occasion. HIS plates only.
 */
export function fillOccasionLooks(
  garments: Garment[],
  looks: Look[],
  occasion: Occasion,
  min = 6,
): Look[] {
  const pool = lookbookPool(garments);
  const byId = new Map(pool.map((g) => [g.id, g]));
  const fitting = looks.filter((l) => {
    if (l.occasion === occasion) {
      const pieces = l.garmentIds
        .map((id) => byId.get(id))
        .filter((g): g is Garment => Boolean(g));
      return pieces.length >= 3 && lookFitsOccasion(pieces, occasion);
    }
    return false;
  });
  const keys = new Set(fitting.map((l) => [...l.garmentIds].sort().join("|")));
  const extra: Look[] = [];
  let prev: string[] = fitting.at(-1)?.garmentIds ?? [];
  const weather =
    occasion === "dinner"
      ? { f: 62, label: "Mild", code: 2 }
      : occasion === "weekend" || occasion === "travel"
        ? { f: 72, label: "Fair", code: 2 }
        : { f: 68, label: "Fair", code: 2 };
  for (let i = 0; i < 40 && fitting.length + extra.length < min; i++) {
    const ids = pickLook(pool, {
      occasion,
      moment: "day",
      weather,
      previousIds: prev,
    });
    if (ids.length < 3) break;
    prev = ids;
    const pieces = ids.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
    if (pieces.length < 3) continue;
    if (!lookFitsOccasion(pieces, occasion)) continue;
    const key = [...ids].sort().join("|");
    if (keys.has(key)) continue;
    keys.add(key);
    extra.push({
      id: `lb2_${occasion}_${ids.join("_")}`,
      name: nameOf(pieces),
      occasion,
      garmentIds: ids,
      source: "ai",
      lookbook: true,
      createdAt: `${todayISO()}T00:00:00.000Z`,
    });
  }
  return extra;
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

export function mergeLookbook(
  existing: Look[],
  book: Look[],
  garments: Garment[] = [],
): Look[] {
  const byId = new Map(garments.map((g) => [g.id, g]));
  const valid = (l: Look) => {
    if (!garments.length) return true;
    const pieces = l.garmentIds
      .map((id) => byId.get(id))
      .filter((g): g is Garment => Boolean(g));
    if (pieces.length < 2) return true;
    return !lookClashes(pieces);
  };
  // Auto builder ids are lb_*. Invalid hoodie+Italian looks drop even if saved.
  const kept = existing.filter(
    (l) => (!l.lookbook || !l.id.startsWith("lb_")) && valid(l),
  );
  const keys = new Set(kept.map((l) => [...l.garmentIds].sort().join("|")));
  const extra = book.filter(
    (b) => valid(b) && !keys.has([...b.garmentIds].sort().join("|")),
  );
  return [...kept, ...extra];
}

type WearSlot = "top" | "bottom" | "footwear" | "outer";

function wearSlot(g: Garment): WearSlot | null {
  const s = slotOf(g);
  if (s === "top" || s === "dress") return "top";
  if (s === "bottom") return "bottom";
  if (s === "footwear") return "footwear";
  if (s === "outerwear") return "outer";
  return null;
}

function lookWear(pieces: Garment[]): Map<WearSlot, string> {
  const m = new Map<WearSlot, string>();
  for (const g of pieces) {
    const slot = wearSlot(g);
    if (!slot || m.has(slot)) continue;
    m.set(slot, g.id);
  }
  return m;
}

function slotsDifferent(a: Garment[], b: Garment[]): number {
  const A = lookWear(a);
  const B = lookWear(b);
  const keys = new Set<WearSlot>([...A.keys(), ...B.keys()]);
  let n = 0;
  for (const k of keys) {
    if (A.get(k) !== B.get(k)) n += 1;
  }
  return n;
}

function lookColors(pieces: Garment[]): Set<string> {
  const s = new Set<string>();
  for (const g of pieces) {
    for (const c of g.colors) {
      const n = canonicalize(c);
      if (n) s.add(n);
    }
  }
  return s;
}

/**
 * Same occasion + shared colors/houses. At least two wear-slots different.
 * Prefers idle pieces. Returns up to `n` looks, never the seed.
 */
export function moreLikeThis(
  look: Look,
  looks: Look[],
  garments: Garment[],
  n = 3,
  lockedIds: string[] = [],
): Look[] {
  const byId = new Map(garments.map((g) => [g.id, g]));
  const pieces = look.garmentIds
    .map((id) => byId.get(id))
    .filter((g): g is Garment => Boolean(g));
  if (pieces.length < 2) return [];
  const houses = new Set(lookHouses(pieces));
  const colors = lookColors(pieces);
  const occ = look.occasion;

  const resolve = (l: Look) =>
    l.garmentIds.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));

  const score = (cand: Look): number => {
    if (cand.id === look.id) return Number.NEGATIVE_INFINITY;
    const p = resolve(cand);
    if (p.length < 3) return Number.NEGATIVE_INFINITY;
    if (lockedIds.length && lockedIds.some((id) => !cand.garmentIds.includes(id))) {
      return Number.NEGATIVE_INFINITY;
    }
    const minDiff = lockedIds.length ? 1 : 2;
    if (slotsDifferent(pieces, p) < minDiff) return Number.NEGATIVE_INFINITY;
    const sharedH = lookHouses(p).filter((h) => houses.has(h)).length;
    let sharedC = 0;
    for (const c of lookColors(p)) if (colors.has(c)) sharedC += 1;
    if (sharedH === 0 && sharedC === 0) return Number.NEGATIVE_INFINITY;
    const idleN = p.filter((g) => daysIdle(g) >= 21).length;
    const idleDays = p.reduce((n, g) => n + daysIdle(g), 0);
    let s = sharedH * 3 + sharedC * 2 + idleN * 5 + idleDays / 20;
    if (cand.occasion === occ) s += 10;
    return s;
  };

  const ranked = looks
    .map((l) => ({ l, s: score(l) }))
    .filter((x) => x.s > Number.NEGATIVE_INFINITY)
    .sort((a, b) => b.s - a.s || a.l.id.localeCompare(b.l.id));

  const same = ranked.filter((x) => x.l.occasion === occ);
  const rest = ranked.filter((x) => x.l.occasion !== occ);
  return [...same, ...rest].slice(0, n).map((x) => x.l);
}

function heroOccasions(g: Garment): Occasion[] {
  const b = `${g.subtype} ${g.name} ${g.notes ?? ""}`.toLowerCase();
  const slot = slotOf(g);
  if (isGraphic(g) || isHoodiePiece(g)) return ["weekend"];
  if (isCampCollar(g)) return ["weekday", "weekend", "travel"];
  if (slot === "footwear" && /loafer/.test(b)) {
    return ["weekday", "client", "dinner", "weekend", "travel"];
  }
  if (slot === "bottom" && /trouser|gurkha/.test(b)) {
    return ["weekday", "client", "dinner", "travel", "weekend"];
  }
  if (slot === "bottom" && /chino/.test(b)) {
    return ["weekday", "client", "weekend", "travel"];
  }
  return ["weekday", "client", "dinner", "weekend", "travel"];
}

function heroHonest(g: Garment, occ: Occasion, pieces: Garment[]): boolean {
  if (lookFitsOccasion(pieces, occ)) return true;
  const blob = pieces.map((p) => `${p.subtype} ${p.name}`).join(" ").toLowerCase();
  const hoodie = pieces.some(isHoodiePiece) || pieces.some(isGraphic);
  const loafer = /loafer/.test(blob);
  if (occ === "weekend" && /trouser|gurkha/.test(`${g.subtype} ${g.name}`) && loafer && !hoodie) {
    return true;
  }
  if (occ === "weekend" && slotOf(g) === "footwear" && /loafer/.test(`${g.subtype} ${g.name}`) && !hoodie) {
    return true;
  }
  return false;
}

/** Up to 5 looks that include this piece — one per occasion that can wear it. */
export function looksForHero(g: Garment, garments: Garment[]): Look[] {
  const pool = lookbookPool(garments);
  const byId = new Map(pool.map((x) => [x.id, x]));
  const out: Look[] = [];
  const keys = new Set<string>();
  for (const occasion of heroOccasions(g)) {
    const weather =
      occasion === "dinner"
        ? { f: 62, label: "Mild", code: 2 }
        : occasion === "weekend" || occasion === "travel"
          ? { f: 72, label: "Fair", code: 2 }
          : { f: 68, label: "Fair", code: 2 };
    const ids = pickLook(pool, {
      occasion,
      moment: "day",
      weather,
      lockedIds: [g.id],
    });
    if (!ids.includes(g.id)) continue;
    const pieces = ids.map((id) => byId.get(id)).filter((x): x is Garment => Boolean(x));
    if (pieces.length < 3) continue;
    if (!heroHonest(g, occasion, pieces)) continue;
    if (occasion === "weekend" && (isHoodiePiece(g) || isGraphic(g))) {
      const jean = pieces.some((p) => /\bjeans?\b|denim/.test(`${p.subtype} ${p.name}`));
      const sneaker = pieces.some((p) => /sneaker|trainer|\b990\b/.test(`${p.subtype} ${p.name}`));
      if (!jean || !sneaker) continue;
    }
    const key = [...ids].sort().join("|");
    if (keys.has(key)) continue;
    keys.add(key);
    out.push({
      id: `hero_${g.id}_${occasion}`,
      name: nameOf(pieces),
      occasion,
      garmentIds: ids,
      source: "ai",
      lookbook: true,
      createdAt: `${todayISO()}T00:00:00.000Z`,
    });
    if (out.length >= 5) break;
  }
  return out;
}

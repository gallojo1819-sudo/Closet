import { canonicalize, harmony } from "./color.ts";
import { livePool } from "./rack.ts";
import {
  clashes as styleClashes,
  daysIdle,
  isBlazerPiece,
  isCampCollar,
  isDistressedJean,
  isFairIsle,
  isGraphic,
  isHeavyCable,
  isHoodiePiece,
  isRugbyPiece,
  isShortsPiece,
  isTrueOuter,
  isWeekendSoftJacket,
  leadHouse,
  lookHouses,
  pickLook,
  pickTrueOuter,
  slotOf,
  type House,
} from "./style.ts";
import { houseFingerprintOk, houseLegalCombo, mapHouse } from "./houses.ts";
import {
  emptyChapter,
  matchRecipe,
  noteChapterLook,
  pickRecipe,
  type ChapterTrack,
} from "./recipes.ts";
import { lookFitsSeason, seasonRank, weatherForSeason, type Season } from "./season.ts";
import { mapOccasion, OCCASIONS, type Garment, type Look, type Occasion } from "./types.ts";
import { todayISO } from "./utils.ts";

export const CHAPTER_CAP = 10;

/** Hydrate / visibility must not drip more AI covers once the blob exists. */
export function lookbookIsFrozen(
  looks: { lookbook?: boolean; source?: string }[],
): boolean {
  const ai = looks.filter((l) => l.lookbook && l.source === "ai").length;
  return ai >= 7;
}

export function lookbookPool(garments: Garment[]): Garment[] {
  return livePool(garments);
}

function bySlot(pool: Garment[], slot: "top" | "bottom" | "footwear" | "outerwear" | "dress") {
  return pool.filter((g) => slotOf(g) === slot);
}

function blobOf(g: Garment): string {
  return `${g.subtype} ${g.name}`.toLowerCase();
}

/** Graphic top + Italian/Ralph leather is costume. Two loud graphics don't share a look. */
export function lookClashes(pieces: Garment[]): boolean {
  return styleClashes(pieces);
}

function pieceScore(g: Garment, today: string): number {
  let s = Math.min(daysIdle(g, today), 90) / 10;
  if (g.wornOn.at(-1) === today) s -= 6;
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

export function comboKey(ids: string[]): string {
  return [...ids].sort().join("|");
}

function isBlazer(g: Garment): boolean {
  return /blazer|sport\s*coats?/.test(blobOf(g));
}

const SAND =
  /beige|cream|tan|camel|khaki|sand|ecru|stone|bone|ivory/;

function isSandPiece(g: Garment): boolean {
  if (g.colors.some((c) => SAND.test(canonicalize(c) || c))) return true;
  return SAND.test(`${g.name} ${g.subtype} ${g.colors.join(" ")}`.toLowerCase());
}

function beigePlateCount(pieces: Garment[]): number {
  return pieces.filter(
    (g) => slotOf(g) !== "accessory" && isSandPiece(g),
  ).length;
}

/** Jacket only when the house wants one. Default look is three pieces. */
export function lookAllowsBlazer(core: Garment[], jacket: Garment, occasion?: Occasion): boolean {
  if (!isBlazer(jacket)) return false;
  if (core.some((g) => slotOf(g) === "outerwear")) return false;
  if (occasion === "comfy") return false;
  if (core.some(isHoodiePiece) || core.some(isGraphic)) return false;
  const top = topsOf(core)[0];
  const bottom = bottomsOf(core)[0];
  const shoe = shoesOf(core)[0];
  if (!top || !shoe) return false;
  const tb = pieceBlob(top);
  const sb = pieceBlob(shoe);
  if (/mule|sneaker|trainer|\b990\b/.test(sb)) return false;
  if (!/loafer|oxford/.test(sb)) return false;
  if (isCampCollar(top) || /linen/.test(tb)) return false;
  if (isRugbyPiece(top) || /rugby/.test(tb)) return false;
  if (isHeavyCable(top)) return false;
  const shirt =
    /oxford|polo/.test(tb) ||
    ((/merino|fine|silk/.test(tb) || /knit|sweater/.test(tb)) &&
      !isHeavyCable(top) &&
      !/fair\s*isle/.test(tb));
  if (!shirt) return false;
  const house = leadHouse(core);
  if (house === "polo" && isHeavyCable(top)) return false;
  if (occasion === "weekend" && isFairIsle(top)) return false;
  if (bottom && isSandPiece(top) && isSandPiece(bottom) && isSandPiece(jacket)) {
    return false;
  }
  if (beigePlateCount([...core, jacket]) >= 3) return false;
  return true;
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

function shouldOuter(outer: Garment, core: Garment[]): boolean {
  const blob = `${outer.subtype} ${outer.name}`.toLowerCase();
  if (/overcoat|topcoat|coat\b/.test(blob)) return true;
  if (outer.warmth >= 4) return true;
  const avg = core.reduce((n, g) => n + g.formality, 0) / core.length;
  return outer.warmth >= 3 && Math.abs(outer.formality - avg) <= 1;
}

function maxBlazerLooks(occasion?: Occasion): number {
  if (occasion === "comfy") return 0;
  if (occasion === "weekend") return 2;
  if (occasion === "weekday") return 6;
  if (occasion === "out") return 6;
  if (occasion === "travel") return 4;
  return 2;
}

function maybeAttachBlazer(
  core: Garment[],
  outers: Garment[],
  today: string,
  occasion: Occasion | undefined,
  season: Season | undefined,
  blazerLooks: number,
  usedBlazers: Set<string>,
  atCap: (g: Garment) => boolean,
): Garment[] {
  if (core.some(isGraphic) || core.some(isHoodiePiece)) return core;
  if (core.some((g) => isTrueOuter(g) || (slotOf(g) === "outerwear" && !isHoodiePiece(g)))) return core;
  const max = maxBlazerLooks(occasion);
  if (occasion === "comfy") return core;
  const tryOn = (o: Garment): Garment[] | null => {
    if (core.some((g) => g.id === o.id)) return null;
    if (usedBlazers.has(o.id)) return null;
    if (atCap(o)) return null;
    if (blazerLooks >= max) return null;
    if (!lookAllowsBlazer(core, o, occasion)) return null;
    if (season === "summer" && o.warmth >= 4) return null;
    const next = [...core, o];
    if (lookClashes(next)) return null;
    if (beigePlateCount(next) >= 3) return null;
    if (season && !lookFitsSeason(next, season)) return null;
    if (harmony(next, { occasion, f: season ? undefined : 64 }) < 0) return null;
    return next;
  };
  if (occasion === "weekend") {
    for (const o of rank(outers.filter((x) => isWeekendSoftJacket(x) && !atCap(x)), today)) {
      if (core.some((g) => g.id === o.id) || usedBlazers.has(o.id)) continue;
      const next = [...core, o];
      if (lookClashes(next)) continue;
      if (season && !lookFitsSeason(next, season)) continue;
      if (harmony(next, { occasion, f: season ? undefined : 64 }) < 0) continue;
      return next;
    }
  }
  if (occasion === "travel") {
    for (const o of rank(
      outers.filter((x) => x.warmth <= 3 && isTrueOuter(x)),
      today,
    )) {
      if (core.some((g) => g.id === o.id) || atCap(o)) continue;
      const next = [...core, o];
      if (lookClashes(next)) continue;
      if (season && !lookFitsSeason(next, season)) continue;
      return next;
    }
    return core;
  }
  const blazers = outers.filter(isBlazer);
  const light = season === "summer" ? blazers.filter((o) => o.warmth <= 3) : blazers;
  for (const o of rank(light, today)) {
    const next = tryOn(o);
    if (next) return next;
  }
  const rest = outers.filter((x) => isTrueOuter(x) && !isBlazer(x));
  for (const o of rank(rest, today)) {
    if (core.some((g) => g.id === o.id) || atCap(o) || usedBlazers.has(o.id)) continue;
    const next = [...core, o];
    if (lookClashes(next)) continue;
    if (season && !lookFitsSeason(next, season)) continue;
    if (harmony(next, { occasion, f: season ? undefined : 58 }) < 0) continue;
    return next;
  }
  return core;
}

function repairJacketQuotas(
  looks: Look[],
  pool: Garment[],
  occasion: Occasion,
  house: House | undefined,
  season: Season | undefined,
  usedBlazers: Set<string>,
  atCap: (g: Garment) => boolean,
): Look[] {
  if (occasion === "comfy") return looks;
  const byId = new Map(pool.map((g) => [g.id, g]));
  const outers = pool.filter(isTrueOuter);
  const piecesOf = (l: Look) =>
    l.garmentIds.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
  const hasOuter = (l: Look) => piecesOf(l).some(isTrueOuter);
  const hasBlazer = (l: Look) => piecesOf(l).some(isBlazerPiece);
  const hasSoft = (l: Look) => piecesOf(l).some(isWeekendSoftJacket);
  const hasCold = (l: Look) =>
    piecesOf(l).some((g) => isTrueOuter(g) && (isBlazerPiece(g) || g.warmth >= 4 || /shearling|coat/.test(`${g.name} ${g.subtype}`.toLowerCase())));
  const attach = (l: Look, prefer: (g: Garment) => boolean): Look => {
    const core = piecesOf(l);
    if (core.some(isTrueOuter)) return l;
    const o = pickTrueOuter(
      outers.filter((x) => prefer(x) && !atCap(x)),
      core,
      undefined,
      {
        occasion,
        house,
        f: season === "summer" ? 78 : 58,
        legalCombo: house ? (p) => houseLegalCombo(p, house, occasion, undefined, pool) : undefined,
        usedOuters: usedBlazers,
      },
    );
    if (!o) return l;
    const next = [...core, o];
    if (lookClashes(next)) return l;
    if (season && !lookFitsSeason(next, season)) return l;
    usedBlazers.add(o.id);
    return {
      ...l,
      garmentIds: next.map((g) => g.id),
      name: nameOf(next),
      recipeId: l.recipeId ?? matchRecipe(next, occasion, house),
    };
  };
  let next = looks.map((l) => ({ ...l }));
  const pass = (prefer: (g: Garment) => boolean, stillNeed: () => boolean) => {
    for (let i = 0; i < next.length && stillNeed(); i++) {
      if (hasOuter(next[i]!)) continue;
      next[i] = attach(next[i]!, prefer);
    }
  };
  if (occasion === "weekday") {
    pass(isBlazerPiece, () => next.filter(hasBlazer).length < 2);
    pass(isTrueOuter, () => next.filter(hasOuter).length < 4);
  } else if (occasion === "out") {
    pass(
      (g) => isBlazerPiece(g) || g.warmth >= 4,
      () => next.filter(hasCold).length < Math.ceil(next.length * 0.4),
    );
  } else if (occasion === "weekend") {
    pass(isWeekendSoftJacket, () => next.filter(hasSoft).length < 3);
  } else if (occasion === "travel") {
    pass((g) => isTrueOuter(g) && g.warmth <= 3, () => next.filter(hasOuter).length < 2);
  }
  return next;
}

/**
 * Best looks from this closet — four chapters, 10 each.
 */
export function buildLookbook(
  garments: Garment[],
  today = todayISO(),
  salt = 0,
): Look[] {
  const all: Look[] = [];
  for (const { id } of OCCASIONS) {
    all.push(...buildChapter(garments, id, { cap: CHAPTER_CAP, salt, today }));
  }
  return coverUnused(garments, all);
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

function rackHas(
  pool: Garment[] | undefined,
  slot: "top" | "bottom" | "footwear",
  re: RegExp,
): boolean {
  return (pool ?? []).some((g) => {
    const s = slotOf(g);
    if (slot === "top") {
      if (s !== "top" && s !== "dress") return false;
    } else if (s !== slot) return false;
    return re.test(pieceBlob(g));
  });
}

export function lookFitsOccasion(
  pieces: Garment[],
  occ: string,
  pool?: Garment[],
  house?: House,
): boolean {
  if (occ === "all") return true;
  if (lookClashes(pieces)) return false;
  const o = mapOccasion(occ);
  const blob = lookBlob(pieces);
  const tops = topsOf(pieces);
  const bottoms = bottomsOf(pieces);
  const shoes = shoesOf(pieces);
  const graphic = pieces.some(isGraphic);
  const hoodie = pieces.some(isHoodiePiece);
  const sneaker = hasKind(shoes, /sneaker|trainer|\b990\b/);
  const gymShoe = hasKind(shoes, /gym|runner|running|athletic/);
  const loafer = hasKind(shoes, /loafer/);
  const mule = hasKind(shoes, /mule/);
  const boot = hasKind(shoes, /boot/);
  const trouser = hasKind(bottoms, /trouser/) && !hasKind(bottoms, /\bjeans?\b|denim/);
  const chino = hasKind(bottoms, /chino/);
  const jean = hasKind(bottoms, /\bjeans?\b|denim/);
  const cord = hasKind(bottoms, /cord/);
  const rugby = pieces.some(isRugbyPiece) || /rugby/.test(blob);
  const oxford = hasKind(tops, /oxford/);
  const polo = hasKind(tops, /polo/);
  const cable = hasKind(tops, /cable/);
  const knit = hasKind(tops, /knit|sweater|merino|cable/) && !hoodie;
  const overshirt = pieces.some((g) => /overshirt/.test(pieceBlob(g)));
  const fairIsle = pieces.some(isFairIsle);
  const camp = pieces.some(isCampCollar);
  const cleanSneaker = sneaker && !gymShoe;
  const hoodieOnly = tops.length > 0 && tops.every((g) => isHoodiePiece(g) || isGraphic(g));
  const distressed = bottoms.some(isDistressedJean);
  const shorts = bottoms.some(isShortsPiece);
  const blazer = pieces.some(isBlazerPiece);
  const legalBottom = chino || trouser || jean || cord;

  if (shorts && o === "weekday") return false;
  if (distressed && o !== "weekend" && o !== "comfy") return false;

  if (o === "weekday") {
    if (tops.length === 0 || bottoms.length === 0 || shoes.length === 0) return false;
    if (rugby && blazer) return false;
    if (house === "ald") {
      return (hoodie || rugby || graphic) && (jean || chino) && (sneaker || loafer);
    }
    if (rugby && (jean || chino) && loafer) return true;
    if (house === "faloni") {
      return (camp || /linen/.test(blob)) && legalBottom && (loafer || mule) && !hoodie;
    }
    if (house === "sweetStable") {
      return (
        (fairIsle || rugby || /gingham/.test(blob)) &&
        (chino || jean || cord) &&
        (loafer || boot || sneaker) &&
        !mule
      );
    }
    if (fairIsle && (chino || jean || cord) && (loafer || boot) && !mule) return true;
    if (house === "italianWinter") {
      return knit && legalBottom && loafer;
    }
    if (house === "fiveFourFive") {
      return (
        (camp || /linen|sangallo|serafino|bowling/.test(blob)) &&
        legalBottom &&
        (loafer || mule || sneaker)
      );
    }
    if (hoodie || graphic) return false;
    if (!(oxford || polo || cable || knit)) return false;
    if (!legalBottom) return false;
    if (loafer || boot) return true;
    if (cleanSneaker) return true;
    return false;
  }

  if (o === "out") {
    if (tops.length === 0 || bottoms.length === 0 || shoes.length === 0) return false;
    if (house === "ald") {
      return (hoodie || rugby || graphic || oxford || polo) && (jean || chino) && (sneaker || loafer);
    }
    if (hoodieOnly || hoodie) return false;
    if (!(oxford || polo || camp || knit)) return false;
    if (!legalBottom) return false;
    const dressShoe = loafer || mule || boot;
    if (!dressShoe) {
      if (!sneaker) return false;
      if (!pool || rackHas(pool, "footwear", /loafer|mule|boot/)) return false;
    }
    return true;
  }

  if (o === "weekend") {
    if (tops.length === 0 || bottoms.length === 0 || shoes.length === 0) return false;
    if ((hoodie || graphic) && !((jean || chino) && sneaker)) return false;
    // oxford + trouser + loafer is legal Ralph weekend — not a tuxedo ban
    return (
      legalBottom ||
      rugby ||
      fairIsle ||
      camp ||
      sneaker ||
      loafer ||
      boot ||
      mule ||
      oxford ||
      polo ||
      knit ||
      /sangallo|serafino|bowling/.test(blob)
    );
  }

  if (o === "comfy") {
    if (tops.length === 0 || bottoms.length === 0 || shoes.length === 0) return false;
    const varsity = /varsity|letterman|bomber/.test(blob);
    const cord = /cord/.test(blob) || hasKind(bottoms, /cord/);
    const boot = hasKind(shoes, /boot/);
    const mule = hasKind(shoes, /mule/);
    const topOk = knit || rugby || varsity || hoodie || fairIsle || polo;
    const botOk = chino || jean || cord;
    const shoeOk = sneaker || mule || loafer || boot;
    return topOk && botOk && shoeOk;
  }

  if (o === "travel") {
    if (tops.length === 0 || bottoms.length === 0 || shoes.length === 0) return false;
    if (hoodieOnly || (hoodie && graphic)) return false;
    if (gymShoe) return false;
    const topOk = knit || overshirt || oxford || polo;
    const botOk = chino || trouser || jean;
    const shoeOk = loafer || sneaker || boot;
    return topOk && botOk && shoeOk;
  }

  return true;
}

export function lookFitsHouse(
  pieces: Garment[],
  house: House | string,
  occasion: Occasion,
  pool?: Garment[],
): boolean {
  const h = mapHouse(house);
  if (h === "all") return true;
  if (!houseFingerprintOk(pieces, h, occasion, pool)) return false;
  return lookFitsOccasion(pieces, occasion, pool, h);
}

export function seenKey(occasion: Occasion, house?: House | "all" | null): string {
  if (!house || house === "all") return occasion;
  return `${occasion}:${house}`;
}

export function pieceLookCap(slotCount: number): number {
  if (slotCount >= 12) return 1;
  if (slotCount >= 6) return 2;
  return 3;
}

function wearCapSlot(g: Garment): "top" | "bottom" | "footwear" | "outerwear" | null {
  const s = slotOf(g);
  if (s === "top" || s === "dress") return "top";
  if (s === "bottom") return "bottom";
  if (s === "footwear") return "footwear";
  if (s === "outerwear") return "outerwear";
  return null;
}

function slotCapsFor(pool: Garment[]) {
  return {
    top: pieceLookCap(bySlot(pool, "top").length + bySlot(pool, "dress").length),
    bottom: pieceLookCap(bySlot(pool, "bottom").length),
    footwear: pieceLookCap(bySlot(pool, "footwear").length),
    outerwear: pieceLookCap(bySlot(pool, "outerwear").length),
  };
}

/** Keep at most one look per blazer id; strip that jacket from the rest. Max 2 blazered looks (1 on weekend). */
export function stripRepeatBlazers(looks: Look[], garments: Garment[]): Look[] {
  const byId = new Map(garments.map((g) => [g.id, g]));
  const keptJacket = new Map<string, Set<string>>();
  const blazerLooks = new Map<string, number>();
  return looks.map((l) => {
    if (l.source === "manual" || !l.lookbook) return l;
    const occ = mapOccasion(l.occasion);
    if (occ !== "weekday" && occ !== "out" && occ !== "weekend") return l;
    const jackets = l.garmentIds
      .map((id) => byId.get(id))
      .filter((g): g is Garment => g != null && isBlazer(g));
    if (!jackets.length) return l;
    const seen = keptJacket.get(occ) ?? new Set<string>();
    const count = blazerLooks.get(occ) ?? 0;
    const max = maxBlazerLooks(occ);
    const keep = new Set<string>();
    for (const j of jackets) {
      if (seen.has(j.id)) continue;
      if (count + keep.size >= max) continue;
      keep.add(j.id);
    }
    const strip = jackets.filter((j) => !keep.has(j.id)).map((j) => j.id);
    if (!strip.length) {
      for (const id of keep) seen.add(id);
      keptJacket.set(occ, seen);
      blazerLooks.set(occ, count + keep.size);
      return l;
    }
    const ids = l.garmentIds.filter((id) => !strip.includes(id));
    if (ids.length < 3) return l;
    for (const id of keep) seen.add(id);
    keptJacket.set(occ, seen);
    blazerLooks.set(occ, count + keep.size);
    const pieces = ids.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
    return { ...l, garmentIds: ids, name: nameOf(pieces) };
  });
}

/** Drop extra auto looks so no shirt/pant/shoe exceeds the per-chapter cap. Manual stays. */
export function enforcePieceCap(looks: Look[], garments: Garment[]): Look[] {
  const pool = lookbookPool(garments);
  const byId = new Map(pool.map((g) => [g.id, g]));
  const caps = slotCapsFor(pool);
  const usedByOcc = new Map<string, Map<string, number>>();
  const out: Look[] = [];
  const over = (occ: string, ids: string[]) => {
    const used = usedByOcc.get(occ) ?? new Map<string, number>();
    for (const id of ids) {
      const g = byId.get(id);
      if (!g) continue;
      const slot = wearCapSlot(g);
      if (!slot) continue;
      if ((used.get(id) ?? 0) >= caps[slot]) return true;
    }
    return false;
  };
  const bump = (occ: string, ids: string[]) => {
    let used = usedByOcc.get(occ);
    if (!used) {
      used = new Map();
      usedByOcc.set(occ, used);
    }
    for (const id of ids) used.set(id, (used.get(id) ?? 0) + 1);
  };
  for (const l of looks) {
    const occ = mapOccasion(l.occasion);
    if (l.source === "manual" || !l.lookbook || l.id.startsWith("week_")) {
      out.push(l);
      bump(occ, l.garmentIds);
      continue;
    }
    if (over(occ, l.garmentIds)) continue;
    bump(occ, l.garmentIds);
    out.push(l);
  }
  return out;
}

export function buildChapter(
  garments: Garment[],
  occasion: Occasion,
  opts?: {
    exclude?: Set<string>;
    cap?: number;
    salt?: number;
    today?: string;
    season?: Season;
    usedCount?: Map<string, number>;
    blazerLooks?: number;
    usedBlazers?: Set<string>;
    house?: House;
  },
): Look[] {
  const cap = opts?.cap ?? CHAPTER_CAP;
  const exclude = opts?.exclude ?? new Set<string>();
  const today = opts?.today ?? todayISO();
  const salt = opts?.salt ?? 0;
  const season = opts?.season;
  const house = opts?.house;
  const pool = lookbookPool(garments);
  const outers = bySlot(pool, "outerwear");
  const byId = new Map(pool.map((g) => [g.id, g]));
  const caps = slotCapsFor(pool);
  const usedCount = opts?.usedCount ?? new Map<string, number>();
  let blazerLooks = opts?.blazerLooks ?? 0;
  const usedBlazers = opts?.usedBlazers ?? new Set<string>();
  const atCap = (g: Garment) => {
    const slot = wearCapSlot(g);
    if (!slot) return false;
    return (usedCount.get(g.id) ?? 0) >= caps[slot];
  };
  const bump = (ids: string[]) => {
    for (const id of ids) usedCount.set(id, (usedCount.get(id) ?? 0) + 1);
  };
  const out: Look[] = [];
  const used = new Set(exclude);
  let prev: string[] = [];
  const weather = season ? weatherForSeason(season) : weatherForOcc(occasion, season);

  const tryPush = (pieces: Garment[], force = false): boolean => {
    if (pieces.length < 3) return false;
    if (!lookFitsOccasion(pieces, occasion, pool, house)) return false;
    if (house && !houseLegalCombo(pieces, house, occasion, undefined, pool)) return false;
    if (season && !lookFitsSeason(pieces, season)) return false;
    if (beigePlateCount(pieces) >= 3) return false;
    if (!force) {
      for (const g of pieces) {
        if (atCap(g)) return false;
      }
    } else {
      for (const g of pieces) {
        const slot = wearCapSlot(g);
        if (!slot) continue;
        if ((usedCount.get(g.id) ?? 0) >= 1 && atCap(g)) return false;
      }
    }
    const key = comboKey(pieces.map((p) => p.id));
    if (used.has(key)) return false;
    used.add(key);
    bump(pieces.map((p) => p.id));
    const recipeId = matchRecipe(pieces, occasion, house);
    out.push({
      id: `lb2_${occasion}_${key.replace(/\|/g, "_")}`,
      name: nameOf(pieces),
      occasion,
      garmentIds: pieces.map((p) => p.id),
      source: "ai",
      lookbook: true,
      recipeId,
      createdAt: `${today}T00:00:00.000Z`,
    });
    return true;
  };

  const track = emptyChapter();
  const weatherUse = season ? weatherForSeason(season) : weather;

  for (let i = 0; i < 220 && out.length < cap; i++) {
    const available = pool.filter((g) => !atCap(g));
    if (available.length < 3) break;
    const recipe = pickRecipe(occasion, available, { house, track });
    const ids = pickLook(available, {
      occasion,
      moment: "day",
      weather: weatherUse,
      previousIds: prev,
      usedCount,
      house,
      recipeId: recipe.id,
      chapter: track,
      legalCombo: house ? (p) => houseLegalCombo(p, house, occasion, undefined, pool) : undefined,
    });
    if (ids.length < 3) continue;
    prev = ids;
    let pieces = ids.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
    if (pieces.length < 3) continue;
    if (!pieces.some(isTrueOuter)) {
      const tryJacket =
        occasion === "weekday" ||
        occasion === "out" ||
        occasion === "travel" ||
        occasion === "weekend";
      if (tryJacket) {
        pieces = maybeAttachBlazer(
          pieces,
          outers,
          today,
          occasion,
          season,
          blazerLooks,
          usedBlazers,
          atCap,
        );
      }
    }
    if (tryPush(pieces)) {
      const last = out[out.length - 1]!;
      const lastPieces = last.garmentIds
        .map((id) => byId.get(id))
        .filter((g): g is Garment => Boolean(g));
      noteChapterLook(track, lastPieces, (last.recipeId as ChapterTrack["lastRecipe"]) ?? recipe.id, occasion);
      for (const g of lastPieces) {
        if (isBlazer(g) || isTrueOuter(g)) {
          if (isBlazer(g)) blazerLooks += 1;
          usedBlazers.add(g.id);
        }
      }
    }
  }

  if (out.length < cap) {
    const leftovers = pool.filter((g) => {
      const slot = wearCapSlot(g);
      if (!slot) return false;
      return (usedCount.get(g.id) ?? 0) === 0;
    });
    for (const g of leftovers) {
      if (out.length >= cap) break;
      const ids = pickLook(pool.filter((x) => x.id === g.id || !atCap(x)), {
        occasion,
        moment: "day",
        weather,
        lockedIds: [g.id],
        house,
        chapter: track,
        legalCombo: house ? (p) => houseLegalCombo(p, house, occasion, undefined, pool) : undefined,
      });
      let pieces = ids.map((id) => byId.get(id)).filter((x): x is Garment => Boolean(x));
      if (!pieces.some((x) => x.id === g.id)) continue;
      if (tryPush(pieces, true)) {
        const last = out[out.length - 1]!;
        const lastPieces = last.garmentIds
          .map((id) => byId.get(id))
          .filter((x): x is Garment => Boolean(x));
        noteChapterLook(track, lastPieces, last.recipeId as ChapterTrack["lastRecipe"], occasion);
      }
    }
  }
  void salt;
  return repairJacketQuotas(out, pool, occasion, house, season, usedBlazers, atCap);
}

/**
 * Extra looks for one occasion until `min` or the rack is exhausted.
 * Tagged with that occasion. HIS plates only.
 */
export function fillOccasionLooks(
  garments: Garment[],
  looks: Look[],
  occasion: Occasion,
  min = CHAPTER_CAP,
  exclude?: Set<string>,
  season?: Season,
  house?: House,
): Look[] {
  const occ = mapOccasion(occasion);
  const byId = new Map(garments.map((g) => [g.id, g]));
  const have = looks.filter((l) => {
    if (mapOccasion(l.occasion) !== occ) return false;
    const pieces = l.garmentIds
      .map((id) => byId.get(id))
      .filter((g): g is Garment => Boolean(g));
    if (pieces.length < 3) return false;
    return true;
  });
  if (have.length >= min) return [];
  const keys = new Set([
    ...(exclude ?? []),
    ...have.map((l) => comboKey(l.garmentIds)),
  ]);
  const usedCount = new Map<string, number>();
  const usedBlazers = new Set<string>();
  let blazerLooks = 0;
  for (const l of have) {
    for (const id of l.garmentIds) usedCount.set(id, (usedCount.get(id) ?? 0) + 1);
    const jackets = l.garmentIds
      .map((id) => byId.get(id))
      .filter((g): g is Garment => g != null && isBlazer(g));
    if (jackets.length) {
      blazerLooks += 1;
      for (const j of jackets) usedBlazers.add(j.id);
    }
  }
  return buildChapter(garments, occ, {
    exclude: keys,
    cap: min - have.length,
    season,
    usedCount,
    blazerLooks,
    usedBlazers,
    house,
  });
}

export function looksToKeepOnShuffle(
  looks: Look[],
  occasion: Occasion,
  garments: Garment[] = [],
  _season?: Season,
  house?: House,
): Look[] {
  const occ = mapOccasion(occasion);
  const byId = new Map(garments.map((g) => [g.id, g]));
  return looks.filter((l) => {
    if (mapOccasion(l.occasion) !== occ) return true;
    if (l.source === "manual") return true;
    if (l.id.startsWith("week_")) return true;
    void house;
    return false;
  });
}

/** Shuffle one chapter: drop unsaved rows, fill up to 10 unseen combos. Saved stay. */
export function applyShuffle(
  garments: Garment[],
  looks: Look[],
  occasion: Occasion,
  seen: string[],
  today?: string,
  season?: Season,
  house?: House,
): { looks: Look[]; added: Look[]; seen: string[] } {
  const occ = mapOccasion(occasion);
  const kept = looksToKeepOnShuffle(looks, occ, garments, season, house);
  const exclude = new Set(seen);
  const usedCount = new Map<string, number>();
  const usedBlazers = new Set<string>();
  let blazerLooks = 0;
  const byId = new Map(garments.map((g) => [g.id, g]));
  for (const l of kept) {
    if (mapOccasion(l.occasion) !== occ) continue;
    exclude.add(comboKey(l.garmentIds));
    for (const id of l.garmentIds) usedCount.set(id, (usedCount.get(id) ?? 0) + 1);
    const jackets = l.garmentIds
      .map((id) => byId.get(id))
      .filter((g): g is Garment => g != null && isBlazer(g));
    if (jackets.length) {
      blazerLooks += 1;
      for (const j of jackets) usedBlazers.add(j.id);
    }
  }
  const added = buildChapter(garments, occ, {
    exclude,
    cap: 8,
    today,
    usedCount,
    blazerLooks,
    usedBlazers,
    house,
  });
  const nextSeen = [...new Set([...seen, ...added.map((l) => comboKey(l.garmentIds))])];
  return { looks: [...kept, ...added], added, seen: nextSeen };
}

/** Migrate old client/dinner tags and cap auto rows at 10 per chapter. Manual stays. */
export function capChapterLooks(looks: Look[]): Look[] {
  const mapped = looks.map((l) => ({ ...l, occasion: mapOccasion(l.occasion) }));
  const out: Look[] = [];
  const used = new Set<string>();
  for (const l of mapped) {
    if (l.source === "manual" || !l.lookbook) {
      out.push(l);
      used.add(l.id);
    }
  }
  for (const { id: occ } of OCCASIONS) {
    let n = 0;
    for (const l of mapped) {
      if (used.has(l.id)) continue;
      if (l.occasion !== occ) continue;
      if (n >= CHAPTER_CAP * 4) continue;
      out.push(l);
      used.add(l.id);
      n += 1;
    }
  }
  return out;
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
    (l) => (l.source === "manual" || !l.lookbook || !l.id.startsWith("lb_")) && valid(l),
  );
  const keys = new Set(kept.map((l) => comboKey(l.garmentIds)));
  const extra = book.filter(
    (b) => valid(b) && !keys.has(comboKey(b.garmentIds)),
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
    if (lookClashes(p)) return Number.NEGATIVE_INFINITY;
    const idleN = p.filter((g) => daysIdle(g) >= 21).length;
    const idleDays = p.reduce((n, g) => n + daysIdle(g), 0);
    let s = sharedH * 3 + sharedC * 2 + idleN * 5 + idleDays / 20;
    if (cand.occasion !== occ) return Number.NEGATIVE_INFINITY;
    return s;
  };

  const ranked = looks
    .map((l) => ({ l, s: score(l) }))
    .filter((x) => x.s > Number.NEGATIVE_INFINITY)
    .sort((a, b) => b.s - a.s || a.l.id.localeCompare(b.l.id));

  return ranked.slice(0, n).map((x) => x.l);
}

const HERO_OCCASIONS: Occasion[] = ["weekday", "out", "weekend", "travel", "comfy"];

function heroOccasions(_g: Garment): Occasion[] {
  return HERO_OCCASIONS;
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

function weatherForOcc(occasion: Occasion, season?: Season) {
  if (season === "summer") return { f: 78, label: "Warm", code: 2 };
  if (season === "winter") return { f: 42, label: "Cold", code: 2 };
  if (occasion === "comfy") return { f: 72, label: "Fair", code: 2 };
  if (occasion === "weekend") return { f: 64, label: "Mild", code: 2 };
  return { f: 58, label: "Cool", code: 2 };
}

function starLook(
  g: Garment,
  garments: Garment[],
  occasion: Occasion,
  seen: Set<string>,
  previousIds: string[],
): Look | null {
  const pool = lookbookPool(garments);
  const byId = new Map(pool.map((x) => [x.id, x]));
  const ids = pickLook(pool, {
    occasion,
    moment: "day",
    weather: weatherForOcc(occasion),
    lockedIds: [g.id],
    previousIds,
  });
  const ordered = ids.includes(g.id) ? ids : [g.id, ...ids.filter((id) => id !== g.id)];
  if (ordered.length < 3 || !ordered.includes(g.id)) return null;
  const key = comboKey(ordered);
  if (seen.has(key)) return null;
  const pieces = ordered.map((id) => byId.get(id)).filter((x): x is Garment => Boolean(x));
  if (pieces.length < 3) return null;
  if (lookClashes(pieces)) return null;
  return {
    id: `hero_${g.id}_${occasion}_${key.slice(0, 10)}`,
    name: nameOf(pieces),
    occasion,
    garmentIds: ordered,
    source: "ai",
    lookbook: true,
    createdAt: `${todayISO()}T00:00:00.000Z`,
  };
}

/**
 * 5 looks starring this piece: weekday / out / weekend / travel / comfy.
 * Skip an occasion only when clashes make it impossible, then PoloDefault fill to 5.
 */
export function looksForHero(
  g: Garment,
  garments: Garment[],
  opts?: { seen?: string[] },
): Look[] {
  const seen = new Set(opts?.seen ?? []);
  const previous: string[] = [];
  const out: Look[] = [];
  for (const occasion of heroOccasions(g)) {
    const look = starLook(g, garments, occasion, seen, previous);
    if (!look) continue;
    const pieces = look.garmentIds
      .map((id) => garments.find((x) => x.id === id))
      .filter((x): x is Garment => Boolean(x));
    if (!lookFitsOccasion(pieces, occasion, garments) && !heroHonest(g, occasion, pieces)) {
      continue;
    }
    out.push(look);
    seen.add(comboKey(look.garmentIds));
    previous.push(...look.garmentIds.filter((id) => id !== g.id));
    if (out.length >= 5) return out;
  }
  for (let t = 0; t < 12 && out.length < 5; t++) {
    const look = starLook(g, garments, "weekday", seen, previous);
    if (!look) break;
    out.push(look);
    seen.add(comboKey(look.garmentIds));
    previous.push(...look.garmentIds.filter((id) => id !== g.id));
  }
  return out;
}

/** Chip-filter the 5 looks starring a piece; fill to ≥3 without dropping the piece. */
export function visibleHero(
  g: Garment,
  looks: Look[],
  garments: Garment[],
  opts?: { occasion?: Occasion; season?: Season; house?: House | "all"; color?: string | null; min?: number },
): Look[] {
  const pool = lookbookPool(garments);
  const byId = new Map(pool.map((x) => [x.id, x]));
  const season = opts?.season;
  const house = opts?.house && opts.house !== "all" ? opts.house : undefined;
  const min = opts?.min ?? 3;
  const resolve = (l: Look) =>
    l.garmentIds.map((id) => byId.get(id)).filter((x): x is Garment => Boolean(x));
  let rows = looks.filter((l) => {
    if (!l.garmentIds.includes(g.id)) return false;
    const pieces = resolve(l);
    if (pieces.length < 3) return false;
    if (lookClashes(pieces)) return false;
    if (season && !lookFitsSeason(pieces, season)) return false;
    if (opts?.color && !lookHasColor(pieces, opts.color)) return false;
    return true;
  });
  if (opts?.occasion) {
    const occRows = rows.filter((l) => mapOccasion(l.occasion) === opts.occasion);
    if (occRows.length >= min) rows = occRows;
  }
  rows = [...rows].sort((a, b) => {
    if (!house) return 0;
    const ha = lookFitsHouse(resolve(a), house, opts?.occasion ?? "weekday", pool) ? 1 : 0;
    const hb = lookFitsHouse(resolve(b), house, opts?.occasion ?? "weekday", pool) ? 1 : 0;
    return hb - ha;
  });
  if (rows.length < min) {
    const extra = looksForHero(g, garments, { seen: rows.map((l) => comboKey(l.garmentIds)) });
    const more = extra.filter((l) => l.garmentIds.includes(g.id));
    const keys = new Set(rows.map((l) => comboKey(l.garmentIds)));
    for (const l of more) {
      const k = comboKey(l.garmentIds);
      if (keys.has(k)) continue;
      keys.add(k);
      rows.push(l);
    }
  }
  return rows.filter((l) => l.garmentIds.includes(g.id)).slice(0, 5);
}

/**
 * Shown-equivalent for one chapter.
 * Occasion is the chapter key. House and season rank; they must not zero the grid.
 */
export function chapterVisible(
  looks: Look[],
  garments: Garment[],
  occasion: Occasion,
  opts?: { season?: Season; house?: House | "all"; color?: string | null; min?: number },
): Look[] {
  const pool = lookbookPool(garments);
  const byId = new Map(pool.map((g) => [g.id, g]));
  const season = opts?.season;
  const house = opts?.house && opts.house !== "all" ? opts.house : undefined;
  const min = opts?.min ?? 3;
  const resolve = (l: Look) =>
    l.garmentIds.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));

  const rows = looks.filter((look) => {
    const pieces = resolve(look);
    if (pieces.length < 3) return false;
    if (mapOccasion(look.occasion) !== occasion) return false;
    if (lookClashes(pieces)) return false;
    if (season && !lookFitsSeason(pieces, season)) return false;
    if (opts?.color && !lookHasColor(pieces, opts.color)) return false;
    return true;
  });

  const ranked = [...rows].sort((a, b) => {
    const pa = resolve(a);
    const pb = resolve(b);
    if (house) {
      const ha = lookFitsHouse(pa, house, occasion, pool) ? 1 : 0;
      const hb = lookFitsHouse(pb, house, occasion, pool) ? 1 : 0;
      if (hb !== ha) return hb - ha;
    }
    if (season) return seasonRank(pb, season) - seasonRank(pa, season);
    return 0;
  });
  if (house) {
    const hard = ranked.filter((l) => lookFitsHouse(resolve(l), house, occasion, pool));
    const minH = opts?.min ?? 0;
    let outH = hard;
    const keysH = new Set(outH.map((l) => comboKey(l.garmentIds)));
    let guardH = 0;
    while (outH.length < minH && minH > 0 && guardH < 12) {
      guardH += 1;
      const ids = pickLook(pool, {
        occasion,
        moment: "day",
        weather: season ? weatherForSeason(season) : weatherForOcc(occasion),
        previousIds: outH.flatMap((l) => l.garmentIds),
        legalCombo: (p) => houseLegalCombo(p, house, occasion, undefined, pool),
      });
      if (ids.length < 3) break;
      const pieces = ids.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
      if (pieces.length < 3 || lookClashes(pieces)) continue;
      if (!lookFitsHouse(pieces, house, occasion, pool)) continue;
      const key = comboKey(ids);
      if (keysH.has(key)) continue;
      keysH.add(key);
      outH.push({
        id: `lb2_house_${house}_${occasion}_${key.replace(/\|/g, "_")}`,
        name: nameOf(pieces),
        occasion,
        garmentIds: ids,
        source: "ai",
        lookbook: true,
        createdAt: `${todayISO()}T00:00:00.000Z`,
      });
    }
    return outH;
  }

  let out = enforcePieceCap(stripRepeatBlazers(ranked, garments), garments);
  if (out.length < min && min > 0) {
    const extra = fillOccasionLooks(
      garments,
      out,
      occasion,
      min,
      new Set(out.map((l) => comboKey(l.garmentIds))),
      undefined,
      undefined,
    );
    const merged = stripRepeatBlazers([...out, ...extra], garments);
    const capped = enforcePieceCap(merged, garments);
    out = capped.length >= min ? capped : merged;
  }
  const keys = new Set(out.map((l) => comboKey(l.garmentIds)));
  let guard = 0;
  while (out.length < min && min > 0 && guard < 16) {
    guard += 1;
    const ids = pickLook(pool, {
      occasion,
      moment: "day",
      weather: season ? weatherForSeason(season) : weatherForOcc(occasion),
      previousIds: out.flatMap((l) => l.garmentIds),
    });
    if (ids.length < 3) break;
    const pieces = ids.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
    if (pieces.length < 3 || lookClashes(pieces)) continue;
    if (season && !lookFitsSeason(pieces, season)) continue;
    const key = comboKey(ids);
    if (keys.has(key)) continue;
    keys.add(key);
    out.push({
      id: `lb2_fill_${occasion}_${key.replace(/\|/g, "_")}`,
      name: nameOf(pieces),
      occasion,
      garmentIds: ids,
      source: "ai",
      lookbook: true,
      createdAt: `${todayISO()}T00:00:00.000Z`,
    });
  }
  return out;
}

/** Exhausted only after a full chapter was shown and shuffle-after-reset added nothing. */
export function chapterExhausted(
  visible: number,
  shuffleAdded: number,
  resetAdded: number,
): boolean {
  return visible >= 3 && shuffleAdded === 0 && resetAdded === 0;
}

/** Put idle livePool pieces into looks so the whole rack is in the book. */
export function coverUnused(garments: Garment[], looks: Look[]): Look[] {
  const pool = lookbookPool(garments);
  const byId = new Map(pool.map((g) => [g.id, g]));
  const used = new Set(looks.flatMap((l) => l.garmentIds));
  const extra: Look[] = looks.map((l) => ({ ...l, garmentIds: [...l.garmentIds] }));
  const keys = new Set(extra.map((l) => comboKey(l.garmentIds)));
  for (const g of pool) {
    if (used.has(g.id)) continue;
    const slot = slotOf(g);
    if (slot === "accessory" || g.category === "accessory" || !slot) {
      const idx = extra.findIndex((l) => {
        const pieces = l.garmentIds
          .map((id) => byId.get(id))
          .filter((x): x is Garment => Boolean(x));
        return (
          pieces.length >= 3 &&
          !pieces.some((p) => slotOf(p) === "accessory" || p.category === "accessory")
        );
      });
      if (idx >= 0) {
        const host = extra[idx]!;
        extra[idx] = { ...host, garmentIds: [...host.garmentIds, g.id] };
        used.add(g.id);
      }
      continue;
    }
    const occ: Occasion =
      isGraphic(g) || isHoodiePiece(g) ? "weekend" : isCampCollar(g) ? "weekend" : "weekday";
    const ids = pickLook(pool, {
      occasion: occ,
      moment: "day",
      weather: { f: 64, label: "Mild", code: 2 },
      lockedIds: [g.id],
    });
    const ordered = ids.includes(g.id) ? ids : [g.id, ...ids.filter((id) => id !== g.id)];
    if (ordered.length < 3 || !ordered.includes(g.id)) continue;
    const pieces = ordered.map((id) => byId.get(id)).filter((x): x is Garment => Boolean(x));
    if (pieces.length < 3 || lookClashes(pieces)) continue;
    const key = comboKey(ordered);
    if (keys.has(key)) continue;
    keys.add(key);
    for (const id of ordered) used.add(id);
    extra.push({
      id: `lb2_cover_${g.id}_${key.replace(/\|/g, "_")}`,
      name: nameOf(pieces),
      occasion: occ,
      garmentIds: ordered,
      source: "ai",
      lookbook: true,
      createdAt: `${todayISO()}T00:00:00.000Z`,
    });
  }
  return extra;
}

export const WEEK_ENERGIES: Occasion[] = [
  "weekday",
  "out",
  "weekend",
  "weekday",
  "out",
  "weekend",
  "weekday",
];

export function mondayISO(iso = todayISO()): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  const day = dt.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + diff);
  return dt.toISOString().slice(0, 10);
}

export function isThisWeekLook(l: Look, monday: string): boolean {
  return l.id.startsWith(`week_${monday}_`);
}

export function lookCountMap(looks: Look[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of looks) {
    for (const id of l.garmentIds) m.set(id, (m.get(id) ?? 0) + 1);
  }
  return m;
}

/** Scarce pieces first. Hubs with 159 looks get 1/160. */
export function weekWeight(lookCount: number): number {
  return 1 / (1 + lookCount);
}

/** 7 scarce-first spreads. Each id at most once in the week. Pool is livePool, not the book. */
export function buildWeek(
  garments: Garment[],
  today = todayISO(),
  opts?: { excludeKeys?: string[]; usedCount?: Map<string, number>; house?: House },
): Look[] {
  const monday = mondayISO(today);
  const pool = lookbookPool(garments);
  const byId = new Map(pool.map((g) => [g.id, g]));
  const usedCount = opts?.usedCount ?? new Map<string, number>();
  const weightOf = (id: string) => weekWeight(usedCount.get(id) ?? 0);
  const weekUsed = new Set<string>();
  const out: Look[] = [];
  const keys = new Set<string>(opts?.excludeKeys ?? []);

  const available = () => pool.filter((g) => !weekUsed.has(g.id));
  const scarceTops = () =>
    available()
      .filter((g) => {
        const s = slotOf(g);
        return s === "top" || s === "dress";
      })
      .sort(
        (a, b) =>
          weightOf(b.id) - weightOf(a.id) ||
          daysIdle(b, today) - daysIdle(a, today) ||
          a.id.localeCompare(b.id),
      );

  const track = emptyChapter();
  const pushLook = (occ: Occasion, locked: string[], i: number): boolean => {
    const avail = available();
    const lockedOk = locked.filter((id) => !weekUsed.has(id) && byId.has(id));
    const recipe = pickRecipe(occ, avail, { house: opts?.house, track });
    const ids = pickLook(avail, {
      occasion: occ,
      moment: "day",
      weather: weatherForOcc(occ),
      lockedIds: lockedOk,
      usedCount,
      house: opts?.house,
      recipeId: recipe.id,
      chapter: track,
      legalCombo: opts?.house
        ? (p) => houseLegalCombo(p, opts.house, occ, undefined, pool)
        : undefined,
    });
    let pieces = ids
      .map((id) => byId.get(id))
      .filter((x): x is Garment => x !== undefined && !weekUsed.has(x.id));
    const hero = lockedOk[0] ? byId.get(lockedOk[0]) : undefined;
    if (hero && !weekUsed.has(hero.id) && !pieces.some((p) => p.id === hero.id)) {
      const restP = pieces.filter((p) => {
        const s = slotOf(p);
        return s !== "top" && s !== "dress";
      });
      pieces = [hero, ...restP];
    }
    pieces = pieces.filter((p) => !weekUsed.has(p.id));
    if (pieces.length < 3 || lookClashes(pieces)) return false;
    if (!lookFitsOccasion(pieces, occ, avail) && lockedOk.length) return false;
    if (opts?.house && !houseLegalCombo(pieces, opts.house, occ, undefined, pool)) return false;
    const lookIds = pieces.map((p) => p.id);
    if (lookIds.some((id) => weekUsed.has(id))) return false;
    const key = comboKey(lookIds);
    if (keys.has(key)) return false;
    keys.add(key);
    for (const id of lookIds) weekUsed.add(id);
    const recipeId = matchRecipe(pieces, occ, opts?.house) ?? recipe.id;
    noteChapterLook(track, pieces, recipeId, occ);
    out.push({
      id: `week_${monday}_${i}`,
      name: nameOf(pieces),
      occasion: occ,
      garmentIds: lookIds,
      source: "ai",
      lookbook: true,
      recipeId,
      createdAt: `${today}T00:00:00.000Z`,
    });
    return true;
  };

  for (let i = 0; i < 7; i++) {
    const occ = WEEK_ENERGIES[i]!;
    const top = scarceTops()[0];
    if (top && pushLook(occ, [top.id], i)) continue;
    pushLook(occ, [], i);
  }
  let pad = out.length;
  while (out.length < 7 && pad < 20) {
    const occ = WEEK_ENERGIES[out.length] ?? "weekday";
    pushLook(occ, [], out.length);
    pad += 1;
  }
  return out.slice(0, 7);
}

export function mergeWeekLooks(looks: Look[], week: Look[]): Look[] {
  return [...week, ...looks.filter((l) => !l.id.startsWith("week_"))];
}

export function unusedFromLooks(garments: Garment[], looks: Look[]): Garment[] {
  const pool = lookbookPool(garments);
  const used = new Set(looks.flatMap((l) => l.garmentIds));
  return pool
    .filter((g) => !used.has(g.id))
    .sort((a, b) => daysIdle(b) - daysIdle(a) || a.id.localeCompare(b.id));
}

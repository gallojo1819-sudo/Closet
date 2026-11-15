/**
 * Post-passes on a card that has already landed. Neither one searches:
 * each tries a handful of pieces and keeps the first the card's own rules accept.
 */
import {
  cardiganPiece,
  casualCover,
  collaredShirt,
  fineKnitTop,
  flannelPiece,
  linenPiece,
  loaferOrBoot,
  nonCollaredKnit,
  sneakerPiece,
  sportCoatPiece,
  suedeShoe,
  trouserBottom,
} from "../outfit-rules.ts";
import { slotOf } from "../style.ts";
import { oversizedOf } from "../stylist/oversized.ts";
import type { Garment } from "../types.ts";

export type LayerTally = { layered: number; cards: number };
export type TailorTally = { placed: number; tried?: number };

const LAYER_TRIES = 6;
const BLAZER_TRIES = 4;
const LOAFER_TRIES = 4;
const PATTERN_TRIES = 2;

type Ok = (pieces: Garment[], relax?: readonly string[]) => boolean;

function byKey(keyOf: (g: Garment) => number) {
  return (a: Garment, b: Garment) => keyOf(b) - keyOf(a) || a.id.localeCompare(b.id);
}

function insertAt(look: readonly Garment[], piece: Garment, index: number): Garment[] {
  const next = [...look];
  next.splice(index, 0, piece);
  return next;
}

function frayedBottom(g: Garment): boolean {
  return /distress|fray|rip|destroyed|raw[- ]hem/.test(`${g.subtype} ${g.name} ${g.material ?? ""}`.toLowerCase());
}

/**
 * A shirt under a non-collared knit, or a non-collared knit over a collared shirt.
 * Stops once layered cards are half of the cards landed so far. The first
 * combination the card's own tier accepts is kept.
 */
export function layerUp(args: {
  look: Garment[];
  tops: readonly Garment[];
  keyOf: (g: Garment) => number;
  open: (g: Garment) => boolean;
  finalOk: Ok;
  relax?: readonly string[];
  tally: LayerTally;
  enabled: boolean;
}): Garment[] {
  const { look } = args;
  const cardigan = look.find(cardiganPiece);
  if (args.enabled) args.tally.cards += 1;
  if ((!args.enabled && !cardigan) || (args.enabled && args.tally.layered >= Math.ceil(args.tally.cards / 2) && !cardigan)) return look;
  const bodies = look.filter((g) => collaredShirt(g) || nonCollaredKnit(g) || cardiganPiece(g));
  if (bodies.length !== 1) return look;
  const top = bodies[0]!;
  const linen = look.some(linenPiece);
  const relax = args.relax ?? [];
  if (nonCollaredKnit(top) || cardiganPiece(top)) {
    const shirts = args.tops
      .filter((g) => args.open(g) && collaredShirt(g) && !oversizedOf(g) && !(linen && flannelPiece(g)))
      .sort(byKey(args.keyOf))
      .slice(0, LAYER_TRIES);
    const at = look.findIndex((g) => g.id === top.id);
    for (const shirt of shirts) {
      const pieces = insertAt(look, shirt, at + 1);
      if (args.finalOk(pieces, relax)) {
        if (args.enabled) args.tally.layered += 1;
        return pieces;
      }
    }
  } else if (collaredShirt(top)) {
    const knits = args.tops
      .filter((g) => args.open(g) && nonCollaredKnit(g))
      .sort(byKey(args.keyOf))
      .slice(0, LAYER_TRIES);
    const at = look.findIndex((g) => g.id === top.id);
    for (const knit of knits) {
      const pieces = insertAt(look, knit, at);
      if (args.finalOk(pieces, relax)) {
        if (args.enabled) args.tally.layered += 1;
        return pieces;
      }
    }
  }
  return look;
}

/**
 * A blazer as the mid under a casual outer, on Weekday and Out.
 * One such card a page is enough. A cable knit is not a base for it.
 */
export function tailorUp(args: {
  look: Garment[];
  layers: readonly Garment[];
  keyOf: (g: Garment) => number;
  open: (g: Garment) => boolean;
  finalOk: Ok;
  relax?: readonly string[];
  tally: TailorTally;
  occasion: string;
}): Garment[] {
  const { look, tally } = args;
  if (tally.placed >= 1) return look;
  if (args.occasion !== "weekday" && args.occasion !== "out") return look;
  if (look.some(sportCoatPiece)) {
    tally.placed += 1;
    return look;
  }
  const bodies = look.filter((g) => collaredShirt(g) || fineKnitTop(g));
  if (bodies.length !== 1) return look;
  const bottom = look.find((g) => slotOf(g) === "bottom");
  if (!bottom || !trouserBottom(bottom) || frayedBottom(bottom)) return look;
  const shoe = look.find((g) => slotOf(g) === "footwear");
  if (!shoe || !loaferOrBoot(shoe)) return look;
  tally.tried = (tally.tried ?? 0) + 1;
  if (tally.tried > 6) return look;
  const relax = args.relax ?? [];
  const blazers = args.layers
    .filter((g) => args.open(g) && sportCoatPiece(g))
    .sort(byKey(args.keyOf))
    .slice(0, BLAZER_TRIES);
  const coverAt = look.findIndex(casualCover);
  if (coverAt >= 0) {
    for (const blazer of blazers) {
      const pieces = insertAt(look, blazer, coverAt + 1);
      if (args.finalOk(pieces, relax)) {
        tally.placed += 1;
        return pieces;
      }
    }
    return look;
  }
  const outerAt = look.findIndex((g) => slotOf(g) === "outerwear");
  if (outerAt < 0 || blazers.length === 0) return look;
  const covers = args.layers.filter((g) => args.open(g) && casualCover(g)).sort(byKey(args.keyOf));
  const old = look[outerAt]!;
  const cover = covers[0];
  const blazer = blazers[0];
  if (!cover || !blazer || cover.id === blazer.id) return look;
  const swapped = look.map((g) => (g.id === old.id ? cover : g));
  const at = swapped.findIndex((g) => g.id === cover.id);
  const pieces = insertAt(swapped, blazer, at + 1);
  if (args.finalOk(pieces, relax)) {
    tally.placed += 1;
    return pieces;
  }
  return look;
}

function pieceText(g: Garment): string {
  return `${g.subtype ?? ""} ${g.name ?? ""} ${g.material ?? ""}`.toLowerCase();
}

/** A knit or sweater worn as the top. Not a polo, hoodie, cardigan or collared sweater. */
function knitSweaterTop(g: Garment): boolean {
  const slot = slotOf(g);
  if (slot !== "top" && slot !== "dress") return false;
  const b = pieceText(g);
  if (/hoodie|\bpolos?\b|cardigan/.test(b)) return false;
  if (/collar/.test(b) && /sweater|knit/.test(b)) return false;
  return /knit|sweater/.test(b);
}

/** Trousers, cords, pleats or flannel. Not denim. */
function plainTrouser(g: Garment): boolean {
  if (slotOf(g) !== "bottom") return false;
  const b = pieceText(g);
  if (/jean|\bdenim\b/.test(b)) return false;
  return /trouser|cord|pleat|flannel/.test(b);
}

function casualJacket(g: Garment): boolean {
  if (sportCoatPiece(g)) return false;
  const b = pieceText(g);
  if (/\bvests?\b|gilet/.test(b)) return false;
  return /jacket|coat/.test(b);
}

function patternedJacket(g: Garment): boolean {
  return casualJacket(g) && /plaid|check|herringbone|tweed/.test(pieceText(g));
}

function loaferPiece(g: Garment): boolean {
  return /loafer/.test(pieceText(g)) && !sneakerPiece(g);
}

/**
 * A knit, a trouser and a casual jacket on a sneaker: try a loafer, suede first.
 * Weekday and Weekend, dry days. The caller decides that.
 */
export function loaferUp(args: {
  look: Garment[];
  shoes: readonly Garment[];
  keyOf: (g: Garment) => number;
  open: (g: Garment) => boolean;
  finalOk: Ok;
  relax?: readonly string[];
}): Garment[] {
  const { look } = args;
  if (!look.some(knitSweaterTop) || !look.some(plainTrouser) || !look.some(casualJacket)) return look;
  const shoe = look.find((g) => sneakerPiece(g));
  if (!shoe) return look;
  const relax = args.relax ?? [];
  const loafers = args.shoes
    .filter((g) => args.open(g) && loaferPiece(g))
    .sort((a, b) => Number(suedeShoe(b)) - Number(suedeShoe(a)) || byKey(args.keyOf)(a, b))
    .slice(0, LOAFER_TRIES);
  for (const loafer of loafers) {
    const pieces = look.map((g) => (g.id === shoe.id ? loafer : g));
    if (args.finalOk(pieces, relax)) return pieces;
  }
  return look;
}

/**
 * A knit, a trouser, a suede loafer and a plain casual jacket: try a patterned jacket.
 */
export function patternJacket(args: {
  look: Garment[];
  layers: readonly Garment[];
  keyOf: (g: Garment) => number;
  open: (g: Garment) => boolean;
  finalOk: Ok;
  relax?: readonly string[];
}): Garment[] {
  const { look } = args;
  if (!look.some(knitSweaterTop) || !look.some(plainTrouser)) return look;
  const shoe = look.find((g) => loaferPiece(g) && /suede/.test(pieceText(g)));
  if (!shoe) return look;
  const outer = look.find((g) => casualJacket(g) && !patternedJacket(g));
  if (!outer) return look;
  const relax = args.relax ?? [];
  const jackets = args.layers
    .filter((g) => args.open(g) && patternedJacket(g))
    .sort(byKey(args.keyOf))
    .slice(0, PATTERN_TRIES);
  for (const jacket of jackets) {
    const pieces = look.map((g) => (g.id === outer.id ? jacket : g));
    if (args.finalOk(pieces, relax)) return pieces;
  }
  return look;
}

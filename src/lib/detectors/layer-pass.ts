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
  sportCoatPiece,
  trouserBottom,
} from "../outfit-rules.ts";
import { slotOf } from "../style.ts";
import { oversizedOf } from "../stylist/oversized.ts";
import type { Garment } from "../types.ts";

export type LayerTally = { layered: number; cards: number };
export type TailorTally = { placed: number; tried?: number };

const LAYER_TRIES = 6;
const BLAZER_TRIES = 4;

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

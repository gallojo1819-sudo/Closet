/**
 * The occasion gate: what a chapter admits (weekday, out, weekend, comfy, travel). One of the
 * pass/fail rules (OCC-GATE in passesRules, stylist/legal.ts), read by the Lookbook rows and by
 * Today's draw alike. A hoodie or a graphic may wear loafers with jeans or chinos (Joe, Oct 15
 * 2026): no occasion bans loafers from that look family. Pure: relative imports only.
 */
import { garmentMemo } from "./garment-memo.ts";
import { shoeFamily, type House } from "./houses.ts";
import {
  clashes,
  isBlazerPiece,
  isCampCollar,
  isDistressedJean,
  isFairIsle,
  isGraphic,
  isHoodiePiece,
  isRugbyPiece,
  isShortsPiece,
  slotOf,
} from "./style.ts";
import { mapOccasion, type Garment } from "./types.ts";

/** The piece's searchable text, built once per garment (garmentMemo tracks the fields read here). */
function pieceBlob(g: Garment): string {
  return garmentMemo(g, "lookbook.blob", buildPieceBlob);
}

function buildPieceBlob(g: Garment): string {
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

/** Whether a pool owns a kind of piece in a slot: one scan per pool, slot and pattern. */
const RACK_HAS = new WeakMap<readonly Garment[], Map<string, boolean>>();

function rackHas(pool: readonly Garment[] | undefined, slot: "top" | "bottom" | "footwear", re: RegExp): boolean {
  if (!pool) return false;
  let memo = RACK_HAS.get(pool);
  if (!memo) {
    memo = new Map();
    RACK_HAS.set(pool, memo);
  }
  const key = `${slot}|${re.source}|${re.flags}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const found = pool.some((g) => {
    const s = slotOf(g);
    if (slot === "top") {
      if (s !== "top" && s !== "dress") return false;
    } else if (s !== slot) return false;
    return re.test(pieceBlob(g));
  });
  memo.set(key, found);
  return found;
}

/**
 * A top with sleeves to the wrist: a shirt (button-down, flannel, dress shirt, denim), a sweater
 * or cardigan, a long-sleeve polo, a henley or a sweatshirt. Tees, tanks, camp and bowling
 * shirts and anything marked short-sleeve are not. Hoodies and graphics fail weekday elsewhere.
 */
export function isLongSleeveTop(g: Garment): boolean {
  const slot = slotOf(g);
  if (slot !== "top" && slot !== "dress") return false;
  const b = pieceBlob(g);
  if (/long[- ]?sleeved?|dress shirt/.test(b)) return true;
  if (/\bt-?shirts?\b|\btees?\b|\btanks?\b|short[- ]?sleeved?|\bcamp\b|bowling|hawaiian|resort|\bdress(es)?\b/.test(b)) return false;
  return /shirt|oxford|button|flannel|chambray|denim|poplin|sweater|knit|cardigan|cable|merino|polo|henley|turtleneck|roll ?neck|sweatshirt|quarter[- ]?zip|half[- ]?zip|pullover|rugby|overshirt|jumper|crewneck/.test(
    b,
  );
}

export type OccasionGateOptions = {
  /** Weekday admits any long-sleeve top (isLongSleeveTop), not only oxfords, polos and knits. The rotation rows and Today use this; the engine's stored rows do not. */
  wideWeekdayTops?: boolean;
};

export function lookFitsOccasion(
  pieces: Garment[],
  occ: string,
  pool?: readonly Garment[],
  house?: House,
  gate?: OccasionGateOptions,
): boolean {
  if (occ === "all") return true;
  if (clashes(pieces)) return false;
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
    if (house === "rrl") {
      const work = /western|pearl\s*snap|work shirt|chambray|flannel/.test(blob);
      const denim = jean || /selvedge|denim/.test(blob);
      const fashion = shoes.some((g) => {
        const b = pieceBlob(g);
        return /sneaker/.test(b) && !/court|\b990\b|\bboot/.test(b);
      });
      const court = shoes.some((g) => /court/.test(pieceBlob(g)));
      if (loafer || mule || fashion || court) return false;
      if (!(denim || work)) return false;
      const ownsBoot = (pool ?? pieces).some((g) => shoeFamily(g) === "boot");
      if (ownsBoot) return boot || /chelsea/.test(blob);
      return true;
    }
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
    const longSleeve = Boolean(gate?.wideWeekdayTops) && tops.some(isLongSleeveTop);
    if (!(oxford || polo || cable || knit || longSleeve)) return false;
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
    /* A hoodie or a graphic wears jeans or chinos with a sneaker or a loafer: loafers are not banned from that look. */
    if ((hoodie || graphic) && !((jean || chino) && (sneaker || loafer))) return false;
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
    const cordHere = /cord/.test(blob) || hasKind(bottoms, /cord/);
    const bootHere = hasKind(shoes, /boot/);
    const muleHere = hasKind(shoes, /mule/);
    const topOk = knit || rugby || varsity || hoodie || fairIsle || polo;
    const botOk = chino || jean || cordHere;
    const shoeOk = sneaker || muleHere || loafer || bootHere;
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

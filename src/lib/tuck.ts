import { mapOccasion, type Garment, type Occasion } from "./types.ts";
import { oversizedOf } from "./stylist/oversized.ts";
import { isShortOuter } from "./stylist/short-outer.ts";

export type Tuck = "in" | "out" | "either";

export function guessTuck(
  g: Pick<Garment, "name" | "subtype"> & { notes?: string },
): Tuck {
  const notes = (g.notes ?? "").toLowerCase();
  if (/untuck|\buntucked\b/.test(notes)) return "out";
  if (/\btucked\b|\btuck in\b|\btuck it\b|shirt-?tail in/.test(notes)) return "in";
  const blob = `${g.subtype} ${g.name} ${g.notes ?? ""}`.toLowerCase();
  if (/camp[- ]?collar|camp\s*shirt|straight hem|resort|\bcuban\b/.test(blob)) {
    return "out";
  }
  if (/oxford|shirttail|shirt-tail|point collar|spread collar/.test(blob)) {
    return "in";
  }
  if (/polo|rugby|overshirt/.test(blob)) return "either";
  return "either";
}

export function tuckOf(g: Garment): Tuck {
  return g.tuck ?? guessTuck(g);
}

/**
 * A shirt that cannot be tucked: the saved out chip, an untuck note, a camp or
 * straight hem, or an oversized top. A vest does not tuck these.
 */
export function shirtLockedOut(g: Garment): boolean {
  if (g.tuck === "out") return true;
  const notes = (g.notes ?? "").toLowerCase();
  if (/untuck|\buntucked\b/.test(notes)) return true;
  if (guessTuck(g) === "out") return true;
  if (oversizedOf(g)) return true;
  return false;
}

export function isShirtLike(g: Garment): boolean {
  const b = `${g.subtype} ${g.name}`.toLowerCase();
  return /shirt|oxford|polo|rugby|camp|overshirt|collar|henley/.test(b);
}

/**
 * Sweaters, half-zips, quarter-zips, cardigans, knit or fleece pullovers, and
 * sweatshirts. A knit polo or knit shirt stays a shirt. A hoodie is not a knit.
 * isShirtLike is unchanged, so a sweatshirt still matches it for On You; the
 * plate treats that word as a knit.
 */
export function isKnitTop(g: Garment): boolean {
  const blob = `${g.subtype} ${g.name}`.toLowerCase();
  if (/hoodie/.test(blob)) return false;
  const knitWord = /sweater|knit|cardigan|half-?zip|quarter-?zip|pullover|fleece/.test(blob);
  if (!knitWord) return false;
  return !isShirtLike(g) || /sweatshirt/.test(blob);
}

/** "tucked" only for a real shirt. A sweatshirt or knit worn in says nothing. */
export function tuckMark(
  d: "in" | "out" | "none",
  lead: Garment | null,
): "untucked" | "tucked" | null {
  switch (d) {
    case "out":
      return "untucked";
    case "in": {
      if (!lead) return null;
      const blob = `${lead.subtype} ${lead.name}`.toLowerCase();
      // A sweatshirt matches isShirtLike ("shirt"). So does a collared sweater
      // and a knit shirt. None of those are labeled tucked.
      if (/sweatshirt/.test(blob)) return null;
      if (/sweat|sweater|knit|zip|fleece|cardigan|pullover/.test(blob)) return null;
      if (isShirtLike(lead)) return "tucked";
      return null;
    }
    case "none":
      return null;
    default: {
      const never: never = d;
      return never;
    }
  }
}

/**
 * How this shirt is worn. An oversized top is always out. A shirt under a vest
 * or cropped layer is in, unless it is locked out. A learned never-tuck habit
 * comes after those two. The saved chip still wins for every other look.
 */
export function resolveTuck(
  g: Garment,
  occasion?: Occasion,
  pieces?: readonly Garment[],
  neverTuck?: readonly string[],
): "in" | "out" {
  if (oversizedOf(g)) return "out";
  if (
    (pieces ?? []).some(isShortOuter) &&
    isShirtLike(g) &&
    !isKnitTop(g) &&
    !shirtLockedOut(g)
  ) {
    return "in";
  }
  if (neverTuck?.includes(g.id)) return "out";
  if (g.tuck === "in") return "in";
  if (g.tuck === "out") return "out";
  const notes = (g.notes ?? "").toLowerCase();
  if (/untuck|\buntucked\b/.test(notes)) return "out";
  if (/\btucked\b|\btuck in\b|\btuck it\b|shirt-?tail in/.test(notes)) return "in";
  const blob = `${g.subtype} ${g.name}`.toLowerCase();
  const oxford = /oxford/.test(blob);
  const polo = /polo/.test(blob);
  const camp = /camp/.test(blob);
  const knit = /knit|sweater/.test(blob) && !/hoodie/.test(blob);
  const blazer = (pieces ?? []).some((p) =>
    /blazer|sport\s*coats?/.test(`${p.subtype} ${p.name}`.toLowerCase()),
  );
  const occ = occasion == null ? undefined : mapOccasion(occasion);
  if (occ === "weekday" || occ === "out") {
    if (oxford) return "in";
    if (polo) return blazer ? "in" : "out";
    return "in";
  }
  if (occ === "weekend" || occ === "comfy") {
    if (camp || polo || oxford) return "out";
    return "out";
  }
  if (occ === "travel") {
    if (knit || oxford) return "out";
    return "out";
  }
  return oxford ? "in" : camp ? "out" : "in";
}

export function tuckDressingLines(
  pieces: Garment[],
  occasion?: Occasion,
  neverTuck?: readonly string[],
): string {
  const lines: string[] = [];
  for (const g of pieces) {
    if (!isShirtLike(g)) continue;
    const how = resolveTuck(g, occasion, pieces, neverTuck);
    if (how === "in") {
      lines.push(
        `Tuck THIS shirt (${g.name}). Shirt-tail in, clean belt line. Not a blousy untuck.`,
      );
    } else {
      lines.push(
        `Wear THIS shirt UNTUCKED (${g.name}). Hem on the hip. Do not stuff it in.`,
      );
    }
  }
  return lines.join(" ");
}

export function onlyTopIsUntucked(pieces: Garment[]): boolean {
  const tops = pieces.filter((g) => {
    const b = `${g.subtype} ${g.name}`.toLowerCase();
    if (/hoodie|sweatshirt/.test(b)) return false;
    return /shirt|oxford|polo|rugby|camp|overshirt|collar/.test(b);
  });
  if (!tops.length) return false;
  return tops.every((g) => tuckOf(g) === "out");
}

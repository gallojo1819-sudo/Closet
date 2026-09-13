import { mapOccasion, type Garment, type Occasion } from "./types.ts";

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

function isShirtLike(g: Garment): boolean {
  const b = `${g.subtype} ${g.name}`.toLowerCase();
  return /shirt|oxford|polo|rugby|camp|overshirt|collar|henley/.test(b);
}

/** How this shirt is worn for this occasion. User chip in/out still wins. */
export function resolveTuck(
  g: Garment,
  occasion?: Occasion,
  pieces?: Garment[],
): "in" | "out" {
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
  if (occ === "weekend") {
    if (camp || polo || oxford) return "out";
    return "out";
  }
  if (occ === "travel") {
    if (knit || oxford) return "out";
    return "out";
  }
  return oxford ? "in" : camp ? "out" : "in";
}

export function tuckDressingLines(pieces: Garment[], occasion?: Occasion): string {
  const lines: string[] = [];
  for (const g of pieces) {
    if (!isShirtLike(g)) continue;
    const how = resolveTuck(g, occasion, pieces);
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

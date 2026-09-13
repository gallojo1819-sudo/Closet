import type { Garment, Occasion } from "./types.ts";

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

/** How this shirt is worn for this occasion. */
export function resolveTuck(g: Garment, occasion?: Occasion): "in" | "out" {
  const t = tuckOf(g);
  if (t === "in") return "in";
  if (t === "out") return "out";
  const blob = `${g.subtype} ${g.name}`.toLowerCase();
  const polo = /polo/.test(blob);
  if (polo) {
    if (occasion === "client" || occasion === "dinner") return "in";
    if (occasion === "weekend" || occasion === "travel") return "out";
  }
  if (occasion === "client" || occasion === "dinner") return "in";
  if (occasion === "weekend" || occasion === "travel") return "out";
  return "in";
}

export function tuckDressingLines(pieces: Garment[], occasion?: Occasion): string {
  const lines: string[] = [];
  for (const g of pieces) {
    if (!isShirtLike(g)) continue;
    const how = resolveTuck(g, occasion);
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

import { titleColor } from "./color.ts";
import type { Category, Garment } from "./types.ts";

function colorLead(g: Garment): string {
  if (g.colors[0]) return titleColor(g.colors[0]);
  const m = g.name.match(
    /^(dark |light |pale |bright |deep |off )?([a-z]+(?: [a-z]+)?)\s+/i,
  );
  return m ? titleColor((m[1] ?? "") + (m[2] ?? "")) : "";
}

/** Drawstring / empty / "Piece" — not a name he chose. */
export function isPlaceholderName(name: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (/^piece$/i.test(n)) return true;
  if (/drawstring/i.test(n)) return true;
  return false;
}

/**
 * Notes describe the make. Gurkha / extended waist / buckle → subtype gurkha,
 * bottom, and retitle only when the current name is a placeholder.
 */
export function patchFromNotes(g: Garment, notes: string): Partial<Garment> {
  const text = notes.trim();
  const patch: Partial<Garment> = { notes: text };
  const blob = `${text} ${g.subtype} ${g.name}`.toLowerCase();
  if (/gurkha|extended\s+waist|\bbuckle/.test(blob)) {
    patch.subtype = "gurkha";
    patch.category = "bottom" as Category;
    if (isPlaceholderName(g.name)) {
      const color = colorLead(g);
      patch.name = color ? `${color} Gurkha trousers` : "Gurkha trousers";
    }
  }
  return patch;
}

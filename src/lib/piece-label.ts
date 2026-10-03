import type { Garment } from "./types.ts";

/** Color, then brand, then material. Skip a token already written in the name. */
function distinguisher(g: Garment): string | null {
  const name = g.name.trim().toLowerCase();
  const candidates = [...(g.colors ?? []), g.brand, g.material];
  for (const raw of candidates) {
    const token = (raw ?? "").trim();
    if (!token) continue;
    const low = token.toLowerCase();
    if (low === name) continue;
    if (name.includes(low)) continue;
    return token;
  }
  return null;
}

/**
 * Keep the plate name. When another piece in the pool has the same name,
 * append brand, else fit, else subtype, else the second color.
 * Does not write garment.name.
 */
export function pieceLabel(g: Garment, pool: readonly Garment[]): string {
  const key = g.name.trim().toLowerCase();
  const shared = pool.some((other) => other.id !== g.id && other.name.trim().toLowerCase() === key);
  if (!shared) return g.name;
  const extra = distinguisher(g);
  if (!extra) return g.name;
  return `${g.name} · ${extra}`;
}

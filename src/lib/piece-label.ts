/**
 * The label a piece shows. The stored name stands (its colour and pattern words with it); when
 * other pieces in the pool share the name, each gets a suffix that is unique within that
 * same-name group: a colour the name does not say, then the material, the subtype, the fit.
 * A piece with nothing unique keeps the plain name once, then "· 2", "· 3" in a stable order
 * (createdAt, then id). Maker text is never a label (no house names in Closet). Does not
 * write garment.name.
 */
import type { Garment } from "./types.ts";

type Named = Pick<Garment, "id" | "name" | "colors" | "material" | "subtype" | "fit" | "createdAt">;

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Suffix candidates in order, lowercased, none already said by the name. */
function candidates(g: Named): string[] {
  const name = nameKey(g.name);
  const raw = [...(g.colors ?? []), g.material, g.subtype, g.fit];
  const out: string[] = [];
  for (const token of raw) {
    const low = (token ?? "").trim().toLowerCase();
    if (!low || low === name || name.includes(low) || out.includes(low)) continue;
    out.push(low);
  }
  return out;
}

function sameNameGroup(g: Named, pool: readonly Named[]): Named[] {
  const key = nameKey(g.name);
  const group = pool.filter((other) => nameKey(other.name) === key);
  if (!group.some((other) => other.id === g.id)) group.push(g);
  return group.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/**
 * The suffix for `g` within its same-name group, or null for the plain name. A token held by
 * exactly one member is that member's; members with no such token are ordered, the first keeps
 * the plain name and the rest take their ordinal.
 */
function suffixFor(g: Named, group: readonly Named[]): string | null {
  if (group.length < 2) return null;
  const mine = candidates(g);
  const holders = new Map<string, number>();
  for (const member of group) for (const token of new Set(candidates(member))) holders.set(token, (holders.get(token) ?? 0) + 1);
  const unique = (list: readonly string[]) => list.find((token) => holders.get(token) === 1) ?? null;
  const own = unique(mine);
  if (own) return own;
  const plain = group.filter((member) => !unique(candidates(member)));
  const at = plain.findIndex((member) => member.id === g.id);
  return at <= 0 ? null : String(at + 1);
}

/** The label: the stored name, with a group-unique suffix when the pool shares the name. */
export function pieceLabel(g: Named, pool: readonly Named[]): string {
  const suffix = suffixFor(g, sameNameGroup(g, pool));
  return suffix ? `${g.name} · ${suffix}` : g.name;
}

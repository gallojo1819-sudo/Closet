import { looksLikeFilename } from "./guess.ts";
import { titleColor } from "./color.ts";
import type { DailyDrop, Garment, Look, WearEntry } from "./types.ts";

type SeenMap = Record<string, string[]>;

export function livePool(garments: Garment[]): Garment[] {
  const real = garments.filter((g) => !g.archived && g.demo !== true);
  return real.length ? real : garments.filter((g) => !g.archived);
}

export function hasRealPieces(garments: Garment[]): boolean {
  return garments.some((g) => g.demo !== true && !g.archived);
}

export function isFakeName(name: string): boolean {
  const n = (name ?? "").trim();
  if (!n) return true;
  if (/\bpiece\b/i.test(n)) return true;
  if (/img_/i.test(n) || looksLikeFilename(n)) return true;
  if (/farfetch|ssense|net-a-porter|mr\s?porter|add to bag|\bID\b/i.test(n)) return true;
  return false;
}

export function nameFromPixels(
  g: Pick<Garment, "category" | "subtype" | "name">,
  colors: string[],
): string {
  const lead = titleColor(colors[0] || "cream") || "Cream";
  const b = `${g.subtype} ${g.category} ${g.name}`.toLowerCase();
  const second = colors[1];
  const jacketish =
    g.category === "outerwear" ||
    g.category === "other" ||
    /jacket|varsity|bomber|letterman|sleeve/.test(b) ||
    isFakeName(g.name);
  if (second && second !== colors[0] && jacketish && g.category !== "bottom" && g.category !== "footwear") {
    return `${lead} varsity`;
  }
  let kind = (g.subtype ?? "").trim();
  if (!kind || isFakeName(kind) || /\bpiece\b/i.test(kind)) {
    if (g.category === "footwear") kind = "shoes";
    else if (g.category === "bottom") kind = "trousers";
    else if (g.category === "outerwear") kind = "jacket";
    else if (g.category === "top") kind = "top";
    else kind = "knit";
  }
  return `${lead} ${kind}`;
}

export function resolveLookIds(ids: string[], allowed: Set<string>): string[] {
  return ids.filter((id) => allowed.has(id));
}

export function scrubLooks(looks: Look[], allowed: Set<string>): Look[] {
  const out: Look[] = [];
  for (const l of looks) {
    const ids = resolveLookIds(l.garmentIds, allowed);
    if (ids.length < 2) continue;
    out.push(ids.length === l.garmentIds.length ? l : { ...l, garmentIds: ids });
  }
  return out;
}

function scrubSeen(seen: SeenMap | undefined, allowed: Set<string>): SeenMap {
  const out: SeenMap = {};
  for (const [k, arr] of Object.entries(seen ?? {})) {
    out[k] = (arr ?? []).filter((key) => key.split("|").every((id) => allowed.has(id)));
  }
  return out;
}

export type ClosetRack = {
  garments: Garment[];
  looks: Look[];
  drop: DailyDrop | null;
  journal: WearEntry[];
  seenLooks?: SeenMap;
};

/**
 * Same fileHash + same name: keep the older, archive the newer, rewrite looks.
 * Same name, different fileHash: leave both.
 */
export function dedupeSameFileHash<T extends ClosetRack>(
  garments: T["garments"],
  looks: T["looks"],
): { garments: T["garments"]; looks: T["looks"] } {
  const keep = new Map<string, string>();
  const replace = new Map<string, string>();
  const sorted = [...garments].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const garmentsOut = garments.map((g) => ({ ...g }));
  for (const g of sorted) {
    const hash = (g.fileHash ?? "").trim();
    if (!hash) continue;
    const key = `${hash}::${(g.name ?? "").trim().toLowerCase()}`;
    const kept = keep.get(key);
    if (!kept) {
      keep.set(key, g.id);
      continue;
    }
    if (kept === g.id) continue;
    replace.set(g.id, kept);
    const row = garmentsOut.find((x) => x.id === g.id);
    if (row) row.archived = true;
  }
  if (replace.size === 0) return { garments: garmentsOut, looks };
  const looksOut = looks.map((l) => ({
    ...l,
    garmentIds: [...new Set(l.garmentIds.map((id) => replace.get(id) ?? id))],
  }));
  return { garments: garmentsOut, looks: looksOut };
}

/** If any real piece exists, demo rows are gone. Looks keep only ids that resolve. */
export function scrubRack<T extends ClosetRack>(state: T): T & { purgedIds: string[] } {
  const hasReal = hasRealPieces(state.garments);
  const purgedIds = hasReal ? state.garments.filter((g) => g.demo === true).map((g) => g.id) : [];
  let garments = hasReal ? state.garments.filter((g) => g.demo !== true) : state.garments;
  let looks = state.looks;
  const deduped = dedupeSameFileHash(garments, looks);
  garments = deduped.garments;
  looks = deduped.looks;
  const allowed = new Set(garments.filter((g) => !g.archived).map((g) => g.id));
  looks = scrubLooks(looks, allowed);
  let drop = state.drop;
  if (drop) {
    const ids = drop.garmentIds.filter((id) => allowed.has(id));
    const locked = (drop.lockedIds ?? []).filter((id) => allowed.has(id));
    if (ids.length < 2) drop = null;
    else {
      drop = {
        ...drop,
        garmentIds: ids,
        lockedIds: locked.length ? locked : drop.lockedIds,
      };
    }
  }
  const journal = state.journal.map((j) => ({
    ...j,
    garmentIds: j.garmentIds.filter((id) => allowed.has(id)),
  })).filter((j) => j.garmentIds.length > 0);
  return {
    ...state,
    garments,
    looks,
    drop,
    journal,
    seenLooks: scrubSeen(state.seenLooks, allowed),
    purgedIds,
  };
}

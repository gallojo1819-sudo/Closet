/**
 * The stylist composes. The engine only lists the rack he may see.
 * Results stay in memory. They are not written to closet.v6.
 */
import { lookClashes } from "./lookbook.ts";
import { livePool } from "./rack.ts";
import { daysIdle, slotOf } from "./style.ts";
import type { Garment, Look, Occasion, Season } from "./types.ts";
import { todayISO } from "./utils.ts";

export const COMPOSE_MODEL = "grok-4.5";
export const COMPOSE_TEMPERATURE = 0.2;
export const COMPOSE_TIMEOUT_MS = 45_000;
export const COMPOSE_MAX_TOKENS = 1200;
export const STYLIST_SILENT = "The stylist didn’t answer — try again.";
export const STYLIST_HOLDS = "Nothing in this chapter holds.";
export const NOT_ON_RACK = "those ids are not on the rack.";
export const NOT_THESE_LINE = "not these ids.";
export const RESHUFFLING = "Reshuffling…";

export const COMPOSE_SYSTEM = `You dress Joe, 5′8, NYC.
Weekday is Ralph: a shirt, polo, or knit, a trouser or a clean jean, a leather shoe. A jacket only if it finishes the look. Out is the same idea, sharper, after dark. Weekend is easier: jean, knit or hoodie, sneaker or boot. Travel is the same clothes, one layer he can take off. Comfy is knit, cord or jean, a shoe he can walk in.
ALD is a jean and a sneaker. It may also be a loafer. It is never a blazer with a hoodie.
Italian is a knit or a camp collar, a trouser, a suede loafer. Sweet Stable may be a weekday: fair isle or gingham, cord, a boot or loafer.
One top. One bottom. One shoe. One jacket or none. A hoodie is never a coat.
Refuse a costume: graphic knit with pleats and loafers, two loud patterns, blazer with rugby, blazer with a mule.
Prefer pieces he has not worn. Do not invent a name or an id.
Return JSON only: looks, each with ids, name, and why.
Copy ids from the list, character for character. An id you invent will be thrown out.
Three looks, or fewer if only one is honest. Two looks must differ in at least two pieces.`;

export type RackPiece = {
  id: string;
  name: string;
  category: string;
  subtype: string;
  colors: string[];
  formality: number;
  idle: number;
};

export type ComposedLook = {
  ids: string[];
  name: string;
  why: string;
};

const cache = new Map<string, ComposedLook[]>();
const inflight = new Map<string, Promise<{ ok: true; looks: ComposedLook[] } | { ok: false; error: string }>>();

function pieceInSeason(g: Garment, season: Season): boolean {
  return !g.seasons?.length || g.seasons.includes(season);
}

function wearable(g: Garment): boolean {
  const slot = slotOf(g);
  return slot === "top" || slot === "bottom" || slot === "footwear" || slot === "outerwear" || slot === "dress";
}

/** Confirmed pieces for this season. Idle first. Not an outfit. */
export function composeRack(garments: Garment[], season: Season, today = todayISO()): Garment[] {
  return livePool(garments)
    .filter((g) => g.id && wearable(g) && pieceInSeason(g, season))
    .filter((g) => {
      const name = g.name.trim().toLowerCase();
      return name !== "new piece" && name !== "brown top" && !/\bpiece\b/i.test(g.name);
    })
    .sort((a, b) => daysIdle(b, today) - daysIdle(a, today) || a.id.localeCompare(b.id));
}

export function rackRow(g: Garment, today = todayISO()): string {
  return [
    g.id,
    g.name,
    g.category,
    g.subtype ?? "",
    (g.colors ?? []).join("/"),
    String(g.formality ?? ""),
    String(daysIdle(g, today)),
  ].join("\t");
}

export function composeMessage(
  garments: Garment[],
  ask: { occasion: string; season: string; house: string },
  notThese: string[][] = [],
  today = todayISO(),
): string {
  const lines = garments.map((g) => rackRow(g, today));
  const skip = notThese
    .map((ids) => [...ids].sort().join(","))
    .filter(Boolean);
  const head = `Ask: ${ask.occasion}, ${ask.season}, ${ask.house}.`;
  const body = [head, ...lines];
  if (skip.length) body.push("", `not these ids: ${skip.join(" | ")}`);
  return body.join("\n");
}

export function composeCacheKey(
  occasion: string,
  season: string,
  house: string,
  ids: string[],
  notThese: string[][] = [],
): string {
  const rack = [...ids].sort().join(",");
  const skip = notThese
    .map((row) => [...row].sort().join(","))
    .filter(Boolean)
    .sort()
    .join(";");
  return skip
    ? `${occasion}|${season}|${house}|${rack}|not|${skip}`
    : `${occasion}|${season}|${house}|${rack}`;
}

export function parseCompose(text: string): ComposedLook[] | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { looks?: unknown };
    if (!Array.isArray(parsed.looks)) return null;
    const looks: ComposedLook[] = [];
    for (const row of parsed.looks) {
      if (!row || typeof row !== "object") continue;
      const item = row as { ids?: unknown; name?: unknown; why?: unknown };
      const ids = Array.isArray(item.ids)
        ? item.ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        : [];
      if (!ids.length) continue;
      looks.push({
        ids,
        name: typeof item.name === "string" ? item.name.trim().slice(0, 48) : "",
        why: typeof item.why === "string" ? item.why.trim().slice(0, 180) : "",
      });
    }
    return looks;
  } catch {
    return null;
  }
}

function sameIds(a: string[], b: string[]): boolean {
  const left = [...a].sort().join(",");
  return left === [...b].sort().join(",");
}

function differs(prev: string[], next: string[]): boolean {
  const have = new Set(prev);
  return next.filter((id) => !have.has(id)).length >= 2;
}

function hoodieWithLoafer(pieces: Garment[]): boolean {
  const blob = (g: Garment) => `${g.name} ${g.subtype ?? ""}`.toLowerCase();
  const hoodie = pieces.some((g) => /hoodie|sweatshirt/.test(blob(g)));
  const loafer = pieces.some((g) => /loafer/.test(blob(g)));
  return hoodie && loafer;
}

/**
 * Drop an invented id. Drop a look that then has fewer than three real pieces.
 * Drop a costume and a look that repeats the previous one.
 */
/** Every returned look is one of the banned id sets. */
export function repeatsBlocked(raw: ComposedLook[], blocked: string[][]): boolean {
  if (!raw.length || !blocked.length) return false;
  const ban = new Set(blocked.map((ids) => [...ids].sort().join(",")));
  return raw.every((look) => ban.has([...look.ids].sort().join(",")));
}

export function allIdsInvented(raw: ComposedLook[], rack: Garment[]): boolean {
  const ids = raw.flatMap((look) => look.ids);
  if (!ids.length) return false;
  const have = new Set(rack.map((g) => g.id));
  return ids.every((id) => !have.has(id));
}

export function validateCompose(
  raw: ComposedLook[],
  rack: Garment[],
  notThese: string[][] = [],
  opts?: { clashes?: boolean },
): ComposedLook[] {
  const byId = new Map(rack.map((g) => [g.id, g]));
  const kept: ComposedLook[] = [];
  for (const look of raw) {
    const ids: string[] = [];
    for (const id of look.ids) {
      if (!byId.has(id) || ids.includes(id)) continue;
      ids.push(id);
    }
    if (ids.length < 3) continue;
    if (notThese.some((prev) => sameIds(prev, ids))) continue;
    if (kept.some((prev) => !differs(prev.ids, ids))) continue;
    const pieces = ids.map((id) => byId.get(id)!);
    if (opts?.clashes !== false && (hoodieWithLoafer(pieces) || lookClashes(pieces))) continue;
    const name =
      look.name ||
      pieces
        .slice(0, 3)
        .map((g) => g.name)
        .join(" · ")
        .slice(0, 48);
    kept.push({ ids, name, why: look.why });
    if (kept.length >= 3) break;
  }
  return kept;
}

/**
 * A hoodie with a loafer can still drop.
 * If that check is the only reason three real looks are gone, keep the model's looks.
 */
export function settleCompose(
  raw: ComposedLook[],
  rack: Garment[],
  notThese: string[][] = [],
): ComposedLook[] {
  const strict = validateCompose(raw, rack, notThese);
  if (strict.length) return strict;
  const real = validateCompose(raw, rack, notThese, { clashes: false });
  if (real.length >= 3) return real;
  return [];
}

export function stylistMiss(error: string): "silent" | "holds" {
  if (error === "holds") return "holds";
  return "silent";
}

export function toShownLook(look: ComposedLook, occasion: Occasion): Look {
  return {
    id: `compose_${occasion}_${[...look.ids].sort().join("_")}`,
    name: look.name,
    occasion,
    garmentIds: look.ids,
    source: "ai",
    lookbook: false,
    createdAt: "2026-09-26T00:00:00.000Z",
  };
}

export type ComposeCall = { ok: true; looks: ComposedLook[] } | { ok: false; error: string };

export function peekCompose(key: string): ComposedLook[] | undefined {
  return cache.get(key);
}

export function rememberCompose(key: string, looks: ComposedLook[]): void {
  if (looks.length) cache.set(key, looks);
}

/** Cached chapter paints now. A miss clears and waits. No engine trio. */
export function chapterPaint(cached: ComposedLook[] | undefined): {
  showCards: boolean;
  building: boolean;
  call: boolean;
} {
  if (cached && cached.length) return { showCards: true, building: false, call: false };
  return { showCards: false, building: true, call: true };
}

/** Try again on this chip keeps the cards. A different chip does not. */
export function keepCardsOnFail(hadCards: boolean, kind: "silent" | "holds"): boolean {
  return hadCards && kind === "silent";
}

/** One key, one call. A new chip or a reshuffle exclusion is a new key. */
export async function composeOnce(
  key: string,
  run: () => Promise<ComposeCall>,
): Promise<ComposeCall & { called: boolean }> {
  const hit = cache.get(key);
  if (hit) return { ok: true, looks: hit, called: false };
  const pending = inflight.get(key);
  if (pending) {
    const result = await pending;
    return { ...result, called: false };
  }
  const task = run()
    .then((result) => {
      if (result.ok && result.looks.length) cache.set(key, result.looks);
      return result;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, task);
  const result = await task;
  return { ...result, called: true };
}

export function clearComposeCache(): void {
  cache.clear();
  inflight.clear();
}

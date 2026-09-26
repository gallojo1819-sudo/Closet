/**
 * One critic call per chapter. It does not invent pieces and it does not
 * write closet.v6. A rejected row never renders.
 */
import type { Garment, Look, Occasion } from "./types.ts";

export const CRITIC_SYSTEM = `You dress Joe, 5′8, NYC. Ralph on a weekday, Italian when the pieces are knit / camp / suede, ALD only when it is a jean and a sneaker. Refuse a costume. One top, one bottom, one shoe, one jacket or none. A hoodie is not a coat and does not go with loafers or pleated trousers. A blazer does not go with a hoodie or a rugby. Do not invent a piece that is not in the row. If the names are "New piece" or "Brown top", do not invent a story — reject that row.
Return JSON only: { "keep": ["id,id,id"], "reject": ["id,id,id"], "why": "one line" }.
keep is 1 to 3 looks.`;

export const CRITIC_MAX = 8;

export type CriticPiece = {
  id: string;
  name: string;
  category: string;
  subtype: string;
  colors: string[];
};

export type CriticRow = {
  key: string;
  pieces: CriticPiece[];
};

export type CriticVerdict = {
  keep: string[];
  reject: string[];
  why: string;
};

const cache = new Map<string, CriticVerdict>();
const inflight = new Map<string, Promise<{ ok: true; verdict: CriticVerdict } | { ok: false; error: string }>>();

export function criticKey(ids: string[]): string {
  return [...ids].filter(Boolean).sort().join(",");
}

export function badCriticName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === "new piece" || n === "brown top";
}

export function criticRows(
  looks: Look[],
  garments: Garment[],
): CriticRow[] {
  const byId = new Map(garments.map((g) => [g.id, g]));
  const rows: CriticRow[] = [];
  const seen = new Set<string>();
  for (const look of looks) {
    const pieces = look.garmentIds
      .map((id) => byId.get(id))
      .filter((g): g is Garment => Boolean(g));
    if (pieces.length < 3) continue;
    const key = criticKey(pieces.map((g) => g.id));
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      key,
      pieces: pieces.map((g) => ({
        id: g.id,
        name: g.name,
        category: g.category,
        subtype: g.subtype ?? "",
        colors: [...(g.colors ?? [])],
      })),
    });
    if (rows.length >= CRITIC_MAX) break;
  }
  return rows;
}

export function criticCacheKey(
  occasion: string,
  season: string,
  house: string,
  rows: CriticRow[],
): string {
  return `${occasion}|${season}|${house}|${rows.map((r) => r.key).join(";")}`;
}

/** Weekday and weekend do not show the same three pieces. */
export function dropSharedTrios(rows: Look[], blocked: Look[]): Look[] {
  const ban = new Set(blocked.map((l) => criticKey(l.garmentIds)));
  if (!ban.size) return rows;
  return rows.filter((l) => !ban.has(criticKey(l.garmentIds)));
}

export function parseCriticVerdict(text: string): CriticVerdict | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      keep?: unknown;
      reject?: unknown;
      why?: unknown;
    };
    const list = (value: unknown) =>
      Array.isArray(value)
        ? value
            .filter((item): item is string => typeof item === "string")
            .map((item) => criticKey(item.split(",")))
            .filter(Boolean)
        : [];
    const why = typeof parsed.why === "string" ? parsed.why.trim().slice(0, 180) : "";
    return { keep: list(parsed.keep).slice(0, 3), reject: list(parsed.reject), why };
  } catch {
    return null;
  }
}

/**
 * Kept rows only, at most 3. A key the model invented is ignored.
 * "New piece" and "Brown top" never render.
 */
export function applyCritic(looks: Look[], garments: Garment[], verdict: CriticVerdict): Look[] {
  const byId = new Map(garments.map((g) => [g.id, g]));
  const allowed = new Set(criticRows(looks, garments).map((r) => r.key));
  const keep = verdict.keep
    .map((key) => criticKey(key.split(",")))
    .filter((key) => allowed.has(key));
  const reject = new Set(verdict.reject.map((key) => criticKey(key.split(","))));
  const out: Look[] = [];
  const seen = new Set<string>();
  for (const key of keep) {
    if (reject.has(key) || seen.has(key)) continue;
    const look = looks.find((l) => criticKey(l.garmentIds) === key);
    if (!look) continue;
    const pieces = look.garmentIds.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
    if (pieces.some((g) => badCriticName(g.name))) continue;
    seen.add(key);
    out.push(look);
    if (out.length >= 3) break;
  }
  return out;
}

/** 403 or timeout. No extra looks. Clashes and unnamed rows stay out. */
export function fallbackChapter(
  looks: Look[],
  garments: Garment[],
  clashes: (pieces: Garment[]) => boolean,
): Look[] {
  const byId = new Map(garments.map((g) => [g.id, g]));
  const out: Look[] = [];
  const seen = new Set<string>();
  for (const look of looks) {
    const pieces = look.garmentIds.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
    if (pieces.length < 3 || clashes(pieces)) continue;
    if (pieces.some((g) => badCriticName(g.name))) continue;
    const key = criticKey(pieces.map((g) => g.id));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(look);
  }
  return out;
}

export function holdsLine(count: number): string | null {
  return count === 1 ? "1 look that holds." : null;
}

export type CriticCall = { ok: true; verdict: CriticVerdict } | { ok: false; error: string };

/** Same chapter key shares one call. A new key (chip or reshuffle) is the next call. */
export async function judgeOnce(
  key: string,
  run: () => Promise<CriticCall>,
): Promise<CriticCall & { called: boolean }> {
  const hit = cache.get(key);
  if (hit) return { ok: true, verdict: hit, called: false };
  const pending = inflight.get(key);
  if (pending) {
    const result = await pending;
    return { ...result, called: false };
  }
  const task = run()
    .then((result) => {
      if (result.ok) cache.set(key, result.verdict);
      return result;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, task);
  const result = await task;
  return { ...result, called: true };
}

export function clearCriticCache(): void {
  cache.clear();
  inflight.clear();
}

import { lookCountMap } from "./lookbook.ts";
import { livePool } from "./rack.ts";
import { houseLegalCombo, type House } from "./houses.ts";
import {
  momentOfDay,
  pairKey,
  pickLook,
  slotOf,
  weekUniformKeys,
} from "./style.ts";
import {
  mapOccasion,
  type Garment,
  type Look,
  type Occasion,
  type WearEntry,
  type WeatherSnap,
} from "./types.ts";

export const WHICH_PIECE = "Which piece? Tap it on Closet.";

const OCCASION_TOKEN =
  /^(out|dinner|weekday|weekend|comfy|travel|saturday|sunday|office|work|client|tonight|afternoon)$/i;

export function tokenizeDressQuery(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/^(wear|put on|outfit with|dress|style)\s+(the\s+)?/i, "")
    .split(/[,&+/]| and | with /i)
    .map((s) => s.replace(/\b(the|a|an|my|this)\b/g, " ").replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 2 && !OCCASION_TOKEN.test(s));
}

export function pieceSearchBlob(g: Garment): string {
  return `${g.name} ${g.subtype} ${g.colors.join(" ")} ${g.category} ${g.notes ?? ""}`.toLowerCase();
}

export function scoreNameMatch(query: string, g: Garment): number {
  const blob = pieceSearchBlob(g);
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  if (blob.includes(q)) return 10 + q.length;
  const words = q.split(/\s+/).filter((w) => w.length >= 3);
  let n = 0;
  for (const w of words) {
    if (blob.includes(w)) n += 3;
  }
  return n;
}

/** Fuzzy names against livePool. Never invent a SKU. */
export function resolvePiecesFromText(text: string, garments: Garment[]): Garment[] {
  const pool = livePool(garments);
  const parts = tokenizeDressQuery(text);
  const found: Garment[] = [];
  const used = new Set<string>();
  for (const part of parts) {
    let best: Garment | null = null;
    let bestS = 0;
    for (const g of pool) {
      if (used.has(g.id)) continue;
      const s = scoreNameMatch(part, g);
      if (s > bestS) {
        bestS = s;
        best = g;
      }
    }
    if (best && bestS >= 3) {
      found.push(best);
      used.add(best.id);
    }
  }
  return found;
}

export function occasionFromDressPrompt(
  prompt: string,
  fallback?: Occasion | null,
): Occasion {
  const p = prompt.toLowerCase();
  if (/client|dinner|\bout\b/.test(p)) return "out";
  if (/comfy|couch|at home|off duty/.test(p)) return "comfy";
  if (/saturday|weekend/.test(p)) return "weekend";
  if (/travel/.test(p)) return "travel";
  if (/weekday|work|office/.test(p)) return "weekday";
  if (fallback) return mapOccasion(fallback);
  return "out";
}

const PIECE_WORD =
  /cable|loafer|oxford|knit|jean|chino|hoodie|polo|blazer|coat|mule|sneaker|trouser|camp|rugby|sweater|merino|boot|cap|belt|tee|shirt|990|sangallo|serafino/;

export function looksLikePieceAsk(prompt: string): boolean {
  const p = prompt.toLowerCase();
  const tokens = tokenizeDressQuery(p);
  if (/^(wear|put on|outfit with)\b/.test(p)) return tokens.length > 0;
  return tokens.some((t) => PIECE_WORD.test(t));
}

export type DressResult = {
  garmentIds: string[];
  occasion: Occasion;
  pieces: Garment[];
  lockedIds: string[];
};

export function bottomShoePair(pieces: Garment[]): string | null {
  const b = pieces.find((g) => slotOf(g) === "bottom");
  const s = pieces.find((g) => slotOf(g) === "footwear");
  if (!b || !s) return null;
  return pairKey(b.id, s.id);
}

export function dressThisPiece(opts: {
  lockedIds: string[];
  garments: Garment[];
  looks?: Look[];
  occasion?: Occasion | null;
  weather?: WeatherSnap;
  journal?: WearEntry[];
  previousIds?: string[];
  repeatPairs?: Set<string>;
  house?: House | "all" | null;
}): DressResult | null {
  const pool = livePool(opts.garments);
  const lockedIds = [...new Set(opts.lockedIds)].filter((id) =>
    pool.some((g) => g.id === id),
  );
  const house = opts.house && opts.house !== "all" ? opts.house : undefined;
  if (!lockedIds.length && !house) return null;
  const occasion = mapOccasion(opts.occasion ?? "out");
  const usedCount = lookCountMap(opts.looks ?? []);
  const repeats =
    opts.repeatPairs ?? weekUniformKeys(opts.journal ?? [], pool);
  const ids = pickLook(pool, {
    occasion,
    moment: momentOfDay(),
    weather: opts.weather ?? { f: 68, label: "Fair", code: 2 },
    lockedIds,
    previousIds: opts.previousIds,
    repeatPairs: repeats,
    usedCount,
    house,
    legalCombo: house
      ? (p) => houseLegalCombo(p, house, occasion, undefined, pool)
      : undefined,
  });
  const ordered = [...lockedIds.filter((id) => !ids.includes(id)), ...ids];
  const pieces = ordered
    .map((id) => pool.find((g) => g.id === id))
    .filter((g): g is Garment => Boolean(g));
  if (lockedIds.length && !lockedIds.every((id) => pieces.some((g) => g.id === id))) {
    return null;
  }
  if (pieces.length < 2) return null;
  if (house && !houseLegalCombo(pieces, house, occasion)) return null;
  return { garmentIds: pieces.map((g) => g.id), occasion, pieces, lockedIds };
}

export function moreOutfitsForLook(opts: {
  seedIds: string[];
  lockedIds: string[];
  garments: Garment[];
  looks?: Look[];
  occasion: Occasion;
  weather?: WeatherSnap;
  n?: number;
  house?: House | "all" | null;
}): DressResult[] {
  const n = opts.n ?? 3;
  const pool = livePool(opts.garments);
  const seedPieces = opts.seedIds
    .map((id) => pool.find((g) => g.id === id))
    .filter((g): g is Garment => Boolean(g));
  const usedPairs = new Set<string>();
  const seedPair = bottomShoePair(seedPieces);
  if (seedPair) usedPairs.add(seedPair);
  const usedLooks = new Set<string>([[...opts.seedIds].sort().join("|")]);
  const banned = new Set<string>();
  for (const g of seedPieces) {
    const s = slotOf(g);
    if ((s === "bottom" || s === "footwear") && !opts.lockedIds.includes(g.id)) {
      banned.add(g.id);
    }
  }
  const out: DressResult[] = [];
  for (let i = 0; i < 16 && out.length < n; i++) {
    const dressed = dressThisPiece({
      lockedIds: opts.lockedIds,
      garments: pool,
      looks: opts.looks,
      occasion: opts.occasion,
      weather: opts.weather,
      previousIds: [...banned],
      repeatPairs: usedPairs,
      house: opts.house,
    });
    if (!dressed) break;
    const key = [...dressed.garmentIds].sort().join("|");
    if (usedLooks.has(key)) continue;
    const pair = bottomShoePair(dressed.pieces);
    if (pair && usedPairs.has(pair)) continue;
    usedLooks.add(key);
    if (pair) usedPairs.add(pair);
    for (const g of dressed.pieces) {
      const s = slotOf(g);
      if ((s === "bottom" || s === "footwear") && !opts.lockedIds.includes(g.id)) {
        banned.add(g.id);
      }
    }
    out.push(dressed);
  }
  return out;
}

export function dressReply(
  pieces: Garment[],
  occasion: Occasion,
  lockedIds: string[],
): string {
  const star =
    pieces.find((g) => lockedIds.includes(g.id)) ?? pieces[0];
  if (!star) return occasion;
  const rest = pieces.filter((g) => g.id !== star.id).map((g) => g.name);
  return [`${star.name} · ${occasion}`, ...rest].join("\n");
}

export function dressOccasionFallback(dropOccasion?: Occasion | null): Occasion {
  return dropOccasion ? mapOccasion(dropOccasion) : "out";
}

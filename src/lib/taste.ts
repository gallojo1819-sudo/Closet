import { resolvePiecesFromText } from "./dress.ts";
import { isFakeName, livePool } from "./rack.ts";
import {
  defaultOccasion,
  houseMixPenalty,
  isHoodiePiece,
  isTrueOuter,
  momentOfDay,
  pickLook,
  slotOf,
} from "./style.ts";
import type { Garment, Occasion } from "./types.ts";

/**
 * Taste lives on the closet, next to the stylist thread.
 * A new account starts empty. Nothing here is copied from another closet.
 * Ralph, ALD, and Fortela are ways of stacking clothes, not a brand list.
 */

export const TASTE_AVOID_KEY = "__taste";
const WEIGHT_CAP = 5;
const WEARS_PER_STEP = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const DECAY_MS = 30 * DAY_MS;
const TREND_REFRESH_MS = 30 * DAY_MS;
const TREND_SHOW_MS = 45 * DAY_MS;

export type TasteTechnique = {
  id: string;
  name: string;
  rule: string;
  weight: number;
  evidenceIds: string[];
  /** Wear-steps already turned into weight. Decay does not refund them. */
  appliedSteps?: number;
  decayedAt?: string;
};

/** A veto only comes from what he typed. Rows without a source are dropped on every read. */
export type TasteVeto =
  | { kind: "piece"; id: string; source?: "ask" }
  | { kind: "pairing"; a: string; b: string; source?: "ask" }
  | { kind: "habit"; id: string; habit: "never tuck"; source?: "ask" };

export type TasteWear = {
  /** Look id, or the garment ids, scoped to one technique. */
  id: string;
  techniqueId: string;
  count: number;
  at: string;
};

export type TasteMemory = {
  techniques: TasteTechnique[];
  vetoes: TasteVeto[];
  wears: TasteWear[];
  trendNote: string;
  lastTrendAt: string;
};

const SEED: readonly Omit<TasteTechnique, "evidenceIds" | "appliedSteps" | "decayedAt">[] = [
  {
    id: "ordered-stack",
    name: "Ordered stack",
    rule: "Shirt, then a thin knit, then a jacket. No chunky knit under a sport coat.",
    weight: 0,
  },
  {
    id: "one-loud",
    name: "One loud piece",
    rule: "A graphic, a print, or a bright knit, and the rest quiet. Two graphics do not share a look.",
    weight: 0,
  },
  {
    id: "open-overshirt",
    name: "Open overshirt",
    rule: "Camp or print worn open over a tee, sleeves pushed, often no jacket. Warm weather.",
    weight: 0,
  },
  {
    id: "workwear-stack",
    name: "Workwear stack",
    rule: "Chore or field jacket, denim or flannel, boot.",
    weight: 0,
  },
];

export function emptyTaste(): TasteMemory {
  return {
    techniques: SEED.map((t) => ({ ...t, evidenceIds: [], appliedSteps: 0 })),
    vetoes: [],
    wears: [],
    trendNote: "",
    lastTrendAt: "",
  };
}

function clampWeight(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 0;
  return Math.max(0, Math.min(WEIGHT_CAP, v));
}

export function normalizeTaste(raw: unknown): TasteMemory {
  const seed = emptyTaste();
  if (!raw || typeof raw !== "object") return seed;
  const o = raw as Partial<TasteMemory>;
  const byId = new Map(
    (Array.isArray(o.techniques) ? o.techniques : [])
      .filter((t): t is TasteTechnique => Boolean(t && typeof t === "object" && typeof (t as TasteTechnique).id === "string"))
      .map((t) => [t.id, t]),
  );
  return {
    techniques: seed.techniques.map((s) => {
      const got = byId.get(s.id);
      if (!got) return s;
      return {
        ...s,
        weight: clampWeight(got.weight),
        evidenceIds: Array.isArray(got.evidenceIds)
          ? got.evidenceIds.filter((id): id is string => typeof id === "string").slice(-24)
          : [],
        appliedSteps: typeof got.appliedSteps === "number" ? Math.max(0, got.appliedSteps) : 0,
        decayedAt: typeof got.decayedAt === "string" ? got.decayedAt : undefined,
      };
    }),
    vetoes: sanitizeVetoes(o.vetoes),
    wears: sanitizeWears(o.wears),
    trendNote: typeof o.trendNote === "string" ? o.trendNote.replace(/\s+/g, " ").trim().slice(0, 180) : "",
    lastTrendAt: typeof o.lastTrendAt === "string" ? o.lastTrendAt : "",
  };
}

function sanitizeVetoes(raw: unknown): TasteVeto[] {
  if (!Array.isArray(raw)) return [];
  const out: TasteVeto[] = [];
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const row = v as TasteVeto;
    /* Skip-made vetoes had no source. They are not his taste, so they do not survive a read. */
    if (row.source !== "ask") continue;
    if (row.kind === "piece" && typeof row.id === "string" && row.id) {
      out.push({ kind: "piece", id: row.id, source: "ask" });
    } else if (row.kind === "habit" && row.habit === "never tuck" && typeof row.id === "string" && row.id) {
      out.push({ kind: "habit", id: row.id, habit: "never tuck", source: "ask" });
    } else if (row.kind === "pairing" && typeof row.a === "string" && typeof row.b === "string" && row.a && row.b) {
      out.push({ kind: "pairing", a: row.a, b: row.b, source: "ask" });
    }
  }
  return dedupeVetoes(out).slice(-40);
}

function sanitizeWears(raw: unknown): TasteWear[] {
  if (!Array.isArray(raw)) return [];
  const out: TasteWear[] = [];
  for (const w of raw) {
    if (!w || typeof w !== "object") continue;
    const row = w as TasteWear;
    if (typeof row.id !== "string" || typeof row.techniqueId !== "string") continue;
    if (typeof row.count !== "number" || !Number.isFinite(row.count) || row.count < 1) continue;
    if (typeof row.at !== "string") continue;
    out.push({ id: row.id, techniqueId: row.techniqueId, count: Math.round(row.count), at: row.at });
  }
  return out.slice(-80);
}

export function tasteBlank(t: TasteMemory | undefined): boolean {
  if (!t) return true;
  return (
    t.techniques.every((x) => x.weight === 0 && (x.appliedSteps ?? 0) === 0 && x.evidenceIds.length === 0) &&
    t.vetoes.length === 0 &&
    t.wears.length === 0 &&
    !t.trendNote
  );
}

function vetoKey(v: TasteVeto): string {
  if (v.kind === "piece") return `piece:${v.id}`;
  if (v.kind === "habit") return `habit:${v.id}`;
  const [a, b] = [v.a, v.b].map((s) => s.toLowerCase()).sort();
  return `pair:${a}|${b}`;
}

function dedupeVetoes(list: TasteVeto[]): TasteVeto[] {
  const seen = new Set<string>();
  const out: TasteVeto[] = [];
  for (const v of list) {
    const k = vetoKey(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/** Account avoid jsonb carries taste under one reserved key. Scores stay numbers. */
export function embedTasteAvoid(
  avoid: Record<string, number>,
  taste: TasteMemory | undefined,
): Record<string, unknown> {
  if (!taste || tasteBlank(taste)) return avoid;
  return { ...avoid, [TASTE_AVOID_KEY]: taste };
}

export function peelTasteAvoid(raw: unknown): { avoid: Record<string, number>; taste?: TasteMemory } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { avoid: {} };
  const avoid: Record<string, number> = {};
  let taste: TasteMemory | undefined;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === TASTE_AVOID_KEY) {
      const parsed = normalizeTaste(value);
      if (!tasteBlank(parsed)) taste = parsed;
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) avoid[key] = value;
  }
  return { avoid, taste };
}

export function mergeTaste(local?: TasteMemory, cloud?: TasteMemory): TasteMemory | undefined {
  const l = local ? normalizeTaste(local) : undefined;
  const c = cloud ? normalizeTaste(cloud) : undefined;
  if (tasteBlank(l) && tasteBlank(c)) return undefined;
  if (tasteBlank(l)) return c;
  if (tasteBlank(c)) return l;
  const left = l!;
  const right = c!;
  const techniques = left.techniques.map((t) => {
    const o = right.techniques.find((x) => x.id === t.id) ?? t;
    const decayedAt = laterIso(t.decayedAt, o.decayedAt);
    return {
      ...t,
      weight: Math.max(t.weight, o.weight),
      evidenceIds: [...new Set([...t.evidenceIds, ...o.evidenceIds])].slice(-24),
      appliedSteps: Math.max(t.appliedSteps ?? 0, o.appliedSteps ?? 0),
      decayedAt,
    };
  });
  const wears = mergeWears(left.wears, right.wears);
  const trend = Date.parse(left.lastTrendAt || "0") >= Date.parse(right.lastTrendAt || "0") ? left : right;
  return {
    techniques,
    vetoes: dedupeVetoes([...left.vetoes, ...right.vetoes]).slice(-40),
    wears,
    trendNote: trend.trendNote,
    lastTrendAt: trend.lastTrendAt,
  };
}

function laterIso(a?: string, b?: string): string | undefined {
  const at = a ? Date.parse(a) : 0;
  const bt = b ? Date.parse(b) : 0;
  if (!at && !bt) return undefined;
  return at >= bt ? a : b;
}

function mergeWears(a: TasteWear[], b: TasteWear[]): TasteWear[] {
  const map = new Map<string, TasteWear>();
  for (const w of [...b, ...a]) {
    const key = `${w.techniqueId}:${w.id}`;
    const prev = map.get(key);
    if (!prev || w.count > prev.count || (w.count === prev.count && w.at > prev.at)) map.set(key, w);
  }
  return [...map.values()].slice(-80);
}

export function pieceVetoIds(taste: TasteMemory): Set<string> {
  return new Set(taste.vetoes.filter((v) => v.kind === "piece").map((v) => v.id));
}

export function tuckHabitIds(taste: TasteMemory): string[] {
  const ids: string[] = [];
  for (const v of taste.vetoes) {
    if (v.kind === "habit" && v.habit === "never tuck") ids.push(v.id);
  }
  return ids;
}

function textOf(g: Garment): string {
  return `${g.name} ${g.subtype} ${g.category} ${g.material} ${g.brand} ${g.notes} ${g.colors.join(" ")}`.toLowerCase();
}

/** Brand is a tag. The technique comes from the stack, not the label. */
export function readTags(g: Garment): {
  brand: string;
  category: string;
  subtype: string;
  material: string;
  notes: string;
} {
  return {
    brand: (g.brand ?? "").trim(),
    category: g.category,
    subtype: g.subtype ?? "",
    material: g.material ?? "",
    notes: g.notes ?? "",
  };
}

function isTee(g: Garment): boolean {
  return /\btee\b|t-shirt|t shirt/.test(textOf(g));
}

function isChunkyKnit(g: Garment): boolean {
  const t = textOf(g);
  return /chunky|cable|aran|fisherman/.test(t) && /knit|sweater|cable/.test(t);
}

function isThinKnit(g: Garment): boolean {
  const t = textOf(g);
  if (slotOf(g) === "bottom" || slotOf(g) === "footwear") return false;
  if (!/knit|merino|sweater|crewneck|\bcrew\b/.test(t)) return false;
  if (isChunkyKnit(g)) return false;
  return true;
}

function isWovenShirt(g: Garment): boolean {
  if (isTee(g) || isThinKnit(g) || isChunkyKnit(g)) return false;
  const slot = slotOf(g);
  if (slot !== "top" && slot !== "dress") return false;
  return /oxford|shirt|poplin|broadcloth|button|flannel|chambray|camp/.test(textOf(g));
}

function isPrintedOvershirt(g: Garment): boolean {
  if (isTee(g)) return false;
  const slot = slotOf(g);
  if (slot === "bottom" || slot === "footwear") return false;
  const t = textOf(g);
  return /camp|overshirt/.test(t) || (/print/.test(t) && /shirt/.test(t));
}

function isSeparateJacket(g: Garment): boolean {
  if (isPrintedOvershirt(g) || isHoodiePiece(g)) return false;
  return isTrueOuter(g);
}

function isLoud(g: Garment): boolean {
  const t = textOf(g);
  if (/graphic|90s|90's|\bflag\b|\blogo\b/.test(t)) return true;
  if (/print/.test(t)) return true;
  if (/knit|sweater/.test(t) && /bright|yellow|red|pink|orange|purple|cobalt|lime/.test(t)) return true;
  return false;
}

function isBoot(g: Garment): boolean {
  return slotOf(g) === "footwear" && /boot/.test(textOf(g));
}

export function matchedTechniques(pieces: Garment[]): string[] {
  const ids: string[] = [];
  const shirt = pieces.some(isWovenShirt);
  const thin = pieces.some(isThinKnit);
  const jacket = pieces.some(isSeparateJacket);
  const chunkyCoat = pieces.some(isChunkyKnit) && pieces.some((g) => /blazer|sport\s*coat/.test(textOf(g)));
  if (shirt && thin && jacket && !chunkyCoat) ids.push("ordered-stack");
  const loud = pieces.filter(isLoud);
  if (loud.length === 1) ids.push("one-loud");
  const tee = pieces.some(isTee);
  const over = pieces.some(isPrintedOvershirt);
  if (tee && over && !pieces.some(isSeparateJacket)) ids.push("open-overshirt");
  const chore = pieces.some((g) => /chore|\bfield\b/.test(textOf(g)) && isSeparateJacket(g));
  const cloth = pieces.some(
    (g) => /flannel/.test(textOf(g)) || ((/jean|denim/.test(textOf(g)) && slotOf(g) === "bottom")),
  );
  if (chore && cloth && pieces.some(isBoot)) ids.push("workwear-stack");
  return ids;
}

function closetCanFill(id: string, garments: Garment[]): boolean {
  const pool = livePool(garments);
  if (id === "ordered-stack") {
    return pool.some(isWovenShirt) && pool.some(isThinKnit) && pool.some(isSeparateJacket);
  }
  if (id === "one-loud") {
    return pool.some(isLoud) && pool.some((g) => !isLoud(g) && slotOf(g) !== null);
  }
  if (id === "open-overshirt") {
    return pool.some(isTee) && pool.some(isPrintedOvershirt);
  }
  if (id === "workwear-stack") {
    return (
      pool.some((g) => /chore|\bfield\b/.test(textOf(g)) && isSeparateJacket(g)) &&
      pool.some((g) => /flannel/.test(textOf(g)) || (/jean|denim/.test(textOf(g)) && slotOf(g) === "bottom")) &&
      pool.some(isBoot)
    );
  }
  return false;
}

function lastWearAt(memory: TasteMemory, techniqueId: string): string | null {
  let best = "";
  for (const w of memory.wears) {
    if (w.techniqueId !== techniqueId) continue;
    if (w.at > best) best = w.at;
  }
  return best || null;
}

export function decayTaste(memory: TasteMemory, now: number): TasteMemory {
  let changed = false;
  const techniques = memory.techniques.map((t) => {
    if (t.weight <= 0) return t;
    const last = lastWearAt(memory, t.id);
    if (!last) return t;
    const idle = now - Date.parse(last);
    if (!Number.isFinite(idle) || idle < DECAY_MS) return t;
    const decayed = t.decayedAt ? Date.parse(t.decayedAt) : 0;
    if (decayed && now - decayed < DECAY_MS) return t;
    changed = true;
    return { ...t, weight: t.weight - 1, decayedAt: new Date(now).toISOString() };
  });
  if (!changed) return memory;
  return { ...memory, techniques };
}

function piecesFromIds(garments: Garment[], ids: string[]): Garment[] {
  const pool = livePool(garments);
  return ids
    .map((id) => pool.find((g) => g.id === id))
    .filter((g): g is Garment => Boolean(g));
}

function addVeto(memory: TasteMemory, veto: TasteVeto): TasteMemory {
  const vetoes = dedupeVetoes([...memory.vetoes, veto]);
  if (vetoes.length === memory.vetoes.length && vetoes.every((v, i) => vetoKey(v) === vetoKey(memory.vetoes[i]!))) {
    return memory;
  }
  return { ...memory, vetoes };
}

function dropVeto(memory: TasteMemory, pred: (v: TasteVeto) => boolean): TasteMemory {
  const vetoes = memory.vetoes.filter((v) => !pred(v));
  if (vetoes.length === memory.vetoes.length) return memory;
  return { ...memory, vetoes };
}

function stem(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.endsWith("ves")) return w.slice(0, -3) + "f";
  if (w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

function mentions(g: Garment, word: string): boolean {
  const w = stem(word);
  if (!w || w.length < 3) return false;
  return textOf(g).includes(w);
}

export function pairingBlocked(pieces: Garment[], taste: TasteMemory): boolean {
  for (const v of taste.vetoes) {
    if (v.kind !== "pairing") continue;
    const a = pieces.some((g) => mentions(g, v.a));
    const b = pieces.some((g) => mentions(g, v.b));
    if (a && b) return true;
  }
  return false;
}

function captureNegations(text: string): string[] {
  const out: string[] = [];
  const re =
    /(?:\bnot the\b|\bdon't use\b|\bdo not use\b|\bdont use\b|\bwithout the\b|\bnever wear\b|\bno\b)\s+([^.,\n]+)/gi;
  for (const m of text.matchAll(re)) {
    const phrase = m[1]?.trim() ?? "";
    if (!phrase || /^(one|thanks|problem)$/i.test(phrase)) continue;
    out.push(phrase);
  }
  return out;
}

function tuckTarget(text: string, garments: Garment[], previousIds: string[]): string | null {
  if (!/never tuck|don't tuck|do not tuck|dont tuck/i.test(text)) return null;
  const after = text.match(/(?:never tuck|don't tuck|do not tuck|dont tuck)\s*(.*)$/i)?.[1] ?? "";
  const named = resolvePiecesFromText(after, garments).filter((g) => {
    const slot = slotOf(g);
    return slot === "top" || slot === "dress";
  });
  if (named[0]) return named[0].id;
  const prev = piecesFromIds(garments, previousIds);
  const top = prev.find((g) => {
    const slot = slotOf(g);
    return slot === "top" || slot === "dress";
  });
  return top?.id ?? null;
}

export function learnFromAsk(
  memory: TasteMemory,
  opts: { text: string; garments: Garment[]; previousIds?: string[]; now: number },
): TasteMemory {
  let next = decayTaste(normalizeTaste(memory), opts.now);
  const previous = opts.previousIds ?? [];
  const tuck = tuckTarget(opts.text, opts.garments, previous);
  if (tuck) next = addVeto(next, { kind: "habit", id: tuck, habit: "never tuck", source: "ask" });

  if (/^(no|nope|nah)\b[.!]?$/i.test(opts.text.trim())) {
    const prev = piecesFromIds(opts.garments, previous);
    const jacket = prev.find(isSeparateJacket);
    if (jacket) next = addVeto(next, { kind: "piece", id: jacket.id, source: "ask" });
    else if (prev[0]) next = addVeto(next, { kind: "piece", id: prev[0].id, source: "ask" });
  }

  for (const phrase of captureNegations(opts.text)) {
    const pair = phrase.match(/^(\w+)\s+with\s+(?:a\s+|the\s+)?(\w+)/i);
    if (pair?.[1] && pair[2]) {
      next = addVeto(next, { kind: "pairing", a: stem(pair[1]), b: stem(pair[2]), source: "ask" });
      continue;
    }
    const found = resolvePiecesFromText(phrase, opts.garments);
    const piece = found[0];
    if (piece) next = addVeto(next, { kind: "piece", id: piece.id, source: "ask" });
  }

  const again = opts.text.match(/(?:you can use|use|tuck)\s+(?:the\s+)?(.+?)\s+again/i);
  if (again?.[1]) {
    const found = resolvePiecesFromText(again[1], opts.garments);
    const id = found[0]?.id;
    if (id) {
      next = dropVeto(next, (v) => (v.kind === "piece" || v.kind === "habit") && v.id === id);
    }
  }

  for (const g of resolvePiecesFromText(opts.text, opts.garments)) readTags(g);
  return next;
}

function addEvidence(memory: TasteMemory, pieces: Garment[]): TasteMemory {
  if (!pieces.length) return memory;
  const matched = new Set(matchedTechniques(pieces));
  if (!matched.size) return memory;
  const ids = pieces.map((g) => g.id);
  let changed = false;
  const techniques = memory.techniques.map((t) => {
    if (!matched.has(t.id)) return t;
    const evidenceIds = [...new Set([...t.evidenceIds, ...ids])].slice(-24);
    if (evidenceIds.length === t.evidenceIds.length) return t;
    changed = true;
    return { ...t, evidenceIds };
  });
  if (!changed) return memory;
  return { ...memory, techniques };
}

/** A lock beats a trend. It does not raise a technique and it does not lift a veto. */
export function learnFromLock(
  memory: TasteMemory,
  piece: Garment,
  lookIds: string[],
  garments: Garment[],
  now: number,
): TasteMemory {
  readTags(piece);
  const next = decayTaste(normalizeTaste(memory), now);
  const pieces = piecesFromIds(garments, lookIds);
  if (!pieces.some((g) => g.id === piece.id)) pieces.push(piece);
  return addEvidence(next, pieces);
}

/** Save reads the stack. Weight moves on wears, not on the save itself. */
export function learnFromSave(memory: TasteMemory, ids: string[], garments: Garment[], now: number): TasteMemory {
  const next = decayTaste(normalizeTaste(memory), now);
  const pieces = piecesFromIds(garments, ids);
  for (const g of pieces) readTags(g);
  return addEvidence(next, pieces);
}

function creditTechniques(techniques: TasteTechnique[], wears: TasteWear[], pieces: Garment[]): TasteTechnique[] {
  const matched = new Set(matchedTechniques(pieces));
  const ids = pieces.map((g) => g.id);
  return techniques.map((t) => {
    const total = wears.filter((w) => w.techniqueId === t.id).reduce((n, w) => n + w.count, 0);
    const steps = Math.floor(total / WEARS_PER_STEP);
    const applied = t.appliedSteps ?? 0;
    let weight = t.weight;
    let appliedSteps = applied;
    if (steps > applied) {
      weight = Math.min(WEIGHT_CAP, weight + (steps - applied));
      appliedSteps = steps;
    }
    const evidenceIds = matched.has(t.id) ? [...new Set([...t.evidenceIds, ...ids])].slice(-24) : t.evidenceIds;
    if (weight === t.weight && appliedSteps === applied && evidenceIds.length === t.evidenceIds.length) return t;
    return { ...t, weight, appliedSteps, evidenceIds };
  });
}

export function logWear(
  memory: TasteMemory,
  garments: Garment[],
  ids: string[],
  now: number,
  lookId?: string,
): TasteMemory {
  const base = decayTaste(normalizeTaste(memory), now);
  const pieces = piecesFromIds(garments, ids);
  for (const g of pieces) readTags(g);
  const matched = matchedTechniques(pieces);
  if (!pieces.length || !matched.length) return base;
  const at = new Date(now).toISOString();
  const day = at.slice(0, 10);
  const garmentKey = lookId ?? [...ids].filter(Boolean).sort().join("|");
  const wears = base.wears.map((w) => ({ ...w }));
  for (const techniqueId of matched) {
    const row = wears.find((w) => w.techniqueId === techniqueId && w.id === garmentKey);
    if (row) {
      if (row.at.slice(0, 10) === day) continue;
      row.count += 1;
      row.at = at;
    } else {
      wears.push({ id: garmentKey, techniqueId, count: 1, at });
    }
  }
  const techniques = creditTechniques(base.techniques, wears, pieces);
  return { ...base, wears: wears.slice(-80), techniques };
}

export function techniqueUsed(taste: TasteMemory, pieces: Garment[]): string | null {
  const matched = new Set(matchedTechniques(pieces));
  let best: TasteTechnique | null = null;
  for (const t of taste.techniques) {
    if (t.weight <= 0 || !matched.has(t.id)) continue;
    if (!best || t.weight > best.weight) best = t;
  }
  return best?.name ?? null;
}

/** Sum of matched technique weights. Weight 0 adds nothing and does not ban the look. */
export function techniqueWeight(taste: TasteMemory, pieces: Garment[]): number {
  const matched = new Set(matchedTechniques(pieces));
  let n = 0;
  for (const t of taste.techniques) {
    if (t.weight > 0 && matched.has(t.id)) n += t.weight;
  }
  return n;
}

/**
 * Drop a vetoed piece when the look still dresses without it.
 * A blocked pairing is rejected. A locked piece stays.
 * Null means this combo cannot be dressed under the vetoes.
 */
export function applyAtlas(
  pieces: Garment[],
  taste: TasteMemory | undefined,
  lockedIds?: Iterable<string>,
): Garment[] | null {
  if (!taste || !taste.vetoes.length) return pieces;
  const locked = new Set(lockedIds ?? []);
  const veto = pieceVetoIds(taste);
  const stripped = pieces.filter((g) => !veto.has(g.id) || locked.has(g.id));
  const candidate = stripped.length === pieces.length ? pieces : stripped.length >= 3 ? stripped : null;
  if (!candidate) return null;
  if (pairingBlocked(candidate, taste) && !candidate.some((g) => locked.has(g.id))) return null;
  return candidate;
}

/** One line when the next drop actually left a skipped piece or pairing off. */
export function leftOffLine(opts: {
  skipped: Garment[];
  next: Garment[];
  taste: TasteMemory;
}): string | null {
  const nextIds = new Set(opts.next.map((g) => g.id));
  const dropped = opts.skipped.find((g) => pieceVetoIds(opts.taste).has(g.id) && !nextIds.has(g.id));
  if (dropped) return `Left the ${dropped.name.trim()} off.`;
  if (pairingBlocked(opts.skipped, opts.taste) && !pairingBlocked(opts.next, opts.taste)) {
    const top = opts.skipped.find((g) => {
      const s = slotOf(g);
      return s === "top" || s === "dress";
    });
    const shoe = opts.skipped.find((g) => slotOf(g) === "footwear");
    if (top && shoe && (!nextIds.has(top.id) || !nextIds.has(shoe.id))) {
      return `Left the ${top.name.trim()} with the ${shoe.name.trim()} off.`;
    }
  }
  return null;
}

/** Technique name, then the pieces. Weight 0 stays silent. */
export function techniqueLine(taste: TasteMemory, pieces: Garment[]): string | null {
  const name = techniqueUsed(taste, pieces);
  if (!name) return null;
  const names = pieces
    .filter((g) => slotOf(g) !== "accessory")
    .map((g) => g.name.trim())
    .filter(Boolean);
  if (!names.length) return null;
  return `${name}. ${names.join(", ")}.`;
}

export function trendVisible(taste: TasteMemory, now: number): string | null {
  if (!taste.trendNote || !taste.lastTrendAt) return null;
  const age = now - Date.parse(taste.lastTrendAt);
  if (!Number.isFinite(age) || age < 0 || age > TREND_SHOW_MS) return null;
  return taste.trendNote;
}

export function trendDue(taste: TasteMemory, now: number): boolean {
  if (!taste.lastTrendAt) return true;
  const age = now - Date.parse(taste.lastTrendAt);
  return !Number.isFinite(age) || age > TREND_REFRESH_MS;
}

const TREND_WORDS = new Set(
  `a an the this that these those and or but with without over under into onto of for to from on in at by is are was were be it its now right still just layer layers layering light lighter lightest heavy heavier thin thick chunky fine soft hard open closed shirt shirts knit knits jacket jackets coat coats tee tees collar collars sleeve sleeves warm warmer cold colder cool weather day days week weekday weekend fall autumn spring summer winter today tonight one two quiet loud simple works work wear wearing worn keep leave no not never cotton wool linen denim flannel merino cashmere navy olive cream grey gray black white brown blue green tan khaki indigo camel stone short long pale dark neutral look looks piece pieces close closer than then when while`
    .split(/\s+/),
);

/** A trend sentence may not name a brand this closet does not own. */
export function trendSentenceOk(sentence: string, garments: Garment[]): boolean {
  const clean = sentence.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 160 || /[\n\r]/.test(sentence)) return false;
  if (/\p{Extended_Pictographic}/u.test(clean)) return false;
  const closet = livePool(garments)
    .map((g) => `${g.brand} ${g.name} ${g.subtype} ${g.material} ${g.notes} ${g.colors.join(" ")}`)
    .join(" ")
    .toLowerCase();
  const words = clean
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return false;
  for (const w of words) {
    const bare = w.replace(/'/g, "");
    if (TREND_WORDS.has(bare)) continue;
    if (closet.includes(bare)) continue;
    return false;
  }
  return true;
}

export function acceptTrend(
  memory: TasteMemory,
  sentence: string,
  garments: Garment[],
  now: number,
): TasteMemory | null {
  const clean = sentence.replace(/\s+/g, " ").trim();
  if (!trendSentenceOk(clean, garments)) return null;
  const base = normalizeTaste(memory);
  return { ...base, trendNote: clean, lastTrendAt: new Date(now).toISOString(), vetoes: base.vetoes };
}

export function pieceLine(g: Garment): string {
  const tags = readTags(g);
  const bits = [
    tags.brand || null,
    `${g.category}/${tags.subtype || "—"}`,
    g.colors.join(" "),
  ].filter(Boolean);
  return `- ${pieceLabel(g)} [${g.id}] (${bits.join(", ")})`;
}

function pieceLabel(g: Garment): string {
  if (g.name && !isFakeName(g.name)) return g.name;
  const color = g.colors.find(Boolean) ?? "";
  const sub = g.subtype || g.category;
  return [color, sub].filter(Boolean).join(" ");
}

export function buildStylistSystem(opts: {
  garments: Garment[];
  taste: TasteMemory;
  weatherF?: number;
  occasion?: Occasion;
  now?: number;
  lockedIds?: string[];
}): string {
  const now = opts.now ?? Date.now();
  const taste = normalizeTaste(opts.taste);
  const pool = livePool(opts.garments);
  const earned = taste.techniques
    .filter((t) => t.weight > 0)
    .slice()
    .sort((a, b) => b.weight - a.weight);
  const dormant = taste.techniques.filter((t) => t.weight === 0 && closetCanFill(t.id, pool));
  const lines: string[] = [
    "You are Atlas. You dress only from this closet. Never invent a piece, a layer, or a shop. Never name a brand that is not stored on a piece in the look.",
    "",
    "CLOSET",
    ...pool.map(pieceLine),
  ];
  if (earned.length) {
    lines.push("", "TECHNIQUES");
    for (const t of earned) lines.push(`- ${t.name} (${t.weight}): ${t.rule}`);
  }
  if (dormant.length) {
    lines.push("", "DORMANT");
    for (const t of dormant) {
      lines.push(`- ${t.name} (0): ${t.rule}`);
      lines.push("This closet can fill it. It is not a habit yet. Do not prefer it.");
    }
  }
  if (!earned.length && !dormant.length) {
    lines.push("", "No earned technique yet. Do not invent a style the clothes have not shown.");
  }
  const pieceVetoes = taste.vetoes.filter((v) => v.kind === "piece");
  const pairs = taste.vetoes.filter((v) => v.kind === "pairing");
  const habits = taste.vetoes.filter((v) => v.kind === "habit");
  if (pieceVetoes.length || pairs.length || habits.length) {
    lines.push("", "VETOES");
    for (const v of pieceVetoes) {
      if (v.kind !== "piece") continue;
      const name = pool.find((g) => g.id === v.id)?.name;
      lines.push(name ? `- Do not use ${v.id} (${name}).` : `- Do not use ${v.id}.`);
    }
    for (const v of pairs) {
      if (v.kind !== "pairing") continue;
      lines.push(`- Never ${v.a} with ${v.b}.`);
    }
    for (const v of habits) {
      if (v.kind !== "habit") continue;
      lines.push(`- Never tuck ${v.id}. This habit is only that piece. Do not apply it to every shirt.`);
    }
  }
  const trend = trendVisible(taste, now);
  if (trend) {
    lines.push("", "TREND", trend, "A trend cannot override a veto, a lock, or a saved look.");
  }
  const locked = (opts.lockedIds ?? []).filter((id) => pool.some((g) => g.id === id) && !pieceVetoIds(taste).has(id));
  if (locked.length) {
    lines.push("", "LOCKED");
    lines.push("These pieces stay. A trend cannot move them.");
    for (const id of locked) {
      const name = pool.find((g) => g.id === id)?.name ?? id;
      lines.push(`- ${id} ${name}`);
    }
  }
  const occasion = opts.occasion ?? "weekday";
  const weather = typeof opts.weatherF === "number" && Number.isFinite(opts.weatherF) ? opts.weatherF : undefined;
  lines.push(
    "",
    "TODAY",
    weather === undefined ? occasion : `${occasion} ${weather}°`,
    "",
    "FORMAT",
    "Line 1: one technique name, then the occasion. Omit the technique if none of the earned ones fit.",
    "Then his exact names, one piece per line. No brand unless that brand is stored on a piece in this look.",
    "MISSING: one type he does not own, or omit the line.",
    "Last line exactly: LOOK: id,id,id",
    "One top, one bottom, one shoe, optional one jacket. Hoodie is not a coat.",
    "Voice: quiet, sure, no emoji, no lecture. Pixels beat names.",
    "Ids only from the closet list.",
  );
  return lines.join("\n");
}

function rawLookIds(text: string): string[] | null {
  const m = text.match(/LOOK:\s*([^\n]+)/i);
  if (!m?.[1]) return null;
  const ids = m[1]
    .split(/[,|\s]+/)
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length ? ids : null;
}

function orderPieces(pieces: Garment[]): Garment[] {
  const top = pieces.find((g) => slotOf(g) === "top" || slotOf(g) === "dress");
  const bottom = pieces.find((g) => slotOf(g) === "bottom");
  const shoe = pieces.find((g) => slotOf(g) === "footwear");
  const jacket = pieces.find((g) => slotOf(g) === "outerwear");
  return [top, bottom, shoe, jacket].filter((g): g is Garment => Boolean(g));
}

function slotsOk(pieces: Garment[]): boolean {
  const ordered = orderPieces(pieces);
  if (ordered.length < 3) return false;
  const top = ordered.filter((g) => slotOf(g) === "top" || slotOf(g) === "dress");
  const bottom = ordered.filter((g) => slotOf(g) === "bottom");
  const shoe = ordered.filter((g) => slotOf(g) === "footwear");
  const outer = pieces.filter((g) => slotOf(g) === "outerwear");
  if (top.length !== 1 || bottom.length !== 1 || shoe.length !== 1) return false;
  if (outer.length > 1) return false;
  if (outer.some(isHoodiePiece)) return false;
  if (pieces.length !== ordered.length) return false;
  return true;
}

function missingType(garments: Garment[]): string | null {
  const pool = livePool(garments);
  if (!pool.some((g) => slotOf(g) === "top" || slotOf(g) === "dress")) return "a shirt";
  if (!pool.some((g) => slotOf(g) === "bottom")) return "trousers";
  if (!pool.some((g) => slotOf(g) === "footwear")) return "shoes";
  return null;
}

export function atlasText(opts: {
  technique: string | null;
  pieces: Garment[];
  occasion: Occasion;
  missing: string | null;
}): string {
  const ordered = orderPieces(opts.pieces);
  const line1 = opts.technique ? `${opts.technique} — ${opts.occasion}` : opts.occasion;
  const lines = [line1, ...ordered.map(pieceLabel)];
  if (opts.missing) lines.push(`MISSING: ${opts.missing}`);
  lines.push(`LOOK: ${ordered.map((g) => g.id).join(",")}`);
  return lines.join("\n");
}

export type AtlasLook = {
  text: string;
  garmentIds: string[];
  occasion: Occasion;
  technique: string | null;
};

function finishLook(pieces: Garment[], taste: TasteMemory, occasion: Occasion, garments: Garment[]): AtlasLook {
  const ordered = orderPieces(pieces);
  const technique = techniqueUsed(taste, ordered);
  return {
    text: atlasText({ technique, pieces: ordered, occasion, missing: missingType(garments) }),
    garmentIds: ordered.map((g) => g.id),
    occasion,
    technique,
  };
}

export function composeAtlasLook(opts: {
  garments: Garment[];
  prompt: string;
  weatherF?: number;
  taste: TasteMemory;
  modelText?: string;
  lockedIds?: string[];
  previousIds?: string[];
  occasion?: Occasion;
  avoid?: Record<string, number>;
}): AtlasLook {
  const taste = normalizeTaste(opts.taste);
  const pool = livePool(opts.garments);
  const owned = new Set(pool.map((g) => g.id));
  const banned = pieceVetoIds(taste);
  const occasion = opts.occasion ?? occasionFromPrompt(opts.prompt);
  const locked = (opts.lockedIds ?? []).filter((id) => owned.has(id) && !banned.has(id));
  const modelIds = opts.modelText ? rawLookIds(opts.modelText) : null;
  if (modelIds && acceptModelIds(modelIds, pool, taste, locked)) {
    const pieces = modelIds
      .map((id) => pool.find((g) => g.id === id))
      .filter((g): g is Garment => Boolean(g));
    return finishLook(pieces, taste, occasion, pool);
  }
  const dressable = pool.filter((g) => !banned.has(g.id));
  const avoid: Record<string, number> = { ...(opts.avoid ?? {}) };
  for (const id of banned) avoid[id] = Math.max(avoid[id] ?? 0, 8);
  const dress = (memory: TasteMemory, legalCombo: (pieces: Garment[]) => boolean): Garment[] => {
    let ids = pickLook(dressable, {
      occasion,
      moment: momentOfDay(),
      ...(typeof opts.weatherF === "number" && Number.isFinite(opts.weatherF)
        ? { weather: { f: opts.weatherF, label: "Fair", code: 2 } }
        : {}),
      avoid,
      lockedIds: locked,
      previousIds: opts.previousIds,
      taste: memory,
      legalCombo,
    });
    ids = ids.filter((id) => owned.has(id) && !banned.has(id));
    let pieces = ids
      .map((id) => dressable.find((g) => g.id === id))
      .filter((g): g is Garment => Boolean(g));
    if (pairingBlocked(pieces, memory) || pieces.some((g) => banned.has(g.id))) {
      pieces = pieces.filter((g) => !banned.has(g.id));
    }
    for (const id of locked) {
      if (!pieces.some((g) => g.id === id)) {
        const g = dressable.find((item) => item.id === id);
        if (g) pieces.push(g);
      }
    }
    return pieces;
  };
  let pieces = dress(taste, (p) => !pairingBlocked(p, taste) && houseMixPenalty(p) >= -8);
  if (!coreDressed(pieces) && taste.vetoes.some((v) => v.kind === "pairing")) {
    /* Every legal pair is vetoed. A pairing is soft, as in pickLook: never an empty look. Piece vetoes still hold. */
    const open = { ...taste, vetoes: taste.vetoes.filter((v) => v.kind !== "pairing") };
    pieces = dress(open, (p) => houseMixPenalty(p) >= -8);
  }
  return finishLook(pieces, taste, occasion, pool);
}

/** A top (or dress), a bottom and a shoe. */
function coreDressed(pieces: Garment[]): boolean {
  return (
    pieces.some((g) => slotOf(g) === "top" || slotOf(g) === "dress") &&
    pieces.some((g) => slotOf(g) === "bottom") &&
    pieces.some((g) => slotOf(g) === "footwear")
  );
}

function acceptModelIds(ids: string[], pool: Garment[], taste: TasteMemory, locked: string[]): boolean {
  const owned = new Set(pool.map((g) => g.id));
  if (ids.some((id) => !owned.has(id))) return false;
  if (ids.some((id) => pieceVetoIds(taste).has(id))) return false;
  if (locked.some((id) => !ids.includes(id))) return false;
  const pieces = ids
    .map((id) => pool.find((g) => g.id === id))
    .filter((g): g is Garment => Boolean(g));
  if (!slotsOk(pieces)) return false;
  if (pairingBlocked(pieces, taste)) return false;
  if (houseMixPenalty(pieces) < -8) return false;
  const loud = taste.techniques.find((t) => t.id === "one-loud");
  if (loud && loud.weight > 0 && pieces.filter(isLoud).length > 1) return false;
  return true;
}

export function occasionFromPrompt(prompt: string): Occasion {
  const p = prompt.toLowerCase();
  if (/client|dinner|\bout\b/.test(p)) return "out";
  if (/comfy|couch|at home|off duty/.test(p)) return "comfy";
  if (/saturday|weekend/.test(p)) return "weekend";
  if (/travel/.test(p)) return "travel";
  if (/weekday|work|office/.test(p)) return "weekday";
  return defaultOccasion();
}

const SWAP_SLOT: Record<string, "top" | "bottom" | "footwear" | "outerwear"> = {
  shirt: "top",
  top: "top",
  knit: "top",
  sweater: "top",
  tee: "top",
  jacket: "outerwear",
  coat: "outerwear",
  overshirt: "outerwear",
  pants: "bottom",
  trousers: "bottom",
  chinos: "bottom",
  jeans: "bottom",
  shoes: "footwear",
  shoe: "footwear",
  loafers: "footwear",
  loafer: "footwear",
  sneakers: "footwear",
  boots: "footwear",
  boot: "footwear",
};

export function swapSlot(text: string): "top" | "bottom" | "footwear" | "outerwear" | null {
  const m = text
    .toLowerCase()
    .match(
      /\b(?:swap|change|switch|replace)\b(?:\s+\w+){0,4}\s+\b(shirt|top|knit|sweater|tee|jacket|coat|overshirt|pants|trousers|chinos|jeans|shoes|shoe|loafers|loafer|sneakers|boots|boot)\b/,
    );
  if (!m?.[1]) return null;
  return SWAP_SLOT[m[1]] ?? null;
}

export function swapDraft(opts: {
  ids: string[];
  slot: "top" | "bottom" | "footwear" | "outerwear";
  garments: Garment[];
  taste: TasteMemory;
  occasion: Occasion;
  weatherF?: number;
}): AtlasLook | null {
  const pieces = piecesFromIds(opts.garments, opts.ids);
  const current = pieces.find((g) => slotOf(g) === opts.slot);
  if (!current) return null;
  const locked = pieces.filter((g) => g.id !== current.id).map((g) => g.id);
  const look = composeAtlasLook({
    garments: opts.garments.filter((g) => g.id !== current.id),
    prompt: "",
    occasion: opts.occasion,
    weatherF: opts.weatherF,
    taste: opts.taste,
    lockedIds: locked,
    previousIds: [current.id],
  });
  if (look.garmentIds.includes(current.id)) return null;
  if (!locked.every((id) => look.garmentIds.includes(id))) return null;
  const next = look.garmentIds
    .map((id) => opts.garments.find((g) => g.id === id))
    .filter((g): g is Garment => Boolean(g));
  if (!next.some((g) => slotOf(g) === opts.slot)) return null;
  return look;
}

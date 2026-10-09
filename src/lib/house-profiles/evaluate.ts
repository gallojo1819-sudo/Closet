/**
 * Port of house-profiles-src/build.py matching + evaluate (lines 16–52, 173–291)
 * and enumerate scoring (297–331). Keywords come from each approved profile.
 * Match is word-start, case-insensitive, over name | subtype | material. Never notes.
 */

export type Plate = {
  id: string;
  name?: string;
  category?: string;
  subtype?: string;
  material?: string;
  colors?: string[];
  brand?: string;
  fit?: string;
  warmth?: number;
  notes?: string;
};

export type LookIds = {
  top?: string;
  bottom?: string;
  shoe?: string;
  outer?: string;
  mid?: string;
};

export type EvalCtx = { occasion?: string; season?: string; partial?: boolean };

export type SoftHit = [string, number];

export type EvalResult = {
  passed: boolean;
  hardFails: string[];
  soft: SoftHit[];
  minSignalGroups: number;
};

type Spec = {
  or?: Spec[];
  any?: string[];
  none?: string[];
  colors_any?: string[];
  colors_none?: string[];
  material_any?: string[];
  material_none?: string[];
  fit_any?: string[];
  brand_any?: string[];
  brand_none?: string[];
  subtype_exact?: string[];
  slot?: string;
  negate?: boolean;
  [k: string]: unknown;
};

const PASTEL = ["pink", "mauve", "yellow", "mint", "lavender", "lilac", "peach"];

const KW = new Map<string, RegExp>();
/** Same regexes keyed by the keyword as written, so the hot path skips toLowerCase. */
const KW_RAW = new Map<string, RegExp>();

export function kwRe(k: string): RegExp {
  const raw = KW_RAW.get(k);
  if (raw) return raw;
  const key = k.toLowerCase();
  let re = KW.get(key);
  if (!re) {
    re = new RegExp(`(?<![a-z0-9])${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
    KW.set(key, re);
  }
  KW_RAW.set(k, re);
  return re;
}

export function hasText(text: string, kws: string[] | undefined): boolean {
  if (!kws?.length) return false;
  const t = text.toLowerCase();
  return kws.some((k) => kwRe(k).test(t));
}

/** Whole word. "AMI" does not match "Amiri". */
export function brandHits(brand: string, words: string[] | undefined): boolean {
  if (!words?.length || !brand) return false;
  return words.some((word) => {
    const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "iu").test(brand);
  });
}

export function legacyChipOf(profile: { legacy_chip?: string | null }): string | null {
  const chip = profile.legacy_chip;
  return typeof chip === "string" && chip.trim() ? chip : null;
}

/** name | subtype | material. Never notes. */
export function blob(g: Plate): string {
  const m = memoOf(g);
  m.blob ??= [g.name ?? "", g.subtype ?? "", g.material ?? ""].join(" | ").toLowerCase();
  return m.blob;
}

export function slotOfPlate(g: Plate): string {
  const cat = g.category;
  const b = blob(g);
  if (cat === "outerwear" && hasText(b, ["cardigan", "fleece", "vest", "gilet", "zip sweater", "zip-up knit"])) {
    return "mid";
  }
  if (cat === "top") return "top";
  if (cat === "bottom") return "bottom";
  if (cat === "footwear") return "shoe";
  if (cat === "outerwear") return "outer";
  return cat ?? "";
}

/**
 * Strings derived from a plate, computed once per plate object. Every read checks the
 * fields it was built from, so an edited plate never reads an old value.
 */
type PlateMemo = {
  id: string;
  category?: string;
  name?: string;
  subtype?: string;
  material?: string;
  brand?: string;
  fit?: string;
  warmth?: number;
  colors: string[] | undefined;
  colorList: string[];
  color?: string;
  blob?: string;
  stamp?: string;
  vals?: Map<string, unknown>;
  colorHits?: WeakMap<string[], boolean>;
  shared?: Shared;
};

/**
 * sig() and banHit() answers, shared by every plate object with the same id and matched fields
 * (callers often build a fresh plate per call). Ids are reused across fixtures, so the key is the plate, not the id.
 */
type Shared = {
  /** Per keyword library. */
  sigs: WeakMap<object, Map<string, boolean>>;
  /** Per ban row, with the library it was read against. */
  bans: WeakMap<object, { lib: object; hit: boolean }>;
};

const SHARED = new Map<string, Shared>();
const SHARED_CAP = 20_000;

function sharedOf(g: Plate): Shared {
  const m = memoOf(g);
  if (m.shared) return m.shared;
  const key = [
    g.id,
    g.category ?? "",
    g.name ?? "",
    g.subtype ?? "",
    g.material ?? "",
    g.brand ?? "",
    g.fit ?? "",
    colorText(g),
  ].join("\0");
  let shared = SHARED.get(key);
  if (!shared) {
    if (SHARED.size >= SHARED_CAP) SHARED.clear();
    shared = { sigs: new WeakMap(), bans: new WeakMap() };
    SHARED.set(key, shared);
  }
  m.shared = shared;
  return shared;
}

const PLATE_MEMO = new WeakMap<Plate, PlateMemo>();

function memoOf(g: Plate): PlateMemo {
  const m = PLATE_MEMO.get(g);
  if (
    m &&
    m.id === g.id &&
    m.category === g.category &&
    m.name === g.name &&
    m.subtype === g.subtype &&
    m.material === g.material &&
    m.brand === g.brand &&
    m.fit === g.fit &&
    m.warmth === g.warmth &&
    m.colors === g.colors &&
    sameList(m.colorList, g.colors)
  ) {
    return m;
  }
  const next: PlateMemo = {
    id: g.id,
    category: g.category,
    name: g.name,
    subtype: g.subtype,
    material: g.material,
    brand: g.brand,
    fit: g.fit,
    warmth: g.warmth,
    colors: g.colors,
    colorList: [...(g.colors ?? [])],
  };
  PLATE_MEMO.set(g, next);
  return next;
}

function sameList(a: string[], b: string[] | undefined): boolean {
  const list = b ?? [];
  if (a.length !== list.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== list[i]) return false;
  return true;
}

export function colorText(g: Plate): string {
  const m = memoOf(g);
  m.color ??= (g.colors ?? []).join(" ").toLowerCase();
  return m.color;
}

/** Any value read only from the fields the plate memo checks (id, category, name, subtype, material, brand, fit, warmth, colors). */
export function plateMemo<T>(g: Plate, key: string, build: (g: Plate) => T): T {
  const m = memoOf(g);
  m.vals ??= new Map();
  if (m.vals.has(key)) return m.vals.get(key) as T;
  const value = build(g);
  m.vals.set(key, value);
  return value;
}

/** hasText(colorText(g), kws) for a fixed keyword list (PASTEL or profile JSON). */
function colorHas(g: Plate, kws: string[]): boolean {
  const m = memoOf(g);
  m.colorHits ??= new WeakMap();
  const hit = m.colorHits.get(kws);
  if (hit !== undefined) return hit;
  const val = hasText(colorText(g), kws);
  m.colorHits.set(kws, val);
  return val;
}

/** jackets.ts memo stamp, built once per plate object. */
export function plateStampOf(g: Plate, build: (g: Plate) => string): string {
  const m = memoOf(g);
  m.stamp ??= build(g);
  return m.stamp;
}

export function matchSpec(g: Plate, spec: Spec | undefined): boolean {
  if (!spec) return false;
  if (spec.or) return spec.or.some((s) => matchSpec(g, s));
  const b = blob(g);
  let ok = true;
  if (spec.any || spec.subtype_exact) {
    const hit =
      (Boolean(spec.any) && hasText(b, spec.any)) ||
      (Boolean(spec.subtype_exact) && spec.subtype_exact!.includes((g.subtype ?? "").toLowerCase()));
    ok = ok && hit;
  }
  if (spec.none) ok = ok && !hasText(b, spec.none);
  if (spec.colors_any) ok = ok && hasText(colorText(g), spec.colors_any);
  if (spec.colors_none) ok = ok && !hasText(colorText(g), spec.colors_none);
  const material = (g.material ?? "").toLowerCase();
  if (spec.material_any) ok = ok && hasText(material, spec.material_any);
  if (spec.material_none) ok = ok && !hasText(material, spec.material_none);
  if (spec.fit_any) ok = ok && spec.fit_any.includes((g.fit ?? "").toLowerCase());
  const brand = (g.brand ?? "").toLowerCase();
  if (spec.brand_any) ok = ok && brandHits(brand, spec.brand_any);
  if (spec.brand_none) ok = ok && !brandHits(brand, spec.brand_none);
  return Boolean(ok);
}

export function sig(g: Plate, sid: string, lib: Record<string, Spec>): boolean {
  return sigIn(sigCache(g, lib), g, sid, lib);
}

function sigCache(g: Plate, lib: Record<string, Spec>): Map<string, boolean> {
  const { sigs } = sharedOf(g);
  let cache = sigs.get(lib);
  if (!cache) {
    cache = new Map();
    sigs.set(lib, cache);
  }
  return cache;
}

/** One evaluation: each plate's sig cache is looked up once, not once per signal. */
function sigReader(lib: Record<string, Spec>): (g: Plate, sid: string) => boolean {
  const caches = new Map<Plate, Map<string, boolean>>();
  return (g, sid) => {
    let cache = caches.get(g);
    if (!cache) {
      cache = sigCache(g, lib);
      caches.set(g, cache);
    }
    return sigIn(cache, g, sid, lib);
  };
}

function sigIn(cache: Map<string, boolean>, g: Plate, sid: string, lib: Record<string, Spec>): boolean {
  const hit = cache.get(sid);
  if (hit !== undefined) return hit;
  const spec = lib[sid];
  let ok = false;
  if (spec) {
    const sl = spec.slot;
    if (sl && sl !== "any" && slotOfPlate(g) !== sl) ok = false;
    else ok = matchSpec(g, spec);
  }
  cache.set(sid, ok);
  return ok;
}

export function lightDenim(g: Plate): boolean {
  const c = colorText(g);
  return c.includes("light blue") || (c.includes("blue") && !hasText(c, ["navy", "indigo", "dark", "raw", "black"]));
}

export function darkDenim(g: Plate): boolean {
  return hasText(colorText(g), ["navy", "indigo", "dark", "raw", "rinse", "black"]);
}

const BAN_KEYS = new Set([
  "any",
  "none",
  "colors_any",
  "colors_none",
  "material_any",
  "brand_any",
  "or",
  "subtype_exact",
]);

function banHit(g: Plate, ban: Spec, lib: Record<string, Spec>): boolean {
  return banReader(lib)(g, ban);
}

/** One evaluation: each plate's ban answers are looked up once. Ban rows are read-only profile JSON. */
function banReader(lib: Record<string, Spec>): (g: Plate, ban: Spec) => boolean {
  const boxes = new Map<Plate, WeakMap<object, { lib: object; hit: boolean }>>();
  return (g, ban) => {
    let box = boxes.get(g);
    if (!box) {
      box = sharedOf(g).bans;
      boxes.set(g, box);
    }
    const hit = box.get(ban);
    if (hit && hit.lib === lib) return hit.hit;
    const val = banHitRaw(g, ban, lib);
    box.set(ban, { lib, hit: val });
    return val;
  };
}

function banHitRaw(g: Plate, ban: Spec, lib: Record<string, Spec>): boolean {
  const ids = ban.plate_ids as string[] | undefined;
  if (ids?.includes(g.id)) return true;
  const signals = ban.signals as string[] | undefined;
  if (signals) return signals.some((s) => sig(g, s, lib));
  const keys: Spec = {};
  let any = false;
  for (const [k, v] of Object.entries(ban)) {
    if (BAN_KEYS.has(k)) {
      (keys as Record<string, unknown>)[k] = v;
      any = true;
    }
  }
  return any && matchSpec(g, keys);
}

export function platesOf(look: LookIds, by: Map<string, Plate>): Partial<Record<string, Plate>> {
  const out: Partial<Record<string, Plate>> = {};
  for (const slot of ["top", "bottom", "shoe", "outer", "mid"] as const) {
    const id = look[slot];
    if (!id) continue;
    const g = by.get(id);
    if (g) out[slot] = g;
  }
  return out;
}

/** Second top/outer becomes mid when that slot is free. Same as stylist pieces_of. */
export function assignSlots(pieces: Plate[]): Partial<Record<string, Plate>> {
  const ps: Partial<Record<string, Plate>> = {};
  for (const g of pieces) {
    let s = slotOfPlate(g);
    if (ps[s]) {
      if ((s === "top" || s === "outer") && !ps.mid) s = "mid";
      else continue;
    }
    ps[s] = g;
  }
  return ps;
}

type Profile = {
  keywords: Record<string, Spec>;
  occasion_gate: Record<string, { status?: string; rule_id?: string }>;
  season_gate: Record<string, { status?: string; rule_id?: string }>;
  banned: Spec[];
  allowed: Record<string, string[] | undefined>;
  allowed_rule_ids: Record<string, string>;
  required: {
    hard: Spec[];
    min_signals?: { count: number; id: string; groups: { signals: string[] }[] };
  };
  pairing_rules: Spec[];
  dominance_caps?: { plates?: Record<string, { penalty?: number; rule_id?: string }> };
  rank_bonus?: { occasions?: string[]; signals: string[]; bonus: number }[];
  [k: string]: unknown;
};

export function evaluate(profile: Profile, look: LookIds, ctx: EvalCtx, by: Map<string, Plate>): EvalResult {
  return evaluatePlates(profile, platesOf(look, by), ctx);
}

export function evaluatePlates(profile: Profile, ps: Partial<Record<string, Plate>>, ctx: EvalCtx): EvalResult {
  const lib = profile.keywords;
  const read = sigReader(lib);
  const banned = banReader(lib);
  /* ps is not changed below; read its entries once. */
  const entries = Object.entries(ps);
  const values = entries.map(([, g]) => g);  const fails: string[] = [];
  const soft: SoftHit[] = [];
  let got = 0;
  const occ = ctx.occasion;
  const season = ctx.season;
  const og = (occ && profile.occasion_gate?.[occ]) || {};
  if (og.status === "off") fails.push(og.rule_id || "GATE-OCC");
  const sg = (season && profile.season_gate?.[season]) || {};
  if (sg.status === "off") fails.push(sg.rule_id || "GATE-SEASON");
  for (const slot of ["top", "bottom", "shoe"]) {
    if (!ps[slot] && !ctx.partial) fails.push(`CORE-MISSING-${slot}`);
  }
  for (const ban of profile.banned ?? []) {
    for (const [slot, g] of entries) {
      if (!g) continue;
      if (ban.slot !== slot && ban.slot !== "any") continue;
      let hit = banned(g, ban);
      const seasonIn = ban.season_in as string[] | undefined;
      const occasionIn = ban.occasion_in as string[] | undefined;
      const unless = ban.unless_occasion as string[] | undefined;
      if (seasonIn && !seasonIn.includes(season ?? "")) hit = false;
      if (occasionIn && !occasionIn.includes(occ ?? "")) hit = false;
      if (hit && !(unless && unless.includes(occ ?? ""))) {
        if ((ban.severity as string | undefined) === "hard" || ban.severity == null) {
          if ((ban.severity as string | undefined) !== "soft") fails.push(String(ban.id));
          else soft.push([String(ban.id), Number(ban.delta ?? -20)]);
        } else soft.push([String(ban.id), Number(ban.delta ?? -20)]);
      }
    }
  }
  for (const slot of ["top", "bottom", "shoe", "outer", "mid"]) {
    const g = ps[slot];
    if (!g) continue;
    const allowed = profile.allowed?.[slot];
    if (allowed && !allowed.some((s) => read(g, s))) {
      const id = profile.allowed_rule_ids?.[slot];
      if (id) fails.push(id);
    }
  }
  for (const req of profile.required?.hard ?? []) {
    const slot = req.slot as string | undefined;
    const signals = (req.signals as string[]) ?? [];
    if (req.type === "slot_in") {
      const g = slot ? ps[slot] : undefined;
      if (!g || !signals.some((s) => read(g, s))) fails.push(String(req.id));
    } else if (req.type === "any_slot_in") {
      const ok = values.some((g) => g && signals.some((s) => read(g, s)));
      if (!ok) fails.push(String(req.id));
    }
  }
  const ms = profile.required?.min_signals;
  if (ms) {
    let n = 0;
    for (const grp of ms.groups) {
      if (values.some((g) => g && grp.signals.some((s) => read(g, s)))) n += 1;
    }
    got = n;
    if (n < ms.count) fails.push(ms.id);
  }
  for (const pr of profile.pairing_rules ?? []) {
    const t = pr.type as string;
    const hard = (pr.severity as string | undefined) !== "soft";
    const push = () => {
      if (hard) fails.push(String(pr.id));
      else soft.push([String(pr.id), Number(pr.delta ?? -10)]);
    };
    if (t === "max_matching") {
      const signals = (pr.signals as string[]) ?? [];
      const n = values.filter((g) => g && signals.some((s) => read(g, s))).length;
      if (n > Number(pr.max)) {
        if ((pr.severity as string | undefined ?? "hard") === "hard") fails.push(String(pr.id));
        else soft.push([String(pr.id), Number(pr.delta ?? -10)]);
      }
    } else if (t === "requires_outer") {
      const seasons = (pr.seasons as string[]) ?? [];
      const occasions = (pr.occasions as string[]) ?? [];
      if (season && seasons.includes(season) && occ && occasions.includes(occ) && !ps.outer) {
        if ((pr.severity as string | undefined ?? "hard") === "hard") fails.push(String(pr.id));
        else soft.push([String(pr.id), Number(pr.delta ?? -15)]);
      }
    } else if (t === "denim_shade_gap") {
      const bottom = ps.bottom;
      if (bottom && read(bottom, "denim_bottom")) {
        for (const sl of ["top", "outer"] as const) {
          const x = ps[sl];
          if (
            x &&
            (read(x, "denim_chambray_shirt") ||
              read(x, "denim_trucker") ||
              (sl === "top" && (x.material ?? "").toLowerCase().includes("denim")))
          ) {
            if ((lightDenim(x) && lightDenim(bottom)) || (darkDenim(x) && darkDenim(bottom))) {
              fails.push(String(pr.id));
            }
          }
        }
      }
      const top = ps.top;
      const outer = ps.outer;
      if (
        top &&
        outer &&
        read(outer, "denim_trucker") &&
        (read(top, "denim_chambray_shirt") || (top.material ?? "").toLowerCase().includes("denim"))
      ) {
        if ((lightDenim(top) && lightDenim(outer)) || (darkDenim(top) && darkDenim(outer))) {
          fails.push(String(pr.id));
        }
      }
    } else if (t === "if_then") {
      const cond = pr.if as Spec;
      const g = ps[String(cond.slot)];
      const cSignals = (cond.signals as string[]) ?? [];
      if (g && cSignals.some((s) => read(g, s))) {
        const th = pr.then as Spec;
        const h = ps[String(th.slot)];
        const tSignals = (th.signals as string[]) ?? [];
        let ok = Boolean(h) && tSignals.some((s) => read(h as Plate, s));
        if (th.negate) ok = !(Boolean(h) && tSignals.some((s) => read(h as Plate, s)));
        if (!ok) push();
      }
    } else if (t === "pastel_budget") {
      const n = values.filter((g) => g && colorHas(g, PASTEL)).length;
      if (n > Number(pr.max)) fails.push(String(pr.id));
    } else if (t === "tonal_or_jacket") {
      const jackets = (pr.jackets as string[]) ?? [];
      const tonal = (pr.tonal_colors as string[]) ?? [];
      const okj = Boolean(ps.outer) && jackets.some((s) => read(ps.outer as Plate, s));
      const core = [ps.top, ps.bottom, ps.shoe].filter((g): g is Plate => Boolean(g));
      const okt = core.length > 0 && core.every((g) => colorHas(g, tonal));
      if (!(okj || okt)) fails.push(String(pr.id));
    }
  }
  const caps = profile.dominance_caps?.plates ?? {};
  for (const [pid, cap] of Object.entries(caps)) {
    if (cap.penalty != null && values.some((g) => g?.id === pid)) {
      soft.push([String(cap.rule_id ?? "DOM"), Number(cap.penalty)]);
    }
  }
  const hardFails = [...new Set(fails)].sort();
  return { passed: hardFails.length === 0, hardFails, soft, minSignalGroups: got };
}

export function rankBonus(profile: Profile, ps: Partial<Record<string, Plate>>, ctx: EvalCtx): number {
  const lib = profile.keywords;
  let tot = 0;
  for (const rb of profile.rank_bonus ?? []) {
    if (rb.occasions && !rb.occasions.includes(ctx.occasion ?? "")) continue;
    if (Object.values(ps).some((g) => g && rb.signals.some((s) => sig(g, s, lib)))) tot += rb.bonus;
  }
  return tot;
}

/** 10×min_signal_groups + soft deltas − 0.05×usage + rank_bonus. Illegal looks score −Infinity. */
export function scorePlates(
  profile: Profile,
  ps: Partial<Record<string, Plate>>,
  ctx: EvalCtx,
  usage = 0,
): { score: number; eval: EvalResult } {
  const ev = evaluatePlates(profile, ps, ctx);
  if (!ev.passed) return { score: Number.NEGATIVE_INFINITY, eval: ev };
  const soft = ev.soft.reduce((sum, [, d]) => sum + d, 0);
  const score = 10 * ev.minSignalGroups + soft - 0.05 * usage + rankBonus(profile, ps, ctx);
  return { score, eval: ev };
}

export function pieceBanned(g: Plate, profile: Profile, ctx: EvalCtx): boolean {
  const lib = profile.keywords;
  const slot = slotOfPlate(g);
  for (const ban of profile.banned ?? []) {
    if (ban.slot !== slot && ban.slot !== "any") continue;
    if ((ban.severity as string | undefined) === "soft") continue;
    let hit = banHit(g, ban, lib);
    const seasonIn = ban.season_in as string[] | undefined;
    const occasionIn = ban.occasion_in as string[] | undefined;
    const unless = ban.unless_occasion as string[] | undefined;
    if (seasonIn && !seasonIn.includes(ctx.season ?? "")) hit = false;
    if (occasionIn && !occasionIn.includes(ctx.occasion ?? "")) hit = false;
    if (hit && !(unless && unless.includes(ctx.occasion ?? ""))) return true;
  }
  return false;
}

export function gateOff(profile: Profile, ctx: EvalCtx): { off: boolean; text: string; ruleId: string } | null {
  const og = (ctx.occasion && profile.occasion_gate?.[ctx.occasion]) || {};
  const sg = (ctx.season && profile.season_gate?.[ctx.season]) || {};
  if (og.status !== "off" && sg.status !== "off") return null;
  const parts = [og.status === "off" ? og : null, sg.status === "off" ? sg : null].filter(Boolean) as {
    modifier?: string;
    rule_id?: string;
  }[];
  return {
    off: true,
    text: parts.map((p) => p.modifier).filter(Boolean).join(" ") || "This house is off for that chip.",
    ruleId: parts.map((p) => p.rule_id).filter(Boolean).join("+"),
  };
}

export function primaryKey(gate: Record<string, { status?: string }> | undefined, fallback: string): string {
  if (!gate) return fallback;
  for (const [k, v] of Object.entries(gate)) if (v?.status === "primary") return k;
  return fallback;
}

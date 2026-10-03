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

export function kwRe(k: string): RegExp {
  const key = k.toLowerCase();
  let re = KW.get(key);
  if (!re) {
    re = new RegExp(`(?<![a-z0-9])${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
    KW.set(key, re);
  }
  return re;
}

export function hasText(text: string, kws: string[] | undefined): boolean {
  if (!kws?.length) return false;
  const t = text.toLowerCase();
  return kws.some((k) => kwRe(k).test(t));
}

/** name | subtype | material. Never notes. */
export function blob(g: Plate): string {
  return [g.name ?? "", g.subtype ?? "", g.material ?? ""].join(" | ").toLowerCase();
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

export function colorText(g: Plate): string {
  return (g.colors ?? []).join(" ").toLowerCase();
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
  if (spec.brand_any) ok = ok && hasText(brand, spec.brand_any);
  if (spec.brand_none) ok = ok && !hasText(brand, spec.brand_none);
  return Boolean(ok);
}

const SIG = new WeakMap<object, Map<string, boolean>>();

export function sig(g: Plate, sid: string, lib: Record<string, Spec>): boolean {
  let cache = SIG.get(lib);
  if (!cache) {
    cache = new Map();
    SIG.set(lib, cache);
  }
  // Ids are reused across fixtures. Key the plate, not just the id.
  const key = [
    g.id,
    g.category ?? "",
    g.name ?? "",
    g.subtype ?? "",
    g.material ?? "",
    g.brand ?? "",
    g.fit ?? "",
    colorText(g),
    sid,
  ].join("\0");
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const spec = lib[sid];
  let ok = false;
  if (spec) {
    const sl = spec.slot;
    if (sl && sl !== "any" && slotOfPlate(g) !== sl) ok = false;
    else ok = matchSpec(g, spec);
  }
  cache.set(key, ok);
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
  const fails: string[] = [];
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
    for (const [slot, g] of Object.entries(ps)) {
      if (!g) continue;
      if (ban.slot !== slot && ban.slot !== "any") continue;
      let hit = banHit(g, ban, lib);
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
    if (allowed && !allowed.some((s) => sig(g, s, lib))) {
      const id = profile.allowed_rule_ids?.[slot];
      if (id) fails.push(id);
    }
  }
  for (const req of profile.required?.hard ?? []) {
    const slot = req.slot as string | undefined;
    const signals = (req.signals as string[]) ?? [];
    if (req.type === "slot_in") {
      const g = slot ? ps[slot] : undefined;
      if (!g || !signals.some((s) => sig(g, s, lib))) fails.push(String(req.id));
    } else if (req.type === "any_slot_in") {
      const ok = Object.values(ps).some((g) => g && signals.some((s) => sig(g, s, lib)));
      if (!ok) fails.push(String(req.id));
    }
  }
  const ms = profile.required?.min_signals;
  if (ms) {
    let n = 0;
    for (const grp of ms.groups) {
      if (Object.values(ps).some((g) => g && grp.signals.some((s) => sig(g, s, lib)))) n += 1;
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
      const n = Object.values(ps).filter((g) => g && signals.some((s) => sig(g, s, lib))).length;
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
      if (bottom && sig(bottom, "denim_bottom", lib)) {
        for (const sl of ["top", "outer"] as const) {
          const x = ps[sl];
          if (
            x &&
            (sig(x, "denim_chambray_shirt", lib) ||
              sig(x, "denim_trucker", lib) ||
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
        sig(outer, "denim_trucker", lib) &&
        (sig(top, "denim_chambray_shirt", lib) || (top.material ?? "").toLowerCase().includes("denim"))
      ) {
        if ((lightDenim(top) && lightDenim(outer)) || (darkDenim(top) && darkDenim(outer))) {
          fails.push(String(pr.id));
        }
      }
    } else if (t === "if_then") {
      const cond = pr.if as Spec;
      const g = ps[String(cond.slot)];
      const cSignals = (cond.signals as string[]) ?? [];
      if (g && cSignals.some((s) => sig(g, s, lib))) {
        const th = pr.then as Spec;
        const h = ps[String(th.slot)];
        const tSignals = (th.signals as string[]) ?? [];
        let ok = Boolean(h) && tSignals.some((s) => sig(h as Plate, s, lib));
        if (th.negate) ok = !(Boolean(h) && tSignals.some((s) => sig(h as Plate, s, lib)));
        if (!ok) push();
      }
    } else if (t === "pastel_budget") {
      const n = Object.values(ps).filter((g) => g && hasText(colorText(g), PASTEL)).length;
      if (n > Number(pr.max)) fails.push(String(pr.id));
    } else if (t === "tonal_or_jacket") {
      const jackets = (pr.jackets as string[]) ?? [];
      const tonal = (pr.tonal_colors as string[]) ?? [];
      const okj = Boolean(ps.outer) && jackets.some((s) => sig(ps.outer as Plate, s, lib));
      const core = [ps.top, ps.bottom, ps.shoe].filter((g): g is Plate => Boolean(g));
      const okt = core.length > 0 && core.every((g) => hasText(colorText(g), tonal));
      if (!(okj || okt)) fails.push(String(pr.id));
    }
  }
  const caps = profile.dominance_caps?.plates ?? {};
  for (const [pid, cap] of Object.entries(caps)) {
    if (cap.penalty != null && Object.values(ps).some((g) => g?.id === pid)) {
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

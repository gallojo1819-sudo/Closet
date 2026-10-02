/**
 * Port of stylist_check.py evaluate(). Signal lists, pattern classes, and
 * colour facts are read from the JSON files. No colour table is copied here.
 * Decision (a): the Italian Summer pink-linen look with the taupe blazer
 * softens COL-9 and PASTEL-b to −10.
 */
import { blob, hasText, sig, slotOfPlate, type Plate } from "../house-profiles/evaluate.ts";
import cmap from "./data/color-value-map.json" with { type: "json" };
import rules from "./data/2026-09-30-proposed-stylist-rules.json" with { type: "json" };

const SIG = rules.shared_signals as Record<string, { slot?: string; [k: string]: unknown }>;
const PATTERNS = rules.pattern_classes as Record<string, string[]>;

export type StylistHit = { id: string; severity: "hard" | "soft"; delta: number; why: string };

const ORDER = ["outer", "mid", "top", "bottom", "shoe"] as const;

const EXCEPTION = ["g_9t24uvtl10wd", "g_66xj06nllgf2", "g_5g4fqg77s4rw", "g_juk45cokjxxy"];

const PASTEL_HOUSES = new Set(["polo", "ald", "faloni", "italiansummer", "sweetstable"]);

const HOUSE_CODE: Record<string, string> = {
  polo: "polo",
  ald: "ald",
  faloni: "faloni",
  purple: "purple",
  rrl: "rrl",
  fiveFourFive: "545",
  "545": "545",
  sweetStable: "sweetstable",
  sweetstable: "sweetstable",
  italianSummer: "italiansummer",
  italiansummer: "italiansummer",
  italianWinter: "italianwinter",
  italianwinter: "italianwinter",
};

type ColorInfo = { family: string; value: number; default_role: string; accent_family?: string; level?: string };

function canonList(raw: string): string[] {
  const r = raw.toLowerCase().trim();
  const aliases = (cmap.raw_aliases as Record<string, string[]>)[r];
  return aliases ?? [r];
}

export function dominant(g: Plate): string | null {
  for (const c of g.colors ?? []) {
    const t = canonList(c);
    if (t.length) return t[0] ?? null;
  }
  return null;
}

function cinfo(c: string | null): ColorInfo | null {
  if (!c) return null;
  return ((cmap.colors as Record<string, ColorInfo>)[c] ?? null) as ColorInfo | null;
}

function valOf(g: Plate): number | null {
  const i = cinfo(dominant(g));
  return i ? i.value : null;
}

function isDenim(g: Plate): boolean {
  return sig(g, "denim_piece", SIG);
}

function accentFamily(g: Plate, slot: string): string | null {
  const c = dominant(g);
  const i = cinfo(c);
  if (!i) return null;
  if (i.default_role === "accent") return i.accent_family ?? i.family;
  if (c === "light blue" && slot !== "top" && !isDenim(g)) return "light_blue";
  return null;
}

function texture(g: Plate): string {
  const m = (g.material ?? "").toLowerCase();
  const b = blob(g);
  const s = slotOfPlate(g);
  if (!m) return "unknown";
  if (m === "knit" || m === "ribbed knit" || (m === "wool" && hasText(b, ["sweater", "cable", "knit"]))) return "knit";
  if (m === "suede" || m === "fleece" || b.includes("shearling")) return "nap";
  if (m === "leather") return "leather";
  if (m === "denim" || m === "corduroy" || m === "flannel" || (m === "wool" && (s === "bottom" || s === "outer"))) {
    return "rugged_woven";
  }
  return "smooth_woven";
}

export function wash(g: Plate): number {
  const name = (g.name ?? "").toLowerCase();
  const nk = cmap.denim_wash.name_keywords_first as Record<string, string[]>;
  const scale = cmap.denim_wash.scale as Record<string, number>;
  for (const lvl of ["ecru", "dark", "light"] as const) {
    if (hasText(name, nk[lvl])) return scale[lvl] ?? 2;
  }
  const c = dominant(g);
  const mapped = (cmap.denim_wash.else_by_dominant_colour as Record<string, string>)[c ?? ""] ?? "mid";
  return scale[mapped] ?? 2;
}

export function piecesFromIds(
  look: Record<string, string | undefined>,
  by: Map<string, Plate>,
): Partial<Record<string, Plate>> {
  const ps: Partial<Record<string, Plate>> = {};
  for (const [k, id] of Object.entries(look)) {
    if (!id) continue;
    const g = by.get(id);
    if (g) ps[k] = g;
  }
  return ps;
}

function exceptionLook(ps: Partial<Record<string, Plate>>): boolean {
  const ids = new Set(Object.values(ps).map((g) => g?.id));
  return EXCEPTION.every((id) => ids.has(id));
}

export function stylistHits(
  ps: Partial<Record<string, Plate>>,
  occ: string,
  season: string,
  house?: string | null,
): StylistHit[] {
  const H: StylistHit[] = [];
  const hit = (id: string, severity: "hard" | "soft", delta: number, why: string) => {
    H.push({ id, severity, delta, why });
  };
  const top = ps.top;
  const bot = ps.bottom;
  const shoe = ps.shoe;
  const outer = ps.outer;
  const mid = ps.mid;
  const garments = Object.entries(ps)
    .filter(([k, g]) => k !== "shoe" && g)
    .map(([, g]) => g as Plate);

  if (shoe && cinfo(dominant(shoe))?.family === "brown") {
    const smat = (shoe.material ?? "").toLowerCase();
    if (bot && dominant(bot) === "black") {
      hit("COL-7", "hard", 0, `black trouser ${bot.name} with brown shoe ${shoe.name}`);
    }
    for (const k of ["top", "mid", "outer"] as const) {
      const g = ps[k];
      if (g && dominant(g) === "black") {
        if (smat === "leather") hit("COL-7", "hard", 0, `black ${g.name} with brown smooth-leather ${shoe.name}`);
        else if (smat === "suede") {
          hit(
            "COL-7",
            "soft",
            texture(g) === "knit" ? -5 : -10,
            `black ${g.name} + brown suede ${shoe.name} (texture-separated)`,
          );
        }
      }
    }
  }
  if (shoe && dominant(shoe) === "black") {
    const nb = garments.filter((g) => cinfo(dominant(g))?.family === "brown").length;
    if (nb >= 2) hit("COL-7", "soft", -10, "black shoe under 2+ brown garments");
  }

  const seq = ORDER.filter((k) => ps[k]).map((k) => [k, ps[k] as Plate] as const);
  const navy = seq.map((pair, i) => (dominant(pair[1]) === "navy" ? i : -1)).filter((i) => i >= 0);
  const black = seq.map((pair, i) => (dominant(pair[1]) === "black" ? i : -1)).filter((i) => i >= 0);
  for (const a of navy) {
    for (const b of black) {
      if (seq[a]![1].id === seq[b]![1].id) continue;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const between = seq.slice(lo + 1, hi).map((pair) => pair[1]);
      if (seq[b]![0] === "shoe" && seq[a]![0] === "bottom") continue;
      if (!between.length) hit("COL-8", "hard", 0, `navy ${seq[a]![1].name} touches black ${seq[b]![1].name}`);
      else if (between.some((x) => (valOf(x) ?? 3) <= 2)) {
        /* separated by a light piece */
      } else hit("COL-8", "soft", -15, `navy ${seq[a]![1].name} / black ${seq[b]![1].name} separated only by mid/dark`);
    }
  }

  const fams = new Map<string, [string, number][]>();
  for (const [k, g] of Object.entries(ps)) {
    if (!g) continue;
    const f = accentFamily(g, k);
    if (!f) continue;
    const list = fams.get(f) ?? [];
    list.push([g.name ?? "", valOf(g) ?? 3]);
    fams.set(f, list);
  }
  if (fams.size > 1) {
    const why = `accents: ${[...fams.entries()].map(([f, v]) => `${f} (${v.map(([n]) => n).join(", ")})`).join("; ")}`;
    const lightFams = [...fams.entries()].filter(([, v]) => Math.min(...v.map(([, x]) => x)) <= 3).map(([f]) => f);
    if (lightFams.length >= 2) {
      if ((season === "spring" || season === "summer") && (outer || garments.some((g) => (valOf(g) ?? 0) >= 4))) {
        hit("COL-9", "soft", -10, `${why} (warm season, anchored)`);
      } else hit("COL-9", "hard", 0, why);
    } else hit("COL-9", "soft", -5, `${why} (one deep accent)`);
  }

  const vals = Object.values(ps)
    .filter((g): g is Plate => Boolean(g))
    .map((g) => valOf(g));
  if (vals.length && vals.every((v) => v != null && v <= 2)) {
    hit("COL-10", occ === "out" ? "hard" : "soft", -15, "every piece is light (no value anchor)");
  } else if (occ === "out" && !garments.some((g) => (valOf(g) ?? 0) >= 4)) {
    hit("COL-10", "soft", -10, "Out look with no dark garment");
  }

  if (top && bot && dominant(top) && dominant(top) === dominant(bot)) {
    const o = outer || mid;
    const topInfo = cinfo(dominant(top));
    const oInfo = o ? cinfo(dominant(o)) : null;
    const exempt = Boolean(o && oInfo && topInfo && oInfo.family !== topInfo.family);
    if (!exempt) {
      const t1 = texture(top);
      const t2 = texture(bot);
      if (t1 === "unknown" || t2 === "unknown") {
        hit("COL-11", "soft", -10, `same colour (${dominant(top)}) top+bottom, texture unknown`);
      } else if (t1 === t2) hit("COL-11", "hard", 0, `same colour (${dominant(top)}) + same texture (${t1})`);
    }
  }

  if (occ === "out" && shoe && bot && (valOf(shoe) ?? 5) <= 2 && (valOf(bot) ?? 0) >= 4) {
    hit("COL-12", "soft", -10, "light shoe under dark trouser at night");
  }
  if (top && bot && valOf(top) === 3 && valOf(bot) === 3) {
    const pair = new Set([dominant(top), dominant(bot)]);
    const muddy = [
      ["grey", "sage"],
      ["blue", "sage"],
      ["mauve", "sage"],
    ].some((p) => p.every((c) => pair.has(c)) && pair.size === 2);
    if (muddy) {
      const o = outer || mid;
      if (!(o && valOf(o) != null && valOf(o) !== 3)) hit("COL-13", "soft", -10, `muddy mid tones ${dominant(top)} + ${dominant(bot)}`);
    }
  }

  const den = Object.entries(ps).filter(([k, g]) => k !== "shoe" && g && isDenim(g)) as [string, Plate][];
  for (let i = 0; i < den.length; i++) {
    for (let j = i + 1; j < den.length; j++) {
      const a = den[i]![1];
      const b = den[j]![1];
      const w1 = wash(a);
      const w2 = wash(b);
      if (Math.abs(w1 - w2) >= 2) continue;
      if ((w1 === 0 && w2 === 1) || (w1 === 1 && w2 === 0)) {
        hit("XC-DEN-1", "soft", -10, `ecru vs light denim: ${a.name} / ${b.name}`);
      } else hit("XC-DEN-1", "hard", 0, `denim washes too close: ${a.name} / ${b.name}`);
    }
  }
  if (den.length >= 3) hit("XC-DEN-2", "hard", 0, "triple denim");

  if (bot && sig(bot, "track_knit_pant", SIG) && occ !== "comfy") {
    if ((top && sig(top, "collared_woven_shirt", SIG)) || (outer && sig(outer, "blazer", SIG)) || (shoe && sig(shoe, "loafer", SIG))) {
      hit("XC-TEX-1", "hard", 0, `track/fleece pant ${bot.name} with a dressy piece`);
    }
  }
  if (outer && sig(outer, "blazer", SIG)) {
    if (
      (top && sig(top, "sweat_fleece_top", SIG)) ||
      (mid && sig(mid, "sweat_fleece_top", SIG)) ||
      (bot && sig(bot, "track_knit_pant", SIG)) ||
      (shoe && sig(shoe, "athletic_or_fashion_sneaker", SIG))
    ) {
      hit("XC-TEX-2", "hard", 0, "blazer with athletic/sweat piece");
    } else if (shoe && sig(shoe, "clean_leather_sneaker", SIG)) hit("XC-TEX-2", "soft", -5, "blazer + leather sneaker");
  }
  if (bot && sig(bot, "tailored_trouser", SIG) && shoe) {
    if (sig(shoe, "athletic_or_fashion_sneaker", SIG)) {
      if (occ === "weekday" || occ === "out") hit("XC-TEX-3", "hard", 0, `tailored ${bot.name} + athletic/fashion ${shoe.name}`);
      else hit("XC-TEX-3", "soft", -10, `tailored ${bot.name} + athletic/fashion ${shoe.name} (weekend)`);
    } else if (sig(shoe, "clean_leather_sneaker", SIG) && (occ === "weekday" || occ === "out")) {
      hit("XC-TEX-3", "soft", -10, `tailored ${bot.name} + leather sneaker on ${occ}`);
    }
  }
  if (top && sig(top, "sweat_fleece_top", SIG) && occ !== "comfy" && occ !== "travel") {
    if ((bot && sig(bot, "tailored_trouser", SIG)) || (shoe && sig(shoe, "tassel_loafer", SIG))) {
      hit("XC-TEX-4", "hard", 0, `sweat/fleece top ${top.name} with tailoring`);
    }
  }
  if (top && sig(top, "work_flannel_shirt", SIG) && bot && sig(bot, "tailored_trouser", SIG)) {
    hit("XC-TEX-5", occ === "out" ? "hard" : "soft", -15, `flannel ${top.name} + dress trouser ${bot.name}`);
  }
  if (bot && sig(bot, "pinstripe", SIG) && !(outer && sig(outer, "blazer", SIG))) {
    hit("XC-TEX-6", "soft", -15, "pinstripe trouser without blazer");
  }
  if (top && hasText(blob(top), ["bowling", "camp"]) && shoe && sig(shoe, "tassel_loafer", SIG)) {
    hit("XC-TEX-7", "soft", -10, "resort shirt + tassel loafer");
  }
  if (occ === "out" && (season === "fall" || season === "winter") && !outer && !mid) {
    if (top && sig(top, "short_sleeve_top", SIG)) hit("XC-TEX-8", "hard", 0, `Out ${season}: ${top.name} with no layer`);
    else hit("XC-TEX-8", "soft", -10, `Out ${season}: no outer`);
  }
  if (outer && hasText(blob(outer), ["field jacket", "chore", "denim jacket", "trucker"]) && shoe && sig(shoe, "mule", SIG)) {
    hit("XC-TEX-9", "soft", -10, `utility ${outer.name} + ${shoe.name}`);
  }
  if (
    shoe &&
    sig(shoe, "boot", SIG) &&
    bot &&
    (sig(bot, "pleated_trouser", SIG) || (sig(bot, "tailored_trouser", SIG) && (valOf(bot) ?? 5) <= 2))
  ) {
    hit("XC-PROP-1", "hard", 0, `${bot.name} over boots`);
  }
  if (top && bot) {
    const chunky =
      ((top.fit ?? "") === "relaxed" || (top.fit ?? "") === "oversized") &&
      ((top.warmth ?? 0) >= 4 || hasText(blob(top), ["cable", "fleece", "hoodie"]));
    if (chunky && (bot.fit ?? "") === "relaxed" && hasText(blob(bot), ["pleated"])) {
      hit("XC-PROP-2", "soft", -10, `relaxed chunky ${top.name} over relaxed pleats`);
    }
  }

  const cold = (g: Plate) => sig(g, "cold_fabric_piece", SIG) || (g.warmth ?? 0) >= 4;
  const hot = (g: Plate) => sig(g, "summer_fabric_piece", SIG);
  const all = Object.values(ps).filter((g): g is Plate => Boolean(g));
  if (season === "summer") {
    const bad = all.filter(cold).map((g) => g.name ?? "");
    if (bad.length) hit("XC-SEA-1", "hard", 0, `cold-weather piece in summer: ${bad.join(", ")}`);
    else {
      if (top && (top.warmth ?? 0) >= 3) hit("XC-SEA-1", "soft", -10, `warmth-3 top in summer (${top.name})`);
      if (outer) hit("XC-SEA-1", "soft", -10, `outer in summer (${outer.name})`);
    }
  }
  if (season === "winter") {
    const bad = all.filter(hot).map((g) => g.name ?? "");
    if (bad.length) hit("XC-SEA-2", "hard", 0, `summer piece in winter: ${bad.join(", ")}`);
    if (top && sig(top, "short_sleeve_top", SIG) && !outer && !mid) {
      hit("XC-SEA-2", "hard", 0, `short-sleeve ${top.name} with no layer in winter`);
    }
    if (bot && accentFamily(bot, "bottom") && (valOf(bot) ?? 5) <= 2) {
      hit("XC-SEA-2", "soft", -10, `pastel/light-blue trouser in winter (${bot.name})`);
    }
    const ws = [top, mid, outer].reduce((sum, g) => sum + (g ? (g.warmth ?? 0) : 0), 0);
    if (ws < 5) hit("XC-SEA-2", "soft", -15, `upper-body warmth ${ws} < 5 in winter`);
  }
  if (season === "fall" && (occ === "weekday" || occ === "out")) {
    for (const g of all) {
      if (!hot(g) || sig(g, "mule", SIG)) continue;
      hit("XC-SEA-3", "soft", -10, `resort piece in fall ${occ}: ${g.name}`);
    }
  }
  if ((season === "fall" || season === "winter") && shoe && sig(shoe, "mule", SIG)) {
    hit("XC-SEA-3", "hard", 0, `mules ${shoe.name} in ${season}`);
  }
  if (all.some(cold) && all.some(hot)) hit("XC-SEA-4", "soft", -15, "cold + hot pieces in one look");

  const pat = new Map<string, [string, string][]>();
  for (const [k, g] of Object.entries(ps)) {
    if (!g || k === "shoe") continue;
    const b = blob(g);
    for (const [cls, kws] of Object.entries(PATTERNS)) {
      if (!hasText(b, kws)) continue;
      if (cls === "check_large" && hasText(b, PATTERNS.check_small)) continue;
      const list = pat.get(cls) ?? [];
      list.push([k, g.name ?? ""]);
      pat.set(cls, list);
    }
  }
  const stripes = pat.get("stripe") ?? [];
  const fine = stripes.filter((x) => hasText(blob(ps[x[0]] as Plate), ["pinstripe", "chalkstripe", "chalk stripe"]));
  const reg = stripes.filter((x) => !fine.includes(x));
  if (reg.length >= 2 || fine.length >= 2) {
    hit("XC-PAT-1", "hard", 0, `two same-scale stripes: ${stripes.map(([, n]) => n).join(", ")}`);
  } else if (reg.length && fine.length) hit("XC-PAT-1", "soft", -5, "striped shirt + pinstripe (different scale)");
  for (const cls of ["check_large", "busy_knit_or_print"]) {
    const list = pat.get(cls) ?? [];
    if (list.length >= 2) hit("XC-PAT-1", "hard", 0, `two ${cls}: ${list.map(([, n]) => n).join(", ")}`);
  }
  const checks = [...(pat.get("check_large") ?? []), ...(pat.get("check_small") ?? [])];
  if ((pat.get("busy_knit_or_print") ?? []).length && checks.length) hit("XC-PAT-1", "hard", 0, "busy knit/print + check");
  if (stripes.length && checks.length && !stripes.concat(checks).some(([k]) => k === "outer")) {
    hit("XC-PAT-1", "soft", -10, "stripe + check");
  }

  const h = HOUSE_CODE[(house ?? "").trim()] ?? (house ?? "").toLowerCase();
  if (h) {
    if (h === "polo" && occ === "out" && (season === "fall" || season === "winter") && !outer) {
      hit("POLO-P7", "hard", 0, "Polo Out needs a jacket");
    }
    if (PASTEL_HOUSES.has(h)) {
      const past = new Set(["pink", "mauve", "yellow", "mint", "lavender", "sage"]);
      let n = 0;
      for (const [k, g] of Object.entries(ps)) {
        if (!g) continue;
        const c = dominant(g);
        if (!c) continue;
        if (past.has(c) || (c === "light blue" && (k === "bottom" || k === "shoe" || k === "outer") && !isDenim(g))) n += 1;
      }
      if (n > 1) hit("PASTEL-b", "hard", 0, `${n} pastel pieces (sage/light-blue counted)`);
    }
    if (h === "faloni" && season === "winter" && !outer && !mid) {
      if ((top && sig(top, "short_sleeve_top", SIG)) || (bot && dominant(bot) === "light blue" && !isDenim(bot))) {
        hit("FAL-P5", "hard", 0, "Faloni winter: summer cotton pieces with no layer");
      }
    }
    if (h === "faloni" && top && bot && (valOf(top) ?? 5) <= 2 && (valOf(bot) ?? 5) <= 2) {
      const anch = [shoe, outer].filter(
        (g): g is Plate => Boolean(g && cinfo(dominant(g!))?.family === "brown" && (valOf(g!) ?? 0) >= 4),
      );
      if (!anch.length) hit("FAL-P6", "soft", -10, "pale Faloni look without a brown anchor");
    }
    if (h === "545" && garments.some((g) => dominant(g) === "black") && shoe) {
      const c = dominant(shoe);
      const m = (shoe.material ?? "").toLowerCase();
      if (!(c === "black" || c === "white" || c === "cream" || ((c === "brown" || c === "chocolate") && m === "suede"))) {
        hit("545-P3", "hard", 0, `545 black look with ${shoe.name}`);
      }
    }
    if (
      h === "sweetstable" &&
      top &&
      bot &&
      hasText(blob(top), ["fair isle", "cable"]) &&
      (dominant(top) === "cream" || dominant(top) === "white" || dominant(top) === "ivory") &&
      isDenim(bot) &&
      wash(bot) === 0
    ) {
      hit("SS-P5", "soft", -10, "cream knit over white/ecru denim");
    }
    if (h === "italiansummer") {
      const cap = season === "summer" ? 2 : 3;
      if ((top && (top.warmth ?? 0) > cap) || [top, mid].some((g) => g && hasText(blob(g), ["fleece"]))) {
        hit("IS-P5", "hard", 0, `IS warmth cap ${cap} / fleece`);
      }
    }
    if (h === "italianwinter" && ![top, bot, outer, mid].some((g) => g && (valOf(g) ?? 0) >= 4)) {
      hit("IW-P5", "soft", -15, "IW look with no dark anchor");
    }
    if (
      h === "purple" &&
      top &&
      bot &&
      cinfo(dominant(top)) &&
      cinfo(dominant(bot)) &&
      cinfo(dominant(top))!.family === cinfo(dominant(bot))!.family &&
      !outer
    ) {
      hit("PL-P2", "hard", 0, "Purple tonal without a jacket");
    }
    if (h === "rrl" && season === "winter" && outer && isDenim(outer) && !mid) {
      hit("RRL-P7", "soft", -10, "denim trucker alone in winter");
    }
  }

  if (!exceptionLook(ps)) return H;
  return H.map((row) =>
    (row.id === "COL-9" || row.id === "PASTEL-b") && row.severity === "hard"
      ? { ...row, severity: "soft" as const, delta: -10 }
      : row,
  );
}

export function stylistSoftDelta(hits: StylistHit[]): number {
  return hits.reduce((sum, h) => (h.severity === "soft" ? sum + h.delta : sum), 0);
}

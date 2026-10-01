/**
 * Joint top-3 for one occasion and season.
 * Houses with the fewest legal looks are placed first. The search backtracks
 * when a later house cannot reach three looks.
 */
import { APPROVED } from "../house-profiles/load.ts";
import { gateOff, primaryKey } from "../house-profiles/evaluate.ts";
import { HOUSES, type House } from "../houses.ts";
import type { Garment, Occasion, Season } from "../types.ts";
import { canonTokens } from "./colorChip.ts";
import { clashes } from "../style.ts";
import { isLegal, missingJacketOnly, rankLook, DELETED_SNEAKERS } from "./legal.ts";
import { allowedJackets, fwEligibleJackets, houseCode, jacketRequired, wearSlot, SUEDE_FAMILY } from "./jackets.ts";
import { DOMINANT, rep1Fails, violatesMustDiffer } from "./row.ts";

export type MatrixLook = {
  top: string;
  bottom: string;
  shoe: string;
  outer?: string;
  score: number;
  /** Set when a required jacket had no uncapped legal outer. */
  demoted?: "JKT-COV-1";
};

export type GateInfo = { occasion: string; season: string; text: string; ruleId: string };

export type HouseCell = {
  gate: GateInfo | null;
  looks: MatrixLook[];
  pool: MatrixLook[];
  gap: string | null;
};

export type Matrix = {
  occasion: string;
  season: string;
  houses: Record<string, HouseCell>;
  all: MatrixLook[];
};

const DELETED = new Set<string>(DELETED_SNEAKERS);
const CACHE = new Map<string, Matrix>();
const JACKET_USES = new Map<string, number>();
const SUEDE = new Set<string>(SUEDE_FAMILY);

function timesWorn(id?: string): number {
  if (!id) return 1000;
  return JACKET_USES.get(id) ?? 0;
}

type ProfileBits = {
  chip_id?: string;
  gap_note?: string;
  occasion_gate?: Record<string, { status?: string }>;
  season_gate?: Record<string, { status?: string }>;
  pairing_rules?: { type?: string; seasons?: string[]; occasions?: string[]; severity?: string }[];
  joe_fill?: { slot_whitelist?: Record<string, { id: string }[] | undefined> };
};

type Opt = { outer?: string; score: number; doms: string[]; demoted?: boolean };
type Core = { top: string; bottom: string; shoe: string; best: number; options: Opt[] };
type Pick = { core: Core; opt: Opt };

function garmentKey(garments: Garment[]): string {
  let h = 2166136261;
  for (const g of garments) {
    const s = `${g.id}|${g.category}|${g.subtype}|${g.material}|${(g.colors ?? []).join(",")}|${g.brand}|${g.warmth}|${g.archived ? 1 : 0}`;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return (h >>> 0).toString(16);
}

function coreOf(l: { top: string; bottom: string; shoe: string }): string {
  return `${l.top}|${l.bottom}|${l.shoe}`;
}

function domsOf(ids: string[]): string[] {
  return ids.filter((id) => DOMINANT.has(id));
}

function profileOf(house: House): ProfileBits {
  return APPROVED[house] as unknown as ProfileBits;
}

function chipOf(house: House): string {
  return profileOf(house).chip_id ?? house;
}

/** Winter/summer avoid that occasion's fall row. Weekend avoids Out for the same season. */
function siblingOf(occasion: string, season: string): { occasion: string; season: string } | null {
  if (season === "winter" || season === "summer") return { occasion, season: "fall" };
  if (occasion === "weekend") return { occasion: "out", season };
  return null;
}

function enumerateHouse(house: House, garments: Garment[], occasion: string, season: string): { cores: Core[]; singleShoe: boolean } {
  const profile = profileOf(house);
  const by = new Map(garments.map((g) => [g.id, g]));
  const take = (slot: string) =>
    (profile.joe_fill?.slot_whitelist?.[slot] ?? [])
      .map((row) => by.get(row.id))
      .filter((g): g is Garment => Boolean(g && !g.archived && !DELETED.has(g.id)));
  let tops = take("top").filter((g) => {
    const worn = wearSlot(g);
    return worn !== "outer" && worn !== "mid";
  });
  const allowed = new Set(allowedJackets(houseCode(house), season));
  let outers = garments.filter((g) => allowed.has(g.id) && !g.archived && !DELETED.has(g.id));
  const bottoms = take("bottom");
  const shoes = take("shoe");
  if (season === "summer") {
    tops = tops.filter((g) => (g.warmth ?? 0) <= 3);
    outers = outers.filter((g) => (g.warmth ?? 0) <= 2);
  }
  const plainFirst = (list: Garment[]) =>
    [...list].sort((a, b) => Number(DOMINANT.has(a.id)) - Number(DOMINANT.has(b.id)) || a.id.localeCompare(b.id));
  tops = plainFirst(tops);
  const orderedBottoms = plainFirst(bottoms);
  const orderedShoes = plainFirst(shoes);
  const needOuter = jacketRequired(occasion, season);
  const ctx = { house, occasion, season };
  const cores: Core[] = [];
  const perShoe = new Map<string, number>();
  const tryOpt = (pieces: Garment[], outer: Garment | undefined, into: Opt[]) => {
    if (into.some((opt) => opt.outer === outer?.id && !opt.demoted)) return;
    if (outer && pieces.some((g) => g.id === outer.id)) return;
    const all = outer ? [...pieces, outer] : pieces;
    if (clashes(all)) return;
    const score = rankLook(all, ctx);
    if (!Number.isFinite(score)) return;
    into.push({ outer: outer?.id, score, doms: domsOf(all.map((g) => g.id)) });
  };
  const consider = (top: Garment, bottom: Garment, shoe: Garment) => {
    if ((perShoe.get(shoe.id) ?? 0) >= 40) return;
    const base = [top, bottom, shoe];
    const options: Opt[] = [];
    if (!needOuter) tryOpt(base, undefined, options);
    for (const outer of outers) tryOpt(base, outer, options);
    if (!options.length) {
      if (needOuter && missingJacketOnly(base, ctx)) {
        cores.push({ top: top.id, bottom: bottom.id, shoe: shoe.id, best: -1e12, options: [] });
        perShoe.set(shoe.id, (perShoe.get(shoe.id) ?? 0) + 1);
      }
      return;
    }
    const best = Math.max(...options.map((opt) => opt.score));
    options.sort(
      (a, b) => timesWorn(a.outer) - timesWorn(b.outer) || b.score - a.score || (a.outer ?? "").localeCompare(b.outer ?? ""),
    );
    cores.push({ top: top.id, bottom: bottom.id, shoe: shoe.id, best, options });
    perShoe.set(shoe.id, (perShoe.get(shoe.id) ?? 0) + 1);
  };
  for (const shoe of orderedShoes) {
    const usedTop = new Map<string, number>();
    const usedBot = new Map<string, number>();
    for (let b = 0; b < orderedBottoms.length && (perShoe.get(shoe.id) ?? 0) < 40; b++) {
      const bottom = orderedBottoms[b]!;
      if ((usedBot.get(bottom.id) ?? 0) >= 2) continue;
      for (let t = 0; t < tops.length && (perShoe.get(shoe.id) ?? 0) < 40 && (usedBot.get(bottom.id) ?? 0) < 2; t++) {
        const top = tops[(t + b * 3) % tops.length]!;
        if (top.id === bottom.id || shoe.id === top.id || shoe.id === bottom.id) continue;
        if ((usedTop.get(top.id) ?? 0) >= 4) continue;
        const before = cores.length;
        consider(top, bottom, shoe);
        if (cores.length > before) {
          usedTop.set(top.id, (usedTop.get(top.id) ?? 0) + 1);
          usedBot.set(bottom.id, (usedBot.get(bottom.id) ?? 0) + 1);
        }
      }
    }
  }
  cores.sort((a, b) => b.best - a.best || coreOf(a).localeCompare(coreOf(b)));
  return { cores, singleShoe: shoes.length === 1 };
}

type State = {
  cores: Set<string>;
  tb: Set<string>;
  top: Map<string, number>;
  bottom: Map<string, number>;
  shoe: Map<string, number>;
  outer: Map<string, number>;
  dom: Map<string, number>;
  rows: Map<string, Pick[]>;
};

function emptyState(): State {
  return {
    cores: new Set(),
    tb: new Set(),
    top: new Map(),
    bottom: new Map(),
    shoe: new Map(),
    outer: new Map(),
    dom: new Map(),
    rows: new Map(),
  };
}

function bump(map: Map<string, number>, id: string, dir: 1 | -1) {
  const n = (map.get(id) ?? 0) + dir;
  if (n <= 0) map.delete(id);
  else map.set(id, n);
}

function commit(state: State, chip: string, picks: Pick[], dir: 1 | -1) {
  if (dir < 0) state.rows.delete(chip);
  else state.rows.set(chip, picks);
  const tops = new Set<string>();
  const bots = new Set<string>();
  const shoes = new Set<string>();
  for (const pick of picks) {
    const key = coreOf(pick.core);
    if (dir > 0) state.cores.add(key);
    else state.cores.delete(key);
    const tb = `${pick.core.top}|${pick.core.bottom}`;
    if (dir > 0) state.tb.add(tb);
    else state.tb.delete(tb);
    tops.add(pick.core.top);
    bots.add(pick.core.bottom);
    shoes.add(pick.core.shoe);
    for (const d of pick.opt.doms) bump(state.dom, d, dir);
    if (pick.opt.outer && !pick.opt.demoted) bump(state.outer, pick.opt.outer, dir);
  }
  for (const id of tops) bump(state.top, id, dir);
  for (const id of bots) bump(state.bottom, id, dir);
  for (const id of shoes) bump(state.shoe, id, dir);
}

function mustClash(state: State, chip: string, core: Core): boolean {
  const cand = { top: core.top, bottom: core.bottom, shoe: core.shoe };
  for (const [other, picks] of state.rows) {
    for (const prev of picks) {
      if (violatesMustDiffer(other, chip, prev.core, cand)) return true;
    }
  }
  return false;
}

const LOGGED = new Set<string>();

function rejectReason(cores: Core[], state: State, chip: string): string {
  const why = new Map<string, number>();
  const bumpWhy = (reason: string) => why.set(reason, (why.get(reason) ?? 0) + 1);
  for (const core of cores) {
    if (state.cores.has(coreOf(core))) {
      bumpWhy("core");
      continue;
    }
    if (state.tb.has(`${core.top}|${core.bottom}`)) {
      bumpWhy("tb");
      continue;
    }
    if (rep1Fails(core.top, (state.top.get(core.top) ?? 0) + 1, "top")) {
      bumpWhy("rep1-top");
      continue;
    }
    if (rep1Fails(core.bottom, (state.bottom.get(core.bottom) ?? 0) + 1, "bottom")) {
      bumpWhy("rep1-bottom");
      continue;
    }
    if (rep1Fails(core.shoe, (state.shoe.get(core.shoe) ?? 0) + 1, "shoe")) {
      bumpWhy("rep1-shoe");
      continue;
    }
    if (mustClash(state, chip, core)) {
      bumpWhy("differ");
      continue;
    }
    const usable = core.options.some((candidate) => candidate.doms.length <= 1 && !(candidate.doms.length && candidate.doms.some((d) => (state.dom.get(d) ?? 0) >= 2)));
    bumpWhy(usable ? "free" : "dom");
  }
  return [...why.entries()].map(([k, n]) => `${k}:${n}`).join(" ");
}

function outerLoad(state: State, id?: string): number {
  if (!id) return 1000;
  return timesWorn(id) + (state.outer.get(id) ?? 0);
}

function fillHouse(
  cores: Core[],
  state: State,
  chip: string,
  singleShoe: boolean,
  allowOuterRepeat: boolean,
  forbid: string | null,
  banFirst: Set<string>,
  required: boolean,
): Pick[] {
  const bag: Pick[] = [];
  const usedTop = new Set<string>();
  const usedBot = new Set<string>();
  const usedShoe = new Set<string>();
  const usedOuter = new Set<string>();
  let domIn = 0;
  const nonDom = cores.some((c) => c.options.some((o) => o.doms.length === 0));
  const blocked = (core: Core): boolean => {
    if (state.cores.has(coreOf(core)) || state.tb.has(`${core.top}|${core.bottom}`)) return true;
    if (usedTop.has(core.top) || usedBot.has(core.bottom)) return true;
    if (!singleShoe && usedShoe.has(core.shoe)) return true;
    if (rep1Fails(core.top, (state.top.get(core.top) ?? 0) + 1, "top")) return true;
    if (rep1Fails(core.bottom, (state.bottom.get(core.bottom) ?? 0) + 1, "bottom")) return true;
    if (rep1Fails(core.shoe, (state.shoe.get(core.shoe) ?? 0) + 1, "shoe")) return true;
    if (mustClash(state, chip, core)) return true;
    return false;
  };
  const take = (core: Core, opt: Opt) => {
    bag.push({ core, opt });
    usedTop.add(core.top);
    usedBot.add(core.bottom);
    usedShoe.add(core.shoe);
    if (opt.outer && !opt.demoted) usedOuter.add(opt.outer);
    if (opt.doms.length) domIn += 1;
  };
  for (const core of cores) {
    if (bag.length === 3) break;
    if (bag.length === 0 && banFirst.has(coreOf(core))) continue;
    if (blocked(core)) continue;
    const ranked = [...core.options].sort(
      (a, b) => outerLoad(state, a.outer) - outerLoad(state, b.outer) || b.score - a.score,
    );
    let opt: Opt | undefined;
    for (const candidate of ranked) {
      if (candidate.demoted || !candidate.outer) continue;
      if (!allowOuterRepeat && usedOuter.has(candidate.outer)) continue;
      if (candidate.doms.length > 1) continue;
      if (candidate.doms.length && domIn >= 1) continue;
      if (bag.length === 0 && candidate.doms.length && nonDom) continue;
      if (candidate.doms.some((d) => (state.dom.get(d) ?? 0) >= 2)) continue;
      opt = candidate;
      break;
    }
    if (!opt && !required) {
      const bare = ranked.find((candidate) => !candidate.outer && !candidate.demoted);
      if (
        bare &&
        !(bare.doms.length > 1) &&
        !(bare.doms.length && domIn >= 1) &&
        !(bag.length === 0 && bare.doms.length && nonDom) &&
        !bare.doms.some((d) => (state.dom.get(d) ?? 0) >= 2)
      ) {
        opt = bare;
      }
    }
    if (!opt) continue;
    take(core, opt);
  }
  if (bag.length < 3) {
    for (const core of cores) {
      if (bag.length === 3) break;
      if (bag.some((pick) => coreOf(pick.core) === coreOf(core))) continue;
      if (bag.length === 0 && banFirst.has(coreOf(core))) continue;
      if (blocked(core)) continue;
      if (required) {
        take(core, { outer: undefined, score: core.best, doms: [], demoted: true });
        continue;
      }
      const bare = core.options.find((candidate) => !candidate.outer && !candidate.demoted);
      if (bare) take(core, bare);
    }
  }
  if (bag.length === 3 && forbid && bag.map((p) => coreOf(p.core)).join("||") === forbid && banFirst.size < 6) {
    const next = new Set(banFirst);
    next.add(coreOf(bag[0]!.core));
    const alt = fillHouse(cores, state, chip, singleShoe, allowOuterRepeat, forbid, next, required);
    if (alt.length === 3 && alt.map((p) => coreOf(p.core)).join("||") !== forbid) return alt;
  }
  return bag;
}

function reserveShoes(open: { id: House; cores: Core[]; singleShoe: boolean }[]): Map<House, Set<string>> {
  const count = new Map<string, number>();
  const reserved = new Map<House, Set<string>>();
  const shoesOf = (cores: Core[]) => [...new Set(cores.map((c) => c.shoe))];
  const order = [...open].sort(
    (a, b) => shoesOf(a.cores).length - shoesOf(b.cores).length || a.cores.length - b.cores.length || a.id.localeCompare(b.id),
  );
  for (const house of order) {
    const need = house.singleShoe ? 1 : 3;
    const depth = new Map<string, number>();
    for (const core of house.cores) depth.set(core.shoe, (depth.get(core.shoe) ?? 0) + 1);
    const ranked = shoesOf(house.cores).sort(
      (a, b) => (count.get(a) ?? 0) - (count.get(b) ?? 0) || (depth.get(b) ?? 0) - (depth.get(a) ?? 0) || a.localeCompare(b),
    );
    const deep = ranked.filter((shoe) => (depth.get(shoe) ?? 0) >= 6);
    const take: string[] = [];
    for (const shoe of deep.length >= need ? deep : ranked) {
      if (rep1Fails(shoe, (count.get(shoe) ?? 0) + 1, "shoe")) continue;
      take.push(shoe);
      if (take.length === need) break;
    }
    for (const shoe of take) count.set(shoe, (count.get(shoe) ?? 0) + 1);
    reserved.set(house.id, new Set(take));
  }
  return reserved;
}

function assignTop3(
  open: { id: House; chip: string; cores: Core[]; singleShoe: boolean; forbid: string | null }[],
  required: boolean,
): Map<House, Pick[]> {
  const reserved = reserveShoes(open);
  const narrowed = open.map((house) => {
    const shoes = reserved.get(house.id) ?? new Set<string>();
    const cores = house.cores.filter((c) => shoes.has(c.shoe));
    return { ...house, cores: cores.length ? cores : house.cores };
  });
  const order = [...narrowed].sort((a, b) => a.cores.length - b.cores.length || a.id.localeCompare(b.id));
  const state = emptyState();
  const chosen = new Map<House, Pick[]>();
  let best = new Map<House, Pick[]>();
  const remember = () => {
    const n = [...chosen.values()].reduce((s, row) => s + row.length, 0);
    const b = [...best.values()].reduce((s, row) => s + row.length, 0);
    if (n > b) best = new Map([...chosen.entries()].map(([k, v]) => [k, v.slice()]));
  };
  let nodes = 0;
  const bt = (i: number): boolean => {
    if (i === order.length) return true;
    if (++nodes > 8000) return false;
    const house = order[i]!;
    const ban = new Set<string>();
    for (let alt = 0; alt < 8; alt++) {
      const outerIds = new Set(house.cores.flatMap((core) => core.options.map((opt) => opt.outer).filter((id): id is string => Boolean(id))));
      const picks = fillHouse(house.cores, state, house.chip, house.singleShoe, outerIds.size < 3, house.forbid, ban, required);
      if (picks.length < 3) {
        if (process.env.DEBUG_MATRIX && !LOGGED.has(house.id)) {
          LOGGED.add(house.id);
          const shoes = new Set(house.cores.map((c) => c.shoe));
          const openShoes = [...shoes].filter((id) => !rep1Fails(id, (state.shoe.get(id) ?? 0) + 1, "shoe"));
          console.error("short", house.id, "got", picks.length, "openShoes", openShoes.length, "/", shoes.size, rejectReason(house.cores, state, house.chip));
        }
        return false;
      }
      commit(state, house.chip, picks, 1);
      chosen.set(house.id, picks);
      remember();
      if (bt(i + 1)) return true;
      commit(state, house.chip, picks, -1);
      chosen.delete(house.id);
      ban.add(coreOf(picks[0]!.core));
    }
    return false;
  };
  if (!bt(0)) return best;
  return chosen;
}

function toLook(pick: Pick): MatrixLook {
  return {
    top: pick.core.top,
    bottom: pick.core.bottom,
    shoe: pick.core.shoe,
    outer: pick.opt.demoted ? undefined : pick.opt.outer,
    score: pick.opt.score,
    demoted: pick.opt.demoted ? "JKT-COV-1" : undefined,
  };
}

function isSuede(id?: string): boolean {
  return Boolean(id && SUEDE.has(id));
}

/** Swap a jacket that breaks ROT-1 or ROT-2. Demote when a required card has no uncapped jacket. */
function rebalance(
  open: { id: House; chip: string; cores: Core[]; singleShoe: boolean }[],
  assigned: Map<House, Pick[]>,
  season: string,
): Map<House, Pick[]> {
  const rows = new Map<House, Pick[]>();
  for (const house of open) {
    rows.set(
      house.id,
      (assigned.get(house.id) ?? []).map((pick) => ({ core: pick.core, opt: { ...pick.opt } })),
    );
  }
  const order = [...open].sort((a, b) => a.cores.length - b.cores.length || a.id.localeCompare(b.id));
  const fw = new Set(season === "fall" || season === "winter" ? fwEligibleJackets() : []);

  const houseSet = (id: string, ignoreHouse?: House, ignoreIndex?: number): Set<House> => {
    const found = new Set<House>();
    for (const [house, picks] of rows) {
      picks.forEach((pick, index) => {
        if (house === ignoreHouse && index === ignoreIndex) return;
        if (!pick.opt.demoted && pick.opt.outer === id) found.add(house);
      });
    }
    return found;
  };
  const suedeHouses = (ignoreHouse?: House, ignoreIndex?: number): Set<House> => {
    const found = new Set<House>();
    for (const [house, picks] of rows) {
      if (picks.some((pick, index) => !(house === ignoreHouse && index === ignoreIndex) && !pick.opt.demoted && isSuede(pick.opt.outer))) {
        found.add(house);
      }
    }
    return found;
  };
  const violates = (house: House, index: number, outer?: string): boolean => {
    if (!outer) return false;
    const row = rows.get(house) ?? [];
    for (let i = 0; i < row.length; i++) {
      if (i === index) continue;
      const other = row[i]!.opt;
      if (other.demoted || !other.outer) continue;
      if (other.outer === outer) return true;
      if (isSuede(outer) && isSuede(other.outer)) return true;
    }
    if (houseSet(outer, house, index).size >= 2) return true;
    if (isSuede(outer) && suedeHouses(house, index).size >= 3) return true;
    return false;
  };
  const appearances = (id: string): number => {
    let n = JACKET_USES.get(id) ?? 0;
    for (const picks of rows.values()) {
      for (const pick of picks) if (!pick.opt.demoted && pick.opt.outer === id) n += 1;
    }
    return n;
  };
  const choose = (core: Core, house: House, index: number): Opt | null => {
    const opts = core.options.filter((opt) => opt.outer && !opt.demoted && !violates(house, index, opt.outer));
    opts.sort((a, b) => timesWorn(a.outer) - timesWorn(b.outer) || b.score - a.score);
    return opts[0] ?? null;
  };

  for (const house of order) {
    const picks = rows.get(house.id) ?? [];
    for (let i = 0; i < picks.length; i++) {
      const pick = picks[i]!;
      if (pick.opt.demoted || !pick.opt.outer || !violates(house.id, i, pick.opt.outer)) continue;
      const alt = choose(pick.core, house.id, i);
      if (alt) {
        pick.opt = alt;
        continue;
      }
      const bare = pick.core.options.find((opt) => !opt.outer && !opt.demoted);
      if (bare) {
        pick.opt = bare;
        continue;
      }
      let replaced = false;
      for (const core of house.cores) {
        if (coreOf(core) === coreOf(pick.core)) continue;
        if (picks.some((other, index) => index !== i && (coreOf(other.core) === coreOf(core) || other.core.top === core.top || other.core.bottom === core.bottom || (!house.singleShoe && other.core.shoe === core.shoe)))) {
          continue;
        }
        let elsewhere = false;
        for (const [otherHouse, otherPicks] of rows) {
          if (otherHouse === house.id) continue;
          if (otherPicks.some((other) => coreOf(other.core) === coreOf(core) || `${other.core.top}|${other.core.bottom}` === `${core.top}|${core.bottom}`)) {
            elsewhere = true;
          }
        }
        if (elsewhere) continue;
        const altOpt = choose(core, house.id, i);
        if (!altOpt) continue;
        picks[i] = { core, opt: altOpt };
        replaced = true;
        break;
      }
      if (!replaced) pick.opt = { outer: undefined, score: pick.opt.score, doms: [], demoted: true };
    }
  }

  if (fw.size) {
    const missing = [...fw].filter((id) => appearances(id) === 0);
    for (const id of missing) {
      let placed = false;
      for (const house of order) {
        if (placed) break;
        if (!allowedJackets(houseCode(house.id), season).includes(id)) continue;
        const picks = rows.get(house.id) ?? [];
        for (let i = 0; i < picks.length; i++) {
          const opt = picks[i]!.core.options.find((candidate) => candidate.outer === id);
          if (!opt || violates(house.id, i, id)) continue;
          const current = picks[i]!.opt.demoted ? undefined : picks[i]!.opt.outer;
          if (current && fw.has(current) && appearances(current) <= 1) continue;
          picks[i] = { core: picks[i]!.core, opt };
          placed = true;
          break;
        }
      }
    }
  }
  return rows;
}

function leadsBrown(g: Garment | undefined): boolean {
  const raw = g?.colors?.[0];
  if (!raw) return false;
  return canonTokens(raw).some((token) => token === "brown" || token.endsWith(" brown"));
}

function enumerateAll(garments: Garment[], occasion: string, season: string, avoid: Set<string>): MatrixLook[] {
  const tops: Garment[] = [];
  const bots: Garment[] = [];
  const shoes: Garment[] = [];
  const outers: Garment[] = [];
  for (const g of garments) {
    if (DELETED.has(g.id) || g.archived) continue;
    if (g.category === "top" || g.category === "dress") tops.push(g);
    else if (g.category === "bottom") bots.push(g);
    else if (g.category === "footwear") shoes.push(g);
    else if (g.category === "outerwear") outers.push(g);
  }
  const brown: MatrixLook[] = [];
  const rest: MatrixLook[] = [];
  const seen = new Set<string>();
  const limit = Math.min(6000, Math.max(tops.length, 1) * Math.max(bots.length, 1));
  for (let i = 0; i < limit && (brown.length < 8 || rest.length < 8); i++) {
    const top = tops[i % Math.max(tops.length, 1)];
    const bottom = bots[(i * 3 + 1) % Math.max(bots.length, 1)];
    const shoe = shoes[(i * 5 + 2) % Math.max(shoes.length, 1)];
    const outer = i % 2 === 0 ? undefined : outers[i % Math.max(outers.length, 1)];
    if (!top || !bottom || !shoe) continue;
    if (new Set([top.id, bottom.id, shoe.id]).size < 3) continue;
    const key = coreOf({ top: top.id, bottom: bottom.id, shoe: shoe.id });
    if (seen.has(key) || avoid.has(key)) continue;
    const pieces = [top, bottom, shoe, ...(outer && ![top.id, bottom.id, shoe.id].includes(outer.id) ? [outer] : [])];
    if (!isLegal(pieces, { occasion, season })) continue;
    const score = rankLook(pieces, { occasion, season });
    if (!Number.isFinite(score)) continue;
    seen.add(key);
    const look: MatrixLook = { top: top.id, bottom: bottom.id, shoe: shoe.id, outer: pieces[3]?.id, score };
    if (leadsBrown(top) || leadsBrown(bottom) || leadsBrown(pieces[3])) brown.push(look);
    else rest.push(look);
  }
  const byScore = (a: MatrixLook, b: MatrixLook) => b.score - a.score || a.top.localeCompare(b.top);
  return [...rest.sort(byScore), ...brown.sort(byScore)];
}

export function buildHouseMatrix(garments: Garment[], occasion: Occasion | string, season: Season | string): Matrix {
  const key = `${occasion}|${season}|${garmentKey(garments)}`;
  const hit = CACHE.get(key);
  if (hit) return hit;
  const forbid = new Map<string, string>();
  const sibling = siblingOf(occasion, season);
  if (sibling) {
    const other = buildHouseMatrix(garments, sibling.occasion, sibling.season);
    for (const house of HOUSES) {
      const looks = other.houses[house]?.looks ?? [];
      if (looks.length >= 3) forbid.set(house, looks.map((l) => coreOf(l)).join("||"));
    }
  }
  const open: { id: House; chip: string; cores: Core[]; singleShoe: boolean; forbid: string | null; gap: string | null }[] = [];
  const cells: Record<string, HouseCell> = {};
  for (const house of HOUSES) {
    const profile = profileOf(house);
    const gate = gateOff(profile as never, { occasion, season });
    if (gate) {
      cells[house] = {
        gate: {
          occasion: primaryKey(profile.occasion_gate, "weekend"),
          season: primaryKey(profile.season_gate, "fall"),
          text: gate.text,
          ruleId: gate.ruleId,
        },
        looks: [],
        pool: [],
        gap: profile.gap_note ?? null,
      };
      continue;
    }
    const found = enumerateHouse(house, garments, occasion, season);
    if (process.env.DEBUG_MATRIX) {
      const shoes = new Set(found.cores.map((c) => c.shoe)).size;
      console.error(`${house} ${occasion}/${season} cores=${found.cores.length} shoes=${shoes}`);
    }
    open.push({
      id: house,
      chip: chipOf(house),
      cores: found.cores,
      singleShoe: found.singleShoe,
      forbid: forbid.get(house) ?? null,
      gap: profile.gap_note ?? null,
    });
  }
  const required = jacketRequired(occasion, season);
  const assigned = rebalance(open, assignTop3(open, required), season);
  const usedCores = new Set<string>();
  for (const house of open) {
    const picks = assigned.get(house.id) ?? [];
    const looks = picks.map(toLook);
    for (const look of looks) {
      if (look.outer && !look.demoted) JACKET_USES.set(look.outer, (JACKET_USES.get(look.outer) ?? 0) + 1);
    }
    for (const look of looks) usedCores.add(coreOf(look));
    cells[house.id] = {
      gate: null,
      looks,
      pool: house.cores.map((c) => ({
        top: c.top,
        bottom: c.bottom,
        shoe: c.shoe,
        outer: c.options[0]?.outer,
        score: c.best,
      })),
      gap: house.gap,
    };
  }
  const matrix: Matrix = {
    occasion,
    season,
    houses: cells,
    all: enumerateAll(garments, occasion, season, usedCores),
  };
  CACHE.set(key, matrix);
  if (CACHE.size > 12) {
    const first = CACHE.keys().next().value;
    if (first) CACHE.delete(first);
  }
  return matrix;
}

export function clearMatrixCache(): void {
  CACHE.clear();
  JACKET_USES.clear();
}

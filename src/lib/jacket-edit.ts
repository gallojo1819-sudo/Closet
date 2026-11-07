/**
 * Jacket On / Off and Try another. The core (top, bottom, shoe, mid) stays.
 * Strict jackets come first. A toggle or denim jacket over pleated trousers
 * is offered only when nothing stricter fits, and it is marked a last resort.
 * Off is allowed on a jacket day and carries a weather warning. Nothing here
 * writes the closet, IndexedDB, or the network.
 */
import { pieceLabel } from "./piece-label.ts";
import { slotOf } from "./style.ts";
import { ruleHits, type RuleCtx } from "./stylist/legal.ts";
import { countsAsOuter, jacketInfo } from "./stylist/jackets.ts";
import { pieceVetoIds, type TasteMemory } from "./taste.ts";
import type { Garment, Occasion, Season } from "./types.ts";
import { finiteF, jacketNeed, jacketTempOf, type JacketGateConditions } from "./jacket-weather.ts";

export type JacketAction = "off" | "on" | "next" | "set";

export type JacketContext = {
  occasion: Occasion | string;
  season: Season | string;
  /** A measured degree or a frozen high. A bucket degree must not be passed as measured. */
  weatherF?: number;
  measured?: boolean;
  highF?: number;
  wet?: boolean;
  windy?: boolean;
  lockedIds?: readonly string[];
  taste?: TasteMemory;
};

export type JacketTier = "strict" | "lastResort";

export type JacketChoice = {
  id: string;
  tier: JacketTier;
  formality: string[];
};

export type JacketEdit = {
  ids: string[];
  changed: boolean;
  off: boolean;
  jacketId: string | null;
  lastJacketId: string | null;
  weatherWarned: boolean;
  warning: string | null;
  note: string | null;
  outdoorsValid: boolean;
  tier: JacketTier | "off" | "unchanged";
  choices: JacketChoice[];
};

export const NOTE_UNLOCK = "Unlock the jacket to change it.";
export const NOTE_ONLY_TOP = "This layer is the only top, so it stays.";
export const NOTE_NO_JACKET = "No jacket on this look.";
export const NOTE_NONE = "No other jacket works with these pieces.";
export const NOTE_ONE = "One other jacket works with these pieces.";
export const NOTE_ONLY = "This is the only jacket that works with these pieces.";
export const NOTE_LAST = "Last resort. A toggle or denim jacket over pleated trousers is not a clean match.";
export const NOTE_WHICH = "More than one jacket is on this look. Pick which one.";
export const NOTE_HELD = "A jacket is already on this look.";

const FORM = new Set(["JKT-FORM-1", "JKT-FORM-2"]);

function conditionsOf(ctx: JacketContext): JacketGateConditions | undefined {
  const highF = finiteF(ctx.highF);
  const wet = typeof ctx.wet === "boolean" ? ctx.wet : undefined;
  const windy = typeof ctx.windy === "boolean" ? ctx.windy : undefined;
  if (highF === undefined && wet === undefined && windy === undefined) return undefined;
  return {
    ...(highF !== undefined ? { highF } : {}),
    ...(wet !== undefined ? { wet } : {}),
    ...(windy !== undefined ? { windy } : {}),
  };
}

function required(ctx: JacketContext): boolean {
  return jacketNeed(ctx.occasion, ctx.season, ctx.measured ? finiteF(ctx.weatherF) : undefined, conditionsOf(ctx));
}

/** Cold, rain, or wind, in Joe's words. Null when the day does not require a jacket. */
export function weatherJacketLine(ctx: JacketContext): string | null {
  if (!required(ctx)) return null;
  const temp = jacketTempOf({
    weatherF: ctx.weatherF,
    measured: ctx.measured === true,
    highF: ctx.highF,
  });
  const cold = ctx.season === "winter" || (temp !== undefined && temp < 55);
  const rainy = ctx.wet === true;
  const windy = ctx.windy === true;
  if (cold && rainy) return "Cold/rainy out — you'll want a jacket.";
  if (rainy && windy) return "Rainy and windy out — you'll want a jacket.";
  if (rainy) return "Rainy out — you'll want a jacket.";
  if (cold && windy) return "Cold and windy out — you'll want a jacket.";
  if (windy) return "Windy out — you'll want a jacket.";
  if (cold) return "Cold out — you'll want a jacket.";
  return "You'll want a jacket outside today.";
}

function pleated(g: Garment): boolean {
  return `${g.name} ${g.subtype ?? ""}`.toLowerCase().includes("pleat");
}

function toggleOrDenim(g: Garment): boolean {
  const text = `${g.name} ${g.subtype ?? ""} ${g.material ?? ""}`.toLowerCase();
  if (text.includes("toggle")) return true;
  return text.includes("denim") && (text.includes("jacket") || g.category === "outerwear");
}

function byId(closet: readonly Garment[]): Map<string, Garment> {
  return new Map(closet.map((g) => [g.id, g]));
}

function piecesOf(ids: readonly string[], map: Map<string, Garment>): Garment[] {
  const out: Garment[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const g = map.get(id);
    if (!g || g.archived || seen.has(id)) continue;
    seen.add(id);
    out.push(g);
  }
  return out;
}

export function countingOuters(pieces: readonly Garment[]): Garment[] {
  const out: Garment[] = [];
  const seen = new Set<string>();
  for (const g of pieces) {
    if (!countsAsOuter(g) || seen.has(g.id)) continue;
    seen.add(g.id);
    out.push(g);
  }
  return out;
}

function baseTops(pieces: readonly Garment[]): Garment[] {
  return pieces.filter((g) => {
    if (countsAsOuter(g)) return false;
    const slot = slotOf(g);
    return slot === "top" || slot === "dress";
  });
}

/** The one counting jacket, or null when there is none, two, or the layer is the only top. */
export function selectedOuter(pieces: readonly Garment[]): { jacket: Garment | null; blocked: "ambiguous" | "only-top" | null } {
  const outers = countingOuters(pieces);
  if (outers.length > 1) return { jacket: null, blocked: "ambiguous" };
  const jacket = outers[0] ?? null;
  if (!jacket) return { jacket: null, blocked: null };
  if (jacketInfo(jacket).outerEligible && baseTops(pieces).length === 0) {
    return { jacket: null, blocked: "only-top" };
  }
  return { jacket, blocked: null };
}

function ruleCtx(pieces: Garment[], closet: readonly Garment[], ctx: JacketContext): RuleCtx {
  const temp = jacketTempOf({
    weatherF: ctx.weatherF,
    measured: ctx.measured === true,
    highF: ctx.highF,
  });
  const conditions = conditionsOf(ctx);
  return {
    occasion: ctx.occasion,
    season: ctx.season,
    pool: [...closet],
    taste: ctx.taste,
    lockedIds: ctx.lockedIds,
    ...(temp !== undefined ? { weatherF: temp } : {}),
    ...(conditions ? { conditions } : {}),
  };
}

function ownedJackets(closet: readonly Garment[], ctx: JacketContext): Garment[] {
  const vetoed = ctx.taste ? pieceVetoIds(ctx.taste) : new Set<string>();
  return closet
    .filter((g) => !g.archived && countsAsOuter(g) && !vetoed.has(g.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Strict jackets first. Last-resort toggle or denim over pleats is included
 * only when the strict list is empty. Hard failures and other formality
 * misses are left out.
 */
export function jacketChoices(
  core: readonly Garment[],
  closet: readonly Garment[],
  ctx: JacketContext,
): JacketChoice[] {
  const bottom = core.find((g) => slotOf(g) === "bottom");
  const strict: JacketChoice[] = [];
  const last: JacketChoice[] = [];
  const ctxRule = ruleCtx([...core], closet, ctx);
  /* Hits the core already has are not a new jacket failure. A suede shoe on a wet day stays. */
  const coreSoft = new Set(ruleHits([...core], ctxRule).soft);
  for (const jacket of ownedJackets(closet, ctx)) {
    if (core.some((g) => g.id === jacket.id)) continue;
    const hits = ruleHits([...core, jacket], ctxRule);
    if (hits.hard.length) continue;
    const added = hits.soft.filter((id) => !coreSoft.has(id));
    const formality = added.filter((id) => FORM.has(id));
    if (added.length === 0) {
      strict.push({ id: jacket.id, tier: "strict", formality: [] });
      continue;
    }
    if (bottom && pleated(bottom) && toggleOrDenim(jacket) && formality.length > 0 && added.every((id) => FORM.has(id))) {
      last.push({ id: jacket.id, tier: "lastResort", formality });
    }
  }
  if (strict.length) return strict;
  return last;
}

/** Strict jackets in `jackets` first. A last-resort jacket stays out while any strict one fits. */
export function orderJackets(
  core: readonly Garment[],
  jackets: readonly Garment[],
  ctx: JacketContext,
  closet: readonly Garment[] = jackets,
): Garment[] {
  const choices = jacketChoices(core, closet, ctx);
  const strict = new Set(choices.filter((row) => row.tier === "strict").map((row) => row.id));
  const last = new Set(choices.filter((row) => row.tier === "lastResort").map((row) => row.id));
  const strictJ = jackets.filter((g) => strict.has(g.id));
  const other = jackets.filter((g) => !strict.has(g.id) && !last.has(g.id));
  const lastJ = strict.size ? [] : jackets.filter((g) => last.has(g.id));
  return [...strictJ, ...other, ...lastJ];
}

/** The caption for a toggle or denim jacket over pleated trousers. */
export function lastResortNote(pieces: readonly Garment[]): string | null {
  const jacket = selectedOuter(pieces).jacket;
  const bottom = pieces.find((g) => slotOf(g) === "bottom");
  if (!jacket || !bottom || !pleated(bottom) || !toggleOrDenim(jacket)) return null;
  return NOTE_LAST;
}

/**
 * What a legacy Swap, Remove, or Add should do with this piece.
 * A counting outer goes through the jacket resolver. Anything else stays a plain edit.
 */
/**
 * Keep the current core. A jacket that is still offered stays. Otherwise the first
 * strict jacket replaces it, or the jacket comes off when nothing legal fits.
 */
export function reconcileOpenLook(ids: readonly string[], closet: readonly Garment[], ctx: JacketContext): JacketEdit {
  const map = byId(closet);
  const pieces = piecesOf(ids, map);
  const selected = selectedOuter(pieces);
  if (selected.blocked || !selected.jacket) {
    return editJacket({ ids, closet, action: "off", ctx });
  }
  const core = pieces.filter((g) => g.id !== selected.jacket?.id);
  const choices = jacketChoices(core, closet, ctx);
  if (choices.some((row) => row.id === selected.jacket?.id)) {
    return editJacket({ ids, closet, action: "set", ctx, chooseId: selected.jacket.id });
  }
  return editJacket({
    ids: core.map((g) => g.id),
    closet,
    action: "on",
    ctx,
    lastJacketId: selected.jacket.id,
  });
}

export function legacyJacketAction(
  piece: Garment,
  pieces: readonly Garment[],
  kind: "remove" | "add" | "swap",
): "off" | "set" | "next" | "plain" | "blocked" {
  const selected = selectedOuter(pieces);
  if (selected.blocked === "ambiguous" && countsAsOuter(piece)) return "blocked";
  if (selected.blocked === "only-top" && piece.id === countingOuters(pieces)[0]?.id) return "plain";
  const jacketId = selected.jacket?.id ?? null;
  if (kind === "remove" || kind === "swap") {
    if (jacketId !== piece.id) return "plain";
    return kind === "remove" ? "off" : "next";
  }
  if (!countsAsOuter(piece)) return "plain";
  if (jacketId && jacketId !== piece.id) return "blocked";
  return "set";
}

function withJacket(coreIds: readonly string[], jacketId: string | null): string[] {
  const ids = coreIds.filter((id) => id !== jacketId);
  return jacketId ? [...ids, jacketId] : [...ids];
}

function finish(
  ids: string[],
  changed: boolean,
  off: boolean,
  jacketId: string | null,
  lastJacketId: string | null,
  note: string | null,
  ctx: JacketContext,
  choices: JacketChoice[],
  tier: JacketEdit["tier"],
): JacketEdit {
  const warning = off ? weatherJacketLine(ctx) : null;
  const weatherWarned = Boolean(warning);
  return {
    ids,
    changed,
    off,
    jacketId,
    lastJacketId,
    weatherWarned,
    warning,
    note,
    outdoorsValid: !weatherWarned && tier !== "lastResort",
    tier,
    choices,
  };
}

export function editJacket(input: {
  ids: readonly string[];
  closet: readonly Garment[];
  action: JacketAction;
  ctx: JacketContext;
  lastJacketId?: string | null;
  /** Used with action "set": a jacket from the offered list. */
  chooseId?: string;
}): JacketEdit {
  const map = byId(input.closet);
  const pieces = piecesOf(input.ids, map);
  const ids = pieces.map((g) => g.id);
  const { jacket, blocked } = selectedOuter(pieces);
  const locked = new Set(input.ctx.lockedIds ?? []);
  const last = input.lastJacketId ?? jacket?.id ?? null;
  const corePieces = jacket ? pieces.filter((g) => g.id !== jacket.id) : pieces;
  const coreIds = corePieces.map((g) => g.id);
  const choices = blocked ? [] : jacketChoices(corePieces, input.closet, input.ctx);
  const unchanged = (note: string | null, off = !jacket): JacketEdit =>
    finish(ids, false, off, jacket?.id ?? null, last, note, input.ctx, choices, "unchanged");

  if (blocked === "ambiguous") {
    const names = countingOuters(pieces)
      .map((g) => pieceLabel(g, input.closet))
      .join(", ");
    return unchanged(`${NOTE_WHICH} ${names}.`);
  }
  if (blocked === "only-top") return unchanged(NOTE_ONLY_TOP, false);
  if (jacket && locked.has(jacket.id)) return unchanged(NOTE_UNLOCK);

  const put = (jacketId: string | null, note: string | null, changed: boolean): JacketEdit => {
    const nextIds = withJacket(coreIds, jacketId);
    const choice = jacketId ? choices.find((row) => row.id === jacketId) : undefined;
    /* A restored jacket that is not in the offered list is the user's own, not a new recommendation. */
    const tier: JacketEdit["tier"] = jacketId ? (choice?.tier ?? "unchanged") : "off";
    const lastResort = tier === "lastResort";
    return finish(
      nextIds,
      changed,
      jacketId === null,
      jacketId,
      jacketId ?? last,
      lastResort ? note ?? NOTE_LAST : note,
      input.ctx,
      choices,
      tier,
    );
  };

  switch (input.action) {
    case "off": {
      if (!jacket) return unchanged(NOTE_NO_JACKET, true);
      return put(null, null, true);
    }
    case "on": {
      if (jacket) return unchanged(null, false);
      /* Restore the last jacket only when it is still on the offered list: strict, or last resort when nothing stricter fits. */
      const restore = last ? map.get(last) : undefined;
      const offered = restore && !restore.archived ? choices.find((row) => row.id === restore.id) : undefined;
      if (restore && offered) {
        return put(restore.id, offered.tier === "lastResort" ? NOTE_LAST : null, true);
      }
      const first = choices[0];
      if (!first) return unchanged(NOTE_NONE, true);
      return put(first.id, first.tier === "lastResort" ? NOTE_LAST : null, true);
    }
    case "next": {
      if (!choices.length) return unchanged(NOTE_NONE, !jacket);
      const at = jacket ? choices.findIndex((row) => row.id === jacket.id) : -1;
      if (choices.length === 1 && at === 0) return unchanged(NOTE_ONLY);
      const pick = choices[(at + 1) % choices.length]!;
      const note =
        choices.length === 1 ? NOTE_ONE : pick.tier === "lastResort" ? NOTE_LAST : null;
      return put(pick.id, note, pick.id !== jacket?.id);
    }
    case "set": {
      const pick = choices.find((row) => row.id === input.chooseId);
      if (!pick) return unchanged(NOTE_NONE);
      return put(pick.id, pick.tier === "lastResort" ? NOTE_LAST : null, pick.id !== jacket?.id);
    }
    default: {
      const neverAction: never = input.action;
      return neverAction;
    }
  }
}

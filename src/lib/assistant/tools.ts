/**
 * The twelve read tools: thin wrappers over the engine the pages already use (livePool,
 * pieceLabel, resolvePiecesFromText, composeAtlasLook, dressThisPiece, isLegal/explain,
 * checkVerdict/checkSwaps, lookOpinion, looksForHero/forceLooksForPiece, the season helpers,
 * todayLookPieces, unusedFromLooks, rackNotes, listActive/relevantNotes). Every list is at most
 * LIST_CAP items plus a `more` count; every piece carries its id and pieceLabel; a reason is
 * the plain line from REASON_BY_RULE, never a rule id; nothing fetches, nothing writes.
 */
/* lookbook.ts first: legal.ts and matrix.ts import each other and resolve only in this order. */
import { forceLooksForPiece, looksForHero, unusedFromLooks } from "../lookbook.ts";
import { z } from "zod";
import { dressThisPiece, resolvePiecesFromText, pieceSearchBlob } from "../dress.ts";
import { rackNotes } from "../gaps.ts";
import { lookOpinion } from "../look-opinion.ts";
import {
  checkSwaps,
  checkVerdict,
  FALLBACK_REASON,
  legalCtx,
  REASON_BY_RULE,
  type CheckCtx,
  type CheckState,
} from "../outfit-check.ts";
import { displayName, pieceLabel } from "../piece-label.ts";
import { livePool } from "../rack.ts";
import { rotationRank } from "../rotation.ts";
import {
  isSeason,
  lookFitsSeason,
  pieceFitsSeason,
  seasonFromWeather,
  type Season,
} from "../season.ts";
import { daysIdle, slotOf } from "../style.ts";
import { scrubHouseNames } from "../stylist-page.ts";
import { explain, isLegal } from "../stylist/legal.ts";
import { listActive } from "../stylist-notes/notes.ts";
import { relevantNotes } from "../stylist-notes/rank.ts";
import { composeAtlasLook } from "../taste.ts";
import { todayLookPieces } from "../today-look.ts";
import { mapOccasion, OCCASIONS, type Garment, type Look, type Occasion } from "../types.ts";
import { todayISO } from "../utils.ts";
import { defineRegistry, type AssistantCtx, type ToolDef } from "./registry.ts";

export const LIST_CAP = 10;
export const UNMEASURED = "unmeasured";

const OCCASION_IDS = OCCASIONS.map((o) => o.id) as [Occasion, ...Occasion[]];
const SEASON_IDS = ["spring", "summer", "fall", "winter"] as const;

const occasionArg = z.enum(OCCASION_IDS);
const seasonArg = z.enum(SEASON_IDS);
const idArg = z.string().regex(/^g_[a-z0-9]+$/, "a piece id looks like g_xxxxxxxxxxxx");
const idsArg = z.array(idArg).min(1).max(6);

export type PieceRef = { id: string; label: string };
export type Capped<T> = { items: T[]; more: number };

function pool(ctx: AssistantCtx): Garment[] {
  return livePool(ctx.pool);
}

function dateOf(ctx: AssistantCtx): string {
  return ctx.date ?? todayISO();
}

function ref(g: Garment, live: Garment[]): PieceRef {
  return { id: g.id, label: pieceLabel(g, live) };
}

function refs(pieces: Garment[], live: Garment[]): PieceRef[] {
  return pieces.map((g) => ref(g, live));
}

export function cap<T>(items: T[], n: number = LIST_CAP): Capped<T> {
  return { items: items.slice(0, n), more: Math.max(0, items.length - n) };
}

function byIds(ids: readonly string[], live: Garment[]): Garment[] {
  return ids.map((id) => live.find((g) => g.id === id)).filter((g): g is Garment => Boolean(g));
}

/** The season for a tool: the argument, else the page's, else the reading or the calendar. */
export function seasonFor(ctx: AssistantCtx, asked?: Season): Season {
  if (asked) return asked;
  const page = ctx.page.season;
  if (page && isSeason(page)) return page;
  const date = new Date(`${dateOf(ctx)}T12:00:00`);
  return seasonFromWeather(ctx.weatherF, Number.isFinite(date.getTime()) ? date : new Date());
}

function occasionFor(ctx: AssistantCtx, asked?: Occasion): Occasion {
  if (asked) return asked;
  return mapOccasion(ctx.page.occasion ?? "weekday");
}

function checkCtx(ctx: AssistantCtx, occasion: Occasion, season: Season): CheckCtx {
  return {
    occasion,
    season,
    ...(typeof ctx.weatherF === "number" && Number.isFinite(ctx.weatherF) ? { weatherF: ctx.weatherF } : {}),
  };
}

/** The plain line for a rule, never its id. */
export function plainReason(id: string): string {
  return REASON_BY_RULE[id] ?? FALLBACK_REASON;
}

type SlotCount = { tops: number; bottoms: number; shoes: number; jackets: number };

function slotCount(pieces: Garment[]): SlotCount {
  const count: SlotCount = { tops: 0, bottoms: 0, shoes: 0, jackets: 0 };
  for (const g of pieces) {
    const s = slotOf(g);
    if (s === "top" || s === "dress") count.tops += 1;
    else if (s === "bottom") count.bottoms += 1;
    else if (s === "footwear") count.shoes += 1;
    else if (s === "outerwear") count.jackets += 1;
  }
  return count;
}

/** One top, one bottom, one shoe, at most one jacket. */
export function oneOfEach(pieces: Garment[]): boolean {
  const c = slotCount(pieces);
  return c.tops === 1 && c.bottoms === 1 && c.shoes === 1 && c.jackets <= 1;
}

export type LookReport = {
  occasion: Occasion;
  season: Season;
  pieces: PieceRef[];
  /** isLegal for the occasion and season, as the Lookbook judges a card. */
  legal: boolean;
  /** The Check verdict: works, works_with_jacket (a bare core on a cold day), doesnt, cant_tell. */
  state: CheckState;
  /** Plain lines, main first. Empty when the look works. */
  reasons: string[];
  /** The owned jacket that finishes a works_with_jacket look. */
  jacket?: PieceRef;
};

function reportLook(ctx: AssistantCtx, pieces: Garment[], occasion: Occasion, season: Season): LookReport {
  const live = pool(ctx);
  const cc = checkCtx(ctx, occasion, season);
  const lc = legalCtx(cc);
  const legal = isLegal(pieces, lc) && lookFitsSeason(pieces, season);
  const verdict = pieces.length >= 3 && oneOfEach(pieces) ? checkVerdict(pieces, cc, live, ctx.taste) : null;
  const reasons: string[] = [];
  if (!legal) {
    if (!oneOfEach(pieces)) reasons.push(plainReason("SLOTS"));
    for (const hit of explain(pieces, lc).hits) {
      if (hit.severity !== "hard") continue;
      const line = plainReason(hit.id);
      if (!reasons.includes(line)) reasons.push(line);
    }
    if (!lookFitsSeason(pieces, season)) reasons.push("One piece is out of season.");
    if (!reasons.length) reasons.push(FALLBACK_REASON);
  }
  const jacket = verdict?.jacketId ? live.find((g) => g.id === verdict.jacketId) : undefined;
  return {
    occasion,
    season,
    pieces: refs(pieces, live),
    legal,
    state: verdict?.state ?? (legal ? "works" : "doesnt"),
    reasons: reasons.slice(0, 3),
    ...(jacket ? { jacket: ref(jacket, live) } : {}),
  };
}

/** True when the report can go out as a look: legal, in season, one piece per slot. */
function dressed(report: LookReport, pieces: Garment[]): boolean {
  return report.legal && oneOfEach(pieces);
}

/* ----------------------------- the tools ----------------------------- */

const pageContext: ToolDef<Record<string, never>> = {
  name: "closet_page_context",
  description: "Which page the user is on: route, chosen occasion, season and colour, the open piece and the looks on screen.",
  schema: z.object({}),
  risk: "read",
  run(ctx) {
    const live = pool(ctx);
    const page = ctx.page;
    const open = page.openGarmentId ? live.find((g) => g.id === page.openGarmentId) : undefined;
    return {
      route: page.route,
      occasion: page.occasion ?? null,
      season: page.season ?? null,
      color: page.color ?? null,
      openPiece: open ? ref(open, live) : null,
      onScreen: cap(refs(byIds(page.onScreenLookIds ?? [], live), live)),
      pieceCount: live.length,
    };
  },
};

const searchPieces: ToolDef<{ query: string }> = {
  name: "closet_search_pieces",
  description: "Find the user's own pieces by words in their name, kind, colour or material. Returns ids and labels.",
  schema: z.object({ query: z.string().min(1).max(120) }),
  risk: "read",
  run(ctx, { query }) {
    const live = pool(ctx);
    const found = resolvePiecesFromText(query, live);
    const seen = new Set(found.map((g) => g.id));
    const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    const wider = words.length
      ? live.filter((g) => !seen.has(g.id) && words.every((w) => pieceSearchBlob(g).includes(w)))
      : [];
    return { query, found: cap(refs([...found, ...wider], live)) };
  },
};

const getPiece: ToolDef<{ id: string }> = {
  name: "closet_get_piece",
  description: "One piece in full: label, kind, colours, material, fit, formality, warmth, seasons and when it was added.",
  schema: z.object({ id: idArg }),
  risk: "read",
  run(ctx, { id }) {
    const live = pool(ctx);
    const g = live.find((p) => p.id === id)!;
    return {
      id: g.id,
      label: pieceLabel(g, live),
      name: displayName(g),
      category: g.category,
      subtype: g.subtype,
      colors: g.colors,
      material: g.material,
      fit: g.fit ?? null,
      formality: g.formality,
      warmth: g.warmth,
      seasons: g.seasons,
      fitsSeasonNow: pieceFitsSeason(g, seasonFor(ctx)),
      addedOn: g.createdAt.slice(0, 10),
      idleDays: daysIdle(g, dateOf(ctx)),
    };
  },
};

const weatherNow: ToolDef<Record<string, never>> = {
  name: "closet_weather_now",
  description: "The measured temperature handed in with the page, or \"unmeasured\" when there is none, and the season it implies. Never fetches.",
  schema: z.object({}),
  risk: "read",
  run(ctx) {
    const measured = typeof ctx.weatherF === "number" && Number.isFinite(ctx.weatherF);
    return {
      reading: measured ? { f: ctx.weatherF } : UNMEASURED,
      measured,
      season: seasonFor(ctx),
      date: dateOf(ctx),
    };
  },
};

const todayLook: ToolDef<Record<string, never>> = {
  name: "closet_today_look",
  description: "The look on the Today page right now (the daily pick), with its pieces and whether it is legal.",
  schema: z.object({}),
  risk: "read",
  run(ctx) {
    const pieces = todayLookPieces(ctx.today, dateOf(ctx));
    const drop = ctx.today.drop && "occasion" in ctx.today.drop ? ctx.today.drop.occasion : undefined;
    const occasion = occasionFor(ctx, drop ?? undefined);
    return pieces.length ? reportLook(ctx, pieces, occasion, seasonFor(ctx)) : { occasion, season: seasonFor(ctx), pieces: [], legal: false, reasons: ["Nothing on Today yet."] };
  },
};

const buildLook: ToolDef<{ prompt: string; occasion?: Occasion; season?: Season; lockedIds?: string[] }> = {
  name: "closet_build_look",
  description: "Dress the user from their own pieces for an ask: one top, one bottom, one shoe, a jacket when the day wants one. Locked ids stay in.",
  schema: z.object({
    prompt: z.string().min(1).max(400),
    occasion: occasionArg.optional(),
    season: seasonArg.optional(),
    lockedIds: z.array(idArg).max(4).optional(),
  }),
  risk: "read",
  run(ctx, args) {
    const live = pool(ctx);
    const season = seasonFor(ctx, args.season);
    const locked = args.lockedIds ?? [];
    const atlas = composeAtlasLook({
      garments: live,
      prompt: args.prompt,
      taste: ctx.taste,
      ...(typeof ctx.weatherF === "number" ? { weatherF: ctx.weatherF } : {}),
      ...(args.occasion ? { occasion: args.occasion } : {}),
      ...(locked.length ? { lockedIds: locked } : {}),
    });
    const occasion = args.occasion ?? atlas.occasion;
    const first = byIds(atlas.garmentIds, live);
    let report = reportLook(ctx, first, occasion, season);
    if (dressed(report, first)) return report;
    /* One retry that steers the atlas off the pieces that fail the season (its own avoid list). */
    const avoid: Record<string, number> = {};
    for (const g of first) if (!pieceFitsSeason(g, season) && !locked.includes(g.id)) avoid[g.id] = 8;
    if (Object.keys(avoid).length) {
      const again = composeAtlasLook({
        garments: live,
        prompt: args.prompt,
        taste: ctx.taste,
        occasion,
        avoid,
        previousIds: first.map((g) => g.id),
        ...(typeof ctx.weatherF === "number" ? { weatherF: ctx.weatherF } : {}),
        ...(locked.length ? { lockedIds: locked } : {}),
      });
      const second = byIds(again.garmentIds, live);
      const next = reportLook(ctx, second, occasion, season);
      if (dressed(next, second)) return next;
      if (!locked.length) report = next;
    }
    if (!locked.length) return report;
    /* The atlas could not seat a locked piece legally: the Closet page's dresser, then the piece's own looks. */
    const fromDresser = dressThisPiece({
      lockedIds: locked,
      garments: live,
      occasion,
      taste: ctx.taste,
      ...(typeof ctx.weatherF === "number" ? { weather: { f: ctx.weatherF, label: "Fair", code: 2 } } : {}),
    });
    if (fromDresser) {
      const next = reportLook(ctx, fromDresser.pieces, fromDresser.occasion, season);
      if (dressed(next, fromDresser.pieces)) return next;
    }
    const hero = live.find((g) => g.id === locked[0]);
    for (const look of hero ? looksForHero(hero, live) : []) {
      if (mapOccasion(look.occasion) !== occasion) continue;
      const pieces = byIds(look.garmentIds, live);
      if (!locked.every((id) => look.garmentIds.includes(id))) continue;
      const next = reportLook(ctx, pieces, occasion, season);
      if (dressed(next, pieces)) return next;
    }
    return report;
  },
};

const checkLook: ToolDef<{ ids: string[]; occasion?: Occasion; season?: Season }> = {
  name: "closet_check_look",
  description: "Whether a set of the user's pieces works together for an occasion and season, with plain reasons when it does not.",
  schema: z.object({ ids: idsArg, occasion: occasionArg.optional(), season: seasonArg.optional() }),
  risk: "read",
  run(ctx, args) {
    const live = pool(ctx);
    const pieces = byIds(args.ids, live);
    const occasion = occasionFor(ctx, args.occasion);
    const season = seasonFor(ctx, args.season);
    const report = reportLook(ctx, pieces, occasion, season);
    const note = report.state === "works" || report.state === "works_with_jacket" ? checkVerdict(pieces, checkCtx(ctx, occasion, season), live, ctx.taste).reason : null;
    return { ...report, ...(note ? { note } : {}) };
  },
};

const suggestSwap: ToolDef<{ ids: string[]; occasion?: Occasion; season?: Season }> = {
  name: "closet_suggest_swap",
  description: "For a look that does not work, the one or two owned pieces that fix it, each with the look it makes.",
  schema: z.object({ ids: idsArg, occasion: occasionArg.optional(), season: seasonArg.optional() }),
  risk: "read",
  run(ctx, args) {
    const live = pool(ctx);
    const pieces = byIds(args.ids, live);
    const occasion = occasionFor(ctx, args.occasion);
    const season = seasonFor(ctx, args.season);
    const swaps = oneOfEach(pieces) ? checkSwaps(pieces, live, checkCtx(ctx, occasion, season), ctx.taste) : [];
    const items = swaps.map((s) => ({
      slot: s.slot,
      out: ref(live.find((g) => g.id === s.outId)!, live),
      in: ref(live.find((g) => g.id === s.inId)!, live),
      line: s.line,
      look: refs(byIds(s.ids, live), live),
    }));
    if (!items.length) {
      const opinion = lookOpinion(pieces, live, { occasion, season, taste: ctx.taste });
      for (const s of opinion?.swaps ?? []) {
        const cand = live.find((g) => g.id === s.id);
        const current = pieces.find((g) => slotOf(g) === s.slot || (s.slot === "top" && slotOf(g) === "dress"));
        if (!cand || !current) continue;
        items.push({
          slot: s.slot,
          out: ref(current, live),
          in: ref(cand, live),
          line: `Better: ${pieceLabel(cand, live)}, not the ${pieceLabel(current, live)}.`,
          look: refs(pieces.map((g) => (g.id === current.id ? cand : g)), live),
        });
      }
    }
    return { occasion, season, swaps: cap(items), ...(items.length ? {} : { note: "Nothing in the closet fixes this with one swap." }) };
  },
};

const looksForPiece: ToolDef<{ id: string; limit?: number; season?: Season }> = {
  name: "closet_looks_for_piece",
  description: "Up to three legal looks built around one owned piece, each with its occasion.",
  schema: z.object({ id: idArg, limit: z.number().int().min(1).max(LIST_CAP).optional(), season: seasonArg.optional() }),
  risk: "read",
  run(ctx, args) {
    const live = pool(ctx);
    const hero = live.find((g) => g.id === args.id)!;
    const season = seasonFor(ctx, args.season);
    const limit = args.limit ?? 3;
    const seen = new Set<string>();
    const out: LookReport[] = [];
    const consider = (looks: Look[]) => {
      for (const look of looks) {
        if (out.length >= limit) return;
        const key = [...look.garmentIds].sort().join("|");
        if (seen.has(key) || !look.garmentIds.includes(hero.id)) continue;
        const pieces = byIds(look.garmentIds, live);
        const occasion = mapOccasion(look.occasion);
        const report = reportLook(ctx, pieces, occasion, season);
        if (!report.legal || !oneOfEach(pieces)) continue;
        seen.add(key);
        out.push(report);
      }
    };
    consider(looksForHero(hero, live));
    if (out.length < limit) consider(forceLooksForPiece(hero.id, live, LIST_CAP));
    return { piece: ref(hero, live), looks: out, more: 0 };
  },
};

const notShownLately: ToolDef<{ limit?: number; season?: Season }> = {
  name: "closet_not_shown_lately",
  description: "In-season pieces no recent look has shown, least recently shown first: what the app has not put in front of the user lately.",
  schema: z.object({ limit: z.number().int().min(1).max(LIST_CAP).optional(), season: seasonArg.optional() }),
  risk: "read",
  run(ctx, args) {
    const live = pool(ctx);
    const season = seasonFor(ctx, args.season);
    const looks = ctx.looks ?? [...(ctx.today.thisWeek ?? [])];
    const date = dateOf(ctx);
    let unused = unusedFromLooks(live, looks).filter((g) => pieceFitsSeason(g, season));
    if (ctx.rotation) {
      const rank = rotationRank(ctx.rotation);
      unused = [...unused].sort((a, b) => rank(a.id) - rank(b.id) || daysIdle(b, date) - daysIdle(a, date));
    }
    const items = unused.map((g) => ({ ...ref(g, live), idleDays: daysIdle(g, date) }));
    return { season, notShown: cap(items, args.limit ?? LIST_CAP), note: "Not shown in a recent look; idleDays counts days since the piece last appeared." };
  },
};

const seasonGaps: ToolDef<{ season?: Season }> = {
  name: "closet_season_gaps",
  description: "What the closet is short of for the season: the rack notes, each with the owned pieces it would finish, and how many pieces fit the season per slot.",
  schema: z.object({ season: seasonArg.optional() }),
  risk: "read",
  run(ctx, args) {
    const live = pool(ctx);
    const season = seasonFor(ctx, args.season);
    const fits = live.filter((g) => pieceFitsSeason(g, season));
    const notes = rackNotes(live).map((n) => ({
      title: scrubHouseNames(n.title),
      body: scrubHouseNames(n.body),
      finishes: n.finishes.map(scrubHouseNames).slice(0, 3),
    }));
    return { season, inSeason: slotCount(fits), gaps: cap(notes) };
  },
};

const memoryRecall: ToolDef<{ query: string; limit?: number }> = {
  name: "closet_memory_recall",
  description: "What the user has told the stylist to remember (nevers and leans), the ones nearest the ask first.",
  schema: z.object({ query: z.string().min(1).max(400), limit: z.number().int().min(1).max(LIST_CAP).optional() }),
  risk: "read",
  async run(ctx, args) {
    const live = pool(ctx);
    const active = await listActive(ctx.notes);
    const ranked = relevantNotes(active, { prompt: args.query, garments: live }, args.limit ?? LIST_CAP);
    const items = ranked.map((n) => ({
      kind: n.kind,
      topic: scrubHouseNames(n.topic),
      text: scrubHouseNames(n.text),
      since: n.createdAt.slice(0, 10),
    }));
    return { notes: cap(items, args.limit ?? LIST_CAP), active: active.length };
  },
};

export const READ_TOOLS: readonly ToolDef<any, any>[] = [
  pageContext,
  searchPieces,
  getPiece,
  weatherNow,
  todayLook,
  buildLook,
  checkLook,
  suggestSwap,
  looksForPiece,
  notShownLately,
  seasonGaps,
  memoryRecall,
];

export const assistantRegistry = defineRegistry(READ_TOOLS);

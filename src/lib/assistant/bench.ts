/**
 * The scripted Closet bench: scenarios the Round 1 read tools can cover, each a recorded
 * tool-call script for the injected model, run through runAssistant on the owner's real
 * closet with a fixed reading and an in-memory notes account. The runner checks every
 * scenario the same way: every id is in the snapshot; a final look is legal for its occasion
 * and season and holds one top, one bottom, one shoe and at most one jacket; no house or
 * brand word, rule id or shop word; at most twelve steps and no repeated identical call
 * (except the repeat scenario); nothing written. Scenarios that need a write tool, a server
 * or a live model are listed as skipped with the reason. Pure: no network, no store.
 */
import { testCloset } from "../__fixtures__/snapshot.ts";
import { assistantRegistry } from "./tools.ts";
import type { AssistantCtx } from "./registry.ts";
import { runAssistant, type AssistantRun, type Model, type ModelMessage, type ModelReply, type StopReason } from "./loop.ts";
import { buildAssistantSystem } from "./system.ts";
import { HOUSE_WORDS, RULE_ID } from "../outfit-check.ts";
import { lookFitsSeason } from "../season.ts";
import { slotOf } from "../style.ts";
import { isLegal } from "../stylist/legal.ts";
import { addNote, memoryNotes, type MemoryNotes } from "../stylist-notes/notes.ts";
import { lookRowIds, NOT_IN_CLOSET } from "../stylist-page.ts";
import { emptyTaste } from "../taste.ts";
import { mapOccasion, type Garment, type Occasion } from "../types.ts";

export const BENCH_DATE = "2026-10-18";
export const BENCH_WEATHER_F = 58;
export const BENCH_SEASON = "fall" as const;

export const SHOP_WORDS = /\b(buy|buying|shop|shopping|purchase|price|prices|cart|checkout|link|links)\b|\$\d|https?:\/\//i;

/* The owner's pieces the scripts name, by id; benchEnv checks each is in the snapshot. */
export const IDS = {
  cords: "g_ayfv9c97ohmv",
  sweater: "g_mqjsmpqgwwvm",
  blazer: "g_5josnvyoi4z9",
  linen: "g_9t24uvtl10wd",
  flannel: "g_2b6fao81vqrs",
  loafers: "g_8nrtffa2s13s",
  shirt: "g_6lolc7ma0mk8",
  chinos: "g_xi3w7tz3aren",
  suedeLoafers: "g_8ukg5mi9r3fc",
} as const;

export type Turn = ModelReply | ((messages: ModelMessage[]) => ModelReply);

export type Scenario = {
  n: number;
  title: string;
  prompt: string;
  script: Turn[];
  /** The occasion a final look is judged for; else the last tool's, else weekday. */
  occasion?: Occasion;
  ctx?: (base: AssistantCtx) => AssistantCtx;
  stop?: StopReason;
  allowRepeat?: boolean;
  /** The answer is expected to be NOT_IN_CLOSET (an invented piece was named). */
  expectNotInCloset?: boolean;
  /** Extra checks: problems, empty when fine. */
  expect?: (run: AssistantRun, ctx: AssistantCtx) => string[];
};

export type Skipped = { n: number; title: string; reason: string };

export type ScenarioResult = { n: number; title: string; ok: boolean; problems: string[]; run: AssistantRun };

export type BenchEnv = { pool: Garment[]; notes: MemoryNotes; ctx: AssistantCtx; system: string };

export function scriptedModel(turns: Turn[]): Model {
  let i = 0;
  return (messages) => {
    const turn = turns[Math.min(i, turns.length - 1)]!;
    i += 1;
    return typeof turn === "function" ? turn(messages) : turn;
  };
}

/* ----------------------------- script helpers ----------------------------- */

type Ref = { id: string; label: string };
type LookData = { occasion?: string; pieces?: Ref[]; legal?: boolean; state?: string; reasons?: string[]; jacket?: Ref };

export function call(name: string, args: unknown = {}): Turn {
  return { toolCalls: [{ name, args }] };
}

export function say(text: string): Turn {
  return { text };
}

/** The data of the last tool observation, or null when it failed. */
export function lastData(messages: ModelMessage[]): any {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "tool") {
      const parsed = JSON.parse(m.content);
      return parsed.ok ? parsed.data : null;
    }
  }
  return null;
}

/** The look a tool result carries: build/check/today, the first of looks_for_piece, the first swap's look. */
export function lookFrom(data: any): LookData | null {
  if (!data) return null;
  if (Array.isArray(data.pieces) && data.pieces.length) return data as LookData;
  if (Array.isArray(data.looks) && data.looks[0]) return data.looks[0] as LookData;
  const swap = data.swaps?.items?.[0];
  if (swap?.look) return { occasion: data.occasion, pieces: swap.look, legal: true };
  return null;
}

const OCCASION_WORD: Record<string, string> = { weekday: "Weekday", out: "Out", weekend: "Weekend", comfy: "Comfy", travel: "Travel" };

function lookLine(occasion: string | undefined, pieces: Ref[]): string {
  const word = OCCASION_WORD[occasion ?? ""] ?? "Today";
  return `${word}: the ${pieces.map((p) => p.label).join(", the ")}.\nLOOK: ${pieces.map((p) => p.id).join(",")}`;
}

/** Answer with the last tool's look when it is legal (a cold-day core takes its jacket); else say the reason and ask. */
export function sayLook(): Turn {
  return (messages) => {
    const look = lookFrom(lastData(messages));
    if (!look?.pieces?.length) return { text: "I could not dress that from the closet today. Which occasion should I try?" };
    if (look.legal) return { text: lookLine(look.occasion, look.pieces) };
    if (look.state === "works_with_jacket" && look.jacket) return { text: lookLine(look.occasion, [...look.pieces, look.jacket]) };
    const reason = look.reasons?.[0] ?? "it does not work";
    return { text: `That look does not hold today: ${reason} Which occasion should I try?` };
  };
}

/* ----------------------------- the scenarios ----------------------------- */

const look = (ids: readonly string[], occasion: Occasion) => ({ ids: [...ids], occasion });

export const SCENARIOS: Scenario[] = [
  { n: 1, title: "Today's look", prompt: "What am I wearing today?", occasion: "weekday", script: [call("closet_today_look"), sayLook()] },
  { n: 2, title: "Office today", prompt: "What do I wear to the office today?", occasion: "weekday", script: [call("closet_build_look", { prompt: "office today", occasion: "weekday" }), sayLook()] },
  { n: 3, title: "Dinner out", prompt: "Dinner out tonight.", occasion: "out", script: [call("closet_build_look", { prompt: "dinner out tonight", occasion: "out" }), sayLook()] },
  { n: 4, title: "Weekend", prompt: "Something for Saturday.", occasion: "weekend", script: [call("closet_build_look", { prompt: "saturday", occasion: "weekend" }), sayLook()] },
  { n: 5, title: "Comfy at home", prompt: "Comfy day at home.", occasion: "comfy", script: [call("closet_build_look", { prompt: "comfy day at home", occasion: "comfy" }), sayLook()] },
  { n: 6, title: "Travel day", prompt: "I'm on a plane all day.", occasion: "travel", script: [call("closet_build_look", { prompt: "plane all day", occasion: "travel" }), sayLook()] },
  {
    n: 7,
    title: "Dress around a named piece",
    prompt: "Build me a weekday look around the brown corduroy trousers.",
    occasion: "weekday",
    script: [
      call("closet_search_pieces", { query: "brown corduroy trousers" }),
      (messages) => {
        const found = lastData(messages)?.found?.items?.[0];
        return found ? { toolCalls: [{ name: "closet_build_look", args: { prompt: "weekday", occasion: "weekday", lockedIds: [found.id] } }] } : { text: "Which piece do you mean?" };
      },
      sayLook(),
    ],
    expect: (run) => (run.garmentIds.includes(IDS.cords) ? [] : ["the look does not hold the corduroy trousers"]),
  },
  {
    n: 8,
    title: "Looks for a piece",
    prompt: "How can I wear the brown corduroy trousers?",
    script: [call("closet_looks_for_piece", { id: IDS.cords }), sayLook()],
    expect: (run) => (run.garmentIds.includes(IDS.cords) ? [] : ["the look does not hold the corduroy trousers"]),
  },
  {
    n: 9,
    title: "Check linen with flannel",
    prompt: "Can I wear the pink linen shirt under the blue plaid flannel shirt?",
    script: [
      call("closet_check_look", look([IDS.linen, IDS.flannel, IDS.cords, IDS.loafers], "weekend")),
      (messages) => {
        const d = lastData(messages);
        const reason = d?.reasons?.find((r: string) => /linen/i.test(r)) ?? d?.reasons?.[0] ?? "";
        return { text: `No: ${reason} Wear the blue plaid flannel shirt on its own with the brown corduroy trousers.` };
      },
    ],
    expect: (run) => (/linen with flannel/i.test(run.text) ? [] : [`the answer does not give the linen reason: ${run.text}`]),
  },
  {
    n: 10,
    title: "Check the cable knit under the blazer",
    prompt: "Cream cable-knit sweater under the navy blazer for work?",
    script: [
      call("closet_check_look", look([IDS.sweater, IDS.blazer, IDS.cords, IDS.loafers], "weekday")),
      (messages) => {
        const d = lastData(messages);
        return d && d.legal === false
          ? { text: "No: the cream cable-knit sweater is too heavy under the navy blazer. Swap the sweater for a shirt or wear the blazer over something thinner." }
          : { text: "That works." };
      },
    ],
    expect: (run) => {
      const trace = run.steps[0]?.result;
      const reasons = trace?.ok ? (trace.data as LookData).reasons ?? [] : [];
      return reasons.includes("A sport coat over a chunky knit.") ? [] : [`the tool did not give the sport-coat reason: ${reasons.join(" | ")}`];
    },
  },
  {
    n: 11,
    title: "Swap to fix a look",
    prompt: "Fix the cable knit and blazer look for me.",
    occasion: "weekday",
    script: [call("closet_suggest_swap", look([IDS.sweater, IDS.blazer, IDS.cords, IDS.loafers], "weekday")), sayLook()],
    expect: (run) => (run.garmentIds.length >= 3 ? [] : ["no swapped look came back"]),
  },
  {
    n: 12,
    title: "Check a look that works",
    prompt: "Dark grey button-down, tan chinos, brown suede loafers, navy blazer: good for work?",
    occasion: "weekday",
    script: [
      call("closet_check_look", look([IDS.shirt, IDS.chinos, IDS.suedeLoafers, IDS.blazer], "weekday")),
      (messages) => {
        const d = lastData(messages);
        return d?.legal ? { text: `Yes, that works.\n${lookLine("weekday", d.pieces)}` } : { text: "It does not work today. Which occasion is it for?" };
      },
    ],
    expect: (run) => (run.garmentIds.length === 4 ? [] : ["the answer did not carry the four pieces"]),
  },
  {
    n: 13,
    title: "Weather now",
    prompt: "How cold is it?",
    script: [
      call("closet_weather_now"),
      (messages) => {
        const d = lastData(messages);
        return d?.measured ? { text: `The reading is ${d.reading.f} degrees, so I am dressing for ${d.season}.` } : { text: "No reading today." };
      },
    ],
    expect: (run) => (/58 degrees/.test(run.text) ? [] : [`the reading was not relayed: ${run.text}`]),
  },
  {
    n: 14,
    title: "Weather unmeasured",
    prompt: "How cold is it?",
    ctx: (base) => ({ ...base, weatherF: undefined }),
    script: [
      call("closet_weather_now"),
      (messages) => {
        const d = lastData(messages);
        return d && !d.measured ? { text: `There is no reading today, so I am going by the calendar: ${d.season}.` } : { text: "I have a reading." };
      },
    ],
    expect: (run) => (/no reading today/.test(run.text) ? [] : [`unmeasured was not relayed: ${run.text}`]),
  },
  {
    n: 15,
    title: "Page context with an open piece",
    prompt: "What goes with this?",
    ctx: (base) => ({ ...base, page: { route: "closet", openGarmentId: IDS.cords, occasion: "weekend", onScreenLookIds: [] } }),
    occasion: "weekend",
    script: [
      call("closet_page_context"),
      (messages) => {
        const open = lastData(messages)?.openPiece;
        return open ? { toolCalls: [{ name: "closet_looks_for_piece", args: { id: open.id } }] } : { text: "Which piece do you mean?" };
      },
      (messages) => {
        const d = lastData(messages);
        const first = d?.looks?.find((l: LookData) => l.occasion === "weekend") ?? d?.looks?.[0];
        return first ? { text: `With the ${d.piece.label}: ${lookLine(first.occasion, first.pieces)}` } : { text: "Nothing holds that piece today. Which occasion?" };
      },
    ],
    expect: (run) => (run.garmentIds.includes(IDS.cords) ? [] : ["the open piece is not in the answer"]),
  },
  {
    n: 16,
    title: "One piece in full",
    prompt: "Tell me about the cream cable-knit sweater.",
    script: [
      call("closet_get_piece", { id: IDS.sweater }),
      (messages) => {
        const d = lastData(messages);
        return d ? { text: `The ${d.label}: ${d.material}, ${d.colors.join(" and ")}, warmth ${d.warmth} of 5, added ${d.addedOn}.` } : { text: "Which piece do you mean?" };
      },
    ],
    expect: (run) => (/cream cable-knit sweater/.test(run.text) ? [] : ["the piece was not named"]),
  },
  {
    n: 17,
    title: "Not shown lately",
    prompt: "What haven't you shown me lately?",
    script: [
      call("closet_not_shown_lately", { limit: 3 }),
      (messages) => {
        const items = lastData(messages)?.notShown?.items ?? [];
        return items.length ? { text: `Three pieces no look has shown lately: the ${items.map((p: Ref) => p.label).join(", the ")}.` } : { text: "Everything has been shown lately." };
      },
    ],
    expect: (run) => (/\bworn\b/i.test(run.text) ? ["the answer says worn"] : run.garmentIds.length === 3 ? [] : ["three pieces were not named"]),
  },
  {
    n: 18,
    title: "Season gaps",
    prompt: "What is the closet short of this fall?",
    script: [
      call("closet_season_gaps", { season: "fall" }),
      (messages) => {
        const d = lastData(messages);
        if (!d) return { text: "I could not read the rack." };
        const c = d.inSeason;
        const first = d.gaps.items[0];
        const finishes = first?.finishes?.length ? ` Wear what is sitting first: ${first.finishes.join(", ")}.` : "";
        return { text: `For ${d.season} you have ${c.tops} tops, ${c.bottoms} bottoms, ${c.shoes} shoes and ${c.jackets} jackets that fit.${finishes}` };
      },
    ],
    expect: (run) => (/tops/.test(run.text) ? [] : ["the counts were not relayed"]),
  },
  {
    n: 19,
    title: "Memory recall",
    prompt: "Did I tell you anything about sneakers?",
    script: [
      call("closet_memory_recall", { query: "sneakers" }),
      (messages) => {
        const note = lastData(messages)?.notes?.items?.[0];
        return note ? { text: `You told me: ${note.text}. I keep that as a ${note.kind === "never" ? "rule" : "lean"}.` } : { text: "Nothing yet about sneakers." };
      },
    ],
    expect: (run) => (/no sneakers when I go out/.test(run.text) ? [] : [`the note was not recalled: ${run.text}`]),
  },
  {
    n: 20,
    title: "A piece the closet does not hold",
    prompt: "What goes with my green tweed jacket?",
    expectNotInCloset: true,
    script: [
      call("closet_search_pieces", { query: "green tweed jacket" }),
      say("I do not see a green tweed jacket in your closet. Which piece do you mean?"),
    ],
  },
  {
    n: 21,
    title: "Recover from bad arguments",
    prompt: "Does the pink linen shirt work with the cords?",
    script: [
      call("closet_check_look", { ids: ["pink linen shirt", "cords"] }),
      call("closet_search_pieces", { query: "pink linen shirt, brown corduroy trousers" }),
      (messages) => {
        const items = lastData(messages)?.found?.items ?? [];
        return items.length >= 2
          ? { toolCalls: [{ name: "closet_check_look", args: { ids: items.slice(0, 2).map((p: Ref) => p.id), occasion: "weekend" } }] }
          : { text: "Which piece do you mean?" };
      },
      (messages) => {
        const d = lastData(messages);
        return d ? { text: d.legal ? "Yes, those two sit together." : "Not on their own: that is a top with trousers and no shoes. Tell me the shoes and I will check the whole look." } : { text: "Which piece do you mean?" };
      },
    ],
    expect: (run) => {
      const first = run.steps[0]?.result;
      return first && !first.ok && /ids/.test(first.error) ? [] : ["the bad arguments did not come back as a structured error"];
    },
  },
  {
    n: 28,
    title: "The same call twice stops the loop",
    prompt: "Keep reading the cords.",
    stop: "repeat",
    allowRepeat: true,
    script: [call("closet_get_piece", { id: IDS.cords }), call("closet_get_piece", { id: IDS.cords })],
  },
  {
    n: 29,
    title: "Twelve steps stop the loop",
    prompt: "Read every piece.",
    stop: "max_steps",
    script: testCloset.slice(0, 13).map((g) => call("closet_get_piece", { id: g.id })),
  },
];

export const SKIPPED: Skipped[] = [
  { n: 22, title: "Save this look", reason: "needs a write tool (looks); Round 2" },
  { n: 23, title: "Log a wear", reason: "needs a write tool (journal); Round 2" },
  { n: 24, title: "Skip today's look", reason: "needs a write tool (the drop and a skip count); Round 2" },
  { n: 25, title: "Remember a note", reason: "needs a write tool over stylist_notes; Round 2" },
  { n: 26, title: "Forget a note", reason: "needs a delete tool over stylist_notes; Round 2" },
  { n: 27, title: "Live weather", reason: "needs the weather server function; Round 3" },
  { n: 30, title: "Live model through the dock", reason: "needs the server function and the dock UI; Round 3" },
];

/* ----------------------------- the runner ----------------------------- */

export async function benchEnv(): Promise<BenchEnv> {
  const pool = testCloset;
  for (const id of Object.values(IDS)) {
    if (!pool.some((g) => g.id === id)) throw new Error(`${id} is not in the snapshot`);
  }
  const notes = memoryNotes();
  await addNote(notes, { text: "no sneakers when I go out", kind: "never", topic: "sneakers", source: "stated" }, Date.parse("2026-10-13T15:00:00Z"));
  const ctx: AssistantCtx = {
    pool,
    taste: emptyTaste(),
    page: { route: "today", onScreenLookIds: [] },
    weatherF: BENCH_WEATHER_F,
    notes,
    today: { drop: null, garments: pool, season: BENCH_SEASON },
    date: BENCH_DATE,
  };
  return { pool, notes, ctx, system: buildAssistantSystem({ pool, page: ctx.page }) };
}

function oneOfEach(pieces: Garment[]): boolean {
  const count = { top: 0, bottom: 0, shoe: 0, jacket: 0 };
  for (const g of pieces) {
    const s = slotOf(g);
    if (s === "top" || s === "dress") count.top += 1;
    else if (s === "bottom") count.bottom += 1;
    else if (s === "footwear") count.shoe += 1;
    else if (s === "outerwear") count.jacket += 1;
  }
  return count.top === 1 && count.bottom === 1 && count.shoe === 1 && count.jacket <= 1;
}

function occasionOf(scenario: Scenario, run: AssistantRun): Occasion {
  if (scenario.occasion) return scenario.occasion;
  for (let i = run.steps.length - 1; i >= 0; i--) {
    const r = run.steps[i]!.result;
    if (!r.ok) continue;
    const d = r.data as any;
    const occ = d?.occasion ?? d?.looks?.[0]?.occasion;
    if (occ) return mapOccasion(String(occ));
  }
  return "weekday";
}

/** The checks every scenario gets. Problems, empty when the run is clean. */
export function checkRun(scenario: Scenario, run: AssistantRun, ctx: AssistantCtx): string[] {
  const problems: string[] = [];
  const owned = new Set(ctx.pool.map((g) => g.id));
  for (const id of run.garmentIds) if (!owned.has(id)) problems.push(`answer names ${id}, not in the snapshot`);
  for (const step of run.steps) {
    if (step.result.ok) {
      const text = JSON.stringify(step.result.data);
      for (const id of text.match(/g_[a-z0-9]{10,}/g) ?? []) if (!owned.has(id)) problems.push(`${step.call.name} returned ${id}, not in the snapshot`);
      if (HOUSE_WORDS.test(text)) problems.push(`${step.call.name} result carries a house word`);
      if (RULE_ID.test(text)) problems.push(`${step.call.name} result carries a rule id`);
    }
  }
  /* A final look is what the answer puts on its LOOK row; pieces merely named in prose are not a look. */
  const lookIds = lookRowIds(run.text, ctx.pool);
  if (lookIds.length && !scenario.expectNotInCloset) {
    const pieces = lookIds.map((id) => ctx.pool.find((g) => g.id === id)!);
    const occasion = occasionOf(scenario, run);
    if (!oneOfEach(pieces)) problems.push("final look is not one top, one bottom, one shoe and at most one jacket");
    const lc = { occasion, season: BENCH_SEASON, ...(ctx.weatherF !== undefined ? { weatherF: ctx.weatherF } : {}) };
    if (!isLegal(pieces, lc)) problems.push(`final look is not legal for ${occasion}/${BENCH_SEASON}`);
    if (!lookFitsSeason(pieces, BENCH_SEASON)) problems.push("final look is out of season");
  }
  if (HOUSE_WORDS.test(run.text)) problems.push("answer carries a house word");
  if (RULE_ID.test(run.text)) problems.push("answer carries a rule id");
  if (SHOP_WORDS.test(run.text)) problems.push("answer carries a shop word");
  if (run.steps.length > 12) problems.push(`${run.steps.length} steps`);
  if (!scenario.allowRepeat) {
    for (let i = 1; i < run.steps.length; i++) {
      const a = run.steps[i - 1]!.call;
      const b = run.steps[i]!.call;
      if (a.name === b.name && JSON.stringify(a.args) === JSON.stringify(b.args)) problems.push(`repeated ${a.name}`);
    }
  }
  const stop = scenario.stop ?? "answer";
  if (run.stopReason !== stop) problems.push(`stopped with ${run.stopReason}, expected ${stop}`);
  if (scenario.expectNotInCloset ? run.text !== NOT_IN_CLOSET : run.text === NOT_IN_CLOSET) {
    problems.push(scenario.expectNotInCloset ? `expected NOT_IN_CLOSET, got: ${run.text}` : "answer was refused as NOT_IN_CLOSET");
  }
  if (scenario.expect) problems.push(...scenario.expect(run, ctx));
  return problems;
}

export async function runScenario(scenario: Scenario, env: BenchEnv): Promise<ScenarioResult> {
  const ctx = scenario.ctx ? scenario.ctx(env.ctx) : env.ctx;
  const poolBefore = JSON.stringify(ctx.pool);
  const notesBefore = JSON.stringify(env.notes.all());
  const run = await runAssistant({
    model: scriptedModel(scenario.script),
    registry: assistantRegistry,
    ctx,
    system: env.system,
    prompt: scenario.prompt,
  });
  const problems = checkRun(scenario, run, ctx);
  if (JSON.stringify(ctx.pool) !== poolBefore) problems.push("the closet changed");
  if (JSON.stringify(env.notes.all()) !== notesBefore) problems.push("the notes changed");
  return { n: scenario.n, title: scenario.title, ok: problems.length === 0, problems, run };
}

export type BenchReport = { results: ScenarioResult[]; passed: number; run: number; skipped: Skipped[]; snapshotPieces: number };

export async function runBench(): Promise<BenchReport> {
  const env = await benchEnv();
  const results: ScenarioResult[] = [];
  for (const scenario of SCENARIOS) results.push(await runScenario(scenario, env));
  return {
    results,
    passed: results.filter((r) => r.ok).length,
    run: results.length,
    skipped: SKIPPED,
    snapshotPieces: env.pool.length,
  };
}

export function summaryLine(report: BenchReport): string {
  return `closet-bench scripted: ${report.passed}/${report.run} passed, ${report.skipped.length} skipped, snapshot pieces: ${report.snapshotPieces}`;
}

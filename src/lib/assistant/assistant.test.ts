/**
 * The assistant core on the owner's real closet (engine-garments.json, never a drafted piece):
 * the registry's cap, names, structured errors and refusals; the read tools' verdicts on
 * known pairs; the loop's stops; the final-text gate; the system prompt's rule blocks; and
 * source pins that keep src/lib/assistant off the server, the network and the persisted closet.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LIVE_SNAPSHOT_COUNT, testCloset } from "../__fixtures__/snapshot.ts";
import { assistantRegistry, LIST_CAP, READ_TOOLS, UNMEASURED } from "./tools.ts";
import {
  defineRegistry,
  MAX_TOOLS,
  NEEDS_APPROVAL,
  NOT_OWNED,
  runTool,
  toModelTools,
  type AssistantCtx,
  type ToolDef,
} from "./registry.ts";
import { MAX_STEPS_TEXT, REPEAT_TEXT, runAssistant, type ModelMessage } from "./loop.ts";
import { buildAssistantSystem, OVERSIZED_KNITS, RULES_BOTTOM, RULES_TOP } from "./system.ts";
import { HOUSE_WORDS, RULE_ID } from "../outfit-check.ts";
import { isLegal } from "../stylist/legal.ts";
import { lookFitsSeason } from "../season.ts";
import { addNote, memoryNotes } from "../stylist-notes/notes.ts";
import { NOT_IN_CLOSET, scrubHouseNames } from "../stylist-page.ts";
import { emptyTaste } from "../taste.ts";
import type { Garment } from "../types.ts";

const POOL: Garment[] = testCloset;
const DATE = "2026-10-18";

/* The owner's pieces, by id. Each is asserted present before use. */
const CORDS = "g_ayfv9c97ohmv";
const SWEATER = "g_mqjsmpqgwwvm";
const BLAZER = "g_5josnvyoi4z9";
const LINEN = "g_9t24uvtl10wd";
const FLANNEL = "g_2b6fao81vqrs";
const LOAFERS = "g_8nrtffa2s13s";

function piece(id: string): Garment {
  const g = POOL.find((p) => p.id === id);
  if (!g) throw new Error(`${id} is not in the snapshot`);
  return g;
}

function ctxOf(over: Partial<AssistantCtx> = {}): AssistantCtx {
  return {
    pool: POOL,
    taste: emptyTaste(),
    page: { route: "today", onScreenLookIds: [] },
    weatherF: 58,
    notes: memoryNotes(),
    today: { drop: null, garments: POOL, season: "fall" },
    date: DATE,
    ...over,
  };
}

function stub(name: string, risk: ToolDef["risk"] = "read"): ToolDef<Record<string, never>> {
  return { name, description: name, schema: z.object({}), risk, run: () => ({ name }) };
}

async function run(name: string, args: unknown, ctx = ctxOf()) {
  return runTool(assistantRegistry, ctx, name, args);
}

function data(result: Awaited<ReturnType<typeof run>>): any {
  expect(result.ok).toBe(true);
  return result.ok ? result.data : null;
}

/* Built, not written: no file in this folder carries these strings. */
const BANNED_SOURCE = ["lib/" + "ai", "ai" + ".ts", ".server" + ".ts", "supa" + "base", "fe" + "tch(", "local" + "Storage", "closet" + ".v6", "closet" + "_meta", "sessionStor" + "age", "indexed" + "DB"];

describe("the snapshot", () => {
  it("is the owner's closet, counted from the fixture", () => {
    expect(POOL.length).toBe(LIVE_SNAPSHOT_COUNT);
    for (const id of [CORDS, SWEATER, BLAZER, LINEN, FLANNEL, LOAFERS]) expect(piece(id).id).toBe(id);
    expect(piece(SWEATER).name).toMatch(/cable-knit sweater/);
    expect(piece(BLAZER).name).toMatch(/blazer/);
    expect(piece(LINEN).material).toBe("linen");
    expect(piece(FLANNEL).material).toBe("flannel");
  });
});

describe("registry", () => {
  it("holds the twelve read tools, every name closet_-prefixed", () => {
    expect(assistantRegistry.list.length).toBe(12);
    expect(READ_TOOLS.every((t) => t.risk === "read")).toBe(true);
    expect(assistantRegistry.list.every((t) => t.name.startsWith("closet_"))).toBe(true);
    const model = toModelTools(assistantRegistry);
    expect(model.length).toBe(12);
    expect(model.find((t) => t.name === "closet_check_look")?.parameters).toMatchObject({ type: "object", required: ["ids"] });
  });

  it("rejects a 16th tool, a bad name and a duplicate", () => {
    const fifteen = [...READ_TOOLS, stub("closet_a"), stub("closet_b"), stub("closet_c")];
    expect(fifteen.length).toBe(MAX_TOOLS);
    expect(() => defineRegistry(fifteen)).not.toThrow();
    expect(() => defineRegistry([...fifteen, stub("closet_d")])).toThrow(/at most 15/);
    expect(() => defineRegistry([stub("search_pieces")])).toThrow(/closet_/);
    expect(() => defineRegistry([stub("closet_x"), stub("closet_x")])).toThrow(/Duplicate/);
  });

  it("returns a structured error for an unknown tool and for args that fail the schema", async () => {
    const unknown = await run("closet_nope", {});
    expect(unknown).toMatchObject({ ok: false });
    expect(unknown.ok ? "" : unknown.error).toMatch(/Unknown tool/);
    const bad = await run("closet_check_look", { ids: ["bad"] });
    expect(bad.ok).toBe(false);
    expect(bad.ok ? "" : bad.error).toMatch(/ids/);
    const missing = await run("closet_search_pieces", {});
    expect(missing.ok).toBe(false);
    expect(missing.ok ? "" : missing.error).toMatch(/query/);
  });

  it("refuses any id that is not in the closet", async () => {
    expect(await run("closet_get_piece", { id: "g_nope" })).toEqual({ ok: false, error: NOT_OWNED });
    expect(await run("closet_check_look", { ids: [CORDS, "g_nope"] })).toEqual({ ok: false, error: NOT_OWNED });
    expect(await run("closet_build_look", { prompt: "out", lockedIds: ["g_zzzz"] })).toEqual({ ok: false, error: NOT_OWNED });
  });

  it("refuses a tool whose risk is not read, without running it", async () => {
    let ran = 0;
    const write: ToolDef<{ text: string }> = {
      name: "closet_remember",
      description: "writes a note",
      schema: z.object({ text: z.string() }),
      risk: "write",
      run: () => {
        ran += 1;
        return {};
      },
    };
    const del: ToolDef<{ id: string }> = {
      name: "closet_forget",
      description: "deletes a note",
      schema: z.object({ id: z.string() }),
      risk: "delete",
      run: () => {
        ran += 1;
        return {};
      },
    };
    const registry = defineRegistry([...READ_TOOLS, write, del]);
    expect(await runTool(registry, ctxOf(), "closet_remember", { text: "x" })).toEqual({ ok: false, error: NEEDS_APPROVAL });
    expect(await runTool(registry, ctxOf(), "closet_forget", { id: "n_1" })).toEqual({ ok: false, error: NEEDS_APPROVAL });
    expect(ran).toBe(0);
  });
});

describe("read tools", () => {
  it("reports linen with flannel as not legal, with the plain reason", async () => {
    const d = data(await run("closet_check_look", { ids: [LINEN, FLANNEL, CORDS, LOAFERS], occasion: "weekend" }));
    expect(d.legal).toBe(false);
    expect(d.state).toBe("doesnt");
    expect(d.reasons).toContain("Linen with flannel.");
    for (const line of d.reasons) expect(line).not.toMatch(RULE_ID);
  });

  it("reports the cream cable-knit sweater under the navy blazer as not legal", async () => {
    const d = data(await run("closet_check_look", { ids: [SWEATER, BLAZER, CORDS, LOAFERS], occasion: "weekday" }));
    expect(d.legal).toBe(false);
    expect(d.reasons[0]).toBe("A sport coat over a chunky knit.");
    expect(JSON.stringify(d)).not.toMatch(RULE_ID);
    const swap = data(await run("closet_suggest_swap", { ids: [SWEATER, BLAZER, CORDS, LOAFERS], occasion: "weekday" }));
    expect(swap.swaps.items.length).toBeGreaterThan(0);
    for (const s of swap.swaps.items) {
      const pieces = s.look.map((p: { id: string }) => piece(p.id));
      expect(isLegal(pieces, { occasion: "weekday", season: "fall", weatherF: 58 })).toBe(true);
    }
  });

  it("gives up to three legal looks around the brown corduroy trousers, each holding them", async () => {
    const d = data(await run("closet_looks_for_piece", { id: CORDS }));
    expect(d.piece.id).toBe(CORDS);
    expect(d.looks.length).toBeGreaterThanOrEqual(1);
    expect(d.looks.length).toBeLessThanOrEqual(3);
    for (const look of d.looks) {
      const ids = look.pieces.map((p: { id: string }) => p.id);
      expect(ids).toContain(CORDS);
      const pieces = ids.map(piece);
      expect(isLegal(pieces, { occasion: look.occasion, season: "fall", weatherF: 58 })).toBe(true);
      expect(lookFitsSeason(pieces, "fall")).toBe(true);
      expect(look.legal).toBe(true);
      for (const p of look.pieces) expect(p.label).toBeTruthy();
    }
  });

  it("builds a legal weekday look with one top, one bottom, one shoe and at most one jacket", async () => {
    const d = data(await run("closet_build_look", { prompt: "what do I wear to the office", occasion: "weekday" }));
    expect(d.legal).toBe(true);
    const pieces = d.pieces.map((p: { id: string }) => piece(p.id));
    expect(pieces.length).toBeGreaterThanOrEqual(3);
    expect(pieces.length).toBeLessThanOrEqual(4);
    expect(isLegal(pieces, { occasion: "weekday", season: "fall", weatherF: 58 })).toBe(true);
  });

  it("caps every list at ten with a more count, and labels every piece", async () => {
    const d = data(await run("closet_not_shown_lately", {}));
    expect(d.notShown.items.length).toBeLessThanOrEqual(LIST_CAP);
    expect(d.notShown.items.length + d.notShown.more).toBeGreaterThan(LIST_CAP);
    for (const item of d.notShown.items) {
      expect(piece(item.id).id).toBe(item.id);
      expect(item.label).toBeTruthy();
    }
    expect(JSON.stringify(d)).not.toMatch(/\bworn\b/i);
    expect(JSON.stringify(d)).toMatch(/shown/i);
    const s = data(await run("closet_search_pieces", { query: "shirt" }));
    expect(s.found.items.length).toBeLessThanOrEqual(LIST_CAP);
  });

  it("reads the weather from the context and says unmeasured without one", async () => {
    expect(data(await run("closet_weather_now", {}))).toMatchObject({ measured: true, reading: { f: 58 }, season: "fall" });
    const none = data(await run("closet_weather_now", {}, ctxOf({ weatherF: undefined })));
    expect(none.reading).toBe(UNMEASURED);
    expect(none.measured).toBe(false);
    expect(none.season).toBe("fall");
  });

  it("reads Today's look and the page through the context", async () => {
    const today = data(await run("closet_today_look", {}));
    expect(today.pieces.length).toBeGreaterThanOrEqual(3);
    for (const p of today.pieces) expect(piece(p.id).id).toBe(p.id);
    const page = data(await run("closet_page_context", {}, ctxOf({ page: { route: "closet", openGarmentId: CORDS, occasion: "weekend", onScreenLookIds: [CORDS, LOAFERS] } })));
    expect(page.route).toBe("closet");
    expect(page.openPiece.id).toBe(CORDS);
    expect(page.onScreen.items.map((p: { id: string }) => p.id)).toEqual([CORDS, LOAFERS]);
    expect(page.pieceCount).toBe(LIVE_SNAPSHOT_COUNT);
    const gaps = data(await run("closet_season_gaps", {}));
    expect(gaps.gaps.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(gaps)).not.toMatch(HOUSE_WORDS);
  });

  it("recalls only what memoryNotes() holds", async () => {
    const notes = memoryNotes();
    await addNote(notes, { text: "no sneakers when I go out", kind: "never", topic: "sneakers", source: "stated" }, Date.parse("2026-10-13T15:00:00Z"));
    const d = data(await run("closet_memory_recall", { query: "sneakers for dinner" }, ctxOf({ notes })));
    expect(d.active).toBe(1);
    expect(d.notes.items).toEqual([{ kind: "never", topic: "sneakers", text: "no sneakers when I go out", since: "2026-10-13" }]);
    const empty = data(await run("closet_memory_recall", { query: "sneakers for dinner" }, ctxOf({ notes: memoryNotes() })));
    expect(empty.notes.items).toEqual([]);
    expect(notes.all().length).toBe(1);
    const source = readFileSync(new URL("./tools.ts", import.meta.url), "utf8");
    expect(source).toMatch(/listActive/);
    expect(source).not.toMatch(new RegExp("supa" + "baseNotes|notes\\.ser" + "ver"));
  });
});

describe("loop", () => {
  const system = buildAssistantSystem({ pool: POOL });
  const base = { registry: assistantRegistry, ctx: ctxOf(), system };

  it("stops with repeat when the same call with the same args comes twice in a row", async () => {
    const result = await runAssistant({
      ...base,
      prompt: "tell me about the cords",
      model: () => ({ toolCalls: [{ name: "closet_get_piece", args: { id: CORDS } }] }),
    });
    expect(result.stopReason).toBe("repeat");
    expect(result.text).toBe(REPEAT_TEXT);
    expect(result.steps.length).toBe(1);
    expect(result.garmentIds).toEqual([]);
  });

  it("stops at twelve steps with max_steps", async () => {
    const ids = POOL.slice(0, 20).map((g) => g.id);
    let n = 0;
    const result = await runAssistant({
      ...base,
      prompt: "read every piece",
      model: () => ({ toolCalls: [{ name: "closet_get_piece", args: { id: ids[n++ % ids.length] } }] }),
    });
    expect(result.stopReason).toBe("max_steps");
    expect(result.steps.length).toBe(12);
    expect(result.text).toBe(MAX_STEPS_TEXT);
  });

  it("answers from the tool result and names the look's ids", async () => {
    const result = await runAssistant({
      ...base,
      prompt: "what do I wear to work",
      model: (messages: ModelMessage[]) => {
        const last = messages.at(-1)!;
        if (last.role !== "tool") return { toolCalls: [{ name: "closet_build_look", args: { prompt: "work", occasion: "weekday" } }] };
        const d = JSON.parse(last.content).data;
        const labels = d.pieces.map((p: { label: string }) => `the ${p.label}`).join(", ");
        return { text: `Weekday: ${labels}.\nLOOK: ${d.pieces.map((p: { id: string }) => p.id).join(",")}` };
      },
    });
    expect(result.stopReason).toBe("answer");
    expect(result.text).not.toBe(NOT_IN_CLOSET);
    expect(result.garmentIds.length).toBeGreaterThanOrEqual(3);
    expect(isLegal(result.garmentIds.map(piece), { occasion: "weekday", season: "fall", weatherF: 58 })).toBe(true);
    expect(result.steps[0]?.result.ok).toBe(true);
  });

  it("scrubs a house word from the final text and refuses a piece not in the closet", async () => {
    /* A house word taken from the scrub list itself, so none is written here. */
    const word = HOUSE_WORDS.source.match(/\(([^)]+)\)/)![1]!.split("|").find((w) => scrubHouseNames(w) === "")!;
    expect(word).toBeTruthy();
    const scrubbed = await runAssistant({ ...base, prompt: "x", model: () => ({ text: `Wear the tan chinos with the brown suede loafers, ${word} style.` }) });
    expect(scrubbed.stopReason).toBe("answer");
    expect(scrubbed.text).not.toMatch(HOUSE_WORDS);
    expect(scrubbed.text).toMatch(/tan chinos/);
    const invented = await runAssistant({ ...base, prompt: "x", model: () => ({ text: "Wear the green tweed jacket with the tan chinos." }) });
    expect(invented.text).toBe(NOT_IN_CLOSET);
    expect(invented.garmentIds).toEqual([]);
    const shop = await runAssistant({ ...base, prompt: "x", model: () => ({ text: "Buy a navy blazer." }) });
    expect(shop.text).toBe(NOT_IN_CLOSET);
  });
});

describe("system prompt", () => {
  const prompt = buildAssistantSystem({ pool: POOL, page: { route: "lookbook", occasion: "out", onScreenLookIds: [] } });
  const topAt = prompt.indexOf(RULES_TOP);
  const bottomAt = prompt.lastIndexOf(RULES_BOTTOM);
  const top = prompt.slice(topAt, prompt.indexOf("\n\n", topAt));
  const bottom = prompt.slice(bottomAt);

  it("states the hard rules at the top and again at the bottom", () => {
    expect(topAt).toBe(0);
    expect(bottomAt).toBeGreaterThan(topAt);
    for (const block of [top, bottom]) {
      expect(block).toMatch(/one top, one bottom and one shoe/i);
      expect(block).toMatch(/linen and flannel never/i);
      expect(block).toMatch(/sport coat takes a shirt or a fine knit, never a chunky cable/i);
      expect(block).toMatch(/jeans are first-class/i);
      expect(block).toMatch(/hoodie is a top, never a coat/i);
      expect(block).toMatch(/camp collar is the only top/i);
      expect(block).toMatch(/weekday, out, weekend, comfy and travel/);
      expect(block).toMatch(/never shopping, links, prices, brands, house names, rule ids or scores/i);
      expect(block).toMatch(/never "anything goes"/i);
    }
    expect(top.split("\n").length).toBe(bottom.split("\n").length);
  });

  it("states the oversized-knit rule in both blocks: the six knits, only under an oversized jacket or coat, never a regular-fit one", () => {
    expect(OVERSIZED_KNITS.length).toBe(6);
    for (const block of [top, bottom]) {
      for (const knit of OVERSIZED_KNITS) expect(block).toContain(knit);
      expect(block).toMatch(/only under an oversized jacket or coat/);
      expect(block).toMatch(/never under a regular-fit/);
    }
  });

  it("carries examples from the owner's pieces and no house word, rule id or shop", () => {
    expect(prompt).toMatch(/EXAMPLES/);
    expect(prompt).toMatch(/LOOK: id,id,id/);
    expect(prompt).not.toMatch(HOUSE_WORDS);
    expect(prompt).not.toMatch(RULE_ID);
    expect(prompt).not.toMatch(/\b(buy|shop|purchase|price)\b/i);
    expect(prompt).toContain("route lookbook, occasion out");
    const examples = prompt.slice(prompt.indexOf("EXAMPLES"), bottomAt);
    expect(examples.match(/^User:/gm)?.length).toBe(3);
    for (const id of ["g_6lolc7ma0mk8", "g_xi3w7tz3aren", "g_8ukg5mi9r3fc", BLAZER, LINEN, FLANNEL, "g_jhyr10t2vo13", CORDS, "g_om0dh5nps1ke", "g_5gfabeezh485"]) {
      expect(examples).toContain(piece(id).name);
    }
    expect(isLegal(["g_6lolc7ma0mk8", "g_xi3w7tz3aren", "g_8ukg5mi9r3fc", BLAZER].map(piece), { occasion: "weekday", season: "fall", weatherF: 58 })).toBe(true);
    expect(isLegal(["g_jhyr10t2vo13", CORDS, "g_om0dh5nps1ke", "g_5gfabeezh485"].map(piece), { occasion: "out", season: "fall", weatherF: 58 })).toBe(true);
  });
});

describe("source pins", () => {
  it("imports no server, network or storage code anywhere in src/lib/assistant", () => {
    const dir = new URL("./", import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const file of files) {
      const source = readFileSync(new URL(file, dir), "utf8");
      for (const banned of BANNED_SOURCE) expect(source, `${file} carries ${banned}`).not.toContain(banned);
    }
  });
});

/**
 * The stylist's "This look" is Today's look. The Today page, the dock and answerTodayAsk read
 * one selector (today-look.ts): the drop when it is dated today, else today's worn entry, else
 * the first queued week look, sorted as the page lists it. A swap that says "today" or "this
 * look" edits Today's ids, not the last answer. The user's own question stays in the thread:
 * restoreIfAskWrote puts back looks and the drop only, and the thread markup renders the
 * question as a bubble before the answer.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { StylistThread, replyLines, sessionMessages } from "@/components/shell/stylist-thread";
import { persistGate, useCloset } from "./store.ts";
import { answerTodayAsk, asksAboutToday, swapBaseIds } from "./stylist-page.ts";
import { recordStylistQuestion, restoreIfAskWrote } from "./stylist-thread.ts";
import { todayLookIds, todayLookPieces } from "./today-look.ts";
import type { DailyDrop, Garment, Look, StylistMessage } from "./types.ts";
import { liveSnapshot } from "./__fixtures__/snapshot.ts";

const CLOSET: Garment[] = liveSnapshot;
const TODAY = "2026-10-14";
const YESTERDAY = "2026-10-13";
const by = (category: Garment["category"], n: number) => CLOSET.filter((g) => g.category === category)[n]!;
/* A look of four owned pieces, listed out of the page's order on purpose. */
const LOOK = [by("footwear", 0), by("top", 0), by("outerwear", 0), by("bottom", 0)];
const LOOK_IDS = LOOK.map((g) => g.id);
const OTHER = [by("top", 1), by("bottom", 1), by("footwear", 1)].map((g) => g.id);
const drop = (date: string, garmentIds: string[]): DailyDrop => ({ date, garmentIds, worn: false, verdict: "pending", occasion: "weekday" });
const week = (garmentIds: string[]): Look => ({ id: "week_0", name: "w", occasion: "weekday", garmentIds, source: "ai", lookbook: true, createdAt: `${TODAY}T00:00:00.000Z` });

/** What the Today page renders: the same call its `shown` memo makes. */
const pageShown = (state: Parameters<typeof todayLookPieces>[0]) => todayLookPieces(state, TODAY).map((g) => g.id);

let gateWas = false;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T10:00:00`));
  gateWas = persistGate.open;
  persistGate.open = false;
});
afterAll(() => {
  persistGate.open = gateWas;
  vi.useRealTimers();
});

describe("one selector for Today, the dock and the ask", () => {
  it("the drop dated today: the dock's ids are the page's ids, in the page's order", () => {
    const state = { drop: drop(TODAY, LOOK_IDS), journal: [], thisWeek: [], garments: CLOSET };
    const shown = pageShown(state);
    expect(new Set(shown)).toEqual(new Set(LOOK_IDS));
    expect(shown).not.toEqual(LOOK_IDS);
    expect(todayLookIds(state, TODAY)).toEqual(shown);
    const asked = answerTodayAsk({ ...state, today: TODAY });
    expect(asked.garmentIds).toEqual(shown);
    expect(asked.text).toMatch(/^Wear your /);
  });

  it("a drop dated yesterday is not today: the page shows today's worn entry, and so does the ask", () => {
    const state = {
      drop: drop(YESTERDAY, LOOK_IDS),
      journal: [{ date: TODAY, garmentIds: OTHER, verdict: "worn" }],
      thisWeek: [week(LOOK_IDS)],
      garments: CLOSET,
    };
    const shown = pageShown(state);
    expect(new Set(shown)).toEqual(new Set(OTHER));
    expect(answerTodayAsk({ ...state, today: TODAY }).garmentIds).toEqual(shown);
  });

  it("no drop and nothing worn: the week row fills the strip's empty days in order, today last", () => {
    /* One queued look lands on the earliest empty day, so today is empty on the page and the ask composes. */
    const one = { drop: null, journal: [], thisWeek: [week(OTHER)], garments: CLOSET };
    expect(pageShown(one)).toEqual([]);
    const composed = answerTodayAsk({ ...one, today: TODAY });
    expect(composed.garmentIds.length).toBeGreaterThanOrEqual(2);
    /* Seven queued looks reach today: the page's today cell and the ask are the same seventh look. */
    const seven = Array.from({ length: 7 }, (_, i) => ({ ...week(i === 6 ? OTHER : LOOK_IDS), id: `week_${i}` }));
    const full = { drop: null, journal: [], thisWeek: seven, garments: CLOSET };
    const shown = pageShown(full);
    expect(new Set(shown)).toEqual(new Set(OTHER));
    expect(answerTodayAsk({ ...full, today: TODAY }).garmentIds).toEqual(shown);
  });

  it("after the stylist answers \"what should I wear today?\" the ids are still Today's", () => {
    const state = { drop: drop(TODAY, LOOK_IDS), journal: [], thisWeek: [], garments: CLOSET };
    const before = pageShown(state);
    const answer = answerTodayAsk({ ...state, today: TODAY });
    expect(answer.garmentIds).toEqual(before);
    expect(pageShown(state)).toEqual(before);
  });
});

describe("a swap about today edits Today's look", () => {
  it("asksAboutToday reads today and this look", () => {
    expect(asksAboutToday("swap the shoes in this look")).toBe(true);
    expect(asksAboutToday("different jacket today")).toBe(true);
    expect(asksAboutToday("swap the shoes")).toBe(false);
  });

  it("todayIds lead when the ask says so; the session's last answer leads otherwise", () => {
    const todayIds = pageShown({ drop: drop(TODAY, LOOK_IDS), journal: [], thisWeek: [], garments: CLOSET });
    const page = { route: "today" as const, onScreenLookIds: [] as string[] };
    expect(swapBaseIds({ previousIds: OTHER, page, looks: [], drop: drop(TODAY, LOOK_IDS), todayIds, aboutToday: true, garments: CLOSET, today: TODAY })).toEqual(todayIds);
    expect(swapBaseIds({ previousIds: OTHER, page, looks: [], drop: drop(TODAY, LOOK_IDS), todayIds, aboutToday: false, garments: CLOSET, today: TODAY })).toEqual(OTHER);
    /* No answer this session and nothing on the page: Today's ids. */
    expect(swapBaseIds({ previousIds: undefined, page, looks: [], drop: drop(TODAY, LOOK_IDS), todayIds, garments: CLOSET, today: TODAY })).toEqual(todayIds);
  });
});

describe("the user's question stays in the thread", () => {
  it("restoreIfAskWrote puts back looks and the drop only; the store keeps the user message", () => {
    useCloset.setState({ garments: CLOSET, looks: [], messages: [], drop: drop(TODAY, LOOK_IDS), journal: [], thisWeek: [] });
    const before = useCloset.getState();
    const staged = recordStylistQuestion(before, "what should I wear today?");
    const snap = { looks: before.looks, drop: before.drop };
    useCloset.getState().pushMessage({ role: "user", text: "what should I wear today?" });
    useCloset.getState().pushMessage({ role: "stylist", text: "Wear your shirt with the trousers and the loafers.", garmentIds: LOOK_IDS });
    /* The ask wrote a look by mistake: the undo covers looks and the drop, nothing else. */
    useCloset.setState({ looks: [week(OTHER)], drop: drop(TODAY, OTHER) });
    const undo = restoreIfAskWrote(staged, snap, useCloset.getState(), false);
    expect(undo).not.toBeNull();
    expect(Object.keys(undo!).sort()).toEqual(["drop", "looks"]);
    useCloset.setState(undo!);
    const messages = useCloset.getState().messages;
    expect(messages.map((m) => m.role)).toEqual(["user", "stylist"]);
    expect(messages[0]!.text).toBe("what should I wear today?");
    expect(useCloset.getState().drop?.garmentIds).toEqual(LOOK_IDS);
    expect(useCloset.getState().looks).toEqual([]);
  });

  it("the thread markup renders the question as a bubble before the answer, in order", () => {
    const messages: StylistMessage[] = [
      { id: "m1", role: "user", text: "what should I wear today?", createdAt: `${TODAY}T10:00:01.000Z` },
      { id: "m2", role: "stylist", text: "Wear your shirt with the trousers and the loafers.", createdAt: `${TODAY}T10:00:02.000Z` },
      { id: "m3", role: "user", text: "swap the shoes in this look", createdAt: `${TODAY}T10:00:03.000Z` },
    ];
    const html = renderToStaticMarkup(createElement(StylistThread, { messages }));
    expect(html).toContain("data-stylist-thread");
    const users = html.match(/data-stylist-user/g) ?? [];
    expect(users.length).toBe(2);
    expect(html.indexOf("what should I wear today?")).toBeLessThan(html.indexOf("Wear your shirt"));
    expect(html.indexOf("Wear your shirt")).toBeLessThan(html.indexOf("swap the shoes in this look"));
    expect(renderToStaticMarkup(createElement(StylistThread, { messages: [] }))).toBe("");
    expect(replyLines("weekday\nWear your shirt with the trousers.")).toEqual(["Wear your shirt with the trousers."]);
  });

  it("only this session's messages are the thread; an earlier session's answer is not this look", () => {
    const old: StylistMessage = { id: "o", role: "stylist", text: "Wear your old look.", garmentIds: OTHER, createdAt: `${YESTERDAY}T18:00:00.000Z` };
    const now: StylistMessage = { id: "n", role: "user", text: "hello", createdAt: `${TODAY}T10:00:05.000Z` };
    expect(sessionMessages([old, now], `${TODAY}T10:00:00.000Z`)).toEqual([now]);
    expect(sessionMessages([old], `${TODAY}T10:00:00.000Z`)).toEqual([]);
  });
});

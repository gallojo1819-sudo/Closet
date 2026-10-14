/**
 * The stylist dock on the live path, seen on Oct 14 2026 (f51a011, signed in): "This look"
 * showed an older look until a message was sent, the user's own messages did not render, and
 * no reply came within six seconds.
 *
 * (1) "This look" is Today's look the instant the panel opens: the dock's ids equal the Today
 *     page's ids from the same store state, on any page, with stale persisted stylist messages
 *     present (one of them timestamped in the future, as another device's clock can be), before
 *     the daily-pick effect has written the drop (the selector computes the same pick the
 *     effect writes: the ids of todayLookPieces equal rerollDrop's daily ids on the snapshot).
 * (2) The user's own question renders: the thread is this session's messages by id, echoed by
 *     the dock, so it is drawn even when the store's list is replaced under it.
 * (3) A request that hangs or throws yields a rendered reply within the deadline: the closet
 *     composes one (localStylistReply) when askWithDeadline gives up.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { StylistThread } from "@/components/shell/stylist-thread";
import { persistGate, useCloset } from "./store.ts";
import { answerTodayAsk } from "./stylist-page.ts";
import {
  ASK_DEADLINE_MS,
  askWithDeadline,
  LOCAL_REPLY_NOTE,
  localStylistReply,
  sessionThread,
  thisLookMessage,
} from "./stylist-session.ts";
import { emptyTaste } from "./taste.ts";
import { dailyPickIds, todayLookPieces } from "./today-look.ts";
import type { DailyDrop, Garment, StylistMessage } from "./types.ts";
import { liveSnapshot } from "./__fixtures__/snapshot.ts";

const CLOSET: Garment[] = liveSnapshot;
const TODAY = "2026-10-14";
const YESTERDAY = "2026-10-13";
const by = (category: Garment["category"], n: number) => CLOSET.filter((g) => g.category === category)[n]!;
const OLD_LOOK = [by("top", 3), by("bottom", 3), by("footwear", 2)].map((g) => g.id);
const drop = (date: string, garmentIds: string[]): DailyDrop => ({ date, garmentIds, worn: false, verdict: "pending", occasion: "weekday" });

/** Messages an earlier session left in closet.v6: yesterday's, and one stamped in the future. */
const STALE: StylistMessage[] = [
  { id: "m_old_q", role: "user", text: "what should I wear?", createdAt: `${YESTERDAY}T18:00:00.000Z` },
  { id: "m_old_a", role: "stylist", text: "Wear your old look.", garmentIds: OLD_LOOK, draftName: "old", draftOccasion: "weekday", createdAt: `${YESTERDAY}T18:00:01.000Z` },
  { id: "m_future", role: "stylist", text: "Wear your future look.", garmentIds: OLD_LOOK, draftName: "future", draftOccasion: "weekday", createdAt: `2026-10-15T09:00:00.000Z` },
];

let gateWas = false;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date(`${TODAY}T10:00:00`));
  gateWas = persistGate.open;
  persistGate.open = false;
  useCloset.setState({
    garments: CLOSET,
    looks: [],
    journal: [],
    avoid: {},
    taste: emptyTaste(),
    messages: STALE,
    drop: drop(YESTERDAY, OLD_LOOK),
    thisWeek: [],
    skipCount: 0,
    reshuffleCount: 0,
    hydrated: true,
  });
});
afterAll(() => {
  persistGate.open = gateWas;
  vi.useRealTimers();
});

/** What the dock reads on open (stylist-dock.tsx): the store's drop, journal, week row, closet, avoid, taste. */
function dockToday(): string[] {
  const s = useCloset.getState();
  return todayLookPieces({ drop: s.drop, journal: s.journal, thisWeek: s.thisWeek, garments: s.garments, avoid: s.avoid, taste: s.taste, season: "fall" }, TODAY).map((g) => g.id);
}

/** What the Today page's `shown` memo reads: the same selector from the same store state. */
function pageToday(): string[] {
  const s = useCloset.getState();
  return todayLookPieces({ drop: s.drop, journal: s.journal, thisWeek: s.thisWeek, garments: s.garments, avoid: s.avoid, taste: s.taste, season: "fall" }, TODAY).map((g) => g.id);
}

describe("(1) This look is Today's look on open", () => {
  it("with yesterday's drop and stale stylist messages (one future-dated), no message counts as this session's answer", () => {
    const thread = sessionThread(useCloset.getState().messages, new Set());
    expect(thread).toEqual([]);
    expect(thisLookMessage(thread, TODAY)).toBeNull();
    /* Even an id the dock would track is not "this look" unless it was pushed today. */
    expect(thisLookMessage(sessionThread(STALE, new Set(["m_old_a", "m_future"])), TODAY)).toBeNull();
  });

  it("before the daily pick lands, the dock's ids are the page's ids, and both are the pick the effect would write", () => {
    const dock = dockToday();
    expect(dock.length).toBeGreaterThanOrEqual(3);
    expect(dock).toEqual(pageToday());
    expect(dock).not.toEqual(OLD_LOOK);
    /* The effect's write: rerollDrop with the daily bucket, in memory. */
    const wrote = useCloset.getState().rerollDrop(undefined, "weekday", undefined, undefined, { season: "fall" });
    expect(wrote).toBe(true);
    const landed = useCloset.getState().drop!;
    expect(landed.date).toBe(TODAY);
    expect(landed.setAt).toBeUndefined();
    expect(new Set(landed.garmentIds)).toEqual(new Set(dock));
    /* After it lands, the same selector reads the drop: nothing moved. */
    expect(dockToday()).toEqual(dock);
    expect(pageToday()).toEqual(dock);
    const s = useCloset.getState();
    expect(new Set(dailyPickIds({ drop: drop(YESTERDAY, OLD_LOOK), journal: [], garments: CLOSET, avoid: s.avoid, taste: s.taste, season: "fall" }, TODAY))).toEqual(new Set(dock));
    /* The today ask answers with the same pieces. */
    expect(answerTodayAsk({ drop: s.drop, journal: s.journal, thisWeek: s.thisWeek, garments: s.garments, avoid: s.avoid, taste: s.taste, season: "fall", today: TODAY }).garmentIds).toEqual(dock);
  });

  it("a stylist answer pushed today in this session is this look; one pushed yesterday is not", () => {
    const ids = new Set<string>();
    const id = useCloset.getState().pushMessage({ role: "stylist", text: "Wear your new look.", garmentIds: OLD_LOOK });
    ids.add(id);
    const thread = sessionThread(useCloset.getState().messages, ids);
    expect(thread.map((m) => m.id)).toEqual([id]);
    expect(thisLookMessage(thread, TODAY)?.id).toBe(id);
    expect(thisLookMessage(thread, "2026-10-15")).toBeNull();
  });
});

describe("(2) the user's own message renders", () => {
  it("the bubble is in the markup from the store's copy, and still when the store's list is replaced", () => {
    const ids = new Set<string>();
    const echo: StylistMessage[] = [];
    const push = (m: Omit<StylistMessage, "id" | "createdAt">) => {
      const id = useCloset.getState().pushMessage(m);
      ids.add(id);
      echo.push(useCloset.getState().messages.find((x) => x.id === id)!);
      return id;
    };
    push({ role: "user", text: "swap the shoes in this look" });
    let html = renderToStaticMarkup(createElement(StylistThread, { messages: sessionThread(useCloset.getState().messages, ids, echo) }));
    expect(html).toContain("data-stylist-user");
    expect(html).toContain("swap the shoes in this look");
    expect(html).not.toContain("Wear your old look.");
    /* A rehydrate or merge puts an older list back: the dock's echo keeps the question on screen. */
    useCloset.setState({ messages: STALE });
    html = renderToStaticMarkup(createElement(StylistThread, { messages: sessionThread(useCloset.getState().messages, ids, echo) }));
    expect(html).toContain("swap the shoes in this look");
    expect((html.match(/data-stylist-user/g) ?? []).length).toBe(1);
  });
});

describe("(3) a hanging or failing request still answers, within the deadline", () => {
  it("askWithDeadline gives up at the deadline, or on a throw, and the closet composes a reply", async () => {
    const hang = askWithDeadline(new Promise<never>(() => {}), ASK_DEADLINE_MS);
    await vi.advanceTimersByTimeAsync(ASK_DEADLINE_MS - 1);
    let settled = false;
    void hang.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await hang).toBeNull();
    expect(await askWithDeadline(Promise.reject(new Error("network")), ASK_DEADLINE_MS)).toBeNull();
    expect(await askWithDeadline(Promise.resolve({ ok: true }), ASK_DEADLINE_MS)).toEqual({ ok: true });
    expect(ASK_DEADLINE_MS).toBeLessThanOrEqual(8000);
    const local = localStylistReply({ prompt: "something for the office", garments: CLOSET, occasion: "weekday", taste: emptyTaste() });
    expect(local).not.toBeNull();
    expect(local!.garmentIds.length).toBeGreaterThanOrEqual(3);
    expect(local!.text).toMatch(/^Wear your /);
    expect(local!.text.endsWith(LOCAL_REPLY_NOTE)).toBe(true);
    for (const id of local!.garmentIds) expect(CLOSET.some((g) => g.id === id)).toBe(true);
  });

  it("the dock sends through askWithDeadline and falls back to localStylistReply; the server call has a timeout", () => {
    const dock = readFileSync(new URL("../components/shell/stylist-dock.tsx", import.meta.url), "utf8");
    const send = dock.slice(dock.indexOf("const send = async"), dock.indexOf("const wearDraft"));
    expect(send).toMatch(/askWithDeadline\(\s*askStylist\(/);
    expect(send).toContain("localStylistReply(");
    expect(dock).not.toContain("SESSION_START");
    expect(dock).toContain("SESSION_IDS");
    expect(dock).toMatch(/thisLookMessage\(thread\)/);
    const ai = readFileSync(new URL("./ai.ts", import.meta.url), "utf8");
    expect(ai).toMatch(/signal: AbortSignal\.timeout\(timeoutMs\)/);
    expect(ai).toMatch(/NOTES_TIMEOUT_MS/);
  });
});

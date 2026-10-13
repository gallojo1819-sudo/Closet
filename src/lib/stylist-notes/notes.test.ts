/**
 * Stylist memory on the 157-piece closet (engine-garments.json + redress-extra.json): a
 * stated never or lean saves with its kind and date, a correction of the shown look notes
 * that piece, a newer note on the same topic supersedes the older one and keeps it, a Skip
 * writes nothing, Delete removes a note, and closet.v6 is byte-identical around a save.
 * The ranking takes the top eight by topic match, then recency, and the prompt block reads
 * from those. Source pins keep the dock, the store, the server call and the migration honest.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { packPersist } from "../store-persist.ts";
import { useCloset } from "../store.ts";
import type { Garment } from "../types.ts";
import { classifyNote, isSkipMessage } from "./classify.ts";
import { addNote, deleteNote, listActive, memoryNotes, noteDateLabel, type StylistNote } from "./notes.ts";
import { NOTES_PER_ASK, noteMatchScore, notesBlock, relevantNotes } from "./rank.ts";
import { rememberFromAsk } from "./remember.ts";

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as Garment[];
const CLOSET: Garment[] = [...read("../__fixtures__/engine-garments.json"), ...read("../__fixtures__/redress-extra.json")];
const NOW = Date.parse("2026-10-13T15:00:00.000Z");
const TODAY = "2026-10-13";

/* Pieces of the owner's closet, by id, so no wardrobe is invented. */
const PINK_POLO = "g_ttw2m97ww8z5";
const NAVY_CORDS = "g_v3ovns4bv344";
const BROWN_LOAFERS = "g_8nrtffa2s13s";
const PINK_SHIRT = "g_zzrq3j5n2njk";
const SHOWN = [PINK_SHIRT, NAVY_CORDS, BROWN_LOAFERS];

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

function closetString(): string {
  const s = useCloset.getState();
  return packPersist({
    garments: s.garments,
    looks: s.looks,
    journal: s.journal,
    avoid: s.avoid,
    drop: s.drop,
    refPhoto: s.refPhoto,
    refPhotoBackup: s.refPhotoBackup,
    messages: s.messages,
    seenLooks: s.seenLooks,
    taste: s.taste,
  });
}

describe("stylist notes on the owner's closet", () => {
  it("the fixture is the 157-piece closet", () => {
    expect(CLOSET.length).toBe(157);
    for (const id of [PINK_POLO, NAVY_CORDS, BROWN_LOAFERS, PINK_SHIRT]) {
      expect(CLOSET.some((g) => g.id === id)).toBe(true);
    }
  });

  it("a stated never saves with its kind, topic, source and date", async () => {
    const notes = memoryNotes();
    const note = await rememberFromAsk(notes, { text: "I never wear the pink polo", garments: CLOSET, now: NOW });
    expect(note).not.toBeNull();
    expect(note!.kind).toBe("never");
    expect(note!.topic).toBe("pink polos");
    expect(note!.source).toBe("stated");
    expect(note!.text).toBe("I never wear the pink polo");
    expect(note!.createdAt).toBe(new Date(NOW).toISOString());
    expect(noteDateLabel(note!.createdAt, NOW)).toBe("Oct 13");
    expect(noteDateLabel("2025-02-03T10:00:00.000Z", NOW)).toBe("Feb 3, 2025");
    const active = await listActive(notes);
    expect(active.map((n) => n.id)).toEqual([note!.id]);
  });

  it("a stated lean saves as a lean", async () => {
    const notes = memoryNotes();
    const note = await rememberFromAsk(notes, { text: "I prefer loafers over sneakers", garments: CLOSET, now: NOW });
    expect(note?.kind).toBe("lean");
    expect(note?.topic).toBe("loafers");
    expect(note?.source).toBe("stated");
    const habit = classifyNote("Please don't tuck my shirts", CLOSET);
    expect(habit?.kind).toBe("never");
    expect(habit?.topic).toBe("tuck");
    const style = classifyNote("I hate prints", CLOSET);
    expect(style?.topic).toBe("prints");
  });

  it("a correction of the shown look is a note on that piece", async () => {
    const notes = memoryNotes();
    const note = await rememberFromAsk(notes, {
      text: "Not the loafers, too slick for a weekday",
      garments: CLOSET,
      previousIds: SHOWN,
      now: NOW,
    });
    expect(note?.kind).toBe("never");
    expect(note?.source).toBe("correction");
    expect(note?.topic).toBe(`piece:${BROWN_LOAFERS}`);
    /* The same words with no look shown are a stated note on the category. */
    const stated = classifyNote("Not the loafers, too slick for a weekday", CLOSET);
    expect(stated?.source).toBe("stated");
    expect(stated?.topic).toBe("loafers");
    /* "too formal" about the shown look keeps its own topic. */
    const formal = classifyNote("Too formal", CLOSET, { previousIds: SHOWN });
    expect(formal?.source).toBe("correction");
    expect(formal?.topic).toBe("formal");
  });

  it("a newer note on the same topic supersedes the older one, and the older one stays", async () => {
    const notes = memoryNotes();
    const older = await rememberFromAsk(notes, { text: "Never loafers", garments: CLOSET, now: NOW });
    const newer = await rememberFromAsk(notes, { text: "The loafers are fine again", garments: CLOSET, now: NOW + 60_000 });
    expect(older?.topic).toBe("loafers");
    expect(newer?.topic).toBe("loafers");
    expect(newer?.kind).toBe("lean");
    const active = await listActive(notes);
    expect(active.map((n) => n.id)).toEqual([newer!.id]);
    const all = notes.all();
    expect(all.length).toBe(2);
    const kept = all.find((n) => n.id === older!.id)!;
    expect(kept.supersededBy).toBe(newer!.id);
    expect(kept.supersededAt).toBe(new Date(NOW + 60_000).toISOString());
    expect(kept.text).toBe("Never loafers");
    /* A different topic supersedes nothing. */
    await rememberFromAsk(notes, { text: "Never the pink polo", garments: CLOSET, now: NOW + 120_000 });
    expect((await listActive(notes)).length).toBe(2);
  });

  it("a Skip creates no note, in the chat and on Today", async () => {
    const notes = memoryNotes();
    for (const text of ["skip", "Skip this one", "next", "No", "nope.", "again"]) {
      expect(isSkipMessage(text)).toBe(true);
      expect(await rememberFromAsk(notes, { text, garments: CLOSET, previousIds: SHOWN, now: NOW })).toBeNull();
    }
    /* A question is not a statement either. */
    expect(await rememberFromAsk(notes, { text: "What should I wear today?", garments: CLOSET, now: NOW })).toBeNull();
    expect(notes.all()).toEqual([]);

    /* Today's Skip goes through the store, which has no path to the notes. */
    useCloset.setState({
      garments: CLOSET,
      looks: [],
      journal: [],
      messages: [],
      drop: { date: TODAY, garmentIds: SHOWN, worn: false, verdict: "pending", occasion: "weekday" },
    });
    const before = useCloset.getState().journal.length;
    useCloset.getState().skipDrop();
    const after = useCloset.getState();
    expect(after.journal.length + (after.drop?.garmentIds.length ? 0 : 1)).toBeGreaterThanOrEqual(before);
    expect(notes.all()).toEqual([]);
    const store = src("../store.ts");
    expect(store.includes("stylist-notes")).toBe(false);
    expect(store.includes("rememberFromAsk")).toBe(false);
    /* The dock remembers only inside send, next to learnFromAsk; Save, Wear and Skip never do. */
    const dock = src("../../components/shell/stylist-dock.tsx");
    const send = dock.slice(dock.indexOf("const send"), dock.indexOf("const wearDraft"));
    expect(send.includes("rememberFromAsk(accountNotes()")).toBe(true);
    expect(send.includes("learnFromAsk")).toBe(true);
    const rest = dock.slice(dock.indexOf("const wearDraft"));
    expect(rest.includes("rememberFromAsk")).toBe(false);
    expect(dock.includes("<StylistNotes")).toBe(true);
    expect(dock.includes("data-stylist-notes-toggle")).toBe(true);
  });

  it("Delete removes the note", async () => {
    const notes = memoryNotes();
    const a = await rememberFromAsk(notes, { text: "Never loafers", garments: CLOSET, now: NOW });
    const b = await rememberFromAsk(notes, { text: "I love the navy corduroy trousers", garments: CLOSET, now: NOW + 1 });
    await deleteNote(notes, a!.id);
    expect((await listActive(notes)).map((n) => n.id)).toEqual([b!.id]);
    expect(notes.all().some((n) => n.id === a!.id)).toBe(false);
  });

  it("closet.v6 is byte-identical before and after a note is saved", async () => {
    useCloset.setState({
      garments: CLOSET,
      looks: [],
      journal: [],
      messages: [],
      drop: { date: TODAY, garmentIds: SHOWN, worn: false, verdict: "pending", occasion: "weekday" },
    });
    const before = closetString();
    const notes = memoryNotes();
    await rememberFromAsk(notes, { text: "Never the pink polo", garments: CLOSET, previousIds: SHOWN, now: NOW });
    await rememberFromAsk(notes, { text: "Not the loafers", garments: CLOSET, previousIds: SHOWN, now: NOW + 1 });
    await addNote(notes, { text: "I lean navy", kind: "lean", topic: "navy", source: "stated" }, NOW + 2);
    expect(notes.all().length).toBe(3);
    expect(closetString()).toBe(before);
    expect(JSON.stringify(useCloset.getState().garments)).toBe(JSON.stringify(CLOSET));
    /* The notes module never touches the store or the closet key. */
    for (const rel of ["./notes.ts", "./classify.ts", "./rank.ts", "./remember.ts", "./client.ts", "./notes.server.ts"]) {
      const text = src(rel);
      expect(text.includes('"../store')).toBe(false);
      expect(text.includes("localStorage")).toBe(false);
      expect(text.includes('from("closet_meta")')).toBe(false);
      expect(text.includes("useCloset")).toBe(false);
    }
  });

  it("the stylist call takes the top eight by topic match, then recency", async () => {
    const notes = memoryNotes();
    const topics = ["loafers", "pink polos", "navy", "tuck", "hoodies", "prints", "linen", "boots", "cardigans", "black sneakers"];
    const rows: StylistNote[] = [];
    for (const [i, topic] of topics.entries()) {
      rows.push(await addNote(notes, { text: `about ${topic}`, kind: "never", topic, source: "stated" }, NOW + i * 1000));
    }
    const picked = relevantNotes(await listActive(notes), { prompt: "What shoes go with the navy trousers?", garments: CLOSET });
    expect(picked.length).toBe(NOTES_PER_ASK);
    expect(picked[0]!.topic).toBe("navy");
    expect(picked.slice(1, 4).map((n) => n.topic)).toEqual(["black sneakers", "boots", "loafers"]);
    expect(picked.slice(4).map((n) => n.topic)).toEqual(["cardigans", "linen", "prints", "hoodies"]);
    expect(picked.some((n) => n.topic === "tuck")).toBe(false);
    expect(picked.some((n) => n.topic === "pink polos")).toBe(false);

    /* A piece note scores on the lock and on the piece's name in the prompt. */
    const pieceNote = await addNote(notes, { text: "Not the loafers", kind: "never", topic: `piece:${BROWN_LOAFERS}`, source: "correction" }, NOW);
    expect(noteMatchScore(pieceNote, { prompt: "a weekday look", garments: CLOSET, lockedIds: [BROWN_LOAFERS] })).toBe(4);
    expect(noteMatchScore(pieceNote, { prompt: "the brown suede loafers with what?", garments: CLOSET })).toBe(4);
    expect(noteMatchScore(pieceNote, { prompt: "a weekday look", garments: CLOSET })).toBe(0);

    const block = notesBlock([pieceNote, rows[2]!], CLOSET, NOW);
    expect(block).toContain("REMEMBERED");
    expect(block).toContain(`- Never: Not the loafers (${BROWN_LOAFERS} brown suede loafers, Oct 13)`);
    expect(block).toContain("- Never: about navy (navy, Oct 13)");
    expect(notesBlock([], CLOSET, NOW)).toBe("");
  });

  it("askStylist loads the notes as the caller after the gate and puts them in the system prompt", () => {
    const ai = src("../ai.ts");
    const start = ai.indexOf("export const askStylist");
    const block = ai.slice(start, ai.indexOf("export const trendLayer"));
    const gateAt = block.indexOf("callerGate(");
    const loadAt = block.indexOf("loadActiveNotes(context.callerId, context.sbToken)");
    expect(gateAt).toBeGreaterThan(0);
    expect(loadAt).toBeGreaterThan(gateAt);
    expect(block.includes("relevantNotes(active, { prompt: data.prompt, garments: rack, lockedIds: data.lockedIds })")).toBe(true);
    expect(block.includes("content: `${system}${notes}${remembered}`")).toBe(true);
    expect(block.indexOf("xaiFetch(")).toBeGreaterThan(loadAt);
    /* No second model call: the classifier is the pure one in classify.ts. */
    expect(src("./classify.ts").includes("xaiFetch")).toBe(false);
    expect(src("./classify.ts").includes("scrubHouseNames")).toBe(true);
    expect(src("./notes.server.ts").includes("service_role")).toBe(false);
  });

  it("the migration is under supabase/migrations with RLS, and not in the auto-applied folder", () => {
    const sql = src("../../../supabase/migrations/20261013200000_stylist_notes.sql");
    for (const bit of [
      "create table if not exists public.stylist_notes",
      "references auth.users (id) on delete cascade",
      "kind in ('never', 'lean')",
      "source in ('stated', 'correction')",
      "enable row level security",
      "force row level security",
      "grant update (superseded_at, superseded_by)",
      "revoke all on table public.stylist_notes from public, anon, authenticated",
    ]) {
      expect(sql.includes(bit), bit).toBe(true);
    }
    for (const op of ["select", "insert", "delete", "update"]) {
      expect(new RegExp(`for ${op}\\s+to authenticated`).test(sql), op).toBe(true);
    }
    expect(/public\.closet_meta|closet\.v6/.test(sql)).toBe(false);
    const top = new URL("../../../migrations/", import.meta.url);
    for (const entry of readdirSync(top)) {
      const path = new URL(entry, top);
      if (!statSync(path).isFile()) continue;
      expect(readFileSync(path, "utf8").includes("stylist_notes"), entry).toBe(false);
    }
  });
});

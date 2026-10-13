/**
 * Stylist notes: what he told the stylist, kept on his account (public.stylist_notes).
 * Pure over a small backend so node and vitest run it with the memory backend, and the
 * dock and the server run it over Supabase under RLS. Nothing here touches closet.v6,
 * closet_meta, the store, or TasteMemory.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** never: a rule. lean: a preference. */
export type NoteKind = "never" | "lean";
/** stated: said outright. correction: said about a look the stylist had just shown. */
export type NoteSource = "stated" | "correction";

export type NoteInput = {
  text: string;
  kind: NoteKind;
  topic: string;
  source: NoteSource;
};

export type StylistNote = NoteInput & {
  id: string;
  createdAt: string;
  supersededAt: string | null;
  supersededBy: string | null;
};

export const NOTE_TEXT_MAX = 400;
export const NOTE_TOPIC_MAX = 80;

/** One account's notes. Every backend is already scoped to its user. */
export type NotesBackend = {
  insert(input: NoteInput, createdAt: string): Promise<StylistNote>;
  listActive(): Promise<StylistNote[]>;
  supersede(ids: string[], byId: string, at: string): Promise<void>;
  remove(id: string): Promise<void>;
};

export type MemoryNotes = NotesBackend & {
  /** Every row, superseded ones included. Tests only. */
  all(): StylistNote[];
};

function clampInput(input: NoteInput): NoteInput {
  const text = input.text.replace(/\s+/g, " ").trim().slice(0, NOTE_TEXT_MAX);
  const topic = input.topic.replace(/\s+/g, " ").trim().toLowerCase().slice(0, NOTE_TOPIC_MAX);
  if (!text) throw new Error("A note needs text.");
  if (!topic) throw new Error("A note needs a topic.");
  if (input.kind !== "never" && input.kind !== "lean") throw new Error("Unknown note kind.");
  if (input.source !== "stated" && input.source !== "correction") throw new Error("Unknown note source.");
  return { text, kind: input.kind, topic, source: input.source };
}

/** Newest first, as the table's index reads. */
function newestFirst(a: StylistNote, b: StylistNote): number {
  return b.createdAt.localeCompare(a.createdAt);
}

/**
 * Add a note. Active notes on the same topic are marked superseded by the new one and kept.
 * The read happens before the insert so the new row never supersedes itself.
 */
export async function addNote(backend: NotesBackend, input: NoteInput, now: number = Date.now()): Promise<StylistNote> {
  const clean = clampInput(input);
  const at = new Date(now).toISOString();
  const older = (await backend.listActive()).filter((n) => n.topic === clean.topic);
  const row = await backend.insert(clean, at);
  const ids = older.map((n) => n.id).filter((id) => id !== row.id);
  if (ids.length) await backend.supersede(ids, row.id, at);
  return row;
}

/** Active notes, newest first. */
export async function listActive(backend: NotesBackend): Promise<StylistNote[]> {
  const rows = await backend.listActive();
  return rows.filter((n) => n.supersededAt === null).sort(newestFirst);
}

export async function deleteNote(backend: NotesBackend, id: string): Promise<void> {
  await backend.remove(id);
}

let memorySeq = 0;

/** An in-memory account. Tests, and nothing else. */
export function memoryNotes(): MemoryNotes {
  const rows: StylistNote[] = [];
  return {
    async insert(input, createdAt) {
      memorySeq += 1;
      const row: StylistNote = {
        ...input,
        id: `n_${memorySeq.toString(36)}`,
        createdAt,
        supersededAt: null,
        supersededBy: null,
      };
      rows.push(row);
      return { ...row };
    },
    async listActive() {
      return rows.filter((n) => n.supersededAt === null).map((n) => ({ ...n })).sort(newestFirst);
    },
    async supersede(ids, byId, at) {
      const set = new Set(ids);
      for (const row of rows) {
        if (set.has(row.id) && row.supersededAt === null) {
          row.supersededAt = at;
          row.supersededBy = byId;
        }
      }
    },
    async remove(id) {
      const at = rows.findIndex((n) => n.id === id);
      if (at >= 0) rows.splice(at, 1);
      for (const row of rows) if (row.supersededBy === id) row.supersededBy = null;
    },
    all() {
      return rows.map((n) => ({ ...n }));
    },
  };
}

type NoteRow = {
  id: string;
  text: string;
  kind: string;
  topic: string;
  source: string;
  created_at: string;
  superseded_at: string | null;
  superseded_by: string | null;
};

const COLUMNS = "id, text, kind, topic, source, created_at, superseded_at, superseded_by";

function fromRow(row: NoteRow): StylistNote {
  return {
    id: row.id,
    text: row.text,
    kind: row.kind === "lean" ? "lean" : "never",
    topic: row.topic,
    source: row.source === "correction" ? "correction" : "stated",
    createdAt: row.created_at,
    supersededAt: row.superseded_at ?? null,
    supersededBy: row.superseded_by ?? null,
  };
}

/**
 * The account's notes over Supabase, as the signed-in user (RLS scopes every row).
 * Only the superseded columns are ever updated; the table grants nothing else.
 */
export function supabaseNotes(sb: SupabaseClient, userId: string): NotesBackend {
  const table = () => sb.from("stylist_notes");
  return {
    async insert(input, createdAt) {
      const { data, error } = await table()
        .insert({ user_id: userId, ...input, created_at: createdAt })
        .select(COLUMNS)
        .single();
      if (error || !data) throw new Error(error?.message || "Could not keep the note.");
      return fromRow(data as NoteRow);
    },
    async listActive() {
      const { data, error } = await table()
        .select(COLUMNS)
        .eq("user_id", userId)
        .is("superseded_at", null)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message || "Could not read the notes.");
      return ((data ?? []) as NoteRow[]).map(fromRow);
    },
    async supersede(ids, byId, at) {
      if (!ids.length) return;
      const { error } = await table()
        .update({ superseded_at: at, superseded_by: byId })
        .in("id", ids)
        .is("superseded_at", null);
      if (error) throw new Error(error.message || "Could not supersede the note.");
    },
    async remove(id) {
      const { error } = await table().delete().eq("id", id);
      if (error) throw new Error(error.message || "Could not delete the note.");
    },
  };
}

/** "Oct 13", or "Oct 13, 2025" when the note is from another year. */
export function noteDateLabel(iso: string, now: number = Date.now()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const sameYear = at.getUTCFullYear() === new Date(now).getUTCFullYear();
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][at.getUTCMonth()];
  const day = at.getUTCDate();
  return sameYear ? `${month} ${day}` : `${month} ${day}, ${at.getUTCFullYear()}`;
}

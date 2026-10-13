import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAccount } from "@/lib/cloud/account";
import { accountNotes } from "@/lib/stylist-notes/client";
import { deleteNote, listActive, noteDateLabel, type StylistNote } from "@/lib/stylist-notes/notes";

const KIND_LABEL: Record<StylistNote["kind"], string> = { never: "Never", lean: "Lean" };

/**
 * What the stylist remembers: active notes with their dates, a Delete on each.
 * Reached from the dock; reads and deletes on the account only. Nothing here touches
 * the closet.
 */
export function StylistNotes({ onBack }: { onBack: () => void }) {
  const account = useAccount();
  const userId = account.user?.id ?? null;
  const [notes, setNotes] = useState<StylistNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const backend = accountNotes();
    if (!backend) {
      setNotes([]);
      return;
    }
    try {
      setNotes(await listActive(backend));
      setError(null);
    } catch {
      setNotes([]);
      setError("Could not read your notes.");
    }
  }, []);

  useEffect(() => {
    setNotes(null);
    void load();
  }, [load, userId]);

  const remove = async (note: StylistNote) => {
    const backend = accountNotes();
    if (!backend || busyId) return;
    setBusyId(note.id);
    try {
      await deleteNote(backend, note.id);
      setNotes((prev) => (prev ?? []).filter((n) => n.id !== note.id));
      setError(null);
    } catch {
      setError("Could not delete that note.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div data-stylist-notes className="px-4 pt-3 pb-4">
      <div className="flex items-center justify-between">
        <p className="micro text-ink-soft">What the stylist remembers</p>
        <button
          type="button"
          onClick={onBack}
          className="micro text-ink-soft hover:text-ink underline-offset-2 hover:underline"
        >
          Back
        </button>
      </div>
      {!userId ? (
        <p className="mt-2 text-sm text-ink-soft">Sign in and the stylist keeps what you tell it.</p>
      ) : notes === null ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-ink-soft">
          <Loader2 className="size-4 animate-spin" /> Reading…
        </p>
      ) : notes.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">
          Nothing yet. Tell the stylist a never or a lean and it stays here.
        </p>
      ) : (
        <ul className="mt-2 space-y-3">
          {notes.map((note) => (
            <li key={note.id} className="border-t border-hairline pt-2">
              <p className="micro text-ink-soft">
                {KIND_LABEL[note.kind]} · {noteDateLabel(note.createdAt)}
              </p>
              <p className="mt-0.5 text-sm leading-relaxed text-ink">{note.text}</p>
              <button
                type="button"
                aria-label={`Delete note: ${note.text}`}
                disabled={busyId === note.id}
                onClick={() => void remove(note)}
                className="mt-1 micro text-ink-soft hover:text-ink underline-offset-2 hover:underline disabled:opacity-40"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="mt-2 text-sm text-accent">{error}</p> : null}
    </div>
  );
}

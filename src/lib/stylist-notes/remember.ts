/**
 * The dock's one call: classify what he typed and keep it on his account. Runs beside
 * learnFromAsk, never instead of it, and never on a Skip. Writes nothing to the store.
 */
import type { Garment } from "../types.ts";
import { classifyNote, isSkipMessage } from "./classify.ts";
import { addNote, type NotesBackend, type StylistNote } from "./notes.ts";

export { isSkipMessage };

export async function rememberFromAsk(
  backend: NotesBackend | null,
  opts: { text: string; garments: Garment[]; previousIds?: readonly string[]; now?: number },
): Promise<StylistNote | null> {
  if (!backend) return null;
  if (isSkipMessage(opts.text)) return null;
  const note = classifyNote(opts.text, opts.garments, { previousIds: opts.previousIds });
  if (!note) return null;
  return addNote(backend, note, opts.now ?? Date.now());
}

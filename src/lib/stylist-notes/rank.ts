/**
 * Which notes go into one stylist call: the top eight by topic match against the prompt
 * (and the locked pieces), then by recency. Pure. The prompt block is built here too so
 * the server and the tests read the same lines.
 */
import { scoreNameMatch } from "../dress.ts";
import { slotOf } from "../style.ts";
import type { Garment } from "../types.ts";
import { topicPieceId } from "./classify.ts";
import { noteDateLabel, type StylistNote } from "./notes.ts";

export const NOTES_PER_ASK = 8;

const FAMILY: Record<string, string> = {
  shoes: "footwear", shoe: "footwear", loafers: "footwear", loafer: "footwear", sneakers: "footwear", sneaker: "footwear",
  boots: "footwear", boot: "footwear", mules: "footwear", mule: "footwear", footwear: "footwear",
  trousers: "bottom", trouser: "bottom", pants: "bottom", jeans: "bottom", chinos: "bottom", cords: "bottom",
  shorts: "bottom", bottoms: "bottom",
  shirts: "top", shirt: "top", polos: "top", polo: "top", tees: "top", tee: "top", knits: "top", knit: "top",
  sweater: "top", sweaters: "top", hoodies: "top", hoodie: "top", cardigans: "top", cardigan: "top", tops: "top", top: "top",
  jackets: "outerwear", jacket: "outerwear", blazers: "outerwear", blazer: "outerwear", coats: "outerwear", coat: "outerwear",
  vests: "outerwear", vest: "outerwear", outerwear: "outerwear", layer: "outerwear", layers: "outerwear",
};

function stem(w: string): string {
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((w) => w.length >= 3);
}

export function noteMatchScore(
  note: StylistNote,
  opts: { prompt: string; garments: readonly Garment[]; lockedIds?: readonly string[] },
): number {
  const prompt = words(opts.prompt);
  const promptStems = new Set(prompt.map(stem));
  const promptFamilies = new Set(prompt.map((w) => FAMILY[w]).filter(Boolean));
  const pieceId = topicPieceId(note.topic);
  if (pieceId) {
    const piece = opts.garments.find((g) => g.id === pieceId);
    let score = 0;
    if (opts.lockedIds?.includes(pieceId)) score += 4;
    if (piece && scoreNameMatch(opts.prompt, piece) >= 6) score += 3;
    const slot = piece ? slotOf(piece) : null;
    if (slot && promptFamilies.has(slot)) score += 1;
    return score;
  }
  let score = 0;
  for (const w of words(note.topic)) {
    if (promptStems.has(stem(w))) score += 2;
    else if (FAMILY[w] && promptFamilies.has(FAMILY[w]!)) score += 1;
  }
  return score;
}

/** Top `max` by topic match, then newest first. Zero-match notes still fill the list by recency. */
export function relevantNotes(
  notes: readonly StylistNote[],
  opts: { prompt: string; garments: readonly Garment[]; lockedIds?: readonly string[] },
  max: number = NOTES_PER_ASK,
): StylistNote[] {
  return notes
    .filter((n) => n.supersededAt === null)
    .map((note) => ({ note, score: noteMatchScore(note, opts) }))
    .sort((a, b) => b.score - a.score || b.note.createdAt.localeCompare(a.note.createdAt))
    .slice(0, Math.max(0, max))
    .map((row) => row.note);
}

export function noteLine(note: StylistNote, garments: readonly Garment[], now: number = Date.now()): string {
  const pieceId = topicPieceId(note.topic);
  const piece = pieceId ? garments.find((g) => g.id === pieceId) : undefined;
  const about = pieceId ? `${pieceId}${piece ? ` ${piece.name}` : ""}` : note.topic;
  const label = note.kind === "never" ? "Never" : "Lean";
  const date = noteDateLabel(note.createdAt, now);
  return `- ${label}: ${note.text} (${about}${date ? `, ${date}` : ""})`;
}

/** The REMEMBERED block for the system prompt, or "" with no notes. */
export function notesBlock(notes: readonly StylistNote[], garments: readonly Garment[], now: number = Date.now()): string {
  if (!notes.length) return "";
  return [
    "",
    "REMEMBERED",
    "What he told the stylist. A never is a rule: do not put him in it. A lean is a preference: favour it when the look allows. These sit beside his vetoes and techniques.",
    ...notes.map((note) => noteLine(note, garments, now)),
  ].join("\n");
}

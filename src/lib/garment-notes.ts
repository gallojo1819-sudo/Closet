/**
 * What the Add flow wrote into `notes` before the piece had a description: the capture
 * source ("camera", "held"), the worn-picker chip ("worn · Polo"), the matte verdict, or the
 * official-plate source. None of it is a style or make, so the piece sheet shows the field
 * blank instead (stored rows are not rewritten; plate.ts still reads "held"/"camera").
 */
const CAPTURE_NOTE =
  /^(?:camera|held|worn\s*·.*|official plate\s*·.*|already a catalog shot\b.*|kept your real pixels\b.*|floated on paper\b.*)$/i;

export function isCaptureNote(notes?: string | null): boolean {
  const text = (notes ?? "").trim();
  if (!text) return false;
  return CAPTURE_NOTE.test(text);
}

/** The notes a person wrote. A capture marker reads as no notes. */
export function styleNotes(notes?: string | null): string {
  const text = (notes ?? "").trim();
  return isCaptureNote(text) ? "" : text;
}

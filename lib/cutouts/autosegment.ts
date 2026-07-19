import "server-only";
import { cropOriginalBbox } from "./reference";
import { segmentBackground } from "./segment";
import { runQaGates } from "./qa";
import type { Bbox } from "@/lib/garments/types";

// The segmentation-first default path, factored out so the ingest route (which
// runs it inline on every upload) and the batch re-segment route share exactly
// one implementation. This is pixel-preserving: it strips a uniform plain
// background from the real photo, leaving the garment's actual RGB untouched.
// No Gemini, no cost, no invention. Returns the RGBA cutout PNG when the shot is
// clean enough to pass technical QA, or null when it isn't (caller falls back to
// the honest cropped photo).

export async function trySegment(
  original: Buffer,
  bbox: Bbox | null,
): Promise<Buffer | null> {
  try {
    const crop = await cropOriginalBbox(original, bbox);
    const seg = await segmentBackground(crop);
    if (!seg.ok) return null;
    const qa = runQaGates(seg.raw, seg.width, seg.height, null);
    if (!qa.pass) return null;
    return seg.png;
  } catch {
    // segmentation is best-effort; any failure means "fall back to photo"
    return null;
  }
}

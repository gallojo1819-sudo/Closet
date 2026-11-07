/**
 * The held-photo cleanup prompt. A retry follows the garment's category.
 * Callers that still omit the category (the camera jacket pass) keep the jacket prompt.
 * The jacket sentences stay in ai.ts; this function only chooses which prompt to send.
 */

const JACKET_WORD = /\b(jackets?|coats?|blazers?)\b/i;

export function heldCleanupPrompt(input: {
  category?: string;
  noun?: string;
  retry?: boolean;
  jacketPrompt: string;
  jacketRetry: string;
}): string {
  const category = (input.category ?? "").trim().toLowerCase();
  const noun = (input.noun ?? "").trim();
  const jacket =
    (!category && !noun) ||
    category === "outerwear" ||
    JACKET_WORD.test(category) ||
    JACKET_WORD.test(noun);
  if (jacket) {
    return input.retry ? `${input.jacketPrompt} ${input.jacketRetry}` : input.jacketPrompt;
  }
  const what = noun || category || "piece";
  const retry = input.retry
    ? " The last plate still failed. Fail if a second garment, a person, a hand, a hanger, a room, or scenery remains."
    : "";
  return (
    `Product photograph of this exact ${what}. Keep this exact shape, color, and fabric. ` +
    "Keep stitching, hardware, logos, and wear. " +
    "Remove the arm, the hand, the hanger, the wall, and the floor. " +
    "Lay it on #F4EFE6. 4:5, garment filling ~80% of the frame, even light. " +
    "No second garment, no model, no text. Do not invent a different item, brand, or color." +
    retry
  );
}

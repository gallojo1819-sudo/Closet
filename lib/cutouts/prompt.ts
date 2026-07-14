import type { Category } from "@/lib/garments/types";

// Chroma-key selection + prompt construction from stored manifest evidence.
// Pure module (no I/O) so it can be unit-tested.

export interface Observed {
  color?: string;
  material?: string;
  silhouette?: string;
  construction?: string;
  marks?: string;
}

export interface PromptGarment {
  category: Category;
  subtype: string | null;
  colors: string[];
  pattern: string | null;
  material: string | null;
  observed: Observed;
  unknowns: string[];
}

/**
 * Default green key. If the garment itself is green, switch to magenta; if it
 * is both green AND magenta/pink, switch to blue — so the key never collides
 * with a color present in the item.
 */
export function selectChroma(colors: string[]): string {
  const hasGreen = colors.some((c) => /green|olive|lime/i.test(c));
  const hasMagenta = colors.some((c) => /magenta|pink|fuchsia|fuscia/i.test(c));
  if (hasGreen && hasMagenta) return "#0000ff";
  if (hasGreen) return "#ff00ff";
  return "#00ff00";
}

function framingClause(category: Category): string {
  switch (category) {
    case "footwear":
      return "Framing: show the matched pair, slightly elevated front three-quarter view, both shoes complete.";
    case "bottom":
      return "Framing: portrait framing, waistband down to the complete hems, nothing cut off.";
    case "accessory":
      return "Framing: align the long axis horizontally with both ends complete and fully in frame.";
    default:
      return "";
  }
}

function noun(g: PromptGarment): string {
  return (g.subtype && g.subtype.trim()) || g.category;
}

/** Assemble the item-fidelity sentence from whatever evidence exists. */
function fidelityClause(g: PromptGarment): string {
  const parts: string[] = [];
  if (g.colors.length) parts.push(`the colors ${g.colors.join(", ")}`);
  if (g.material) parts.push(`the material ${g.material}`);
  if (g.pattern) parts.push(`the ${g.pattern} pattern`);

  const constructionBits = [
    g.observed.construction,
    g.observed.silhouette,
    g.observed.marks,
  ]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);

  let sentence = "Item fidelity: Preserve the source-supported ";
  sentence += parts.length ? parts.join(", ") : "appearance";
  if (constructionBits.length) {
    sentence += `, and the construction details recorded from the source: ${constructionBits.join("; ")}`;
  }
  sentence += ".";
  return sentence;
}

/** Unknowns become explicit omissions rather than invented detail. */
function unknownsClause(unknowns: string[]): string {
  const list = unknowns
    .map((u) => u.trim())
    .filter(Boolean)
    .slice(0, 4);
  if (!list.length) return "";
  return list
    .map(
      (u) =>
        `The ${u} is not verifiable from the source; use the simplest construction consistent with what is visible.`,
    )
    .join(" ");
}

export interface BuiltPrompt {
  prompt: string;
  chromaHex: string;
}

export function buildCutoutPrompt(g: PromptGarment): BuiltPrompt {
  const chromaHex = selectChroma(g.colors);
  const s = noun(g);
  const framing = framingClause(g.category);
  const unknowns = unknownsClause(g.unknowns);

  const lines = [
    `Asset type: transparent ecommerce clothing catalog cutout, generated first on a removable chroma key.`,
    `Input image: the reference photograph shows the exact same ${s} worn/laid out. Use it only to identify and reconstruct that item. Do not mix in details from other visible clothing.`,
    `Primary request: Reconstruct ONLY the complete empty ${s} as a clean front-view ecommerce catalog product photograph. Remove any wearer, body, skin, hair, other clothing, bedding, and the scene. Show the complete unoccluded item, naturally and symmetrically arranged, with no person, mannequin, or hanger visible.`,
    fidelityClause(g),
    unknowns,
    `Do not invent any logo, lettering, label, pocket, seam, fastener, hardware, color, or decoration.`,
    `Composition: square canvas, centered front view, complete item fully inside frame with generous even padding on every outer edge; no cropping or truncation.`,
    framing,
    `Background: perfectly flat, absolutely uniform solid ${chromaHex} edge-to-edge — exactly one color, no shadow, gradient, texture, vignette, floor, reflection, or lighting variation.`,
    `Lighting: neutral diffuse ecommerce product lighting contained on the item only; no cast shadow, contact shadow, reflection, prop, watermark, caption, or border.`,
    `Critical: use no ${chromaHex} anywhere in the item itself; preserve a crisp separable outer silhouette; output only one item (a matched pair only for footwear).`,
  ].filter(Boolean);

  return { prompt: lines.join("\n\n"), chromaHex };
}

/** Corrective prompt for the single retry, naming the specific QA failure(s). */
export function buildCorrectivePrompt(
  chromaHex: string,
  failureSummary: string,
): string {
  return [
    `Correct the attached catalog cutout using the source crop. Keep the successful silhouette and composition.`,
    `Remove ${failureSummary}.`,
    `Return the corrected item on the same uniform ${chromaHex} background with no shadow.`,
  ].join(" ");
}

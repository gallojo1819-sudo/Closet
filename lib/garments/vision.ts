import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { CATEGORIES, type Category, type VisionItem } from "./types";

// The vision inventory model. Named explicitly by the round spec.
const VISION_MODEL = "claude-sonnet-4-6";

// Grounding discipline is stated verbatim to the model: prefer omission over
// invention; unverifiable attributes go in `unknowns`, never stated as fact;
// unreadable branding is never guessed.
const SYSTEM_PROMPT = `You are a meticulous fashion cataloguer. You identify every garment or accessory a person is deliberately wearing or displaying in a photo, and describe ONLY what you can actually see.

GROUNDING RULES — follow these exactly:
- Prefer omission over invention. If you cannot verify an attribute from THIS photo, do not state it as a fact — put it in "unknowns".
- Never guess. Unreadable text or branding is left blank ("brand": ""), never inferred from style or logo shape you are unsure of.
- Uncertain attributes (material you can't confirm by look, a color hidden in shadow, a size) belong in "unknowns", not in the attribute fields.
- Set "brand" ONLY when a name/wordmark is clearly legible in the image.
- Include deliberately worn/displayed items: tops, bottoms, outerwear, dresses, footwear, hosiery, belts, ties, headwear, and similar accessories.
- Exclude props, background objects, furniture, and anything not worn or displayed as apparel.
- If an item is present but too obscured to classify confidently, STILL return it with "confidence": "low" and put what you couldn't determine in "unknowns".

OUTPUT — respond with ONLY a JSON array (no prose, no markdown fences). Each element:
{
  "category": one of "top" | "bottom" | "outerwear" | "dress" | "footwear" | "accessory" | "other",
  "subtype": short noun (e.g. "crewneck t-shirt", "chelsea boot") or "",
  "colors": ["primary color", ...],
  "pattern": e.g. "solid" | "striped" | "plaid" | "floral" | "graphic",
  "material": best-verified material or "",
  "brand": "" unless a wordmark is clearly legible,
  "formality": integer 1 (loungewear) to 5 (formal),
  "warmth": integer 1 (hot-weather) to 5 (heavy winter),
  "seasons": subset of ["spring","summer","fall","winter"],
  "bbox": [left, top, right, bottom] as fractions 0..1 of the UPRIGHT image bounding the item,
  "observed": { "color": "", "material": "", "silhouette": "", "construction": "", "marks": "" },
  "unknowns": [ attributes you could NOT verify from this photo ],
  "confidence": "high" | "medium" | "low",
  "notes": one styling-relevant note
}
Return [] if no wearable items are present.`;

function isCategory(v: unknown): v is Category {
  return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean);
}

function clampRating(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  if (r < 1 || r > 5) return null;
  return r;
}

function toBbox(v: unknown): VisionItem["bbox"] {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const nums = v.map((x) => (typeof x === "number" ? x : Number(x)));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  let [l, t, r, b] = nums.map((n) => Math.min(1, Math.max(0, n)));
  if (r < l) [l, r] = [r, l];
  if (b < t) [t, b] = [b, t];
  if (r - l < 0.001 || b - t < 0.001) return null;
  return [l, t, r, b];
}

/** Pull the JSON array out of the model's text, tolerating stray prose/fences. */
function extractJsonArray(text: string): unknown[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeItem(raw: unknown): VisionItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const category: Category = isCategory(o.category) ? o.category : "other";
  const brandRaw = typeof o.brand === "string" ? o.brand.trim() : "";
  const confidence =
    o.confidence === "high" || o.confidence === "low" ? o.confidence : "medium";
  return {
    category,
    subtype: typeof o.subtype === "string" && o.subtype.trim() ? o.subtype.trim() : null,
    colors: toStringArray(o.colors).map((c) => c.toLowerCase()),
    pattern: typeof o.pattern === "string" && o.pattern.trim() ? o.pattern.trim() : "solid",
    material: typeof o.material === "string" && o.material.trim() ? o.material.trim() : null,
    brand: brandRaw || null,
    formality: clampRating(o.formality),
    warmth: clampRating(o.warmth),
    seasons: toStringArray(o.seasons).map((s) => s.toLowerCase()),
    bbox: toBbox(o.bbox),
    observed:
      o.observed && typeof o.observed === "object"
        ? (o.observed as Record<string, unknown>)
        : {},
    unknowns: toStringArray(o.unknowns),
    confidence,
    notes: typeof o.notes === "string" && o.notes.trim() ? o.notes.trim() : null,
  };
}

/**
 * Parse the model's raw text into validated items: extract the JSON array,
 * normalize each item, drop anything unparseable. Exposed for testing.
 */
export function parseManifest(text: string): VisionItem[] {
  return extractJsonArray(text)
    .map(normalizeItem)
    .filter((x): x is VisionItem => x !== null);
}

/**
 * Run the vision inventory on an upright JPEG buffer. Downscales a working
 * copy to max 1024px long side before sending. Returns the validated item
 * array; throws on API failure so the caller can surface a per-file error.
 */
export async function runVisionInventory(uprightJpeg: Buffer): Promise<VisionItem[]> {
  const working = await sharp(uprightJpeg)
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();

  const client = new Anthropic();
  const response = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: working.toString("base64"),
            },
          },
          {
            type: "text",
            text: "Inventory every deliberately worn or displayed garment and accessory in this photo. Respond with ONLY the JSON array.",
          },
        ],
      },
    ],
  });

  const text = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");

  return parseManifest(text);
}

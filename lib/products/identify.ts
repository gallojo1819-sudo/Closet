import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";

// Product identification (Round B4). We look up a REAL manufacturer/retailer
// product for a garment so its displayed image can be the official product
// image — the gold standard, exactly what the user bought. Three lookup
// surfaces, all server-side against the existing ANTHROPIC_API_KEY:
//
//   * searchProducts  — Anthropic `web_search` from the best signal available
//                       (brand + reference number, or brand + product name).
//   * fetchProductUrl — Anthropic `web_fetch` of a pasted product URL, no search.
//   * readCareTag     — vision (claude-sonnet-4-6) reads a care/size label.
//
// Discipline, stated to the model verbatim: return only real, findable products;
// ground every match_reason in the garment's own attributes; when not confident,
// return an empty list. A wrong product is worse than none.

const MODEL = "claude-sonnet-4-6";

// The dynamic-filtering server-tool variants (supported on Sonnet 4.6). Typed
// loosely so we don't depend on the SDK's exact tool-union spelling.
const WEB_SEARCH_TOOL = {
  type: "web_search_20260209",
  name: "web_search",
  max_uses: 5,
};
const WEB_FETCH_TOOL = {
  type: "web_fetch_20260209",
  name: "web_fetch",
  max_uses: 3,
};

export interface ProductCandidate {
  product_name: string;
  brand: string | null;
  retailer: string | null;
  price: string | null;
  product_url: string | null;
  image_url: string | null;
  retailer_product_id: string | null;
  /** Grounded in the garment's own attributes vs. this candidate. */
  match_reason: string;
}

export interface CareTagReading {
  brand: string | null;
  size: string | null;
  material: string | null;
  style_code: string | null;
}

/** The garment's own manifest attributes, used to ground match reasons. */
export interface GarmentSignal {
  category: string;
  subtype: string | null;
  colors: string[];
  pattern: string | null;
  material: string | null;
}

function signalLine(s: GarmentSignal): string {
  const parts = [
    s.colors.length ? `color: ${s.colors.join("/")}` : null,
    s.pattern ? `pattern: ${s.pattern}` : null,
    s.material ? `material: ${s.material}` : null,
    `type: ${s.subtype ?? s.category}`,
  ].filter(Boolean);
  return parts.join(", ");
}

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

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function normalizeCandidate(raw: unknown): ProductCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = str(o.product_name);
  if (!name) return null; // a candidate with no name is not usable
  return {
    product_name: name,
    brand: str(o.brand),
    retailer: str(o.retailer),
    price: str(o.price),
    product_url: str(o.product_url),
    image_url: str(o.image_url),
    retailer_product_id: str(o.retailer_product_id),
    match_reason: str(o.match_reason) ?? "",
  };
}

function parseCandidates(text: string): ProductCandidate[] {
  return extractJsonArray(text)
    .map(normalizeCandidate)
    .filter((c): c is ProductCandidate => c !== null)
    .slice(0, 5);
}

// Run a tool-enabled conversation to completion, resuming across pause_turn
// (the server-tool sampling loop can pause), and return the concatenated final
// text. Tools are cast loosely so an unknown-to-the-SDK tool type still compiles.
async function runToolConversation(
  client: Anthropic,
  system: string,
  userText: string,
  tools: unknown[],
): Promise<string> {
  const base = {
    model: MODEL,
    max_tokens: 2048,
    system,
    tools: tools as unknown as Anthropic.ToolUnion[],
  };
  let messages: Anthropic.MessageParam[] = [
    { role: "user", content: userText },
  ];
  let resp = await client.messages.create({ ...base, messages });
  let guard = 0;
  while (resp.stop_reason === "pause_turn" && guard < 6) {
    messages = [
      ...messages,
      {
        role: "assistant",
        content: resp.content as unknown as Anthropic.ContentBlockParam[],
      },
    ];
    resp = await client.messages.create({ ...base, messages });
    guard++;
  }
  return resp.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

const SEARCH_SYSTEM = `You identify the REAL, currently- or recently-purchasable product that matches a single garment, using web search. Rules:
- Prefer the exact brand + reference/style number. Search official brand sites and major retailers first.
- Return ONLY genuine products you actually found in results — never invent a name, URL, price, or image.
- Every candidate's image_url must be a direct link to that product's photo (jpg/png/webp). If you cannot find a real image URL, set image_url to null rather than guessing.
- Ground each match_reason in the garment's stated attributes (color, pattern, material, cut) versus the candidate. Be specific.
- Older or sold-out pieces may have no findable live listing even with the exact code — that is expected. If you are not confident any result is the same product, return an empty array [].
- A wrong product is worse than none. When in doubt, return fewer candidates or none.

Respond with ONLY a JSON array (no prose, no markdown fences). 3-5 elements max, best match first. Each element:
{"product_name": string, "brand": string|null, "retailer": string|null, "price": string|null, "product_url": string|null, "image_url": string|null, "retailer_product_id": string|null, "match_reason": string}`;

export async function searchProducts(
  query: string,
  signal: GarmentSignal,
): Promise<ProductCandidate[]> {
  const client = new Anthropic();
  const userText = `Find the product for this garment.
Search signal: ${query}
The garment (from the owner's own photo): ${signalLine(signal)}
Return the JSON array of candidates.`;
  const text = await runToolConversation(client, SEARCH_SYSTEM, userText, [
    WEB_SEARCH_TOOL,
  ]);
  return parseCandidates(text);
}

const FETCH_SYSTEM = `You extract the REAL product shown on a single product page, using the web_fetch tool on the URL provided (do not search — fetch the given URL directly). Rules:
- Extract only what the page actually shows: product name, brand, retailer, price, a direct product image URL, and any visible style/reference number.
- image_url must be a direct link to the product's photo on that page. If none is available, set it to null — never guess.
- Ground match_reason in the garment's stated attributes versus the product on the page.
- If the URL is not a real product page (404, unrelated), return an empty array [].

Respond with ONLY a JSON array (no prose, no markdown fences), with the single product (or its close variants). Each element:
{"product_name": string, "brand": string|null, "retailer": string|null, "price": string|null, "product_url": string|null, "image_url": string|null, "retailer_product_id": string|null, "match_reason": string}`;

export async function fetchProductUrl(
  url: string,
  signal: GarmentSignal,
): Promise<ProductCandidate[]> {
  const client = new Anthropic();
  const userText = `Fetch this product page and extract the product: ${url}
The garment (from the owner's own photo): ${signalLine(signal)}
Return the JSON array.`;
  const text = await runToolConversation(client, FETCH_SYSTEM, userText, [
    WEB_FETCH_TOOL,
  ]);
  // Ensure product_url falls back to the page the user pasted.
  return parseCandidates(text).map((c) => ({
    ...c,
    product_url: c.product_url ?? url,
  }));
}

const CARETAG_SYSTEM = `You read a garment care/brand/size label from a photo. Extract ONLY what is clearly legible. Rules:
- Never guess. If a field is not clearly readable in the image, return null for it — do not infer from style, logo shape, or context.
- brand: the brand/wordmark, only if the text is legible.
- size: the size marking (e.g. "M", "32", "EU 42"), only if legible.
- material: the fiber content if printed (e.g. "100% cotton"), only if legible.
- style_code: any style / reference / article number printed on the tag, only if legible.

Respond with ONLY a JSON object (no prose, no markdown fences):
{"brand": string|null, "size": string|null, "material": string|null, "style_code": string|null}`;

function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function readCareTag(imageBytes: Buffer): Promise<CareTagReading> {
  const working = await sharp(imageBytes)
    .rotate()
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();

  const client = new Anthropic();
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: CARETAG_SYSTEM,
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
            text: "Read this label. Respond with ONLY the JSON object.",
          },
        ],
      },
    ],
  });

  const text = resp.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  const o = extractJsonObject(text);
  if (!o) return { brand: null, size: null, material: null, style_code: null };
  return {
    brand: str(o.brand),
    size: str(o.size),
    material: str(o.material),
    style_code: str(o.style_code),
  };
}

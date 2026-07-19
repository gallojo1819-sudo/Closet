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
// max_uses trimmed 5 -> 3 on search to cut latency (each search runs code-based
// dynamic filtering that dominates the wall-clock).
const WEB_SEARCH_TOOL = {
  type: "web_search_20260209",
  name: "web_search",
  max_uses: 3,
};
const WEB_FETCH_TOOL = {
  type: "web_fetch_20260209",
  name: "web_fetch",
  max_uses: 2,
};

// Overall wall-clock budget for a single lookup (stage 1 search + stage 2 image
// resolves). Kept comfortably under the route's maxDuration (300s) so we fail
// cleanly with a real message instead of being killed mid-flight.
const LOOKUP_BUDGET_MS = 240_000;

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
  /** When image_url is null after stage 2, why — shown in the UI, never dropped. */
  image_note: string | null;
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
    image_note: null,
  };
}

function parseCandidates(text: string): ProductCandidate[] {
  const rawArr = extractJsonArray(text);
  const normalized = rawArr.map(normalizeCandidate);
  const kept = normalized.filter((c): c is ProductCandidate => c !== null);
  const dropped = normalized.length - kept.length;
  // [DIAG] why candidates survive or die.
  console.log(
    `[identify][DIAG] parseCandidates: extracted ${rawArr.length} raw array item(s); ` +
      `kept ${kept.length}, dropped ${dropped} (dropped = missing product_name).` +
      (rawArr.length === 0 ? " NO JSON ARRAY found in the model's final text." : ""),
  );
  return kept.slice(0, 5);
}

// [DIAG] Summarize each content block: text length, and — critically — whether
// each web_search_tool_result carried results or an error object.
function summarizeBlocks(content: readonly unknown[]): string {
  return content
    .map((raw) => {
      const b = raw as { type: string; text?: string; content?: unknown };
      if (b.type === "web_search_tool_result") {
        return Array.isArray(b.content)
          ? `web_search_result(${b.content.length} results)`
          : `web_search_result(ERROR ${JSON.stringify(b.content).slice(0, 200)})`;
      }
      if (b.type === "server_tool_use") return "server_tool_use(search query issued)";
      if (b.type === "text") return `text(${b.text?.length ?? 0} chars)`;
      return b.type;
    })
    .join(", ");
}

// Run a tool-enabled conversation to completion, resuming across pause_turn
// (the server-tool sampling loop can pause), and return the concatenated final
// text. Tools are cast loosely so an unknown-to-the-SDK tool type still compiles.
async function runToolConversation(
  client: Anthropic,
  system: string,
  userText: string,
  tools: unknown[],
  signal?: AbortSignal,
): Promise<string> {
  const base = {
    model: MODEL,
    max_tokens: 2048,
    system,
    tools: tools as unknown as Anthropic.ToolUnion[],
  };
  const opts = signal ? { signal } : undefined;
  let messages: Anthropic.MessageParam[] = [
    { role: "user", content: userText },
  ];
  const t0 = Date.now();
  let calls = 0;
  let resp = await client.messages.create({ ...base, messages }, opts);
  calls++;
  console.log(
    `[identify][DIAG] API call #${calls} took ${Date.now() - t0}ms — stop_reason=${resp.stop_reason}; ` +
      `blocks=[${summarizeBlocks(resp.content)}]; usage=${JSON.stringify(resp.usage)}`,
  );
  let guard = 0;
  while (resp.stop_reason === "pause_turn" && guard < 6) {
    messages = [
      ...messages,
      {
        role: "assistant",
        content: resp.content as unknown as Anthropic.ContentBlockParam[],
      },
    ];
    const t = Date.now();
    resp = await client.messages.create({ ...base, messages }, opts);
    calls++;
    console.log(
      `[identify][DIAG] API call #${calls} (pause_turn resume) took ${Date.now() - t}ms — ` +
        `stop_reason=${resp.stop_reason}; blocks=[${summarizeBlocks(resp.content)}]`,
    );
    guard++;
  }
  const text = resp.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  console.log(
    `[identify][DIAG] tool conversation DONE: ${calls} API call(s), ${Date.now() - t0}ms total, ` +
      `final stop_reason=${resp.stop_reason}, final text length=${text.length}`,
  );
  console.log(`[identify][DIAG] final text preview: ${JSON.stringify(text.slice(0, 500))}`);
  return text;
}

const SEARCH_SYSTEM = `You identify the REAL, currently- or recently-purchasable product that matches a single garment, using web search. Rules:
- Prefer the exact brand + reference/style number. Search official brand sites and major retailers first.
- Return ONLY genuine products you actually found in results — never invent a name, URL, or price.
- The single most important field is product_url: the exact product page for each candidate (official brand site preferred, then a major retailer). A follow-up step fetches the real product image from that page, so ALWAYS set image_url to null here and never guess an image.
- Ground each match_reason in the garment's stated attributes (color, pattern, material, cut) versus the candidate. Be specific.
- Older or sold-out pieces may have no findable live listing even with the exact code — that is expected. If you are not confident any result is the same product, return an empty array [].
- A wrong product is worse than none. When in doubt, return fewer candidates or none.

Respond with ONLY a JSON array (no prose, no markdown fences). 3-5 elements max, best match first. Each element:
{"product_name": string, "brand": string|null, "retailer": string|null, "price": string|null, "product_url": string|null, "image_url": null, "retailer_product_id": string|null, "match_reason": string}`;

// Stage 2: open ONE product page and pull its primary product image + price.
const IMAGE_SYSTEM = `You open a single product page with the web_fetch tool and extract the PRIMARY product image and price. Rules:
- Use web_fetch on the exact URL provided. Do NOT search.
- image_url must be the MAIN product photo — the hero product shot — as a direct link to an image file (jpg/png/webp/avif) actually present on the page (an og:image or the main gallery image is ideal). NOT a thumbnail, NOT a related/recommended product, NOT a logo, banner, or sprite.
- price: the product's current price as shown on the page, or null.
- If the page has no usable main product image (blocked, 404, or none present), set image_url null and briefly say why in "note". Never guess or fabricate an image URL.
Respond with ONLY a JSON object (no prose, no fences): {"image_url": string|null, "price": string|null, "note": string|null}`;

interface ImageResolution {
  image_url: string | null;
  price: string | null;
  note: string | null;
}

/** Stage 2 for one candidate — web_fetch its page and read the hero image + price. */
async function resolveProductImage(
  client: Anthropic,
  url: string,
  signal: AbortSignal,
): Promise<ImageResolution> {
  const t0 = Date.now();
  console.log(`[identify][DIAG] resolveProductImage START — url=${JSON.stringify(url)}`);
  let text: string;
  try {
    text = await runToolConversation(
      client,
      IMAGE_SYSTEM,
      `Fetch this product page and return the primary product image and price: ${url}`,
      [WEB_FETCH_TOOL],
      signal,
    );
  } catch (e) {
    // A budget abort must propagate and fail the whole lookup cleanly.
    if (signal.aborted) throw e;
    console.error(`[identify][DIAG] resolveProductImage error for ${url}:`, e);
    return { image_url: null, price: null, note: "Couldn't fetch the product page." };
  }
  const o = extractJsonObject(text);
  const image_url = o ? str(o.image_url) : null;
  const price = o ? str(o.price) : null;
  const note = o ? str(o.note) : null;
  console.log(
    `[identify][DIAG] resolveProductImage DONE in ${Date.now() - t0}ms — image=${!!image_url}, price=${!!price}`,
  );
  return {
    image_url,
    price,
    note: image_url ? null : note ?? "No product image found on the page.",
  };
}

// Resolve images for the top few candidates (rest stay image-null, ranked below).
const RESOLVE_TOP_N = 3;

export async function searchProducts(
  query: string,
  garment: GarmentSignal,
): Promise<ProductCandidate[]> {
  const client = new Anthropic();
  const controller = new AbortController();
  const budget = setTimeout(() => controller.abort(), LOOKUP_BUDGET_MS);
  const userText = `Find the product for this garment.
Search signal: ${query}
The garment (from the owner's own photo): ${signalLine(garment)}
Return the JSON array of candidates.`;
  console.log(
    `[identify][DIAG] searchProducts START — query=${JSON.stringify(query)}, signal="${signalLine(garment)}"`,
  );
  const t0 = Date.now();
  try {
    // ---- Stage 1: find candidate product pages ----
    const text = await runToolConversation(
      client,
      SEARCH_SYSTEM,
      userText,
      [WEB_SEARCH_TOOL],
      controller.signal,
    );
    const candidates = parseCandidates(text);

    // ---- Stage 2: fetch the real product image for the top few (in parallel) ----
    console.log(
      `[identify][DIAG] stage 2 — resolving images for up to ${RESOLVE_TOP_N} of ${candidates.length} candidate(s)`,
    );
    await Promise.all(
      candidates.slice(0, RESOLVE_TOP_N).map(async (c) => {
        if (!c.product_url) {
          c.image_note = "No product page to fetch an image from.";
          return;
        }
        const r = await resolveProductImage(client, c.product_url, controller.signal);
        if (r.image_url) {
          c.image_url = r.image_url;
          c.image_note = null;
          if (!c.price && r.price) c.price = r.price;
        } else {
          c.image_note = r.note;
        }
      }),
    );
    // A budget abort that was swallowed inside a resolve still fails cleanly here.
    if (controller.signal.aborted) {
      throw new Error("Product lookup timed out — try again, or paste the product URL.");
    }
    // Candidates we didn't try (lower-ranked): keep them, just note why no image.
    candidates.slice(RESOLVE_TOP_N).forEach((c) => {
      if (!c.image_url) c.image_note = "Lower-ranked — not checked for an image.";
    });

    // Rank resolved-image candidates first (stable within each group).
    const ranked = candidates
      .map((c, i) => ({ c, i }))
      .sort((a, b) => (a.c.image_url ? 0 : 1) - (b.c.image_url ? 0 : 1) || a.i - b.i)
      .map((x) => x.c);

    console.log(
      `[identify][DIAG] searchProducts DONE in ${Date.now() - t0}ms — ${ranked.length} candidate(s): ` +
        JSON.stringify(ranked.map((c) => ({ name: c.product_name, hasImage: !!c.image_url, note: c.image_note }))),
    );
    return ranked;
  } catch (e) {
    if (controller.signal.aborted) {
      console.error(`[identify][DIAG] searchProducts ABORTED (budget ${LOOKUP_BUDGET_MS}ms) after ${Date.now() - t0}ms`);
      throw new Error("Product lookup timed out — try again, or paste the product URL.");
    }
    throw e;
  } finally {
    clearTimeout(budget);
  }
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
  garment: GarmentSignal,
): Promise<ProductCandidate[]> {
  const client = new Anthropic();
  const controller = new AbortController();
  const budget = setTimeout(() => controller.abort(), LOOKUP_BUDGET_MS);
  const userText = `Fetch this product page and extract the product: ${url}
The garment (from the owner's own photo): ${signalLine(garment)}
Return the JSON array.`;
  console.log(`[identify][DIAG] fetchProductUrl START — url=${JSON.stringify(url)}`);
  const t0 = Date.now();
  try {
    // The URL method fetches the page directly, so the image comes back in one
    // step (no separate search stage). It's stage 2 without stage 1.
    const text = await runToolConversation(
      client,
      FETCH_SYSTEM,
      userText,
      [WEB_FETCH_TOOL],
      controller.signal,
    );
    const candidates = parseCandidates(text).map((c) => ({
      ...c,
      // Ensure product_url falls back to the page the user pasted.
      product_url: c.product_url ?? url,
      image_note: c.image_url ? null : "No product image found on that page.",
    }));
    console.log(
      `[identify][DIAG] fetchProductUrl DONE in ${Date.now() - t0}ms — ${candidates.length} candidate(s), ` +
        `withImage=${candidates.filter((c) => c.image_url).length}`,
    );
    return candidates;
  } catch (e) {
    if (controller.signal.aborted) {
      throw new Error("Product lookup timed out — try again.");
    }
    throw e;
  } finally {
    clearTimeout(budget);
  }
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

import { createServerFn } from "@tanstack/react-start";
import { lookMissing } from "./gaps";
import { livePool } from "./rack";
import { parseScanClass, type ScanClass, type ScanSlot } from "./scan";
import { defaultOccasion, HOUSE_LABEL, houseMixPenalty, lookHouses, momentOfDay, pickLook } from "./style";
import type { Category, Garment, Occasion } from "./types";

export type TagResult = {
  ok: true;
  name: string;
  category: Category;
  subtype: string;
  colors: string[];
  material: string;
  brand: string;
  fit: "slim" | "regular" | "relaxed";
  formality: 1 | 2 | 3 | 4 | 5;
  warmth: 1 | 2 | 3 | 4 | 5;
  tuck?: "in" | "out" | "either";
} | { ok: false; error: string };

type XaiResult = {
  ok: boolean;
  status: number;
  error: string;
  json: unknown;
};

function xaiErrorMessage(json: unknown, text: string, status: number): string {
  if (json && typeof json === "object") {
    const o = json as { error?: unknown; message?: unknown };
    if (typeof o.error === "string" && o.error.trim()) return o.error.trim();
    if (o.error && typeof o.error === "object") {
      const m = (o.error as { message?: unknown }).message;
      if (typeof m === "string" && m.trim()) return m.trim();
    }
    if (typeof o.message === "string" && o.message.trim()) return o.message.trim();
  }
  const t = text.replace(/\s+/g, " ").trim();
  if (t && t.length < 400 && !t.startsWith("<")) return t;
  return `xAI request failed (${status})`;
}

async function xaiFetch(url: string, body: unknown): Promise<XaiResult> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return { ok: false, status: 0, error: "Set XAI_API_KEY.", json: null };
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return {
    ok: res.ok,
    status: res.status,
    error: xaiErrorMessage(json, text, res.status),
    json,
  };
}

function imageUrlPart(url: string) {
  return { url, type: "image_url" as const };
}

const CATEGORY_SET = new Set([
  "top",
  "bottom",
  "outerwear",
  "dress",
  "footwear",
  "accessory",
  "other",
]);

export const tagGarment = createServerFn({ method: "POST" })
  .validator((input: { image: string; context?: string }) => input)
  .handler(async ({ data }): Promise<TagResult> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: "AI tagging is unavailable here." };

    const userContent: unknown[] = [
      { type: "image_url", image_url: { url: data.image } },
    ];
    if (data.context) {
      userContent.push({ type: "image_url", image_url: { url: data.context } });
    }
    userContent.push({
      type: "text",
      text:
        'Return ONLY JSON: {"name":"Brown suede mules","category":"top|bottom|outerwear|dress|footwear|accessory|other","subtype":"mules","colors":["brown"],"material":"suede","brand":"Giuseppe Zanotti","fit":"slim|regular|relaxed","formality":3,"warmth":2,"tuck":"in|out|either"}. Name the FIRST image like a closet label: color + garment (Navy oxford, Grey merino, Brown suede mules). A pair of shoes is footwear. Two trouser legs joined at a crotch is bottom. Fit from how it lies. If unsure, regular. tuck: oxford/shirttail/point collar = in; camp collar/straight hem/resort = out; polo/rugby/overshirt = either; omit if not a shirt. Name the GARMENT fabric color as worn, not the background. Navy is navy, not olive, not black, not charcoal. Maroon/burgundy is not brown. Light blue denim is light blue, not white. Loafers: the leather, not the sole. Return colors[] from this list only: navy, light blue, cream, white, ivory, khaki, beige, tan, camel, brown, chocolate, olive, forest, maroon, burgundy, wine, pink, blush, grey, charcoal, black, rust, gold.' +
        (data.context
          ? " The second image is only the page the garment came from — you may read a brand name from it (Axel Arigato, AMI), nothing else. Never name the garment after the shop or a page ID."
          : " Brand only if a label or logo is legible on the garment itself, else empty."),
    });

    const tagged = await xaiFetch("https://api.x.ai/v1/chat/completions", {
      model: "grok-4.5",
      max_tokens: 400,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "You tag ONE garment (or one pair of shoes) in the photo. Catalog voice. A pair of mules, loafers, or sneakers photographed from above is footwear — never pants. Read the insole/label brand if it is printed (Giuseppe Zanotti, Golden Goose, AMI). Never a filename. Never a shop name or page ID. Never invent a brand that is not visible. JSON only.",
        },
        { role: "user", content: userContent },
      ],
    });
    if (!tagged.ok) return { ok: false, error: tagged.error };
    const body = tagged.json as {
      choices?: { message?: { content?: string } }[];
    };
    const text = body.choices?.[0]?.message?.content ?? "";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < start) return { ok: false, error: "Could not read tag." };
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      const category = String(parsed.category ?? "other");
      const formality = Number(parsed.formality);
      const warmth = Number(parsed.warmth);
      const fitRaw = String(parsed.fit ?? "regular");
      const fit =
        fitRaw === "slim" || fitRaw === "relaxed" ? fitRaw : "regular";
      const tuckRaw = String(parsed.tuck ?? "");
      const tuck =
        tuckRaw === "in" || tuckRaw === "out" || tuckRaw === "either"
          ? tuckRaw
          : undefined;
      return {
        ok: true,
        name: String(parsed.name ?? "Garment").slice(0, 48),
        category: (CATEGORY_SET.has(category) ? category : "other") as Category,
        subtype: String(parsed.subtype ?? "").slice(0, 40),
        colors: Array.isArray(parsed.colors)
          ? parsed.colors.filter((c) => typeof c === "string").slice(0, 4)
          : [],
        material: String(parsed.material ?? "").slice(0, 32),
        brand: String(parsed.brand ?? "").slice(0, 40),
        fit,
        formality: (formality >= 1 && formality <= 5 ? formality : 3) as 1 | 2 | 3 | 4 | 5,
        warmth: (warmth >= 1 && warmth <= 5 ? warmth : 3) as 1 | 2 | 3 | 4 | 5,
        tuck,
      };
    } catch {
      return { ok: false, error: "Could not parse tag." };
    }
  });

type EditResult = { ok: true; image: string } | { ok: false; error: string };

async function imageFromEditJson(json: unknown): Promise<EditResult> {
  const body = json as { data?: { b64_json?: string; url?: string }[] };
  const first = body.data?.[0];
  if (first?.b64_json) return { ok: true, image: `data:image/png;base64,${first.b64_json}` };
  if (first?.url) {
    try {
      const img = await fetch(first.url);
      if (!img.ok) return { ok: false, error: "Could not download the edit." };
      const buf = Buffer.from(await img.arrayBuffer());
      const mime = img.headers.get("content-type") ?? "image/jpeg";
      return { ok: true, image: `data:${mime};base64,${buf.toString("base64")}` };
    } catch {
      return { ok: false, error: "Could not download the edit." };
    }
  }
  return { ok: false, error: "Edit came back empty." };
}

async function imagineEdit(prompt: string, url: string): Promise<EditResult> {
  if (!url) return { ok: false, error: "No image to edit." };
  const r = await xaiFetch("https://api.x.ai/v1/images/edits", {
    model: "grok-imagine-image-2.0",
    prompt,
    image: imageUrlPart(url),
  });
  if (!r.ok) return { ok: false, error: r.error };
  const got = await imageFromEditJson(r.json);
  if (!got.ok) return { ok: false, error: r.error || got.error };
  return got;
}

const STATUS_TTL = 60_000;
let statusMemo: { t: number; v: { print: boolean; chat: boolean } } | null = null;
let clientStatus: { t: number; v: { print: boolean; chat: boolean } } | null = null;

export const aiStatus = createServerFn({ method: "GET" }).handler(async () => {
  if (statusMemo && Date.now() - statusMemo.t < STATUS_TTL) return statusMemo.v;
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return { print: false, chat: false };
  let chat = false;
  let print = false;
  try {
    const res = await fetch("https://api.x.ai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const json = (await res.json()) as { data?: { id?: string }[] };
    const ids = (json.data ?? []).map((m) => m.id ?? "");
    chat = ids.some((id) => /grok-4/.test(id));
    print = ids.some((id) => /imagine/.test(id));
  } catch {
    /* ping below */
  }
  if (!chat) {
    const ping = await xaiFetch("https://api.x.ai/v1/chat/completions", {
      model: "grok-4.3",
      max_tokens: 1,
      messages: [{ role: "user", content: "ok" }],
    });
    chat = ping.ok;
  }
  const v = { print, chat };
  statusMemo = { t: Date.now(), v };
  return v;
});

/** Client cache — don’t RPC /v1/models on every tab. */
export async function readAiStatus(): Promise<{ print: boolean; chat: boolean }> {
  if (clientStatus && Date.now() - clientStatus.t < STATUS_TTL) return clientStatus.v;
  const v = await aiStatus();
  clientStatus = { t: Date.now(), v };
  return v;
}

export const printGarment = createServerFn({ method: "POST" })
  .validator((input: { image: string }) => input)
  .handler(async ({ data }): Promise<EditResult> => {
    if (!process.env.XAI_API_KEY) return { ok: false, error: "Set XAI_API_KEY for catalog covers." };
    return imagineEdit(
      "Product photograph of the SINGLE garment only. Keep the exact garment: color, fabric, stitching, hardware, logos, wear. Remove floor, walls, hangers, people, webpage chrome, prices, IDs, buttons, color swatches, text. Lay the garment (or pair of shoes) neatly on a solid #F4EFE6 paper, 4:5, garment filling ~80% of the frame, even light, no shadow theater. Do not invent a different item, brand, or color.",
      data.image,
    );
  });

const CLASSIFY_PROMPT =
  'Return ONLY JSON: {"kind":"skip|garment|worn","reason":"short","boxes":[{"name":"Polo","category":"top","x":0.2,"y":0.12,"w":0.55,"h":0.32}]}. ' +
  "skip: food, pizza, meal, receipt, landscape, document, screenshot chrome with no clothing product, meme, pet as the subject, nothing wearable. " +
  "garment: exactly ONE clothing item or one pair of shoes — product plate, floor or chair flat-lay, or a single hung piece. No person as the subject. boxes empty. " +
  "worn: a PERSON wearing clothes, OR 2+ distinct garments in one frame (laid look, rail, pile). Return 2-6 boxes. Each box is one garment: short chip name (Polo, Cords, Loafers), category top|bottom|outerwear|footwear|accessory, and x,y,w,h as fractions of the image (0-1). " +
  "NEVER a face, head, or the person as a box. NEVER invent shoes, white mules, or extras that are not clearly visible. If only ONE garment is clearly visible, kind=garment with no boxes — do not invent a second. Never \"Piece\".";

export type ClassifyScanResult =
  | ({ ok: true } & ScanClass)
  | { ok: false; error: string };

export const classifyScan = createServerFn({ method: "POST" })
  .validator((input: { image: string }) => input)
  .handler(async ({ data }): Promise<ClassifyScanResult> => {
    if (!process.env.XAI_API_KEY) {
      return { ok: true, kind: "garment", reason: "no-key", pieces: [], boxes: [] };
    }
    const userContent = [
      { type: "image_url", image_url: { url: data.image } },
      { type: "text", text: CLASSIFY_PROMPT },
    ];
    for (const model of ["grok-4.3", "grok-4.5", "grok-4"] as const) {
      const r = await xaiFetch("https://api.x.ai/v1/chat/completions", {
        model,
        max_tokens: 500,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You classify one photo for a clothes closet. JSON only. Never invent a garment that is not clearly in the photo. Never return a face or person as a box.",
          },
          { role: "user", content: userContent },
        ],
      });
      if (!r.ok) {
        if (r.status === 403 || r.status === 404 || r.status === 422) continue;
        return { ok: false, error: r.error };
      }
      const body = r.json as { choices?: { message?: { content?: string } }[] };
      const text = body.choices?.[0]?.message?.content ?? "";
      if (!text.trim()) continue;
      const parsed = parseScanClass(text);
      return { ok: true, ...parsed };
    }
    return { ok: false, error: "Could not classify." };
  });

export const extractGarment = createServerFn({ method: "POST" })
  .validator((input: { image: string; slot: ScanSlot | string; label: string }) => input)
  .handler(async ({ data }): Promise<EditResult> => {
    if (!process.env.XAI_API_KEY) {
      return { ok: false, error: "Set XAI_API_KEY to pull a garment off a look." };
    }
    const label = data.label.trim().slice(0, 80);
    const slot = String(data.slot ?? "").trim().slice(0, 24);
    if (!label) return { ok: false, error: "No garment to extract." };
    return imagineEdit(
      `Extract ONLY this one real garment from the photo: ${label} (${slot || "garment"}).
Product photograph of that SINGLE garment (or pair of shoes) laid neatly on solid #F4EFE6 paper, 4:5, filling ~80%.
Keep exact color, fabric, stitching, hardware, logos, wear.
No person, no face, no body, no mannequin, no other garments, no hangers, no room, no text.
Do not invent a garment that is not clearly visible. Do not invent white mules, white sneakers, or any shoes that are not in the photo.
If this piece is not clearly visible as its own item, leave the paper blank — do not substitute.`,
      data.image,
    );
  });

export const recolorCover = createServerFn({ method: "POST" })
  .validator((input: { image: string; color: string }) => input)
  .handler(async ({ data }): Promise<EditResult> => {
    if (!process.env.XAI_API_KEY) return { ok: false, error: "Set XAI_API_KEY to recolor a cover." };
    const color = data.color.trim();
    if (!color) return { ok: false, error: "Pick a color first." };
    return imagineEdit(
      `This is the SAME garment. Change ONLY the fabric color to ${color}.
Keep cut, stitching, pockets, hardware, wrinkles, logos. Do not turn pants into a shirt.
Lay on #F4EFE6 paper, 4:5, fill ~80%. No extra garments, no model, no text.`,
      data.image,
    );
  });

export const describeCover = createServerFn({ method: "POST" })
  .validator((input: { image: string; notes: string }) => input)
  .handler(async ({ data }): Promise<EditResult> => {
    if (!process.env.XAI_API_KEY) {
      return { ok: false, error: "Set XAI_API_KEY to match a cover." };
    }
    const notes = data.notes.trim();
    if (!notes) return { ok: false, error: "Describe the make first." };
    return imagineEdit(
      `This is the SAME garment. Use the photo for fabric color and corduroy texture ONLY.
Joe's notes WIN. He says: ${notes}
REMOVE drawstring ties, hanging cords, elastic cuff, and jogger hem. They must be gone.
DRAW a Gurkha: extended waistband, side tabs/buckles, no belt loops as the story, flat hem.
Same brown corduroy. One pair on #F4EFE6 paper, 4:5, fill ~80%. No model, no extra garments.
If you leave hanging ties, you failed.`,
      data.image,
    );
  });

export const onMePreview = createServerFn({ method: "POST" })
  .validator((input: { refImage: string; cutouts: string[]; pieces: string; tuck?: string }) => input)
  .handler(async ({ data }): Promise<EditResult> => {
    if (!process.env.XAI_API_KEY) return { ok: false, error: "Preview needs XAI_API_KEY on the server." };
    if (!data.refImage) return { ok: false, error: "No reference photo." };
    const prompt = `Image 1 is THIS man. Same face, hair, beard or none. Forbidden: stock campaign model, different man.
Images 2+ are the ONLY garments that exist. Wear exactly those plates — nothing else.
FORBIDDEN unless it is in images 2+: a white shirt, white mules, khaki oxford, extra shoes, a second pair of footwear, any invented knit.
If image 2 is a cream varsity, dress THAT cream varsity — not a khaki shirt.
One top, one bottom, one pair of shoes, optional one jacket from the plates. Never extra layers.
Do NOT copy elbow patches, arm stripes, a collar, a placket, or hardware from garment A onto garment B.
If no blazer/jacket image was sent, he is NOT wearing a blazer.
Keep his face, hair, beard or none, skin, 5′8 regular body. Hands EMPTY. Full-body editorial, plain studio #F4EFE6. No text.
${data.pieces}
${data.tuck ?? ""}`;
    const urls = [data.refImage, ...data.cutouts.slice(0, 4)].filter(Boolean);
    const images = urls.map(imageUrlPart);
    let r = await xaiFetch("https://api.x.ai/v1/images/edits", {
      model: "grok-imagine-image-2.0",
      prompt,
      images,
    });
    if (!r.ok && r.status === 422) {
      r = await xaiFetch("https://api.x.ai/v1/images/edits", {
        model: "grok-imagine-image-2.0",
        prompt,
        images: urls,
      });
    }
    if (!r.ok) return { ok: false, error: r.error };
    const got = await imageFromEditJson(r.json);
    if (!got.ok) return { ok: false, error: r.error || got.error };
    return got;
  });

function occasionFromPrompt(prompt: string): Occasion {
  const p = prompt.toLowerCase();
  if (/client|dinner|\bout\b/.test(p)) return "out";
  if (/comfy|couch|at home|off duty/.test(p)) return "comfy";
  if (/saturday|weekend/.test(p)) return "weekend";
  if (/travel/.test(p)) return "travel";
  if (/weekday|work|office/.test(p)) return "weekday";
  return defaultOccasion();
}

export function parseLookLine(text: string, valid: Set<string>): string[] {
  const m = text.match(/LOOK:\s*([^\n]+)/i);
  if (!m?.[1]) return [];
  return m[1]
    .split(/[,|\s]+/)
    .map((id) => id.trim())
    .filter((id) => id && valid.has(id));
}

function resolveStylistLook(
  garments: Garment[],
  prompt: string,
  f: number,
  grokText?: string,
): { text: string; garmentIds: string[]; occasion: Occasion } {
  const occasion = occasionFromPrompt(prompt);
  const skip = /skip/.test(prompt.toLowerCase());
  const valid = new Set(garments.map((g) => g.id));
  let ids = grokText ? parseLookLine(grokText, valid) : [];
  let pieces = ids
    .map((id) => garments.find((g) => g.id === id))
    .filter((g): g is Garment => Boolean(g));
  if (ids.length < 2 || houseMixPenalty(pieces) < -8) {
    ids = pickLook(garments, {
      occasion,
      moment: momentOfDay(),
      weather: { f, label: "Fair", code: 2 },
      recentWorn: skip ? [] : undefined,
    });
    pieces = ids
      .map((id) => garments.find((g) => g.id === id))
      .filter((g): g is Garment => Boolean(g));
  }
  const houses = lookHouses(pieces)
    .slice(0, 2)
    .map((h) => HOUSE_LABEL[h])
    .join(" × ");
  const line = houses ? `${houses} — ${occasion} ${f}°` : `${occasion} ${f}°`;
  const names = pieces.map((g) => g.name).join("\n");
  let stripped = grokText
    ? grokText.replace(/\n?LOOK:\s*[^\n]+/i, "").trim()
    : "";
  const hole = lookMissing(pieces, garments);
  const missing = hole
    ? `MISSING: ${hole.title.toLowerCase()} — ${hole.finishes}`
    : "";
  if (stripped && missing && !/MISSING:/i.test(stripped)) {
    stripped = `${stripped}\n${missing}`;
  }
  const text = stripped
    ? stripped
    : `${line}\n${names}${missing ? `\n${missing}` : ""}`;
  return { text, garmentIds: ids, occasion };
}

const CHAT_MODELS = ["grok-4.5", "grok-4.3", "grok-4"] as const;

const STYLIST_SYSTEM = `You are Joe's master stylist. HIS houses only. Never invent a piece, layer, or shop.

HOUSES (tight)
- Ralph: oxford, polo, chino, cable, navy blazer, loafer. Clean tuck. No graphic hoodie.
- ALD: rugby, oversized oxford, jean, 990 or loafer, graphic hoodie ONLY with jean/sneaker.
- Faloni / Italian summer: linen, camp collar, light trouser, mule/loafer, no-show. Heat.
- Italian winter: merino, flannel, cashmere, suede, overcoat.
- FiveFourFive: linen, sangallo, light cashmere, tailored.
- Sweet Stable: fair isle, gingham, cord, rugby. Not under a 90s hoodie.

Never put a 90s hoodie with pleated trousers and loafers. Hoodie is not a coat.

FORMAT
Line 1: {House} × {House} — {occasion} {temp}°
Then 2–5 lines: HIS exact names.
Then MISSING: one hole if the look would be better with a type he does not own (e.g. "MISSING: white oxford — under the cream cable"). Omit MISSING if the look is complete from this closet.
Last line MUST be exactly:
LOOK: g_xxx,g_yyy,g_zzz
IDs from the closet list only, in order top, bottom, footwear (outer optional). Never invent an id.
Voice: quiet, sure, no emoji, no lecture. Pixels beat names. No invented layers.`;

export const askStylist = createServerFn({ method: "POST" })
  .validator(
    (input: {
      prompt: string;
      closet: string;
      context?: string;
      garments?: Garment[];
      weatherF?: number;
    }) => input,
  )
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; text: string; garmentIds: string[]; occasion: Occasion }
      | { ok: false; error: string }
    > => {
    const rack = livePool(data.garments ?? []);
    const f = data.weatherF ?? 68;
    const fallback = () =>
      rack.length
        ? { ok: true as const, ...resolveStylistLook(rack, data.prompt, f) }
        : { ok: false as const, error: "The stylist has nothing to dress." };

    if (!process.env.XAI_API_KEY) return fallback();

    const messages = [
      {
        role: "system",
        content: `${STYLIST_SYSTEM}

${data.context ? `TODAY\n${data.context}\n` : ""}
CLOSET
${data.closet.slice(0, 6000)}`,
      },
      { role: "user", content: data.prompt.slice(0, 1200) },
    ];

    for (const model of CHAT_MODELS) {
      const r = await xaiFetch("https://api.x.ai/v1/chat/completions", {
        model,
        max_tokens: 400,
        temperature: 0.4,
        messages,
      });
      if (r.ok) {
        const body = r.json as { choices?: { message?: { content?: string } }[] };
        const text = body.choices?.[0]?.message?.content ?? "";
        if (text.trim() && rack.length) {
          return { ok: true, ...resolveStylistLook(rack, data.prompt, f, text) };
        }
        if (text.trim()) return { ok: true, text, garmentIds: [], occasion: occasionFromPrompt(data.prompt) };
      }
      if (r.status !== 403 && r.status !== 404 && r.status !== 422) {
        return fallback();
      }
    }
    return fallback();
  });

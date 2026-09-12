import { createServerFn } from "@tanstack/react-start";
import { defaultOccasion, HOUSE_LABEL, lookHouses, momentOfDay, pickLook } from "./style";
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
        'Return ONLY JSON: {"name":"Brown suede mules","category":"top|bottom|outerwear|dress|footwear|accessory|other","subtype":"mules","colors":["brown"],"material":"suede","brand":"Giuseppe Zanotti","fit":"slim|regular|relaxed","formality":3,"warmth":2}. Name the FIRST image like a closet label: color + garment (Navy oxford, Grey merino, Brown suede mules). A pair of shoes is footwear. Two trouser legs joined at a crotch is bottom. Fit from how it lies. If unsure, regular. Name the GARMENT fabric color as worn, not the background. Navy is navy, not olive, not black, not charcoal. Maroon/burgundy is not brown. Light blue denim is light blue, not white. Loafers: the leather, not the sole. Return colors[] from this list only: navy, light blue, cream, white, ivory, khaki, beige, tan, camel, brown, chocolate, olive, forest, maroon, burgundy, wine, pink, blush, grey, charcoal, black, rust, gold.' +
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

async function imagineEdit(prompt: string, urls: string[]): Promise<EditResult> {
  const all = urls.filter(Boolean).slice(0, 5);
  if (!all.length) return { ok: false, error: "No image to edit." };
  const first = all[0]!;
  const parts = all.map(imageUrlPart);
  let r = await xaiFetch("https://api.x.ai/v1/images/edits", {
    model: "grok-imagine-image-2.0",
    prompt,
    image: imageUrlPart(first),
    images: parts,
  });
  if (!r.ok && (r.status === 403 || r.status === 422)) {
    r = await xaiFetch("https://api.x.ai/v1/images/edits", {
      model: "grok-imagine-image-2.0",
      prompt,
      image: parts,
    });
  }
  if (!r.ok) return { ok: false, error: r.error };
  return imageFromEditJson(r.json);
}

export const aiStatus = createServerFn({ method: "GET" }).handler(async () => {
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
  return { print, chat };
});

export const printGarment = createServerFn({ method: "POST" })
  .validator((input: { image: string }) => input)
  .handler(async ({ data }): Promise<EditResult> => {
    if (!process.env.XAI_API_KEY) return { ok: false, error: "Set XAI_API_KEY for catalog covers." };
    return imagineEdit(
      "Product photograph of the SINGLE garment only. Keep the exact garment: color, fabric, stitching, hardware, logos, wear. Remove floor, walls, hangers, people, webpage chrome, prices, IDs, buttons, color swatches, text. Lay the garment (or pair of shoes) neatly on a solid #F4EFE6 paper, 4:5, garment filling ~80% of the frame, even light, no shadow theater. Do not invent a different item, brand, or color.",
      [data.image],
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
      [data.image],
    );
  });

export const onMePreview = createServerFn({ method: "POST" })
  .validator((input: { refImage: string; cutouts: string[]; pieces: string }) => input)
  .handler(async ({ data }): Promise<EditResult> => {
    if (!process.env.XAI_API_KEY) return { ok: false, error: "Preview needs XAI_API_KEY on the server." };
    const urls = [data.refImage, ...data.cutouts.slice(0, 4)];
    return imagineEdit(
      `Image 1 is THIS man — the only person. Keep his face, hair, beard or none, skin, 5′8 regular body.
Hands EMPTY. No phone, no camera, no selfie pose, no screen.
Full-body editorial, standing, both arms relaxed, plain studio #F4EFE6 or light grey. No text, no logo invented.
Images 2+ are the EXACT garments. Put ONLY those on him. Do not add a shirt under a sweater, a belt, a watch, or a second shoe unless that piece is one of the images.
If a knit is in the look and no shirt image was sent, the knit is the only top — no invented oxford.
${data.pieces}`,
      urls,
    );
  });

function occasionFromPrompt(prompt: string): Occasion {
  const p = prompt.toLowerCase();
  if (/client/.test(p)) return "client";
  if (/dinner/.test(p)) return "dinner";
  if (/saturday|weekend/.test(p)) return "weekend";
  if (/travel/.test(p)) return "travel";
  return defaultOccasion();
}

function localStylistLook(
  garments: Garment[],
  prompt: string,
  f: number,
): string {
  const occasion = occasionFromPrompt(prompt);
  const skip = /skip/.test(prompt.toLowerCase());
  const ids = pickLook(garments, {
    occasion,
    moment: momentOfDay(),
    weather: { f, label: "Fair", code: 2 },
    recentWorn: skip ? [] : undefined,
  });
  const pieces = ids
    .map((id) => garments.find((g) => g.id === id))
    .filter((g): g is Garment => Boolean(g));
  const houses = lookHouses(pieces)
    .slice(0, 2)
    .map((h) => HOUSE_LABEL[h])
    .join(" × ");
  const line = houses ? `${houses} — ${occasion} ${f}°` : `${occasion} ${f}°`;
  const bullets = pieces.map((g) => `• ${g.name}`).join("\n");
  return `${line}\n${bullets}\n(Grok was blocked — this is from your rack.)`;
}

const CHAT_MODELS = ["grok-4.5", "grok-4.3", "grok-4"] as const;

const STYLIST_SYSTEM = `You are Joe's designer. HIS garments only. Never invent a piece, layer, or shop.

HOUSES (mix when honest, never costume)
- Ralph: oxford, polo, chino, navy, cable, loafer, blazer. Formality 3–4.
- ALD: rugby, oversized oxford, relaxed jean, Yankees/cap, 990 or loafer, earth/navy/cream. Formality 2–3. High-low ok.
- Faloni / Italian summer: linen, silk-cotton, light trouser, loafer no-show. Warmth ≤2. Prefer above 75°F.
- Italian winter: cashmere, flannel, merino, suede, overcoat. Below 55°F.
- FiveFourFive: linen, sangallo, light cashmere, tailored short, Italian street-luxury. Weekend/travel.
- Sweet Stable: rugby, gingham, cord, horse/equestrian, ski-prep. Weekend.

FORMAT
Line 1 only: {House} × {House} — {occasion} {temp}°
Example: Ralph × Faloni — weekday 77°
Then 2–5 short lines naming closet pieces by exact name. No lecture. No emoji. Pixels beat names. No invented oxford under a knit.`;

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
  .handler(async ({ data }): Promise<{ ok: true; text: string } | { ok: false; error: string }> => {
    const rack = (data.garments ?? []).filter((g) => !g.archived);
    const f = data.weatherF ?? 68;
    const fallback = () =>
      rack.length
        ? { ok: true as const, text: localStylistLook(rack, data.prompt, f) }
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
        if (text.trim()) return { ok: true, text };
      }
      if (r.status !== 403 && r.status !== 404 && r.status !== 422) {
        return fallback();
      }
    }
    return fallback();
  });

import { createServerFn } from "@tanstack/react-start";
import type { Category } from "./types";

export type TagResult = {
  ok: true;
  name: string;
  category: Category;
  subtype: string;
  colors: string[];
  material: string;
  fit: "slim" | "regular" | "relaxed";
  formality: 1 | 2 | 3 | 4 | 5;
  warmth: 1 | 2 | 3 | 4 | 5;
} | { ok: false; error: string };

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
  .validator((input: { image: string }) => input)
  .handler(async ({ data }): Promise<TagResult> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: "AI tagging is unavailable here." };

    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 400,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content:
              "You tag ONE garment in the photo. Catalog voice. Never a filename (no IMG_0930). Never invent a brand. JSON only.",
          },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: data.image } },
              {
                type: "text",
                text: 'Return ONLY JSON: {"name":"Khaki chinos","category":"top|bottom|outerwear|dress|footwear|accessory|other","subtype":"chinos","colors":["khaki"],"material":"cotton","fit":"slim|regular|relaxed","formality":3,"warmth":2}. Name like a closet label: color + garment (Navy oxford, Grey merino, White sneakers). Fit from how it lies. If unsure, regular.',
              },
            ],
          },
        ],
      }),
    });
    if (!res.ok) return { ok: false, error: `Tag failed (${res.status})` };
    const body = (await res.json()) as {
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
        fit,
        formality: (formality >= 1 && formality <= 5 ? formality : 3) as 1 | 2 | 3 | 4 | 5,
        warmth: (warmth >= 1 && warmth <= 5 ? warmth : 3) as 1 | 2 | 3 | 4 | 5,
      };
    } catch {
      return { ok: false, error: "Could not parse tag." };
    }
  });

type EditResult = { ok: true; image: string } | { ok: false; error: string };

async function readEditedImage(res: Response): Promise<EditResult> {
  if (!res.ok) return { ok: false, error: `Edit failed (${res.status})` };
  const body = (await res.json()) as {
    data?: { b64_json?: string; url?: string }[];
  };
  const first = body.data?.[0];
  if (first?.b64_json) return { ok: true, image: `data:image/png;base64,${first.b64_json}` };
  if (first?.url) {
    // The imgen URL is temporary and not CORS-open — pull the pixels
    // server-side and hand back a data URL.
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

export const aiStatus = createServerFn({ method: "GET" }).handler(async () => ({
  /** Catalog prints + on-me previews need the xAI key server-side. */
  print: Boolean(process.env.XAI_API_KEY),
}));

export const printGarment = createServerFn({ method: "POST" })
  .validator((input: { image: string }) => input)
  .handler(async ({ data }): Promise<EditResult> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: "Set XAI_API_KEY for catalog prints." };
    const res = await fetch("https://api.x.ai/v1/images/edits", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-imagine-image-2.0",
        image: { url: data.image },
        prompt:
          "Catalog product photo of the SINGLE garment in this image. If this is a screenshot of a shopping page or order email (prices, buttons, color dots, text, navigation), extract ONLY the garment — never frame the webpage. Keep the exact color, fabric, stitching, hardware, and wear. Remove the floor, wall, hanger, hands, and any room. Lay the garment flat on a warm paper background (#F4EFE6), 4:5 portrait, filling about 80% of the frame. Do not replace or invent clothing.",
      }),
    });
    return readEditedImage(res);
  });

export const onMePreview = createServerFn({ method: "POST" })
  .validator((input: { refImage: string; cutouts: string[]; pieces: string }) => input)
  .handler(async ({ data }): Promise<{ ok: true; image: string } | { ok: false; error: string }> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: "Preview needs XAI_API_KEY on the server." };

    const res = await fetch("https://api.x.ai/v1/images/edits", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-imagine-image-2.0",
        // Joe's reference first, then the actual cutouts of this look (max 4).
        images: [{ url: data.refImage }, ...data.cutouts.slice(0, 4).map((c) => ({ url: c }))],
        prompt: `Dress THIS man — the man in the first image, same face, same 5'8 regular build — in THESE exact garments from the following images: ${data.pieces}. Editorial full-body photograph on plain warm paper. Do not invent clothing, logos, or colors. If a piece is unclear, omit it. No text.`,
      }),
    });
    return readEditedImage(res);
  });

export const askStylist = createServerFn({ method: "POST" })
  .validator((input: { prompt: string; closet: string; context?: string }) => input)
  .handler(async ({ data }): Promise<{ ok: true; text: string } | { ok: false; error: string }> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: "The stylist is unavailable in this environment." };

    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 800,
        temperature: 0.45,
        messages: [
          {
            role: "system",
            content: `You are Joe's personal designer. One man, three houses, mixed — never costume, never a generated garment.

HOUSES
- Ralph Lauren: oxford, polo, navy, khaki, loafers. American prep. No logo dump.
- Italian: merino, camel, trousers, loafers, ease. Tailored, not stiff.
- Street: sneakers, denim, tee, overshirt. Real, not a lookbook drop.

RULES
1. Name only pieces in CLOSET, by their exact name.
2. Never invent a garment, color, brand, or silhouette he does not own.
3. Dress for the given NYC weather, date, time, and occasion.
4. Prefer pieces that have been sitting. He wants to wear what he already owns.
5. Mix houses in one look when it is honest (polo + raw denim + loafers beats a costume).
6. If the closet cannot do the brief, name the gap. Do not shop-invent.
7. Short. Decisive. No emoji.

${data.context ? `TODAY\n${data.context}\n` : ""}
CLOSET
${data.closet.slice(0, 6000)}`,
          },
          { role: "user", content: data.prompt.slice(0, 1200) },
        ],
      }),
    });
    if (!res.ok) return { ok: false, error: `Stylist failed (${res.status})` };
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return { ok: true, text: body.choices?.[0]?.message?.content ?? "" };
  });

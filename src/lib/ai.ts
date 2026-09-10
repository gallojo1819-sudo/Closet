import { createServerFn } from "@tanstack/react-start";
import type { Category } from "./types";

export type TagResult = {
  ok: true;
  name: string;
  category: Category;
  subtype: string;
  colors: string[];
  material: string;
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
              "You tag a single clothing item from a photo. Name only what is visible in THIS picture. Never invent a different garment, color, or brand. JSON only.",
          },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: data.image } },
              {
                type: "text",
                text: 'Return ONLY JSON: {"name":"short catalog name","category":"top|bottom|outerwear|dress|footwear|accessory|other","subtype":"oxford shirt","colors":["navy"],"material":"cotton","formality":1-5,"warmth":1-5}',
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
      return {
        ok: true,
        name: String(parsed.name ?? "Garment").slice(0, 48),
        category: (CATEGORY_SET.has(category) ? category : "other") as Category,
        subtype: String(parsed.subtype ?? "").slice(0, 40),
        colors: Array.isArray(parsed.colors)
          ? parsed.colors.filter((c) => typeof c === "string").slice(0, 4)
          : [],
        material: String(parsed.material ?? "").slice(0, 32),
        formality: (formality >= 1 && formality <= 5 ? formality : 3) as 1 | 2 | 3 | 4 | 5,
        warmth: (warmth >= 1 && warmth <= 5 ? warmth : 3) as 1 | 2 | 3 | 4 | 5,
      };
    } catch {
      return { ok: false, error: "Could not parse tag." };
    }
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

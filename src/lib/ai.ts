import { createServerFn } from "@tanstack/react-start";
import type { Category } from "./types";

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
        'Return ONLY JSON: {"name":"Brown suede mules","category":"top|bottom|outerwear|dress|footwear|accessory|other","subtype":"mules","colors":["brown"],"material":"suede","brand":"Giuseppe Zanotti","fit":"slim|regular|relaxed","formality":3,"warmth":2}. Name the FIRST image like a closet label: color + garment (Navy oxford, Grey merino, Brown suede mules). A pair of shoes is footwear. Two trouser legs joined at a crotch is bottom. Fit from how it lies. If unsure, regular.' +
        (data.context
          ? " The second image is only the page the garment came from — you may read a brand name from it (Axel Arigato, AMI), nothing else. Never name the garment after the shop or a page ID."
          : " Brand only if a label or logo is legible on the garment itself, else empty."),
    });

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
              "You tag ONE garment (or one pair of shoes) in the photo. Catalog voice. A pair of mules, loafers, or sneakers photographed from above is footwear — never pants. Read the insole/label brand if it is printed (Giuseppe Zanotti, Golden Goose, AMI). Never a filename. Never a shop name or page ID. Never invent a brand that is not visible. JSON only.",
          },
          { role: "user", content: userContent },
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
    if (!apiKey) return { ok: false, error: "Set XAI_API_KEY for catalog covers." };
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
          "Product photograph of the SINGLE garment only. Keep the exact garment: color, fabric, stitching, hardware, logos, wear. Remove floor, walls, hangers, people, webpage chrome, prices, IDs, buttons, color swatches, text. Lay the garment (or pair of shoes) neatly on a solid #F4EFE6 paper, 4:5, garment filling ~80% of the frame, even light, no shadow theater. Do not invent a different item, brand, or color.",
      }),
    });
    return readEditedImage(res);
  });

export const recolorCover = createServerFn({ method: "POST" })
  .validator((input: { image: string; color: string }) => input)
  .handler(async ({ data }): Promise<EditResult> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: "Set XAI_API_KEY to recolor a cover." };
    const color = data.color.trim();
    if (!color) return { ok: false, error: "Pick a color first." };
    const res = await fetch("https://api.x.ai/v1/images/edits", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-imagine-image-2.0",
        image: { url: data.image },
        prompt: `This is the SAME garment. Change ONLY the fabric color to ${color}.
Keep cut, stitching, pockets, hardware, wrinkles, logos. Do not turn pants into a shirt.
Lay on #F4EFE6 paper, 4:5, fill ~80%. No extra garments, no model, no text.`,
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
        // Image 1 is always Joe (idb:me:ref). Images 2+ are this look's cutouts.
        images: [{ url: data.refImage }, ...data.cutouts.slice(0, 4).map((c) => ({ url: c }))],
        prompt: `Image 1 is THIS man — the only person. Keep his face, hair, beard or none, skin, 5′8 regular body.
Hands EMPTY. No phone, no camera, no selfie pose, no screen.
Full-body editorial, standing, both arms relaxed, plain studio #F4EFE6 or light grey. No text, no logo invented.
Images 2+ are the EXACT garments. Put ONLY those on him. Do not add a shirt under a sweater, a belt, a watch, or a second shoe unless that piece is one of the images.
If a knit is in the look and no shirt image was sent, the knit is the only top — no invented oxford.
${data.pieces}`,
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

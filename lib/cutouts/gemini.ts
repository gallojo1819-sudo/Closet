import "server-only";
import { GoogleGenAI, Modality, type Part } from "@google/genai";

// Image generation via Gemini. GEMINI_API_KEY is server-only.
const MODEL = "gemini-3.1-flash-image";

export interface RefImage {
  mimeType: string;
  /** base64-encoded bytes */
  data: string;
}

export function toRefImage(buf: Buffer, mimeType = "image/png"): RefImage {
  return { mimeType, data: buf.toString("base64") };
}

/**
 * Generate an image from a text prompt plus one or more reference images.
 * Returns the first inline image the model emits, as a Buffer. Throws if the
 * model returns no image (treated as a failed attempt by the worker).
 */
export async function generateImage(
  text: string,
  images: RefImage[],
): Promise<Buffer> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const ai = new GoogleGenAI({ apiKey });

  const parts: Part[] = [
    { text },
    ...images.map((im) => ({
      inlineData: { mimeType: im.mimeType, data: im.data },
    })),
  ];

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts }],
    config: { responseModalities: [Modality.IMAGE] },
  });

  const out = response.candidates?.[0]?.content?.parts ?? [];
  for (const p of out) {
    const data = p.inlineData?.data;
    if (data) return Buffer.from(data, "base64");
  }
  throw new Error("Gemini returned no image");
}

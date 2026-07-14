// One-off Gemini probe. Runs the EXACT model + config our worker uses against a
// synthetic reference image, and dumps the raw response shape. No DB needed.
// Run: node --env-file=.env.local diag/gemini-probe.mjs
import { GoogleGenAI, Modality } from "@google/genai";
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const MODEL = "gemini-3.1-flash-image";

function line() {
  console.log("-".repeat(60));
}

const key = process.env.GEMINI_API_KEY;
console.log("GEMINI_API_KEY present:", Boolean(key), "prefix:", key ? key.slice(0, 4) : "(none)", "len:", key ? key.length : 0);
line();

// Build a synthetic reference: gray canvas with a brown block (stand-in garment).
const block = await sharp({
  create: { width: 300, height: 420, channels: 3, background: { r: 120, g: 80, b: 60 } },
}).png().toBuffer();
const reference = await sharp({
  create: { width: 1200, height: 1200, channels: 3, background: { r: 220, g: 220, b: 220 } },
})
  .composite([{ input: block, gravity: "center" }])
  .png()
  .toBuffer();
writeFileSync("diag/ref.png", reference);
console.log("wrote diag/ref.png (", reference.length, "bytes )");
line();

const prompt = [
  "Asset type: transparent ecommerce clothing catalog cutout on a removable chroma key.",
  "Reconstruct ONLY the complete empty jacket as a clean front-view ecommerce catalog product photograph. Remove any wearer, body, and scene.",
  "Background: perfectly flat, absolutely uniform solid #00ff00 edge-to-edge.",
  "Composition: square canvas, centered, generous even padding, no cropping.",
].join("\n\n");

const ai = new GoogleGenAI({ apiKey: key });

const parts = [
  { text: prompt },
  { inlineData: { mimeType: "image/png", data: reference.toString("base64") } },
];

async function attempt(label, config) {
  line();
  console.log(`ATTEMPT: ${label}`);
  console.log("config:", JSON.stringify(config));
  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts }],
      ...(config ? { config } : {}),
    });
    console.log("OK — top-level response keys:", Object.keys(response));
    console.log("promptFeedback:", JSON.stringify(response.promptFeedback ?? null));
    const cands = response.candidates ?? [];
    console.log("candidates.length:", cands.length);
    if (cands[0]) {
      console.log("candidates[0].finishReason:", cands[0].finishReason);
      console.log("candidates[0].safetyRatings:", JSON.stringify(cands[0].safetyRatings ?? null));
      const cparts = cands[0].content?.parts ?? [];
      console.log("candidates[0].content.parts.length:", cparts.length);
      cparts.forEach((p, i) => {
        const kind = p.inlineData ? "inlineData" : p.text ? "text" : Object.keys(p).join(",");
        if (p.inlineData) {
          const bytes = Buffer.from(p.inlineData.data ?? "", "base64");
          console.log(`  part[${i}] inlineData mime=${p.inlineData.mimeType} bytes=${bytes.length}`);
          const ext = (p.inlineData.mimeType || "image/png").split("/")[1] || "png";
          const fn = `diag/gen-${label.replace(/\W+/g, "_")}-${i}.${ext}`;
          writeFileSync(fn, bytes);
          console.log(`  -> saved ${fn}`);
        } else if (p.text) {
          console.log(`  part[${i}] text: ${JSON.stringify(p.text).slice(0, 400)}`);
        } else {
          console.log(`  part[${i}] other keys: ${kind}`);
        }
      });
    }
  } catch (e) {
    console.log("THREW:", e?.constructor?.name);
    console.log("message:", e?.message);
    if (e?.status) console.log("status:", e.status);
    // Google SDK often nests the HTTP body here:
    for (const k of ["response", "error", "cause", "statusText", "code"]) {
      if (e && e[k] !== undefined) {
        try { console.log(`${k}:`, typeof e[k] === "object" ? JSON.stringify(e[k]).slice(0, 800) : e[k]); }
        catch { console.log(`${k}: <unserializable>`); }
      }
    }
  }
}

// Exactly what the worker sends today:
await attempt("worker-config (responseModalities=[IMAGE])", { responseModalities: [Modality.IMAGE] });
// Diagnostic comparison — do NOT treat as a fix, just to localize the cause:
await attempt("no-config", null);
await attempt("modalities=[IMAGE,TEXT]", { responseModalities: [Modality.IMAGE, Modality.TEXT] });

line();
console.log("done");

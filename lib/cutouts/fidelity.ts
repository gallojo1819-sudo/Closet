import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";

// Claude-vision gates around the generation route:
//   - judgeEvidence:  is the reference crop good enough to reconstruct from?
//   - judgeFidelity:  does the finished cutout match MY source garment, or did
//                     the model invent something?
//
// Discipline in both prompts: judge ONLY visible source evidence, and when
// uncertain reject. False rejection is cheap; false acceptance corrupts the
// closet. Any parse failure is therefore treated as the rejecting verdict.

const MODEL = "claude-sonnet-4-6";

export interface Evidence {
  sufficient: boolean;
  reason: string;
}

export interface Fidelity {
  same_garment: boolean;
  color_match: boolean;
  pattern_match: boolean;
  construction_match: boolean;
  invented_elements: string[];
  missing_elements: string[];
  verdict: "faithful" | "minor_drift" | "fabricated";
  reason: string;
}

type Img = { b64: string; media: "image/jpeg" };

async function toJpegB64(buf: Buffer, over?: [number, number, number]): Promise<string> {
  // Composite over a neutral background if requested (so a transparent cutout
  // is actually visible to the model).
  let img = sharp(buf);
  if (over) {
    const fitted = await sharp(buf)
      .resize(1000, 1000, { fit: "inside", withoutEnlargement: true })
      .toBuffer();
    img = sharp({
      create: { width: 1024, height: 1024, channels: 3, background: { r: over[0], g: over[1], b: over[2] } },
    }).composite([{ input: fitted, gravity: "center" }]);
  } else {
    img = img.resize(1024, 1024, { fit: "inside", withoutEnlargement: true });
  }
  return (await img.jpeg({ quality: 85 }).toBuffer()).toString("base64");
}

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

async function ask(system: string, images: Img[], text: string): Promise<string> {
  const client = new Anthropic();
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    messages: [
      {
        role: "user",
        content: [
          ...images.map((im) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: im.media, data: im.b64 },
          })),
          { type: "text" as const, text },
        ],
      },
    ],
  });
  return resp.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

const EVIDENCE_SYSTEM =
  "You assess whether a reference photo of a single clothing item is good enough to reconstruct that exact item as a catalog cutout. Judge only what is visible. Be strict: if the item is mostly hidden, out of focus, or its category/construction can't be read, it is NOT sufficient.";

export async function judgeEvidence(referenceCrop: Buffer): Promise<Evidence> {
  const b64 = await toJpegB64(referenceCrop);
  const out = await ask(
    EVIDENCE_SYSTEM,
    [{ b64, media: "image/jpeg" }],
    'Is this ONE garment substantially visible (roughly >60% unoccluded), with its category and defining construction readable, and in focus? Respond with ONLY JSON: {"sufficient": boolean, "reason": "one short line"}.',
  );
  const o = extractJsonObject(out);
  if (!o || typeof o.sufficient !== "boolean") {
    return { sufficient: false, reason: "could not assess evidence" };
  }
  return { sufficient: o.sufficient, reason: String(o.reason ?? "") };
}

const FIDELITY_SYSTEM =
  "You compare a generated clothing cutout against the source photograph of the real garment. Your job is to catch fabrication. Judge ONLY against visible source evidence. If you are uncertain whether a detail in the cutout exists in the source, treat it as invented. False rejection is acceptable; false acceptance is not.";

export async function judgeFidelity(
  referenceCrop: Buffer,
  cutoutPng: Buffer,
): Promise<Fidelity> {
  const srcB64 = await toJpegB64(referenceCrop);
  const cutB64 = await toJpegB64(cutoutPng, [235, 235, 235]);
  const out = await ask(
    FIDELITY_SYSTEM,
    [
      { b64: srcB64, media: "image/jpeg" },
      { b64: cutB64, media: "image/jpeg" },
    ],
    [
      "IMAGE 1 is the SOURCE photo of the real garment. IMAGE 2 is the GENERATED cutout.",
      "Compare them and report, as ONLY this JSON object:",
      '{"same_garment": bool, "color_match": bool, "pattern_match": bool, "construction_match": bool, "invented_elements": [things visible in the cutout but NOT supported by the source — logos, text, pockets, buttons, zippers, collars, hardware, trim], "missing_elements": [defining things in the source absent from the cutout], "verdict": "faithful" | "minor_drift" | "fabricated", "reason": "one line"}',
      "Use verdict 'fabricated' if the cutout is a different garment, or invents any element, or you are unsure. Use 'minor_drift' only for small cosmetic differences with no invented elements. Use 'faithful' only when it is clearly the same garment with the same colors, pattern, and construction.",
    ].join("\n"),
  );

  const o = extractJsonObject(out);
  if (!o) {
    return {
      same_garment: false,
      color_match: false,
      pattern_match: false,
      construction_match: false,
      invented_elements: [],
      missing_elements: [],
      verdict: "fabricated",
      reason: "could not parse fidelity judgement",
    };
  }
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const verdict =
    o.verdict === "faithful" || o.verdict === "minor_drift" ? o.verdict : "fabricated";
  return {
    same_garment: Boolean(o.same_garment),
    color_match: Boolean(o.color_match),
    pattern_match: Boolean(o.pattern_match),
    construction_match: Boolean(o.construction_match),
    invented_elements: arr(o.invented_elements),
    missing_elements: arr(o.missing_elements),
    verdict,
    reason: String(o.reason ?? ""),
  };
}

import { createServerFn } from "@tanstack/react-start";
import {
  attachCitation,
  maySearchOfficial,
  orderedPackshots,
  packshotCandidates,
  packshotFetchMiss,
  packshotPlan,
  parsePackshotVerdict,
  responseCitations,
  responseText,
  visionRejects,
  type PackshotVerdict,
} from "./packshot.ts";

export type OfficialCover =
  | { ok: true; image: string; pageUrl: string; title: string }
  | { ok: false };

export type PlateJudge = { clean: boolean; why: string };

const PLATE_JUDGE_PROMPT =
  'Look only at the picture. Return ONLY JSON: {"clean":true,"why":""}. ' +
  "clean is false if a person, a face, a hand, an arm, skin, or a clothes hanger is still visible. " +
  "clean is true only when none of those are visible. " +
  "why is a few words, empty when clean. JSON only.";

const MATCH_PROMPT =
  "Image 1 is the closet photo. Image 2 is a downloaded product photograph. " +
  'Return ONLY JSON: {"same":false,"color":"match|different|unclear","pockets":"match|different|unclear","closure":"match|different|unclear","collar":"match|different|unclear","model":false}. ' +
  "color different means a different brown, or navy versus black. " +
  "pockets different means a different pocket count. " +
  "closure different means a zip versus buttons. " +
  "collar different means the collar is not the same. " +
  "model is true if image 2 shows a person, a mannequin, or a hand. " +
  "If you cannot see a detail, say unclear. Do not guess a match. JSON only.";

const UNREADABLE: PlateJudge = { clean: false, why: "unreadable" };

async function xaiPost(
  url: string,
  body: unknown,
  ms: number,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return { ok: false, status: 0, json: null };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: null };
  }
}

function chatText(json: unknown): string {
  const body = json as { choices?: { message?: { content?: string | null } }[] };
  return body.choices?.[0]?.message?.content ?? "";
}

function parseJudge(text: string): PlateJudge {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return UNREADABLE;
  try {
    const o = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    if (typeof o.clean === "boolean") {
      return { clean: o.clean, why: typeof o.why === "string" ? o.why.slice(0, 80) : "" };
    }
    if ("hand" in o || "arm" in o || "hanger" in o) {
      const hand = o.hand === true;
      const arm = o.arm === true;
      const hanger = o.hanger === true;
      const why = [hand ? "hand" : "", arm ? "arm" : "", hanger ? "hanger" : ""]
        .filter(Boolean)
        .join(" ");
      return { clean: !(hand || arm || hanger), why };
    }
    return UNREADABLE;
  } catch {
    return UNREADABLE;
  }
}

/** clean:false when a person, face, hand, arm, skin, or hanger is visible. No JSON is not a cover. */
export const judgeHeldPlate = createServerFn({ method: "POST" })
  .validator((input: { image: string }) => input)
  .handler(async ({ data }): Promise<PlateJudge> => {
    if (!process.env.XAI_API_KEY || !data.image) return UNREADABLE;
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: PLATE_JUDGE_PROMPT },
          { type: "image_url", image_url: { url: data.image } },
        ],
      },
    ];
    for (const model of ["grok-4.7", "grok-4.3"] as const) {
      const r = await xaiPost(
        "https://api.x.ai/v1/chat/completions",
        { model, temperature: 0, max_tokens: 80, messages },
        12000,
      );
      if (!r.ok) {
        if (r.status === 400 || r.status === 403 || r.status === 404 || r.status === 422) continue;
        return UNREADABLE;
      }
      const text = chatText(r.json).trim();
      if (!text) continue;
      return parseJudge(text);
    }
    return UNREADABLE;
  });

async function searchOnce(query: string, brief: string, site: string | null): Promise<unknown> {
  const tool: Record<string, unknown> = { type: "web_search", enable_image_search: true };
  if (site) tool.filters = { allowed_domains: [site] };
  else {
    tool.filters = {
      excluded_domains: ["pinterest.com", "pinimg.com", "medium.com", "blogspot.com", "tumblr.com"],
    };
  }
  const input = [
    {
      role: "user",
      content:
        `${brief}\nSearch this query exactly: ${query}\n` +
        'Return ONLY JSON: {"imageUrl":"","pageUrl":"","title":""}. ' +
        "imageUrl must be a direct image of this garment alone on a plain background. " +
        "Prefer the brand's own packshot, then Mr Porter, Nordstrom, Selfridges, or End. " +
        "No Pinterest, no blogs, no AI-image sites. No model, no mannequin, no hand. " +
        "If there is no such photograph, return empty strings. Do not invent a URL.",
    },
  ];
  const body = { model: "grok-4.7", input, tools: [tool] };
  let r = await xaiPost("https://api.x.ai/v1/responses", body, 45000);
  if (!r.ok && (r.status === 400 || r.status === 422)) {
    r = await xaiPost(
      "https://api.x.ai/v1/responses",
      {
        model: "grok-4.7",
        input,
        tools: [{ type: "web_search", enable_image_search: true }],
      },
      45000,
    );
  }
  return r.ok ? r.json : null;
}

async function fetchPackshot(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/jpeg,image/png,image/*",
        "User-Agent": "Closet/1.0",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    if (packshotFetchMiss(res.status, buf.byteLength)) return null;
    const mime = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (mime && !mime.startsWith("image/")) return null;
    if (buf.byteLength > 6_000_000) return null;
    const type = mime.startsWith("image/") ? mime : "image/jpeg";
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

async function compareToPhoto(photo: string, pack: string): Promise<PackshotVerdict | null> {
  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: MATCH_PROMPT },
        { type: "image_url", image_url: { url: photo } },
        { type: "image_url", image_url: { url: pack } },
      ],
    },
  ];
  for (const model of ["grok-4.7", "grok-4.3"] as const) {
    const r = await xaiPost(
      "https://api.x.ai/v1/chat/completions",
      { model, temperature: 0, max_tokens: 180, messages },
      25000,
    );
    if (!r.ok) {
      if (r.status === 400 || r.status === 403 || r.status === 404 || r.status === 422) continue;
      return null;
    }
    const text = chatText(r.json).trim();
    if (!text) continue;
    return parsePackshotVerdict(text);
  }
  return null;
}

/**
 * One search. His photo is only for the match. 403 or an empty download is a miss.
 * No match returns ok:false so the caller can keep a plate. It does not fail the tile.
 */
export const findOfficialCover = createServerFn({ method: "POST" })
  .validator(
    (input: {
      id?: string;
      brand: string;
      name: string;
      color: string;
      subtype: string;
      material: string;
      photo: string;
    }) => input,
  )
  .handler(async ({ data }): Promise<OfficialCover> => {
    if (!maySearchOfficial(data.id, data.brand)) return { ok: false };
    const plan = packshotPlan(data);
    if (!plan || !data.photo) return { ok: false };
    const brief = [
      `Brand: ${data.brand}`,
      `Name: ${data.name}`,
      `Color: ${data.color}`,
      `Subtype: ${data.subtype}`,
      `Material: ${data.material}`,
    ].join("\n");
    const seen = new Set<string>();
    for (let i = 0; i < plan.queries.length; i++) {
      const query = plan.queries[i]!;
      const site = plan.site && (query.startsWith("site:") || i > 0) ? plan.site : null;
      const json = await searchOnce(query, brief, site);
      if (!json) continue;
      const ranked = orderedPackshots(
        attachCitation(packshotCandidates(responseText(json)), responseCitations(json)),
        data.brand,
      );
      for (const cand of ranked) {
        if (seen.has(cand.imageUrl)) continue;
        seen.add(cand.imageUrl);
        const image = await fetchPackshot(cand.imageUrl);
        if (!image) continue;
        if (visionRejects(await compareToPhoto(data.photo, image))) continue;
        return { ok: true, image, pageUrl: cand.pageUrl, title: cand.title };
      }
    }
    return { ok: false };
  });

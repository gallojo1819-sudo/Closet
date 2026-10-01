import { coverStillPhoto, type PlatePatch } from "./plate.ts";

/** The other brown suede. No brand. Never search it, and never give it the REISS photo. */
export const UNBRANDED_SUEDE_ID = "g_py2swfwot1ed";

export type PackshotFields = {
  id?: string;
  brand?: string;
  name?: string;
  color?: string;
  subtype?: string;
  material?: string;
  category?: string;
  archived?: boolean;
  imageSrc?: string;
  cutoutSrc?: string;
  imageSource?: string;
  reprint?: boolean;
};

export type PackshotPlan = {
  queries: string[];
  /** Brand site for the follow-up search. Null means do not invent a shop domain. */
  site: string | null;
};

export type PackshotCandidate = {
  imageUrl: string;
  pageUrl: string;
  title: string;
};

export type MatchDetail = "match" | "different" | "unclear";

export type PackshotVerdict = {
  same: boolean;
  color: MatchDetail;
  pockets: MatchDetail;
  closure: MatchDetail;
  collar: MatchDetail;
  model: boolean;
};

const EMPTY_BRAND = /^(unknown|n\/a|none|null|unbranded|no brand|-|—)$/i;

/** Stored brand, kept as written. "Double RL Supply Company" is a brand. Blank is not. */
export function searchBrand(brand: string | undefined | null): string {
  const b = (brand ?? "").replace(/\s+/g, " ").trim();
  if (!b || EMPTY_BRAND.test(b)) return "";
  return b;
}

export function maySearchOfficial(id: string | undefined, brand: string | undefined | null): boolean {
  if (!id || id === UNBRANDED_SUEDE_ID) return false;
  return searchBrand(brand).length > 0;
}

function blob(input: PackshotFields): string {
  return [input.brand, input.name, input.color, input.subtype, input.material]
    .join(" ")
    .toLowerCase();
}

/**
 * Queries for a branded garment. The REISS suede and the Double RL field jacket
 * use the exact searches. Anything else is only the stored words. No brand, no search.
 */
export function packshotPlan(input: PackshotFields): PackshotPlan | null {
  if (input.id === UNBRANDED_SUEDE_ID) return null;
  const brand = searchBrand(input.brand);
  if (!brand) return null;
  const text = blob({ ...input, brand });
  if (/\breiss\b/.test(text) && /\bbrown\b/.test(text) && /\bsuede\b/.test(text) && /\bjacket\b/.test(text)) {
    return {
      queries: ["REISS brown suede jacket zip flap pockets", "site:reiss.com"],
      site: "reiss.com",
    };
  }
  if (/double\s*rl/.test(text) && /\bnavy\b/.test(text) && /\bfield\b/.test(text) && /\bjacket\b/.test(text)) {
    return {
      queries: ['"Double RL" navy field jacket corduroy collar'],
      site: null,
    };
  }
  const parts = [brand, input.color, input.material, input.subtype || input.name]
    .map((s) => (s ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const query = parts.join(" ").trim();
  if (!query) return null;
  return { queries: [query], site: null };
}

/** Search, or the locked plate, or leave a cover that is already a plate. */
export function coverPassAction(g: PackshotFields): "search" | "plate" | "skip" {
  if (g.archived || g.category !== "outerwear" || !coverStillPhoto(g) || !g.id) return "skip";
  if (maySearchOfficial(g.id, g.brand)) return "search";
  return "plate";
}

const BANNED_HOST =
  /(^|\.)pinterest\.|(^|\.)pinimg\.|blogspot\.|wordpress\.com|medium\.com|tumblr\.|substack\.|midjourney\.|leonardo\.ai|civitai\.|lexica\.|seaart\.|ideogram\.|krea\.ai|craiyon\.|tensor\.art|nightcafe\.|openai\.com|generative\.|ai-?image/i;

const RETAIL: { token: string; rank: number }[] = [
  { token: "mrporter", rank: 1 },
  { token: "nordstrom", rank: 2 },
  { token: "selfridges", rank: 3 },
  { token: "endclothing", rank: 4 },
];

function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function packshotAllowed(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (BANNED_HOST.test(host) || BANNED_HOST.test(url)) return false;
  if (/\/blog(\/|$)/i.test(url)) return false;
  return true;
}

function brandRank(host: string, brand: string): number | null {
  if (/\breiss\b/i.test(brand) && host.includes("reiss")) return 0;
  if (/double\s*rl/i.test(brand) && /doublerl|double-rl|(^|\.)rrl\./i.test(host)) return 0;
  return null;
}

/** 0 is the brand's own packshot. Then Mr Porter, Nordstrom, Selfridges, End. 99 is banned. */
export function packshotRank(url: string, brand: string): number {
  if (!packshotAllowed(url)) return 99;
  const host = hostOf(url);
  if (!host) return 99;
  const own = brandRank(host, brand);
  if (own != null) return own;
  for (const retail of RETAIL) {
    if (host.includes(retail.token)) return retail.rank;
  }
  return 10;
}

export function orderedPackshots(cands: PackshotCandidate[], brand: string): PackshotCandidate[] {
  return cands
    .filter((c) => packshotAllowed(c.imageUrl) && (!c.pageUrl || packshotAllowed(c.pageUrl)))
    .map((c, i) => ({ c, i, rank: packshotRank(c.imageUrl, brand) }))
    .filter((row) => row.rank < 99)
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((row) => row.c);
}

export function responseText(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const o = json as Record<string, unknown>;
  const chunks: string[] = [];
  if (typeof o.output_text === "string") chunks.push(o.output_text);
  if (Array.isArray(o.output)) {
    for (const item of o.output) {
      if (!item || typeof item !== "object") continue;
      const content = (item as { content?: unknown }).content;
      if (typeof content === "string") chunks.push(content);
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        const text = (part as { text?: unknown }).text;
        if (typeof text === "string") chunks.push(text);
      }
    }
  }
  return chunks.join("\n");
}

export function responseCitations(json: unknown): string[] {
  if (!json || typeof json !== "object") return [];
  const cites = (json as { citations?: unknown }).citations;
  if (!Array.isArray(cites)) return [];
  return cites.filter((c): c is string => typeof c === "string" && c.startsWith("http"));
}

function pushCandidate(out: PackshotCandidate[], imageUrl: string, pageUrl: string, title: string) {
  const image = imageUrl.trim();
  if (!image.startsWith("http")) return;
  out.push({ imageUrl: image, pageUrl: pageUrl.trim(), title: title.trim() });
}

/** JSON imageUrl plus markdown image embeds. Does not invent a URL that is not in the text. */
export function packshotCandidates(text: string): PackshotCandidate[] {
  const out: PackshotCandidate[] = [];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const o = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      pushCandidate(
        out,
        String(o.imageUrl ?? o.image_url ?? ""),
        String(o.pageUrl ?? o.page_url ?? ""),
        String(o.title ?? ""),
      );
    } catch {
      /* prose around the JSON */
    }
  }
  for (const m of text.matchAll(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/g)) {
    pushCandidate(out, m[1] ?? "", "", "");
  }
  return out;
}

export function attachCitation(cands: PackshotCandidate[], cites: string[]): PackshotCandidate[] {
  const page = cites.find((u) => packshotAllowed(u)) ?? "";
  return cands.map((c) => (c.pageUrl ? c : { ...c, pageUrl: page }));
}

/** 403 or an empty body is a miss for this URL, not a failed tile. */
export function packshotFetchMiss(status: number, byteLength: number): boolean {
  if (status === 403) return true;
  if (byteLength <= 0) return true;
  return status < 200 || status >= 300;
}

function asDetail(v: unknown): MatchDetail | null {
  return v === "match" || v === "different" || v === "unclear" ? v : null;
}

export function parsePackshotVerdict(text: string): PackshotVerdict | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const color = asDetail(o.color);
    const pockets = asDetail(o.pockets);
    const closure = asDetail(o.closure);
    const collar = asDetail(o.collar);
    if (!color || !pockets || !closure || !collar) return null;
    if (typeof o.same !== "boolean" || typeof o.model !== "boolean") return null;
    return { same: o.same, color, pockets, closure, collar, model: o.model };
  } catch {
    return null;
  }
}

/**
 * Reject a different garment, a model, or more than one detail that cannot be seen.
 * A missing verdict is a reject of this download, not a failed tile.
 */
export function visionRejects(v: PackshotVerdict | null): boolean {
  if (!v) return true;
  if (v.model || v.same === false) return true;
  if (v.color === "different" || v.pockets === "different") return true;
  if (v.closure === "different" || v.collar === "different") return true;
  const unclear = [v.color, v.pockets, v.closure, v.collar].filter((d) => d === "unclear").length;
  return unclear > 1;
}

export type OfficialPatch = PlatePatch & { productUrl?: string };

/** imageSrc and notes are not in the patch. The page URL uses the existing productUrl field. */
export function officialCoverPatch(plateKey: string, pageUrl: string): OfficialPatch {
  const patch: OfficialPatch = {
    cutoutSrc: plateKey,
    imageSource: "official",
    matteQuality: "clean",
    reprint: false,
  };
  const page = pageUrl.trim();
  if (page) patch.productUrl = page;
  return patch;
}

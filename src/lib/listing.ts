import { createServerFn } from "@tanstack/react-start";
import type { Category } from "./types";

export type OfficialHit = {
  title: string;
  brand: string;
  source: string;
  pageUrl: string;
  image: string;
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const CATEGORY_SET = new Set([
  "top",
  "bottom",
  "outerwear",
  "dress",
  "footwear",
  "accessory",
  "other",
]);

function absUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&/g, "&")
    .replace(/"/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/\\u0026/g, "&");
}

function meta(html: string, key: string): string {
  const prop = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  const prop2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`,
    "i",
  );
  return decodeEntities(prop.exec(html)?.[1] ?? prop2.exec(html)?.[1] ?? "");
}

function jsonLdImages(html: string): string[] {
  const out: string[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const data = JSON.parse(m[1]!);
      const visit = (node: unknown) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) {
          node.forEach(visit);
          return;
        }
        const rec = node as Record<string, unknown>;
        const img = rec.image;
        if (typeof img === "string") out.push(img);
        if (Array.isArray(img)) {
          for (const i of img) {
            if (typeof i === "string") out.push(i);
            else if (i && typeof i === "object" && "url" in i)
              out.push(String((i as { url: string }).url));
          }
        }
        if (typeof rec.brand === "object" && rec.brand && "name" in rec.brand) {
          /* brand read elsewhere */
        }
        visit(rec.offers);
      };
      visit(data);
    } catch {
      /* skip bad json-ld */
    }
  }
  return out;
}

function jsonLdBrand(html: string): string {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const data = JSON.parse(m[1]!);
      const raw = JSON.stringify(data);
      const brand = /"brand"\s*:\s*\{\s*"@type"\s*:\s*"Brand"\s*,\s*"name"\s*:\s*"([^"]+)"/.exec(
        raw,
      );
      if (brand?.[1]) return brand[1];
      const brand2 = /"brand"\s*:\s*"([^"]+)"/.exec(raw);
      if (brand2?.[1]) return brand2[1];
    } catch {
      /* skip */
    }
  }
  return "";
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Page ${res.status}`);
  return res.text();
}

async function downloadImage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Image ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > 8 * 1024 * 1024) throw new Error("Image too large");
  const mime = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  const safe = mime.startsWith("image/") ? mime : "image/jpeg";
  return `data:${safe};base64,${buf.toString("base64")}`;
}

function hostLabel(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    if (h.includes("farfetch")) return "Farfetch";
    if (h.includes("ssense")) return "SSENSE";
    if (h.includes("mrporter")) return "Mr Porter";
    if (h.includes("net-a-porter")) return "Net-a-Porter";
    if (h.includes("ralphlauren")) return "Ralph Lauren";
    if (h.includes("amiparis") || h.includes("ami.")) return "AMI";
    if (h.includes("goldengoose")) return "Golden Goose";
    if (h.includes("nordstrom")) return "Nordstrom";
    if (h.includes("mytheresa")) return "Mytheresa";
    if (h.includes("endclothing")) return "END";
    return h.split(".")[0] ?? h;
  } catch {
    return "Listing";
  }
}

function pickImage(html: string, pageUrl: string): string | null {
  const candidates = [
    meta(html, "og:image"),
    meta(html, "og:image:secure_url"),
    meta(html, "twitter:image"),
    ...jsonLdImages(html),
  ]
    .map((u) => absUrl(u, pageUrl))
    .filter((u): u is string => !!u && /^https?:/i.test(u));
  return candidates[0] ?? null;
}

export const fetchListing = createServerFn({ method: "POST" })
  .validator((input: { url: string }) => input)
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; title: string; brand: string; source: string; pageUrl: string; image: string }
      | { ok: false; error: string }
    > => {
      let pageUrl = data.url.trim();
      if (!/^https?:\/\//i.test(pageUrl)) pageUrl = `https://${pageUrl}`;
      let parsed: URL;
      try {
        parsed = new URL(pageUrl);
      } catch {
        return { ok: false, error: "That is not a link." };
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, error: "Only http(s) links." };
      }
      try {
        const html = await fetchHtml(parsed.toString());
        const img = pickImage(html, parsed.toString());
        if (!img) return { ok: false, error: "No product photo on that page." };
        const image = await downloadImage(img);
        const title = (
          meta(html, "og:title") ||
          /<title>([^<]+)<\/title>/i.exec(html)?.[1] ||
          "Piece"
        )
          .replace(/\s+/g, " ")
          .replace(/\|.*$/, "")
          .replace(/–.*$/, "")
          .trim()
          .slice(0, 80);
        const brand = jsonLdBrand(html) || hostLabel(parsed.toString());
        return {
          ok: true,
          title,
          brand,
          source: hostLabel(parsed.toString()),
          pageUrl: parsed.toString(),
          image,
        };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "Could not open that listing.",
        };
      }
    },
  );

export const identifyPiece = createServerFn({ method: "POST" })
  .validator((input: { image: string; mode: "photo" | "hangtag" }) => input)
  .handler(
    async ({
      data,
    }): Promise<
      | {
          ok: true;
          brand: string;
          name: string;
          query: string;
          sku: string;
          category: Category;
        }
      | { ok: false; error: string }
    > => {
      const apiKey = process.env.XAI_API_KEY;
      if (!apiKey) return { ok: false, error: "Set XAI_API_KEY to identify the make." };
      const hangtag = data.mode === "hangtag";
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
              content: hangtag
                ? "You read a clothing hangtag or neck label. Transcribe brand, style name, SKU/style code. JSON only. Do not invent a SKU that is not printed."
                : "You identify the exact retail product in the photo if the make is distinctive. JSON only. Empty brand if it is a generic unbranded piece.",
            },
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: data.image } },
                {
                  type: "text",
                  text: hangtag
                    ? 'Return ONLY JSON: {"brand":"AMI","name":"Oxford stripe shirt","query":"AMI Paris oxford stripe shirt men","sku":"HSH113","category":"top"}'
                    : 'Return ONLY JSON: {"brand":"Golden Goose","name":"Superstar white sneakers","query":"Golden Goose Superstar white leather sneakers","sku":"","category":"footwear"}. category is top|bottom|outerwear|dress|footwear|accessory|other. query is a retail search string. If the make is not clear, brand and sku empty, query still a useful search.',
                },
              ],
            },
          ],
        }),
      });
      if (!res.ok) return { ok: false, error: `Identify failed (${res.status})` };
      const body = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = body.choices?.[0]?.message?.content ?? "";
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start < 0 || end < start) return { ok: false, error: "Could not read the label." };
      try {
        const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
        const category = String(parsed.category ?? "other");
        const brand = String(parsed.brand ?? "").slice(0, 40);
        const name = String(parsed.name ?? "Piece").slice(0, 60);
        const sku = String(parsed.sku ?? "").slice(0, 32);
        const query =
          String(parsed.query ?? "").trim() ||
          [brand, name, sku].filter(Boolean).join(" ");
        return {
          ok: true,
          brand,
          name,
          query: query.slice(0, 120),
          sku,
          category: (CATEGORY_SET.has(category) ? category : "other") as Category,
        };
      } catch {
        return { ok: false, error: "Could not parse the label." };
      }
    },
  );

async function serpShopping(query: string): Promise<OfficialHit[]> {
  const key = process.env.SERPAPI_API_KEY;
  if (!key) return [];
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_shopping");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "us");
  url.searchParams.set("api_key", key);
  const res = await fetch(url);
  if (!res.ok) return [];
  const body = (await res.json()) as {
    shopping_results?: {
      title?: string;
      source?: string;
      link?: string;
      thumbnail?: string;
      product_link?: string;
    }[];
  };
  const hits: OfficialHit[] = [];
  for (const r of body.shopping_results ?? []) {
    const pageUrl = r.product_link || r.link || "";
    const thumb = r.thumbnail;
    if (!thumb || !pageUrl) continue;
    try {
      const image = await downloadImage(thumb);
      hits.push({
        title: (r.title ?? "Piece").slice(0, 80),
        brand: "",
        source: r.source ?? hostLabel(pageUrl),
        pageUrl,
        image,
      });
    } catch {
      /* skip */
    }
    if (hits.length >= 3) break;
  }
  return hits;
}

function farfetchCards(html: string, base: string): { href: string; img: string; title: string }[] {
  const cards: { href: string; img: string; title: string }[] = [];
  const imgRe =
    /https:\/\/cdn-images\.farfetch-contents\.com\/[^"'\\\s]+/gi;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html))) {
    const img = m[0]!.replace(/\\u002F/g, "/").replace(/\\/g, "");
    if (seen.has(img)) continue;
    seen.add(img);
    cards.push({ href: base, img, title: "" });
    if (cards.length >= 6) break;
  }
  const itemRe = /href="(\/shopping\/[^"]+item-\d+[^"]*)"/gi;
  const hrefs: string[] = [];
  while ((m = itemRe.exec(html))) {
    const href = absUrl(m[1]!, base);
    if (href) hrefs.push(href);
  }
  return cards.map((c, i) => ({ ...c, href: hrefs[i] ?? c.href }));
}

async function scrapeFarfetch(query: string): Promise<OfficialHit[]> {
  const q = encodeURIComponent(query);
  const pageUrl = `https://www.farfetch.com/shopping/men/search/items.aspx?q=${q}`;
  try {
    const html = await fetchHtml(pageUrl);
    const cards = farfetchCards(html, pageUrl);
    const hits: OfficialHit[] = [];
    for (const c of cards) {
      try {
        const image = await downloadImage(c.img.replace(/_\\d+\\.jpg/, "_1000.jpg"));
        hits.push({
          title: (c.title || query).slice(0, 80),
          brand: "",
          source: "Farfetch",
          pageUrl: c.href,
          image,
        });
      } catch {
        /* skip */
      }
      if (hits.length >= 3) break;
    }
    return hits;
  } catch {
    return [];
  }
}

export const searchOfficial = createServerFn({ method: "POST" })
  .validator((input: { query: string }) => input)
  .handler(
    async ({
      data,
    }): Promise<{ ok: true; hits: OfficialHit[] } | { ok: false; error: string }> => {
      const query = data.query.trim();
      if (!query) return { ok: false, error: "Nothing to search." };
      const serp = await serpShopping(query);
      if (serp.length) return { ok: true, hits: serp };
      const ff = await scrapeFarfetch(query);
      if (ff.length) return { ok: true, hits: ff };
      return { ok: false, error: "No official listing found. Use the photo, or paste the product link." };
    },
  );

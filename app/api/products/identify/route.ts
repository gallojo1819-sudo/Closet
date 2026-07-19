import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  searchProducts,
  fetchProductUrl,
  type GarmentSignal,
  type ProductCandidate,
} from "@/lib/products/identify";

// Product lookup for a garment. Returns 3-5 CANDIDATES for the owner to pick
// from — nothing is auto-applied here. Uses the garment's own manifest to ground
// each candidate's match_reason. Care-tag reading is a separate route (multipart).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Two-stage lookup (web_search + per-page web_fetch) can legitimately run 1–2 min;
// the lib enforces a 240s internal budget, so 300 leaves headroom to fail cleanly.
export const maxDuration = 300;

interface Body {
  garmentId?: string;
  method?: "reference" | "name" | "url";
  brand?: string;
  reference?: string;
  name?: string;
  url?: string;
}

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const garmentId = clean(body.garmentId);
  const method = body.method;
  if (!garmentId || !method) {
    return NextResponse.json({ error: "Missing garment or method." }, { status: 400 });
  }

  // Load the garment's own attributes to ground the search (RLS scopes to owner).
  const { data: g, error: garmentError } = await supabase
    .from("garments")
    .select("category,subtype,colors,pattern,material")
    .eq("id", garmentId)
    .maybeSingle();
  if (garmentError) {
    // A query failure is not "not found" — surface it as a real error.
    console.error("[products/identify] garment lookup failed", garmentError);
    return NextResponse.json({ error: "Couldn't load the garment." }, { status: 500 });
  }
  if (!g) return NextResponse.json({ error: "Garment not found." }, { status: 404 });

  const signal: GarmentSignal = {
    category: g.category as string,
    subtype: (g.subtype as string | null) ?? null,
    colors: (g.colors as string[] | null) ?? [],
    pattern: (g.pattern as string | null) ?? null,
    material: (g.material as string | null) ?? null,
  };

  console.log(
    `[identify][DIAG] route POST — method=${method}, garmentId=${garmentId}, ` +
      `signal={category:${signal.category}, subtype:${signal.subtype}, colors:[${signal.colors.join("/")}], pattern:${signal.pattern}}`,
  );
  const routeT0 = Date.now();
  try {
    let candidates: ProductCandidate[] = [];
    if (method === "reference") {
      const brand = clean(body.brand);
      const reference = clean(body.reference);
      if (!brand && !reference) {
        return NextResponse.json({ error: "Enter a brand and/or reference number." }, { status: 400 });
      }
      const q = `${brand} ${reference}`.trim();
      console.log(`[identify][DIAG] reference method — built query=${JSON.stringify(q)} (brand=${JSON.stringify(brand)}, reference=${JSON.stringify(reference)})`);
      candidates = await searchProducts(q, signal);
    } else if (method === "name") {
      const brand = clean(body.brand);
      const name = clean(body.name);
      if (!brand && !name) {
        return NextResponse.json({ error: "Enter a brand and/or product name." }, { status: 400 });
      }
      candidates = await searchProducts(`${brand} ${name}`.trim(), signal);
    } else if (method === "url") {
      const url = clean(body.url);
      if (!/^https?:\/\//i.test(url)) {
        return NextResponse.json({ error: "Enter a valid product URL (http/https)." }, { status: 400 });
      }
      candidates = await fetchProductUrl(url, signal);
    } else {
      return NextResponse.json({ error: "Unknown lookup method." }, { status: 400 });
    }

    console.log(
      `[identify][DIAG] route DONE in ${Date.now() - routeT0}ms — returning ${candidates.length} candidate(s)`,
    );
    return NextResponse.json({ ok: true, candidates });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    console.error(
      `[products/identify][DIAG] lookup THREW after ${Date.now() - routeT0}ms —`,
      e,
    );
    // Surface a real timeout distinctly (consistent with the error-audit pass).
    if (/timed out/i.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 504 });
    }
    return NextResponse.json(
      { error: "Product lookup failed. Please try again." },
      { status: 502 },
    );
  }
}

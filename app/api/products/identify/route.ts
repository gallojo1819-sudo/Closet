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
export const maxDuration = 60;

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

  try {
    let candidates: ProductCandidate[] = [];
    if (method === "reference") {
      const brand = clean(body.brand);
      const reference = clean(body.reference);
      if (!brand && !reference) {
        return NextResponse.json({ error: "Enter a brand and/or reference number." }, { status: 400 });
      }
      candidates = await searchProducts(`${brand} ${reference}`.trim(), signal);
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

    return NextResponse.json({ ok: true, candidates });
  } catch (e) {
    console.error("[products/identify] lookup failed", e);
    return NextResponse.json(
      { error: "Product lookup failed. Please try again." },
      { status: 502 },
    );
  }
}

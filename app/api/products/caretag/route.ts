import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readCareTag } from "@/lib/products/identify";

// Read a care/size/brand label from an uploaded or camera photo. Returns only
// what is legible (unreadable fields come back null, never guessed). The client
// pre-fills the identify form with these so the OWNER reviews before searching —
// nothing is auto-applied or auto-searched.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No image provided." }, { status: 400 });
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const reading = await readCareTag(bytes);
    return NextResponse.json({ ok: true, reading });
  } catch (e) {
    console.error("[products/caretag] read failed", e);
    return NextResponse.json(
      { error: "Could not read that label. Try a sharper, closer photo." },
      { status: 502 },
    );
  }
}

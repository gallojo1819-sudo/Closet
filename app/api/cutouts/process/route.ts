import "server-only";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { buildReferenceCrop } from "@/lib/cutouts/reference";
import {
  buildCutoutPrompt,
  buildCorrectivePrompt,
  type Observed,
} from "@/lib/cutouts/prompt";
import { generateImage, toRefImage } from "@/lib/cutouts/gemini";
import { removeChroma } from "@/lib/cutouts/chroma";
import { runQaGates } from "@/lib/cutouts/qa";
import type { Bbox, Category } from "@/lib/garments/types";

// Image generation is slow; needs the Node runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BUCKET = "garments";
const MAX_JOBS = 3;

type Supabase = Awaited<ReturnType<typeof createClient>>;

interface JobRow {
  id: string;
  garment_id: string | null;
  payload: Record<string, unknown> | null;
  attempts: number;
}

interface GarmentRow {
  id: string;
  status: string;
  category: Category;
  subtype: string | null;
  colors: string[] | null;
  pattern: string | null;
  material: string | null;
  source_bbox: Bbox | null;
  image_path: string;
  attributes: { observed?: Observed } | null;
  unknowns: string[] | null;
}

interface JobResult {
  jobId: string;
  garmentId: string | null;
  outcome: "cutout_ready" | "cutout_failed" | "skipped" | "error";
  detail?: string;
}

interface AttemptResult {
  pass: boolean;
  png?: Buffer;
  failureSummary?: string;
  /** The generator's output (re-encoded PNG) to attach on the corrective retry. */
  failedRefPng?: Buffer;
}

async function runOneAttempt(
  prompt: string,
  refImages: { mimeType: string; data: string }[],
  chromaHex: string,
): Promise<AttemptResult> {
  let gen: Buffer;
  try {
    gen = await generateImage(prompt, refImages);
  } catch (e) {
    return { pass: false, failureSummary: `generation error: ${msg(e)}` };
  }

  // Re-encode to PNG so it can be re-attached with a correct mime type.
  let failedRefPng: Buffer | undefined;
  try {
    failedRefPng = await sharp(gen).png().toBuffer();
  } catch {
    failedRefPng = undefined;
  }

  const chroma = await removeChroma(gen, chromaHex);
  if (!chroma.ok) {
    return {
      pass: false,
      failureSummary: `the non-uniform background (${chroma.reason})`,
      failedRefPng,
    };
  }

  const qa = runQaGates(chroma.raw, chroma.width, chroma.height, chromaHex);
  if (!qa.pass) {
    return { pass: false, failureSummary: qa.failures.join("; "), failedRefPng };
  }
  return { pass: true, png: chroma.png };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function storeSuccess(
  supabase: Supabase,
  userId: string,
  job: JobRow,
  garmentId: string,
  png: Buffer,
  attempts: number,
  payload: Record<string, unknown>,
): Promise<void> {
  const cutoutPath = `${userId}/cutouts/${garmentId}.png`;
  await supabase.storage
    .from(BUCKET)
    .upload(cutoutPath, png, { contentType: "image/png", upsert: true });
  await supabase
    .from("garments")
    .update({ status: "cutout_ready", cutout_path: cutoutPath })
    .eq("id", garmentId);
  await supabase
    .from("processing_jobs")
    .update({ status: "done", attempts, payload })
    .eq("id", job.id);
}

async function handleJob(
  supabase: Supabase,
  userId: string,
  job: JobRow,
): Promise<JobResult> {
  const base = { jobId: job.id, garmentId: job.garment_id };
  if (!job.garment_id) {
    await supabase
      .from("processing_jobs")
      .update({ status: "failed", last_error: "no garment_id" })
      .eq("id", job.id);
    return { ...base, outcome: "error", detail: "no garment_id" };
  }

  const { data: g } = await supabase
    .from("garments")
    .select(
      "id,status,category,subtype,colors,pattern,material,source_bbox,image_path,attributes,unknowns",
    )
    .eq("id", job.garment_id)
    .maybeSingle();
  const garment = g as GarmentRow | null;

  if (!garment) {
    await supabase
      .from("processing_jobs")
      .update({ status: "failed", last_error: "garment missing" })
      .eq("id", job.id);
    return { ...base, outcome: "error", detail: "garment missing" };
  }

  // Skip 'hold' garments — mark the job done with a note.
  if (garment.status === "hold") {
    await supabase
      .from("processing_jobs")
      .update({
        status: "done",
        payload: { ...(job.payload ?? {}), note: "garment on hold — skipped" },
      })
      .eq("id", job.id);
    return { ...base, outcome: "skipped", detail: "garment on hold" };
  }

  try {
    const dl = await supabase.storage.from(BUCKET).download(garment.image_path);
    if (dl.error || !dl.data) throw new Error("could not load original");
    const original = Buffer.from(await dl.data.arrayBuffer());

    const reference = await buildReferenceCrop(original, garment.source_bbox);
    const refImg = toRefImage(reference);

    const { prompt, chromaHex } = buildCutoutPrompt({
      category: garment.category,
      subtype: garment.subtype,
      colors: garment.colors ?? [],
      pattern: garment.pattern,
      material: garment.material,
      observed: garment.attributes?.observed ?? {},
      unknowns: garment.unknowns ?? [],
    });

    const payload: Record<string, unknown> = {
      ...(job.payload ?? {}),
      chroma_hex: chromaHex,
      prompt,
    };

    // Attempt 1
    const a1 = await runOneAttempt(prompt, [refImg], chromaHex);
    if (a1.pass && a1.png) {
      await storeSuccess(supabase, userId, job, garment.id, a1.png, 1, payload);
      return { ...base, outcome: "cutout_ready" };
    }

    // Corrective retry (attach failed output + reference crop)
    const corrective = buildCorrectivePrompt(chromaHex, a1.failureSummary ?? "the artifacts");
    payload.first_failure = a1.failureSummary;
    payload.corrective_prompt = corrective;
    const retryImages = a1.failedRefPng
      ? [refImg, toRefImage(a1.failedRefPng)]
      : [refImg];

    const a2 = await runOneAttempt(corrective, retryImages, chromaHex);
    if (a2.pass && a2.png) {
      await storeSuccess(supabase, userId, job, garment.id, a2.png, 2, payload);
      return { ...base, outcome: "cutout_ready" };
    }

    // Both attempts failed — honest failure, no fabricated item.
    const lastError = a2.failureSummary ?? "cutout QA failed";
    payload.second_failure = a2.failureSummary;
    await supabase
      .from("processing_jobs")
      .update({ status: "failed", attempts: 2, last_error: lastError, payload })
      .eq("id", job.id);
    await supabase
      .from("garments")
      .update({ status: "cutout_failed" })
      .eq("id", garment.id);
    return { ...base, outcome: "cutout_failed", detail: lastError };
  } catch (e) {
    const detail = msg(e);
    await supabase
      .from("processing_jobs")
      .update({ status: "failed", attempts: (job.attempts ?? 0) + 1, last_error: detail })
      .eq("id", job.id);
    await supabase
      .from("garments")
      .update({ status: "cutout_failed" })
      .eq("id", garment.id);
    return { ...base, outcome: "error", detail };
  }
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Atomic claim: queued -> running for up to MAX_JOBS of this user's jobs.
  const { data: claimedRaw, error: claimError } = await supabase.rpc(
    "claim_cutout_jobs",
    { max_jobs: MAX_JOBS },
  );
  if (claimError) {
    return NextResponse.json({ error: claimError.message }, { status: 500 });
  }
  const claimed = (claimedRaw ?? []) as JobRow[];

  const processed: JobResult[] = [];
  for (const job of claimed) {
    processed.push(await handleJob(supabase, user.id, job));
  }

  const { count } = await supabase
    .from("processing_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("kind", "cutout_generate")
    .eq("status", "queued");

  return NextResponse.json({
    ok: true,
    processed,
    claimed: claimed.length,
    remaining: count ?? 0,
  });
}

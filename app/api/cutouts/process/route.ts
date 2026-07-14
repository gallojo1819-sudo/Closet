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
import {
  classifyThrown,
  qaCode,
  classifiedLastError,
  type FailureCode,
} from "@/lib/cutouts/errors";
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
  outcome: "cutout_ready" | "cutout_failed" | "skipped" | "paused" | "error";
  code?: FailureCode;
  detail?: string;
}

// A single generation+key+QA attempt resolves to one of three shapes:
//  pass  -> we have a PNG
//  infra -> quota/auth/network: DO NOT burn the job; halt the batch
//  fail  -> a genuine generation/chroma/QA failure: consumes an attempt
type AttemptOutcome =
  | { kind: "pass"; png: Buffer }
  | { kind: "infra"; code: FailureCode; message: string }
  | { kind: "fail"; code: FailureCode; message: string; failedRefPng?: Buffer };

async function runOneAttempt(
  prompt: string,
  refImages: { mimeType: string; data: string }[],
  chromaHex: string,
): Promise<AttemptOutcome> {
  let gen: Buffer;
  try {
    gen = await generateImage(prompt, refImages);
  } catch (e) {
    const c = classifyThrown(e);
    return c.infra
      ? { kind: "infra", code: c.code, message: c.message }
      : { kind: "fail", code: c.code, message: c.message };
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
      kind: "fail",
      code: "chroma_nonuniform",
      message: `non-uniform background (${chroma.reason})`,
      failedRefPng,
    };
  }

  const qa = runQaGates(chroma.raw, chroma.width, chroma.height, chromaHex);
  if (!qa.pass) {
    return {
      kind: "fail",
      code: qaCode(qa.failures),
      message: qa.failures.join("; "),
      failedRefPng,
    };
  }
  return { kind: "pass", png: chroma.png };
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
    .update({ status: "done", attempts, last_error: null, payload })
    .eq("id", job.id);
}

/**
 * Infra failure: release the job back to 'queued' WITHOUT touching attempts or
 * the garment. It stays fully re-runnable once billing/quota recovers.
 */
async function pauseJob(
  supabase: Supabase,
  job: JobRow,
  code: FailureCode,
  message: string,
): Promise<void> {
  await supabase
    .from("processing_jobs")
    .update({ status: "queued", last_error: classifiedLastError(code, message) })
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
      .update({ status: "failed", last_error: classifiedLastError("unknown", "no garment_id") })
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
      .update({ status: "failed", last_error: classifiedLastError("unknown", "garment missing") })
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

  // Load the original. A missing original is a genuine, non-retryable failure.
  let original: Buffer;
  try {
    const dl = await supabase.storage.from(BUCKET).download(garment.image_path);
    if (dl.error || !dl.data) throw new Error("could not load original");
    original = Buffer.from(await dl.data.arrayBuffer());
  } catch {
    await supabase
      .from("processing_jobs")
      .update({
        status: "failed",
        attempts: (job.attempts ?? 0) + 1,
        last_error: classifiedLastError("unknown", "could not load original image"),
      })
      .eq("id", job.id);
    await supabase.from("garments").update({ status: "cutout_failed" }).eq("id", garment.id);
    return { ...base, outcome: "cutout_failed", code: "unknown", detail: "could not load original" };
  }

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
  if (a1.kind === "pass") {
    await storeSuccess(supabase, userId, job, garment.id, a1.png, 1, payload);
    return { ...base, outcome: "cutout_ready" };
  }
  if (a1.kind === "infra") {
    await pauseJob(supabase, job, a1.code, a1.message);
    return { ...base, outcome: "paused", code: a1.code, detail: a1.message };
  }

  // Corrective retry (attach failed output + reference crop)
  const corrective = buildCorrectivePrompt(chromaHex, a1.message);
  payload.first_failure = classifiedLastError(a1.code, a1.message);
  payload.corrective_prompt = corrective;
  const retryImages = a1.failedRefPng
    ? [refImg, toRefImage(a1.failedRefPng)]
    : [refImg];

  const a2 = await runOneAttempt(corrective, retryImages, chromaHex);
  if (a2.kind === "pass") {
    await storeSuccess(supabase, userId, job, garment.id, a2.png, 2, payload);
    return { ...base, outcome: "cutout_ready" };
  }
  if (a2.kind === "infra") {
    // Infra on the retry: still must not burn — forgive attempt 1, re-queue.
    await pauseJob(supabase, job, a2.code, a2.message);
    return { ...base, outcome: "paused", code: a2.code, detail: a2.message };
  }

  // Two genuine failures — honest terminal failure, no fabricated item.
  payload.second_failure = classifiedLastError(a2.code, a2.message);
  await supabase
    .from("processing_jobs")
    .update({
      status: "failed",
      attempts: 2,
      last_error: classifiedLastError(a2.code, a2.message),
      payload,
    })
    .eq("id", job.id);
  await supabase.from("garments").update({ status: "cutout_failed" }).eq("id", garment.id);
  return { ...base, outcome: "cutout_failed", code: a2.code, detail: a2.message };
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
  let paused: { code?: FailureCode; message?: string } | null = null;

  for (let i = 0; i < claimed.length; i++) {
    const result = await handleJob(supabase, user.id, claimed[i]);
    processed.push(result);
    if (result.outcome === "paused") {
      paused = { code: result.code, message: result.detail };
      // Release the rest of the claimed batch back to 'queued' so nothing is
      // stranded in 'running' — no point burning more calls on the same infra.
      const rest = claimed.slice(i + 1).map((j) => j.id);
      if (rest.length) {
        await supabase.from("processing_jobs").update({ status: "queued" }).in("id", rest);
      }
      break;
    }
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
    paused: Boolean(paused),
    pause: paused
      ? {
          code: paused.code,
          message: "Cutouts paused: Gemini quota/billing issue.",
          detail: paused.message,
        }
      : null,
  });
}

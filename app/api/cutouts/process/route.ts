import "server-only";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import {
  buildReferenceCrop,
  cropOriginalBbox,
} from "@/lib/cutouts/reference";
import {
  buildCutoutPrompt,
  buildCorrectivePrompt,
  type Observed,
} from "@/lib/cutouts/prompt";
import { generateImage, toRefImage } from "@/lib/cutouts/gemini";
import { removeChroma } from "@/lib/cutouts/chroma";
import { segmentBackground } from "@/lib/cutouts/segment";
import { runQaGates } from "@/lib/cutouts/qa";
import { judgeEvidence, judgeFidelity } from "@/lib/cutouts/fidelity";
import {
  classifyThrown,
  qaCode,
  classifiedLastError,
  type FailureCode,
} from "@/lib/cutouts/errors";
import type { Bbox, Category } from "@/lib/garments/types";

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
  outcome:
    | "segmented"
    | "cutout_ready"
    | "cutout_rejected"
    | "cutout_failed"
    | "hold"
    | "skipped"
    | "paused"
    | "error";
  code?: FailureCode;
  detail?: string;
}

// A generation attempt (route B) resolves to one of these.
type GenOutcome =
  | { kind: "accept"; png: Buffer; verdict: string }
  | { kind: "infra"; code: FailureCode; message: string }
  | { kind: "techfail"; code: FailureCode; message: string; failedRefPng?: Buffer }
  | { kind: "fidelityfail"; reason: string; invented: string[]; failedRefPng?: Buffer };

async function runGeneration(
  prompt: string,
  refImages: { mimeType: string; data: string }[],
  chromaHex: string,
  referenceCrop: Buffer,
): Promise<GenOutcome> {
  let gen: Buffer;
  try {
    gen = await generateImage(prompt, refImages);
  } catch (e) {
    const c = classifyThrown(e);
    return c.infra
      ? { kind: "infra", code: c.code, message: c.message }
      : { kind: "techfail", code: c.code, message: c.message };
  }

  let failedRefPng: Buffer | undefined;
  try {
    failedRefPng = await sharp(gen).png().toBuffer();
  } catch {
    failedRefPng = undefined;
  }

  const chroma = await removeChroma(gen, chromaHex);
  if (!chroma.ok) {
    return {
      kind: "techfail",
      code: "chroma_nonuniform",
      message: `non-uniform background (${chroma.reason})`,
      failedRefPng,
    };
  }
  const qa = runQaGates(chroma.raw, chroma.width, chroma.height, chromaHex);
  if (!qa.pass) {
    return { kind: "techfail", code: qaCode(qa.failures), message: qa.failures.join("; "), failedRefPng };
  }

  // Source-fidelity gate — this is what stops a plausible fabrication.
  let fid;
  try {
    fid = await judgeFidelity(referenceCrop, chroma.png);
  } catch (e) {
    const c = classifyThrown(e);
    if (c.infra) return { kind: "infra", code: c.code, message: c.message };
    // Can't verify -> reject (false rejection is cheap).
    return { kind: "fidelityfail", reason: `judge error: ${c.message}`, invented: [], failedRefPng };
  }
  if (fid.verdict === "fabricated" || fid.invented_elements.length > 0) {
    return {
      kind: "fidelityfail",
      reason: fid.reason || "fabricated",
      invented: fid.invented_elements,
      failedRefPng,
    };
  }
  return { kind: "accept", png: chroma.png, verdict: fid.verdict };
}

async function storeCutout(
  supabase: Supabase,
  userId: string,
  job: JobRow,
  garmentId: string,
  png: Buffer,
  source: "segmented" | "cutout",
  attempts: number,
  payload: Record<string, unknown>,
): Promise<void> {
  const cutoutPath = `${userId}/cutouts/${garmentId}.png`;
  await supabase.storage
    .from(BUCKET)
    .upload(cutoutPath, png, { contentType: "image/png", upsert: true });
  await supabase
    .from("garments")
    .update({ status: "cutout_ready", cutout_path: cutoutPath, image_source: source })
    .eq("id", garmentId);
  await supabase
    .from("processing_jobs")
    .update({ status: "done", attempts, last_error: null, payload })
    .eq("id", job.id);
}

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
  if (garment.status === "hold") {
    await supabase
      .from("processing_jobs")
      .update({ status: "done", payload: { ...(job.payload ?? {}), note: "garment on hold — skipped" } })
      .eq("id", job.id);
    return { ...base, outcome: "skipped", detail: "garment on hold" };
  }

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
    await supabase
      .from("garments")
      .update({ status: "cutout_failed", image_source: "photo" })
      .eq("id", garment.id);
    return { ...base, outcome: "cutout_failed", code: "unknown", detail: "could not load original" };
  }

  // ---- LADDER A: TRUE SEGMENTATION (real pixels, no invention) ----
  try {
    const crop = await cropOriginalBbox(original, garment.source_bbox);
    const seg = await segmentBackground(crop);
    if (seg.ok) {
      const qa = runQaGates(seg.raw, seg.width, seg.height, null);
      if (qa.pass) {
        await storeCutout(supabase, userId, job, garment.id, seg.png, "segmented", 0, {
          ...(job.payload ?? {}),
          method: "segmented",
        });
        return { ...base, outcome: "segmented" };
      }
    }
  } catch {
    // segmentation is best-effort; fall through to the generation route
  }

  // ---- Evidence sufficiency (before spending a Gemini call) ----
  const reference = await buildReferenceCrop(original, garment.source_bbox);
  try {
    const ev = await judgeEvidence(reference);
    if (!ev.sufficient) {
      await supabase
        .from("garments")
        .update({ status: "hold", image_source: "photo" })
        .eq("id", garment.id);
      await supabase
        .from("processing_jobs")
        .update({
          status: "done",
          payload: { ...(job.payload ?? {}), note: `insufficient_evidence: ${ev.reason}` },
        })
        .eq("id", job.id);
      return { ...base, outcome: "hold", detail: `insufficient_evidence: ${ev.reason}` };
    }
  } catch (e) {
    const c = classifyThrown(e);
    if (c.infra) {
      await pauseJob(supabase, job, c.code, c.message);
      return { ...base, outcome: "paused", code: c.code, detail: c.message };
    }
    // non-infra judge error: proceed — the fidelity gate still guards output.
  }

  // ---- LADDER B: GEMINI RECONSTRUCTION (must pass the fidelity gate) ----
  const { prompt, chromaHex } = buildCutoutPrompt({
    category: garment.category,
    subtype: garment.subtype,
    colors: garment.colors ?? [],
    pattern: garment.pattern,
    material: garment.material,
    observed: garment.attributes?.observed ?? {},
    unknowns: garment.unknowns ?? [],
  });
  const refImg = toRefImage(reference);
  const payload: Record<string, unknown> = {
    ...(job.payload ?? {}),
    method: "generated",
    chroma_hex: chromaHex,
    prompt,
  };

  const a1 = await runGeneration(prompt, [refImg], chromaHex, reference);
  if (a1.kind === "accept") {
    await storeCutout(supabase, userId, job, garment.id, a1.png, "cutout", 1, {
      ...payload,
      fidelity: a1.verdict,
    });
    return { ...base, outcome: "cutout_ready" };
  }
  if (a1.kind === "infra") {
    await pauseJob(supabase, job, a1.code, a1.message);
    return { ...base, outcome: "paused", code: a1.code, detail: a1.message };
  }

  // One corrective retry — name the specific problem to fix.
  const corrective =
    a1.kind === "fidelityfail"
      ? buildCorrectivePrompt(
          chromaHex,
          `the invented elements not present in the source (${a1.invented.join(", ") || a1.reason}); reconstruct ONLY what the source photo shows`,
        )
      : buildCorrectivePrompt(chromaHex, a1.message);
  payload.first_failure =
    a1.kind === "fidelityfail" ? `fidelity: ${a1.reason}` : classifiedLastError(a1.code, a1.message);
  payload.corrective_prompt = corrective;
  const retryImages = a1.failedRefPng ? [refImg, toRefImage(a1.failedRefPng)] : [refImg];

  const a2 = await runGeneration(corrective, retryImages, chromaHex, reference);
  if (a2.kind === "accept") {
    await storeCutout(supabase, userId, job, garment.id, a2.png, "cutout", 2, {
      ...payload,
      fidelity: a2.verdict,
    });
    return { ...base, outcome: "cutout_ready" };
  }
  if (a2.kind === "infra") {
    await pauseJob(supabase, job, a2.code, a2.message);
    return { ...base, outcome: "paused", code: a2.code, detail: a2.message };
  }

  // ---- LADDER C: honest fallback (real photo), never a fabrication ----
  if (a2.kind === "fidelityfail") {
    const lastError = `fidelity: ${a2.reason}`;
    await supabase
      .from("processing_jobs")
      .update({ status: "failed", attempts: 2, last_error: lastError, payload: { ...payload, second_failure: lastError } })
      .eq("id", job.id);
    await supabase
      .from("garments")
      .update({ status: "cutout_rejected", image_source: "photo" })
      .eq("id", garment.id);
    return { ...base, outcome: "cutout_rejected", detail: a2.reason };
  }

  const techError = classifiedLastError(a2.code, a2.message);
  await supabase
    .from("processing_jobs")
    .update({ status: "failed", attempts: 2, last_error: techError, payload: { ...payload, second_failure: techError } })
    .eq("id", job.id);
  await supabase
    .from("garments")
    .update({ status: "cutout_failed", image_source: "photo" })
    .eq("id", garment.id);
  return { ...base, outcome: "cutout_failed", code: a2.code, detail: a2.message };
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: claimedRaw, error: claimError } = await supabase.rpc("claim_cutout_jobs", {
    max_jobs: MAX_JOBS,
  });
  if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 });
  const claimed = (claimedRaw ?? []) as JobRow[];

  const processed: JobResult[] = [];
  let paused: { code?: FailureCode; message?: string } | null = null;
  for (let i = 0; i < claimed.length; i++) {
    const result = await handleJob(supabase, user.id, claimed[i]);
    processed.push(result);
    if (result.outcome === "paused") {
      paused = { code: result.code, message: result.detail };
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
      ? { code: paused.code, message: "Cutouts paused: Gemini quota/billing issue.", detail: paused.message }
      : null,
  });
}

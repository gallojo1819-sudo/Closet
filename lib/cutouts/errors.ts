// Failure classification for the cutout worker. Pure module (no I/O) so it can
// be unit-tested. The key distinction is `infra`: quota/auth/network failures
// are NOT generation failures — they must not burn the job's attempts and must
// halt the batch, whereas gen/chroma/QA failures consume an attempt.

export type FailureCode =
  | "quota"
  | "auth"
  | "network"
  | "gen_empty"
  | "chroma_nonuniform"
  | `qa_${string}`
  | "unknown";

export interface Classified {
  code: FailureCode;
  /** One-line, human-readable, classification-first. */
  message: string;
  /** true = quota/auth/network → leave the job queued, don't burn attempts. */
  infra: boolean;
}

function truncate(s: string, n: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
}

/** Pull an HTTP-ish status from a thrown error object or its message body. */
function extractStatus(e: unknown, raw: string): number | undefined {
  if (e && typeof e === "object") {
    const s = (e as { status?: unknown }).status;
    if (typeof s === "number") return s;
    if (typeof s === "string") {
      const n = parseInt(s, 10);
      if (Number.isFinite(n)) return n;
    }
  }
  const m = raw.match(/"code"\s*:\s*(\d{3})/);
  return m ? parseInt(m[1], 10) : undefined;
}

function looksNetwork(status: number | undefined, lower: string): boolean {
  if (status && status >= 500) return true; // 5xx / INTERNAL / UNAVAILABLE — transient
  return [
    "unavailable",
    "overloaded",
    "etimedout",
    "econnreset",
    "enotfound",
    "eai_again",
    "socket hang up",
    "network",
    "fetch failed",
    "timeout",
    "timed out",
    "aborterror",
  ].some((k) => lower.includes(k));
}

/**
 * Classify a thrown error from the generation step (or a downstream throw).
 * Recognized infra classes leave `infra: true`.
 */
export function classifyThrown(e: unknown): Classified {
  const raw = e instanceof Error ? e.message : String(e);
  const lower = raw.toLowerCase();
  const status = extractStatus(e, raw);

  // Our own "no image" signal is a generation failure, not infra.
  if (lower.includes("no image")) {
    return { code: "gen_empty", message: "Gemini returned no image", infra: false };
  }

  if (
    status === 429 ||
    lower.includes("resource_exhausted") ||
    lower.includes("quota") ||
    lower.includes("billing") ||
    lower.includes("rate limit") ||
    lower.includes("rate-limit")
  ) {
    return {
      code: "quota",
      message:
        "Gemini quota/billing limit hit (429). Enable billing on the Google project or wait for quota to reset.",
      infra: true,
    };
  }

  if (
    status === 401 ||
    status === 403 ||
    lower.includes("permission_denied") ||
    lower.includes("unauthenticated") ||
    lower.includes("api key not valid") ||
    lower.includes("api_key_invalid") ||
    lower.includes("invalid authentication") ||
    lower.includes("invalid api key")
  ) {
    return {
      code: "auth",
      message: "Gemini rejected the API key (auth error). Check GEMINI_API_KEY.",
      infra: true,
    };
  }

  if (looksNetwork(status, lower)) {
    return {
      code: "network",
      message: "Network/timeout reaching Gemini (transient).",
      infra: true,
    };
  }

  return { code: "unknown", message: truncate(raw, 200), infra: false };
}

/** Map a QA failure list to a short `qa_<gate>` code. */
export function qaCode(failures: string[]): FailureCode {
  const l = (failures[0] ?? "").toLowerCase();
  if (l.includes("corner")) return "qa_corner";
  if (l.includes("border")) return "qa_border";
  if (l.includes("both transparent and visible")) return "qa_alpha";
  if (l.includes("too little")) return "qa_too_small";
  if (l.includes("too much")) return "qa_too_large";
  if (l.includes("clipped") || l.includes("touching") || l.includes("padding"))
    return "qa_padding";
  if (l.includes("chroma")) return "qa_chroma_edge";
  if (l.includes("bounding box")) return "qa_no_content";
  return "qa_unknown";
}

/** `code: message`, message truncated — the classification is always first. */
export function classifiedLastError(code: FailureCode, message: string): string {
  return `${code}: ${truncate(message, 240)}`;
}

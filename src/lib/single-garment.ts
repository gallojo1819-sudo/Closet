/**
 * The single-garment check: before a cut-out may be stamped matteQuality "clean", a vision
 * helper is asked whether the picture shows exactly one piece. Joe (Oct 16 2026) saw an olive
 * field jacket's elbow patch inside the "Cream cable-knit sweater" plate: the plate was cut
 * from a model shot (sweater under the jacket) and stamped clean with nothing looking.
 *
 * This module is pure. The only producer of a `SingleGarmentCheck` is `checkSingleGarment`,
 * which takes the asker as an argument: the app passes the server function (plate-pass.ts,
 * `askSingleGarment`), tests pass a mocked verdict. Nothing else can build the branded type,
 * so `plateResultPatch` (plate.ts), which requires one, cannot be reached without a check.
 */
import type { CutoutCheck, SingleVerdict } from "./types.ts";

declare const CHECKED: unique symbol;

/** A verdict that went through `checkSingleGarment`. Only this module can make one. */
export type SingleGarmentCheck = CutoutCheck & { readonly [CHECKED]: true };

/** What the vision helper returns. Null is a failed or timed-out call. */
export type RawSingleVerdict = { one?: unknown; why?: unknown } | null | undefined;

export type SingleGarmentAsk = (input: { image: string; noun: string }) => Promise<RawSingleVerdict>;

/** How long the check may take before it is "unclear" (and the plate is busy). */
export const SINGLE_GARMENT_MS = 6000;

/** The word the question names: the subtype, else the category, else "garment". */
export function singleGarmentNoun(g: { subtype?: string; category?: string }): string {
  const sub = (g.subtype ?? "").trim().toLowerCase();
  if (sub) return sub;
  const cat = (g.category ?? "").trim().toLowerCase();
  if (cat === "footwear") return "pair of shoes";
  if (cat === "bottom") return "pair of trousers";
  if (cat && cat !== "other") return cat;
  return "garment";
}

/**
 * A uniform studio ground the catalog itself asks for. #F4EFE6 is the app paper.
 * A room, scenery, a person, a hand, a hanger, or a second garment is not this.
 */
const PAPER_STUDIO =
  /(?:#f4efe6|\bf4efe6\b|\bbeige\b|\boff-white\b|\boff white\b|\bneutral\b|\btransparent\b|\bstudio\b|\bpaper\b)/i;

const CONTAMINATED =
  /\b(second|another|two|extras?|layers?|collars?|sleeves?|trousers?|persons?|people|skin|hairs?|hands?|hangers?|rooms?|scenery|landscapes?|walls?|floors?|furniture|models?|faces?|mannequins?|bodies|body)\b/i;

/** True when `why` names only an allowed studio ground and nothing else in the frame. */
export function paperStudioOnly(why: string): boolean {
  const text = why.trim();
  if (!text || CONTAMINATED.test(text)) return false;
  return PAPER_STUDIO.test(text);
}

/**
 * A "no" whose only reason is the paper the print prompt requested is one garment.
 * Any other "no", and every "unclear", is left alone. An empty why is not accepted.
 */
export function normalizeSingleVerdict(
  one: SingleVerdict,
  why: string,
): { one: SingleVerdict; why: string } {
  if (one === "no" && paperStudioOnly(why)) return { one: "yes", why: "" };
  return { one, why: one === "yes" ? "" : why };
}

/** The question, verbatim. JSON only, like the other checkers. */
export function singleGarmentQuestion(noun: string): string {
  const what = noun.trim() || "garment";
  return (
    `Does this image show exactly one ${what}? ` +
    "A uniform neutral studio background, a transparent background, or the app paper #F4EFE6 is allowed. " +
    'Return ONLY JSON: {"one":"yes|no|unclear","why":""}. ' +
    "one is no when any part of a second garment (a layer worn under or over it, a collar, a sleeve, a trouser leg), " +
    "a person, skin, hair, a hand, a hanger, a room, or scenery is visible. " +
    "A plain beige, off-white, neutral, transparent, or #F4EFE6 paper background alone is not a reason for no. " +
    "one is unclear when you cannot tell. why is a few words, empty on yes. JSON only."
  );
}

function verdictWord(raw: unknown): SingleVerdict {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "yes" || s === "true") return "yes";
  if (s === "no" || s === "false") return "no";
  return "unclear";
}

/** Parse the helper's text. No JSON, or no `one`, is unclear. */
export function parseSingleGarment(text: string): { one: SingleVerdict; why: string } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { one: "unclear", why: "unreadable" };
  try {
    const o = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    if (!("one" in o)) return { one: "unclear", why: "unreadable" };
    const one = verdictWord(o.one);
    const why = typeof o.why === "string" ? o.why.trim().slice(0, 80) : "";
    return normalizeSingleVerdict(one, why);
  } catch {
    return { one: "unclear", why: "unreadable" };
  }
}

function settle(raw: RawSingleVerdict): { one: SingleVerdict; why: string } {
  if (!raw || typeof raw !== "object") return { one: "unclear", why: "no answer" };
  if (typeof raw.one === "string" || typeof raw.one === "boolean") {
    const one = verdictWord(raw.one);
    const why = typeof raw.why === "string" ? raw.why.trim().slice(0, 80) : "";
    return normalizeSingleVerdict(one, why);
  }
  return { one: "unclear", why: "unreadable" };
}

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      },
    );
  });
}

/**
 * The one producer. An empty image is never asked about (unclear, "no image"); a thrown or
 * timed-out ask is unclear. The verdict is stamped with the time it ran.
 */
export async function checkSingleGarment(
  input: { image: string; noun: string },
  ask: SingleGarmentAsk,
  opts: { now?: () => string; timeoutMs?: number } = {},
): Promise<SingleGarmentCheck> {
  const at = (opts.now ?? (() => new Date().toISOString()))();
  const brand = (v: { one: SingleVerdict; why: string }): SingleGarmentCheck =>
    ({ ...v, at }) as SingleGarmentCheck;
  const image = input.image.trim();
  if (!image) return brand({ one: "unclear", why: "no image" });
  const raw = await withDeadline(
    Promise.resolve().then(() => ask({ image, noun: input.noun })),
    opts.timeoutMs ?? SINGLE_GARMENT_MS,
  );
  return brand(settle(raw));
}

/** The stored field for a garment patch: the verdict without the brand. */
export function cutoutCheckOf(check: SingleGarmentCheck): CutoutCheck {
  return { one: check.one, why: check.why, at: check.at };
}

/**
 * Colours read off a clean cut-out (the tag model's palette words), for the re-derive after a
 * re-plate. Empty when the tag failed, saw a person or more than one piece, or named no colour.
 */
export function colorsFromPlateTag(
  tag: { ok: true; colors?: unknown; person?: boolean; count?: number } | { ok: false } | null | undefined,
): string[] {
  if (!tag || !tag.ok) return [];
  if (tag.person === true || (tag.count ?? 1) > 1) return [];
  const raw = Array.isArray(tag.colors) ? tag.colors : [];
  const out: string[] = [];
  for (const c of raw) {
    if (typeof c !== "string") continue;
    const word = c.trim().toLowerCase();
    if (!word || out.includes(word)) continue;
    out.push(word);
    if (out.length >= 4) break;
  }
  return out;
}

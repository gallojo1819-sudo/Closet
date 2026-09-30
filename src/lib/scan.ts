import type { Category } from "./types.ts";
import { isFakeName } from "./rack.ts";

export type ScanKind = "skip" | "garment" | "worn";
export type ScanSlot = "top" | "bottom" | "outerwear" | "footwear" | "accessory";

export type ScanPiece = {
  slot: ScanSlot;
  label: string;
};

export type CropBox = { x: number; y: number; w: number; h: number };

export type WornBox = {
  id: string;
  name: string;
  chip: string;
  category: Category;
  slot: ScanSlot;
  box: CropBox | null;
};

export type ScanClass = {
  kind: ScanKind;
  reason: string;
  pieces: ScanPiece[];
  boxes: WornBox[];
  /** Hand, hanger, arm, or sleeve labels dropped so they are not garments. */
  holders?: string[];
};

const KINDS = new Set<ScanKind>(["skip", "garment", "worn"]);

const KIND_ALIAS: Record<string, ScanKind> = {
  skip: "skip",
  garment: "garment",
  worn: "worn",
  outfit: "worn",
  rail: "worn",
};

const PERSON = /\b(person|people|selfie|face|portrait|body|mannequin|model|head|human)\b/i;
/** A hand or a hanger is not a second garment. "handle" does not match. */
const HOLDER_LABEL = /\b(hands?|hangers?|arms?|sleeves?|fingers?)\b/i;
const HELD_CUE = /\b(hands?|hangers?|held|holding|arms?|sleeves?)\b/i;
const WORN_PERSON = /\b(person|people|selfie|wearing)\b/i;

export const HAND_COVER_MESSAGE = "Cover still has the hand — try again.";
const SKIP_FILE =
  /\b(pizza|food|receipt|screenshot|menu|landscape|meme|invoice|document)\b/i;

const CATEGORY_SET = new Set<Category>([
  "top",
  "bottom",
  "outerwear",
  "dress",
  "footwear",
  "accessory",
  "other",
]);

export function filenameLooksLikeSkip(name: string): boolean {
  return SKIP_FILE.test(name);
}

function coerceSlot(raw: string): ScanSlot | null {
  const s = raw.toLowerCase().trim();
  if (/^(top|shirt|knit|polo|tee|blouse|oxford)$/.test(s)) return "top";
  if (/^(bottom|pants|trousers|chinos?|jeans?|shorts?|cords?)$/.test(s)) return "bottom";
  if (/^(outerwear|outer|jacket|coat|blazer|varsity)$/.test(s)) return "outerwear";
  if (/^(footwear|shoes?|loafers?|mules?|sneakers?|boots?)$/.test(s)) return "footwear";
  if (/^(accessory|hat|cap|belt|bag|scarf)$/.test(s)) return "accessory";
  return null;
}

function slotFromCategory(category: Category): ScanSlot {
  if (category === "bottom") return "bottom";
  if (category === "footwear") return "footwear";
  if (category === "outerwear") return "outerwear";
  if (category === "accessory") return "accessory";
  return "top";
}

function coerceCategory(raw: string, slot: ScanSlot | null): Category {
  const s = raw.toLowerCase().trim();
  if (CATEGORY_SET.has(s as Category) && s !== "other") return s as Category;
  if (slot === "bottom") return "bottom";
  if (slot === "footwear") return "footwear";
  if (slot === "outerwear") return "outerwear";
  if (slot === "accessory") return "accessory";
  if (slot === "top") return "top";
  return "other";
}

function cleanLabel(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 48);
}

export function isHolderLabel(name: string): boolean {
  return HOLDER_LABEL.test(name);
}

function reasonSaysPersonWearing(reason: string): boolean {
  return WORN_PERSON.test(reason);
}

/**
 * Worn is only a person wearing clothes, or two or more garments.
 * One real garment — including one the model called worn because of a hand — is garment.
 */
function settleScanKind(kind: ScanKind, reason: string, realCount: number): ScanKind {
  if (kind === "skip") return "skip";
  if (realCount >= 2) return "worn";
  if (reasonSaysPersonWearing(reason)) return "worn";
  return "garment";
}

export function chipLabel(name: string, category: Category): string {
  const n = name.toLowerCase();
  if (/polo/.test(n)) return "Polo";
  if (/cord/.test(n)) return "Cords";
  if (/loafer/.test(n)) return "Loafers";
  if (/oxford/.test(n)) return "Oxford";
  if (/chino/.test(n)) return "Chinos";
  if (/jean/.test(n)) return "Jeans";
  if (/mule/.test(n)) return "Mules";
  if (/sneaker/.test(n)) return "Sneakers";
  if (/boot/.test(n)) return "Boots";
  if (/knit|sweater|merino|cable/.test(n)) return "Knit";
  if (/varsity|bomber|letterman/.test(n)) return "Varsity";
  if (/blazer/.test(n)) return "Blazer";
  if (/overshirt/.test(n)) return "Overshirt";
  const words = name.trim().split(/\s+/);
  const last = words[words.length - 1] ?? "";
  if (!last || isFakeName(last) || /\bpiece\b/i.test(last) || PERSON.test(last)) {
    if (category === "footwear") return "Shoes";
    if (category === "bottom") return "Trousers";
    if (category === "outerwear") return "Jacket";
    if (category === "accessory") return "Extra";
    return "Top";
  }
  return `${last[0]!.toUpperCase()}${last.slice(1)}`;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function scaleIfPercent(n: number): number {
  return n > 1 && n <= 100 ? n / 100 : n;
}

export function clampBox(b: CropBox): CropBox {
  const x = Math.min(0.95, Math.max(0, b.x));
  const y = Math.min(0.95, Math.max(0, b.y));
  const w = Math.min(1 - x, Math.max(0.04, b.w));
  const h = Math.min(1 - y, Math.max(0.04, b.h));
  return { x, y, w, h };
}

export function padBox(b: CropBox, pad = 0.05): CropBox {
  return clampBox({
    x: b.x - pad,
    y: b.y - pad,
    w: b.w + pad * 2,
    h: b.h + pad * 2,
  });
}

export function parseCropBox(raw: unknown): CropBox | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const nested = o.box && typeof o.box === "object" ? (o.box as Record<string, unknown>) : o;
  const x1 = num(nested.x1);
  const y1 = num(nested.y1);
  const x2 = num(nested.x2);
  const y2 = num(nested.y2);
  if (x1 != null && y1 != null && x2 != null && y2 != null) {
    const a = scaleIfPercent(x1);
    const b = scaleIfPercent(y1);
    const c = scaleIfPercent(x2);
    const d = scaleIfPercent(y2);
    return clampBox({ x: Math.min(a, c), y: Math.min(b, d), w: Math.abs(c - a), h: Math.abs(d - b) });
  }
  const x = num(nested.x) ?? num(nested.left);
  const y = num(nested.y) ?? num(nested.top);
  const w = num(nested.w) ?? num(nested.width);
  const h = num(nested.h) ?? num(nested.height);
  if (x == null || y == null || w == null || h == null) return null;
  return clampBox({
    x: scaleIfPercent(x),
    y: scaleIfPercent(y),
    w: scaleIfPercent(w),
    h: scaleIfPercent(h),
  });
}

export function looksLikeFace(name: string, category: Category, box: CropBox | null): boolean {
  if (PERSON.test(name)) return true;
  if (category === "other" && PERSON.test(name)) return true;
  if (box && box.y < 0.18 && box.h < 0.28 && (category === "other" || PERSON.test(name))) {
    return true;
  }
  return false;
}

function boxFromUnknown(raw: unknown, index: number): WornBox | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = cleanLabel(String(o.name ?? o.label ?? o.chip ?? ""));
  if (!name || isFakeName(name) || isHolderLabel(name)) return null;
  const slot =
    coerceSlot(String(o.slot ?? o.category ?? "")) ??
    (CATEGORY_SET.has(String(o.category ?? "") as Category)
      ? slotFromCategory(String(o.category) as Category)
      : null);
  const category = coerceCategory(String(o.category ?? ""), slot);
  if (category === "other") return null;
  const resolvedSlot = slot ?? slotFromCategory(category);
  const box = parseCropBox(o);
  if (looksLikeFace(name, category, box)) return null;
  return {
    id: `${resolvedSlot}-${index}`,
    name,
    chip: chipLabel(name, category),
    category,
    slot: resolvedSlot,
    box,
  };
}

function pieceFromUnknown(raw: unknown): ScanPiece | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { slot?: unknown; label?: unknown; name?: unknown; category?: unknown };
  const slot =
    coerceSlot(String(o.slot ?? o.category ?? "")) ??
    coerceSlot(String(o.category ?? ""));
  const label = cleanLabel(String(o.label ?? o.name ?? ""));
  if (!slot || !label) return null;
  if (PERSON.test(label) || isFakeName(label) || isHolderLabel(label)) return null;
  return { slot, label };
}

export function sanitizeWornBoxes(boxes: WornBox[]): WornBox[] {
  const out: WornBox[] = [];
  const seen = new Set<string>();
  for (const b of boxes) {
    if (out.length >= 6) break;
    if (looksLikeFace(b.name, b.category, b.box) || isFakeName(b.name)) continue;
    const key = `${b.slot}:${b.chip.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...b,
      id: `${b.slot}-${out.length}`,
      name: cleanLabel(b.name),
      chip: b.chip || chipLabel(b.name, b.category),
      box: b.box ? clampBox(b.box) : null,
    });
  }
  return out;
}

export function sanitizeScanPieces(kind: ScanKind, pieces: ScanPiece[]): ScanPiece[] {
  if (kind === "skip") return [];
  const out: ScanPiece[] = [];
  const seen = new Set<string>();
  const cap = kind === "garment" ? 1 : 6;
  for (const p of pieces) {
    if (out.length >= cap) break;
    if (PERSON.test(p.label) || isFakeName(p.label)) continue;
    const key = `${p.slot}:${p.label.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ slot: p.slot, label: cleanLabel(p.label) });
  }
  return out;
}

export function boxesToPieces(boxes: WornBox[]): ScanPiece[] {
  return boxes.map((b) => ({ slot: b.slot, label: b.name }));
}

/** Parse model JSON. Unknown kind falls back to garment — never invents extra slots. */
export function parseScanClass(text: string): ScanClass {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) {
    return { kind: "garment", reason: "", pieces: [], boxes: [] };
  }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const kindRaw = String(parsed.kind ?? "garment").toLowerCase();
    const kind: ScanKind = KINDS.has(kindRaw as ScanKind)
      ? (kindRaw as ScanKind)
      : (KIND_ALIAS[kindRaw] ?? "garment");
    const reason = String(parsed.reason ?? "").slice(0, 80);
    const rawBoxes = Array.isArray(parsed.boxes)
      ? parsed.boxes
      : Array.isArray(parsed.pieces)
        ? parsed.pieces
        : [];
    const boxes = sanitizeWornBoxes(
      rawBoxes.map((row, i) => boxFromUnknown(row, i)).filter((b): b is WornBox => Boolean(b)),
    );
    const rawPieces = Array.isArray(parsed.pieces) ? parsed.pieces : [];
    const fromPieces = sanitizeScanPieces(
      kind,
      rawPieces.map(pieceFromUnknown).filter((p): p is ScanPiece => Boolean(p)),
    );
    const pieces = boxes.length ? boxesToPieces(boxes) : fromPieces;
    const holders = [...rawBoxes, ...rawPieces]
      .map(rawHolderName)
      .filter((name): name is string => Boolean(name));
    const realCount = boxes.length || pieces.length;
    const settled = settleScanKind(kind, reason, realCount);
    return {
      kind: settled,
      reason,
      pieces: settled === "garment" ? pieces.slice(0, 1) : pieces,
      boxes: settled === "garment" ? boxes.slice(0, 1) : boxes,
      holders,
    };
  } catch {
    return { kind: "garment", reason: "", pieces: [], boxes: [] };
  }
}

function rawHolderName(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = cleanLabel(String(o.name ?? o.label ?? o.chip ?? ""));
  return name && isHolderLabel(name) ? name : null;
}

/** One garment in a hand, on a hanger, or held up — not a clean product plate. */
export function isHeldGarment(scan: {
  kind: ScanKind;
  reason: string;
  holders?: string[];
  pieces?: ScanPiece[];
  boxes?: WornBox[];
}): boolean {
  if (scan.kind !== "garment") return false;
  const blob = [
    scan.reason,
    ...(scan.holders ?? []),
    ...(scan.pieces ?? []).map((p) => p.label),
    ...(scan.boxes ?? []).map((b) => b.name),
  ].join(" ");
  return HELD_CUE.test(blob);
}

/** Positive hand or hanger. "no hand" and "handle" do not count. */
export function coverRejected(checker: string): boolean {
  const raw = checker.trim().toLowerCase();
  if (!raw) return false;
  const negated = raw
    .replace(/\b(?:no|not|without|removed|gone)\s+(?:a\s+|the\s+)?(?:hands?|hangers?)\b/g, " ")
    .replace(/\b(?:hands?|hangers?)\s+(?:removed|gone|absent)\b/g, " ");
  return /\b(?:hands?|hangers?)\b/.test(negated);
}

export function scanCheckerText(scan: {
  ok?: boolean;
  reason?: string;
  holders?: string[];
  boxes?: { name: string }[];
  pieces?: { label: string }[];
} | null): string {
  if (!scan || scan.ok === false) return "";
  return [
    scan.reason ?? "",
    ...(scan.holders ?? []),
    ...(scan.boxes ?? []).map((b) => b.name),
    ...(scan.pieces ?? []).map((p) => p.label),
  ].join(" ");
}

export type CutoutWrite = {
  imageSrc: string;
  cutoutSrc: string;
  message: string | null;
};

/** The photo stays imageSrc. A plate the checker still calls "hand" is not cutoutSrc. */
export function writtenCutout(input: {
  photo: string;
  plate: string | null;
  checker: string;
}): CutoutWrite {
  const reject = Boolean(input.plate) && coverRejected(input.checker);
  if (!input.plate || reject) {
    return {
      imageSrc: input.photo,
      cutoutSrc: input.photo,
      message: reject ? HAND_COVER_MESSAGE : null,
    };
  }
  return { imageSrc: input.photo, cutoutSrc: input.plate, message: null };
}

/**
 * Held garment only. print runs before the tile. No shop-image fetch.
 * imageSrc is always the photo. cutoutSrc is the plate only when the checker accepts it.
 */
export async function placeHeldGarment(opts: {
  photo: string;
  print: (photo: string) => Promise<{ ok: boolean; image?: string }>;
  check: (plate: string) => Promise<string>;
  showTile: (cover: string) => void;
  save: (written: CutoutWrite) => void | Promise<void>;
}): Promise<CutoutWrite> {
  const printed = await opts.print(opts.photo);
  const plate = printed.ok && printed.image ? printed.image : null;
  const checker = plate ? await opts.check(plate) : "";
  const written = writtenCutout({ photo: opts.photo, plate, checker });
  opts.showTile(written.cutoutSrc);
  await opts.save(written);
  return written;
}

/** New tab. Google image search of brand + name. Does not fetch a picture. */
export function findThisHref(brand: string, name: string): string {
  const q = [brand, name]
    .map((s) => s.trim())
    .filter((s) => s && !/^(unknown|n\/a|none|null|unbranded)$/i.test(s))
    .join(" ");
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`;
}

export function slotFitsCategory(slot: ScanSlot, category: Category): boolean {
  switch (slot) {
    case "top":
      return category === "top" || category === "dress";
    case "bottom":
      return category === "bottom";
    case "outerwear":
      return category === "outerwear" || category === "top";
    case "footwear":
      return category === "footwear";
    case "accessory":
      return category === "accessory";
  }
}

/**
 * Drop an extract that is the wrong kind of thing, a person, or invented
 * white footwear when we did not ask for white shoes.
 */
export function looksInventedExtra(
  wanted: ScanPiece,
  got: { name: string; category: Category; colors?: string[] },
): boolean {
  if (PERSON.test(got.name)) return true;
  if (!slotFitsCategory(wanted.slot, got.category)) return true;
  const wantedL = wanted.label.toLowerCase();
  const gotL = got.name.toLowerCase();
  if (got.category !== "footwear") return false;
  const wantedWhite = /white|cream|ivory/.test(wantedL);
  const gotWhite =
    /white|cream|ivory/.test(gotL) ||
    (got.colors ?? []).some((c) => /white|cream|ivory/.test(c));
  if (gotWhite && !wantedWhite) return true;
  if (/mule|sneaker/.test(gotL) && !/mule|sneaker/.test(wantedL) && /loafer|boot|shoe/.test(wantedL)) {
    return true;
  }
  return false;
}

/** Source JPEG hash plus any `hash:slot:i` piece hashes already on the rack. */
export function collectKnownHashes(
  fileHashes: Array<string | undefined | null>,
): Set<string> {
  const known = new Set<string>();
  for (const h of fileHashes) {
    if (!h) continue;
    known.add(h);
    const i = h.indexOf(":");
    if (i > 0) known.add(h.slice(0, i));
  }
  return known;
}

export function pieceFileHash(sourceHash: string, slot: ScanSlot, index: number): string {
  return `${sourceHash}:${slot}:${index}`;
}

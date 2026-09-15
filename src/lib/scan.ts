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

function looksLikeFace(name: string, category: Category, box: CropBox | null): boolean {
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
  if (!name || isFakeName(name)) return null;
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
  if (PERSON.test(label) || isFakeName(label)) return null;
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
    return { kind, reason, pieces, boxes };
  } catch {
    return { kind: "garment", reason: "", pieces: [], boxes: [] };
  }
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

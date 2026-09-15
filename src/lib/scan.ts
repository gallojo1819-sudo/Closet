import type { Category } from "./types.ts";
import { isFakeName } from "./rack.ts";

export type ScanKind = "skip" | "garment" | "outfit" | "rail";
export type ScanSlot = "top" | "bottom" | "outerwear" | "footwear" | "accessory";

export type ScanPiece = {
  slot: ScanSlot;
  label: string;
};

export type ScanClass = {
  kind: ScanKind;
  reason: string;
  pieces: ScanPiece[];
};

const KINDS = new Set<ScanKind>(["skip", "garment", "outfit", "rail"]);

const PERSON = /\b(person|people|selfie|face|portrait|body|mannequin|model|man|woman|guy|human)\b/i;
const SKIP_FILE =
  /\b(pizza|food|receipt|screenshot|menu|landscape|meme|invoice|document)\b/i;

export function filenameLooksLikeSkip(name: string): boolean {
  return SKIP_FILE.test(name);
}

function coerceSlot(raw: string): ScanSlot | null {
  const s = raw.toLowerCase().trim();
  if (/^(top|shirt|knit|polo|tee|blouse|oxford)$/.test(s)) return "top";
  if (/^(bottom|pants|trousers|chinos?|jeans?|shorts?)$/.test(s)) return "bottom";
  if (/^(outerwear|outer|jacket|coat|blazer|varsity)$/.test(s)) return "outerwear";
  if (/^(footwear|shoes?|loafers?|mules?|sneakers?|boots?)$/.test(s)) return "footwear";
  if (/^(accessory|hat|cap|belt|bag|scarf)$/.test(s)) return "accessory";
  if (s === "top" || s === "bottom" || s === "outerwear" || s === "footwear" || s === "accessory") {
    return s;
  }
  return null;
}

function cleanLabel(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 48);
}

function pieceFromUnknown(raw: unknown): ScanPiece | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { slot?: unknown; label?: unknown; name?: unknown };
  const slot = coerceSlot(String(o.slot ?? ""));
  const label = cleanLabel(String(o.label ?? o.name ?? ""));
  if (!slot || !label) return null;
  if (PERSON.test(label) || isFakeName(label)) return null;
  return { slot, label };
}

/** Parse model JSON. Unknown kind falls back to garment — never invents extra slots. */
export function parseScanClass(text: string): ScanClass {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) {
    return { kind: "garment", reason: "", pieces: [] };
  }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const kindRaw = String(parsed.kind ?? "garment").toLowerCase();
    const kind: ScanKind = KINDS.has(kindRaw as ScanKind)
      ? (kindRaw as ScanKind)
      : "garment";
    const reason = String(parsed.reason ?? "").slice(0, 80);
    const rawPieces = Array.isArray(parsed.pieces) ? parsed.pieces : [];
    const pieces = sanitizeScanPieces(
      kind,
      rawPieces.map(pieceFromUnknown).filter((p): p is ScanPiece => Boolean(p)),
    );
    return { kind, reason, pieces };
  } catch {
    return { kind: "garment", reason: "", pieces: [] };
  }
}

export function sanitizeScanPieces(kind: ScanKind, pieces: ScanPiece[]): ScanPiece[] {
  if (kind === "skip") return [];
  const out: ScanPiece[] = [];
  const seen = new Set<string>();
  const cap = kind === "garment" ? 1 : kind === "outfit" ? 4 : 8;
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

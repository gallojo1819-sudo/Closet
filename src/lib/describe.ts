import { titleColor } from "./color.ts";
import type { Category, Garment } from "./types.ts";

function colorLead(g: Garment): string {
  if (g.colors[0]) return titleColor(g.colors[0]);
  const m = g.name.match(
    /^(dark |light |pale |bright |deep |off )?([a-z]+(?: [a-z]+)?)\s+/i,
  );
  return m ? titleColor((m[1] ?? "") + (m[2] ?? "")) : "";
}

/** Drawstring / empty / "Piece" — not a name he chose. */
export function isPlaceholderName(name: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (/^piece$/i.test(n)) return true;
  if (/drawstring/i.test(n)) return true;
  return false;
}

/**
 * Notes describe the make. Gurkha / no belt / not a drawstring → subtype gurkha,
 * bottom, and retitle when the name does not already say gurkha.
 */
function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("image"));
    el.src = src;
  });
}

function garmentMask(img: HTMLImageElement): boolean[] {
  const w = 24;
  const h = 30;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const bits: boolean[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    bits.push(!(r > 220 && g > 210 && b > 200));
  }
  return bits;
}

/** True when Imagine reprinted the same plate instead of changing construction. */
export async function coversSameSilhouette(a: string, b: string): Promise<boolean> {
  if (typeof document === "undefined") return false;
  if (a === b) return true;
  try {
    const [ia, ib] = await Promise.all([loadImg(a), loadImg(b)]);
    const A = garmentMask(ia);
    const B = garmentMask(ib);
    if (!A.length || A.length !== B.length) return false;
    let same = 0;
    for (let i = 0; i < A.length; i++) if (A[i] === B[i]) same += 1;
    return same / A.length > 0.94;
  } catch {
    return false;
  }
}

export function patchFromNotes(g: Garment, notes: string): Partial<Garment> {
  const text = notes.trim();
  const patch: Partial<Garment> = { notes: text };
  const blob = `${text} ${g.subtype} ${g.name}`.toLowerCase();
  if (
    /gurkha|extended\s+waist|\bbuckle|no\s*belt|not\s+a\s+drawstring|not\s+drawstring/.test(
      blob,
    )
  ) {
    patch.subtype = "gurkha";
    patch.category = "bottom" as Category;
    if (!/gurkha/i.test(g.name)) {
      const color = colorLead(g);
      patch.name = color ? `${color} Gurkha trousers` : "Gurkha trousers";
    }
  }
  return patch;
}

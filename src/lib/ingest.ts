/**
 * Phone add pipeline. Shrink first so an 8–12MP camera JPEG never hits matte/Imagine.
 * addGarment happens before printGarment. Tests must not touch closet.v6.
 */

import { HEIC_ERROR } from "./camera.ts";

export const ADD_SHRINK_EDGE = 1280;
export const ADD_SHRINK_QUALITY = 0.82;
export const ADD_TILE_BUDGET_MS = 300;
export const PRINT_TIMEOUT_MS = 12_000;
export const ADDING_NAME = "Adding…";
export const NEW_PIECE_NAME = "New piece";
export { HEIC_ERROR };

export type IngestStep = "shrink" | "preview" | "matte" | "save" | "tag" | "print";

export function ingestSteps(): IngestStep[] {
  return ["shrink", "preview", "matte", "save", "tag", "print"];
}

export function saveBeforeImagine(steps: IngestStep[] = ingestSteps()): boolean {
  return steps.indexOf("save") < steps.indexOf("print");
}

export function addQueueConcurrency(input: {
  width?: number;
  connectionType?: string;
  effectiveType?: string;
}): 2 | 3 {
  if ((input.width ?? 1024) < 600) return 2;
  const type = (input.connectionType ?? "").toLowerCase();
  const effective = (input.effectiveType ?? "").toLowerCase();
  if (
    type === "cellular" ||
    effective === "slow-2g" ||
    effective === "2g" ||
    effective === "3g"
  ) {
    return 2;
  }
  return 3;
}

export function readAddConcurrency(): 2 | 3 {
  const conn =
    typeof navigator !== "undefined"
      ? (
          navigator as Navigator & {
            connection?: { type?: string; effectiveType?: string };
          }
        ).connection
      : undefined;
  return addQueueConcurrency({
    width: typeof window !== "undefined" ? window.innerWidth : 1024,
    connectionType: conn?.type,
    effectiveType: conn?.effectiveType,
  });
}

export function addProgress(done: number, total: number, name?: string): string {
  const label = name && name !== ADDING_NAME ? name : undefined;
  return label ? `${done}/${total} — ${label}` : `${done}/${total}`;
}

export type IngestShrink = { dataUrl: string; objectUrl: string };

export type IngestDeps = {
  now?: () => number;
  shrink: (file: File) => Promise<IngestShrink>;
  matte: (dataUrl: string) => Promise<{ cutoutSrc: string; kind: string }>;
  save: (input: { id: string; original: string; cover: string; name: string }) => Promise<void>;
  tag: (cover: string) => Promise<{ name: string }>;
  enqueuePrint: (id: string, original: string) => void;
  onPreview: (input: { id: string; name: string; cutout: string }) => void;
  patchName?: (name: string) => void;
  guessName?: string;
};

export async function runIngestPiece(
  file: File,
  id: string,
  deps: IngestDeps,
): Promise<{ previewMs: number; steps: IngestStep[] }> {
  const now = deps.now ?? Date.now;
  const started = now();
  const steps: IngestStep[] = [];

  const shrunk = await deps.shrink(file);
  steps.push("shrink");
  deps.onPreview({ id, name: ADDING_NAME, cutout: shrunk.objectUrl });
  steps.push("preview");
  const previewMs = now() - started;

  const matte = await deps.matte(shrunk.dataUrl);
  steps.push("matte");
  const savedName =
    deps.guessName && deps.guessName.trim() && deps.guessName !== ADDING_NAME
      ? deps.guessName
      : NEW_PIECE_NAME;
  await deps.save({
    id,
    original: shrunk.dataUrl,
    cover: matte.cutoutSrc,
    name: savedName,
  });
  steps.push("save");

  try {
    const tagged = await deps.tag(matte.cutoutSrc);
    if (tagged?.name) deps.patchName?.(tagged.name);
  } catch {
    /* tag 403 / hang — garment stays */
  }
  steps.push("tag");
  try {
    deps.enqueuePrint(id, shrunk.dataUrl);
  } catch {
    /* print reject — garment stays */
  }
  steps.push("print");

  return { previewMs, steps };
}

export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Fast shrink: createImageBitmap + canvas. Never FileReader the 12MP original. */
export async function shrinkFile(
  file: File,
  maxEdge = ADD_SHRINK_EDGE,
  quality = ADD_SHRINK_QUALITY,
): Promise<IngestShrink> {
  let bitmap: ImageBitmap | null = null;
  let fallbackUrl: string | null = null;
  try {
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(file);
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height, 1));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas");
      ctx.drawImage(bitmap, 0, 0, w, h);
      const blob = await canvasToJpeg(canvas, quality);
      const objectUrl = URL.createObjectURL(blob);
      const dataUrl = await blobToDataUrl(blob);
      return { dataUrl, objectUrl };
    }
    fallbackUrl = URL.createObjectURL(file);
    const img = await loadImg(fallbackUrl);
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight, 1));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await canvasToJpeg(canvas, quality);
    const objectUrl = URL.createObjectURL(blob);
    const dataUrl = await blobToDataUrl(blob);
    return { dataUrl, objectUrl };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Couldn't read that photo/i.test(msg)) throw e;
    throw new Error(HEIC_ERROR);
  } finally {
    bitmap?.close();
    if (fallbackUrl) URL.revokeObjectURL(fallbackUrl);
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("blob"))),
      "image/jpeg",
      quality,
    );
  });
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("image"));
    el.src = src;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read"));
    r.readAsDataURL(blob);
  });
}

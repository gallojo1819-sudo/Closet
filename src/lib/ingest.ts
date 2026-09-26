/**
 * Phone add pipeline. Shrink first so an 8–12MP camera JPEG never hits matte/Imagine.
 * addGarment happens before printGarment. Tests must not touch closet.v6.
 */

import { CAMERA_EDGE, CAMERA_JPEG, HEIC_ERROR, PENDING_CAMERA_FLAG, PENDING_CAMERA_KEY } from "./camera.ts";

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

export type IngestShrink = { dataUrl: string; objectUrl: string; blob?: Blob };

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

export type CameraShotDeps = {
  /** Small JPEG only. Must not be awaited before the tile is on screen. */
  putPending?: (blob: Blob) => Promise<void>;
  markPending?: () => void;
  clearPending?: () => Promise<void>;
  shrink: (file: File) => Promise<IngestShrink>;
  matte?: (dataUrl: string) => Promise<{ cutoutSrc?: string }>;
  guess?: (dataUrl: string) => Promise<{ name: string } | null>;
  save: (input: {
    original: string;
    cover: string;
    name: string;
    hash: string;
    fellBack: boolean;
    blob?: Blob;
  }) => Promise<void>;
  onPreview: (src: string) => void;
  /** Fired when the shrunk tile is visible. Clear “Saving the shot…”. */
  onShown?: () => void;
  onCover?: (cover: string) => void;
  onName?: (name: string) => void;
  revoke?: (url: string) => void;
  hash?: (file: Blob) => Promise<string>;
  knownHashes?: Set<string>;
  /** Must stay unused. Camera ingest does not rebuild the lookbook. */
  ensureLookbook?: () => void;
};

/**
 * Take photo. Shrink first, show the tile, then save.
 * Matte and guess run after addGarment and must not block the tile.
 * Does not call ensureLookbook. Does not write the raw file.
 */
export async function ingestCameraShot(file: File, deps: CameraShotDeps): Promise<void> {
  void deps.ensureLookbook;
  let shrunk: IngestShrink;
  try {
    shrunk = await deps.shrink(file);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === HEIC_ERROR || /heic/i.test(msg)) throw new Error(HEIC_ERROR);
    throw new Error(HEIC_ERROR);
  }
  const hash = deps.hash && shrunk.blob ? await deps.hash(shrunk.blob) : "";
  if (hash && deps.knownHashes?.has(hash)) {
    await deps.clearPending?.();
    return;
  }
  const tile = shrunk.objectUrl || shrunk.dataUrl;
  deps.onPreview(tile);
  deps.onShown?.();
  const pendingWrite =
    shrunk.blob && deps.putPending
      ? deps.putPending(shrunk.blob).then(() => deps.markPending?.()).catch(() => {})
      : Promise.resolve();
  await deps.save({
    original: shrunk.dataUrl || tile,
    cover: tile,
    name: NEW_PIECE_NAME,
    hash,
    fellBack: true,
    blob: shrunk.blob,
  });
  void pendingWrite.then(() => deps.clearPending?.());
  const photo = tile;
  void (async () => {
    let cover = photo;
    if (deps.matte) {
      const matte = await withTimeout(deps.matte(photo), 4000);
      const next = matte?.cutoutSrc?.trim() ?? "";
      if (next) {
        cover = next;
        deps.onCover?.(next);
      }
    }
    if (deps.guess) {
      const guess = await withTimeout(deps.guess(cover), 4000);
      if (guess?.name) deps.onName?.(guess.name);
    }
  })();
}

export { PENDING_CAMERA_KEY, PENDING_CAMERA_FLAG, CAMERA_EDGE, CAMERA_JPEG };

export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
    (timer as unknown as { unref?: () => void }).unref?.();
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Resize box whose long edge is `edge`. Does not decode pixels. */
export function longEdgeBox(
  width: number,
  height: number,
  edge: number,
): { resizeWidth: number; resizeHeight: number } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const long = Math.max(w, h);
  if (long <= edge) return { resizeWidth: w, resizeHeight: h };
  const scale = edge / long;
  return {
    resizeWidth: Math.max(1, Math.round(w * scale)),
    resizeHeight: Math.max(1, Math.round(h * scale)),
  };
}

/**
 * JPEG size after EXIF orientation, from the header only.
 * Returns null when the file is not a JPEG or the SOF is missing.
 */
export function jpegOrientedSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let width = 0;
  let height = 0;
  let orientation = 1;
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1] ?? 0;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    const len = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
    if (len < 2 || i + 2 + len > bytes.length) break;
    if (marker === 0xe1 && orientation === 1) {
      orientation = exifOrientation(bytes.subarray(i + 4, i + 2 + len)) ?? 1;
    }
    const sof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (sof) {
      if (i + 9 >= bytes.length) return null;
      height = ((bytes[i + 5] ?? 0) << 8) | (bytes[i + 6] ?? 0);
      width = ((bytes[i + 7] ?? 0) << 8) | (bytes[i + 8] ?? 0);
      break;
    }
    i += 2 + len;
  }
  if (width < 1 || height < 1) return null;
  if (orientation >= 5 && orientation <= 8) return { width: height, height: width };
  return { width, height };
}

function exifOrientation(segment: Uint8Array): number | null {
  if (segment.length < 16) return null;
  if (segment[0] !== 0x45 || segment[1] !== 0x78 || segment[2] !== 0x69 || segment[3] !== 0x66) {
    return null;
  }
  const tiff = 6;
  const le = segment[tiff] === 0x49 && segment[tiff + 1] === 0x49;
  const u16 = (o: number) =>
    le ? (segment[o] ?? 0) | ((segment[o + 1] ?? 0) << 8) : ((segment[o] ?? 0) << 8) | (segment[o + 1] ?? 0);
  const u32 = (o: number) =>
    le
      ? (segment[o] ?? 0) |
        ((segment[o + 1] ?? 0) << 8) |
        ((segment[o + 2] ?? 0) << 16) |
        ((segment[o + 3] ?? 0) << 24)
      : ((segment[o] ?? 0) << 24) |
        ((segment[o + 1] ?? 0) << 16) |
        ((segment[o + 2] ?? 0) << 8) |
        (segment[o + 3] ?? 0);
  if (tiff + 8 > segment.length) return null;
  const ifd = tiff + u32(tiff + 4);
  if (ifd < 0 || ifd + 2 > segment.length) return null;
  const count = u16(ifd);
  for (let n = 0; n < count; n++) {
    const entry = ifd + 2 + n * 12;
    if (entry + 10 > segment.length) return null;
    if (u16(entry) === 0x0112) return u16(entry + 8);
  }
  return null;
}

/** createImageBitmap options. Long edge is `edge`. Never the full sensor size. */
export function cameraBitmapOptions(
  width: number,
  height: number,
  edge = CAMERA_EDGE,
): { resizeWidth: number; resizeHeight: number; resizeQuality: "medium" } {
  const box = longEdgeBox(width, height, edge);
  return { resizeWidth: box.resizeWidth, resizeHeight: box.resizeHeight, resizeQuality: "medium" };
}

/** Fast shrink. Header size, then one resized bitmap and one JPEG. No raw IDB write. */
export async function shrinkFile(
  file: File,
  maxEdge = ADD_SHRINK_EDGE,
  quality = ADD_SHRINK_QUALITY,
  withDataUrl = true,
): Promise<IngestShrink> {
  let bitmap: ImageBitmap | null = null;
  let fallbackUrl: string | null = null;
  try {
    if (typeof createImageBitmap === "function") {
      const header = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
      const sized = jpegOrientedSize(header);
      const resize = sized ? cameraBitmapOptions(sized.width, sized.height, maxEdge) : null;
      bitmap = await createImageBitmap(
        file,
        (resize ?? { resizeWidth: maxEdge, resizeQuality: "medium" }) as ImageBitmapOptions,
      );
      const long = Math.max(bitmap.width, bitmap.height, 1);
      const scale = Math.min(1, maxEdge / long);
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
      const dataUrl = withDataUrl ? await blobToDataUrl(blob) : "";
      return { dataUrl, objectUrl, blob };
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
    const dataUrl = withDataUrl ? await blobToDataUrl(blob) : "";
    return { dataUrl, objectUrl, blob };
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

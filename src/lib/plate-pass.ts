import { classifyScan, printGarment } from "./ai.ts";
import { fetchCloudBlob } from "./cloud/blobs.ts";
import { isCloudSrc, parseCloudSrc } from "./cloud/src.ts";
import { withTimeout } from "./ingest.ts";
import {
  blobToDataUrl,
  cloudImageKey,
  dataUrlToBlob,
  getImage,
  imageKey,
  isIdbKey,
  putImage,
  putThumb,
} from "./images.ts";
import { coverIsOriginal, plateResultPatch, rawOuterwearCovers, runPlatePass } from "./plate.ts";
import { placeHeldGarment, scanCheckerText } from "./scan.ts";
import { useCloset } from "./store.ts";

const autoStarted = new Set<string>();
const inflight = new Map<string, Promise<void>>();

async function shrinkForPrint(src: string, max: number): Promise<string> {
  if (typeof document === "undefined") return src;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("resize"));
    el.src = src;
  });
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

/** Original photo bytes. Does not change imageSrc. */
async function readPhoto(id: string, src: string): Promise<string | null> {
  if (src.startsWith("data:")) return src;
  if (isIdbKey(src)) {
    const blob = await getImage(src);
    return blob ? blobToDataUrl(blob) : null;
  }
  if (isCloudSrc(src)) {
    const parsed = parseCloudSrc(src);
    const kind = parsed?.kind ?? "o";
    await fetchCloudBlob(id, kind, parsed?.userId, src);
    const blob =
      (parsed ? await getImage(cloudImageKey(parsed.path)) : null) ||
      (await getImage(imageKey(id, kind)));
    return blob ? blobToDataUrl(blob) : null;
  }
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    return blobToDataUrl(await res.blob());
  } catch {
    return null;
  }
}

/** Same held-jacket print as a camera shot. imageSrc is not written. */
export function makePlate(id: string): Promise<void> {
  const existing = inflight.get(id);
  if (existing) return existing;
  const job = printOnePlate(id).finally(() => {
    inflight.delete(id);
  });
  inflight.set(id, job);
  return job;
}

async function printOnePlate(id: string): Promise<void> {
  const g = useCloset.getState().garments.find((item) => item.id === id);
  if (!g || g.archived) return;
  if (!coverIsOriginal(g) && g.reprint !== true) return;
  try {
    const photo = await readPhoto(g.id, g.imageSrc);
    if (!photo) {
      useCloset.getState().updateGarment(id, { reprint: true });
      return;
    }
    const written = await placeHeldGarment({
      photo,
      print: async (src, attempt) => {
        try {
          const image = await shrinkForPrint(src, 1024);
          return await printGarment({
            data: { image, held: true, retry: Boolean(attempt?.retry) },
          });
        } catch {
          return { ok: false, error: "print" };
        }
      },
      check: async (plate) => {
        try {
          const image = await shrinkForPrint(plate, 768);
          const scan = await withTimeout(
            classifyScan({ data: { image } }).catch(() => null),
            4000,
          );
          return scanCheckerText(scan);
        } catch {
          return "";
        }
      },
      showTile: () => {},
      save: () => {},
    });
    const plateKey = imageKey(id, "c");
    const patch = plateResultPatch(g.imageSrc, written, plateKey);
    if (patch.reprint === false && written.cutoutSrc.startsWith("data:")) {
      await putImage(plateKey, dataUrlToBlob(written.cutoutSrc));
      await putThumb(id, written.cutoutSrc).catch(() => {});
    }
    if (!useCloset.getState().garments.some((item) => item.id === id)) return;
    useCloset.getState().updateGarment(id, patch);
  } catch {
    if (useCloset.getState().garments.some((item) => item.id === id)) {
      useCloset.getState().updateGarment(id, { reprint: true });
    }
  }
}

/** Fire-and-forget. Does not wait, and does not reprint an id twice this session. */
export function scheduleOuterwearPlates(): void {
  const items = rawOuterwearCovers(useCloset.getState().garments).filter(
    (g) => g.id && !autoStarted.has(g.id),
  );
  for (const g of items) {
    if (g.id) autoStarted.add(g.id);
  }
  if (!items.length) return;
  void runPlatePass(items, (g) => makePlate(g.id!), 2);
}

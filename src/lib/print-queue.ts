import { printGarment, tagGarment } from "./ai.ts";
import { dataUrlToBlob, imageKey, putImage, putThumb } from "./images.ts";
import { PRINT_TIMEOUT_MS, withTimeout } from "./ingest.ts";
import { isFakeName } from "./rack.ts";
import { useCloset } from "./store.ts";
import { guessTuck } from "./tuck.ts";

let chain: Promise<void> = Promise.resolve();

async function toLocalDataUrl(src: string): Promise<string> {
  if (src.startsWith("data:")) return src;
  const blob = await (await fetch(src)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("print"));
    r.readAsDataURL(blob);
  });
}

async function shrinkJpeg(src: string, max: number, q = 0.85): Promise<string> {
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
  return c.toDataURL("image/jpeg", q);
}

/**
 * Imagine one at a time, after the garment is already in the closet.
 * 12s timeout keeps the matte.
 */
let tagChain: Promise<void> = Promise.resolve();

async function shrinkForAi(src: string): Promise<string> {
  try {
    return await shrinkJpeg(src, 768, 0.82);
  } catch {
    return src;
  }
}

/** Tag after the garment is already in the closet. 12s timeout keeps "New piece". */
export function enqueueTag(id: string, cover: string): void {
  tagChain = tagChain.then(async () => {
    if (!useCloset.getState().garments.some((g) => g.id === id)) return;
    try {
      const tag = await withTimeout(
        tagGarment({ data: { image: await shrinkForAi(cover) } }),
        PRINT_TIMEOUT_MS,
      );
      if (!tag?.ok || !tag.name || isFakeName(tag.name)) return;
      if (!useCloset.getState().garments.some((g) => g.id === id)) return;
      useCloset.getState().updateGarment(id, {
        name: tag.name,
        category: tag.category,
        subtype: tag.subtype,
        colors: tag.colors,
        material: tag.material,
        brand: tag.brand,
        fit: tag.fit,
        formality: tag.formality,
        warmth: tag.warmth,
        tuck: tag.tuck ?? guessTuck({ name: tag.name, subtype: tag.subtype ?? "", notes: "" }),
      });
    } catch {
      /* keep guess / New piece */
    }
  });
}

export function enqueuePrint(id: string, original: string): void {
  chain = chain.then(async () => {
    if (!useCloset.getState().garments.some((g) => g.id === id)) return;
    try {
      const print = await withTimeout(
        printGarment({ data: { image: await shrinkJpeg(original, 1024) } }),
        PRINT_TIMEOUT_MS,
      );
      if (!print?.ok) return;
      if (!useCloset.getState().garments.some((g) => g.id === id)) return;
      const cutout = await shrinkJpeg(await toLocalDataUrl(print.image), 900, 0.85);
      await putImage(imageKey(id, "c"), dataUrlToBlob(cutout));
      await putThumb(id, cutout).catch(() => {});
      useCloset.getState().updateGarment(id, {
        cutoutSrc: imageKey(id, "c"),
        imageSource: "cutout",
      });
    } catch {
      /* keep the matte */
    }
  });
}

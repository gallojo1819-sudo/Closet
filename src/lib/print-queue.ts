import { printGarment, tagGarment } from "./ai.ts";
import { CAMERA_TAG_MS, decideCameraTag } from "./camera-tag.ts";
import { getAccount } from "./cloud/account.ts";
import { getSupabase } from "./cloud/client.ts";
import { garmentV2Fields, garmentWriter, mirrorGarmentFields } from "./data/mirror.ts";
import { dataUrlToBlob, imageKey, putImage, putThumb } from "./images.ts";
import { PRINT_TIMEOUT_MS, withTimeout } from "./ingest.ts";
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
        CAMERA_TAG_MS,
      );
      if (!useCloset.getState().garments.some((g) => g.id === id)) return;
      const decision = decideCameraTag(tag);
      if (decision.action !== "update") return;
      const patch = decision.patch;
      const tagged = tag && tag.ok ? tag : null;
      useCloset.getState().updateGarment(id, {
        name: patch.name,
        category: patch.category,
        subtype: patch.subtype,
        colors: patch.colors,
        material: patch.material,
        ...(patch.brand ? { brand: patch.brand } : {}),
        ...(tagged
          ? {
              fit: tagged.fit,
              formality: tagged.formality,
              warmth: tagged.warmth,
              tuck: tagged.tuck ?? guessTuck({ name: patch.name, subtype: patch.subtype, notes: "" }),
            }
          : {}),
      });
      void mirrorGarmentFields(
        garmentWriter(getSupabase()),
        getAccount().user?.id ?? null,
        garmentV2Fields({ id, ...patch, subtype: patch.subtype }),
      ).catch(() => false);
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

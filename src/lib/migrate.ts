/**
 * One-time move: garments persisted with inline data URLs (pre-IDB) get their
 * pixels written to IndexedDB, and persist keeps only the "idb:" keys.
 */
import { imageKey, stashDataUrl } from "./images";
import { useCloset } from "./store";

export async function migrateImagesToIdb(): Promise<void> {
  const { garments, updateGarment } = useCloset.getState();
  for (const g of garments) {
    const patch: { imageSrc?: string; cutoutSrc?: string } = {};
    if (g.imageSrc.startsWith("data:")) {
      patch.imageSrc = await stashDataUrl(imageKey(g.id, "o"), g.imageSrc);
    }
    if (g.cutoutSrc.startsWith("data:")) {
      patch.cutoutSrc = await stashDataUrl(imageKey(g.id, "c"), g.cutoutSrc);
    }
    if (patch.imageSrc || patch.cutoutSrc) updateGarment(g.id, patch);
  }
}

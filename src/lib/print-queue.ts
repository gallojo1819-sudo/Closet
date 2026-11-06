import { printGarment, tagGarment, type TagResult } from "./ai.ts";
import { CAMERA_TAG_MS, decideCameraTag, type CameraPatch, type CameraTag, type CameraTagDecision } from "./camera-tag.ts";
import { getAccount } from "./cloud/account.ts";
import { getSupabase } from "./cloud/client.ts";
import { garmentV2Fields, garmentWriter, mirrorGarmentFields } from "./data/mirror.ts";
import { dataUrlToBlob, imageKey, putImage, putThumb } from "./images.ts";
import { NEW_PIECE_NAME, withTimeout } from "./ingest.ts";
import { isFakeName } from "./rack.ts";
import { judgeHeldPlate } from "./packshot-search.ts";
import { cropHeldPhoto, guardedPlatePatch, noteGarmentCoverBytes } from "./plate-pass.ts";
import { hasCleanCover, keptPlateKey } from "./plate.ts";
import { holderCheckerText, looksLikeFace, placeHeldGarment } from "./scan.ts";
import type { Category, Garment } from "./types.ts";
import { singleGarmentNoun } from "./single-garment.ts";
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

/** A single classifyScan box: name and category only. No invented subtype. */
export type TagHint = { name: string; category: Category };

export function singleBoxHint(
  scan: {
    ok: boolean;
    kind?: string;
    boxes?: { name: string; category: Category; box: { x: number; y: number; w: number; h: number } | null }[];
  } | null,
): TagHint | null {
  if (!scan?.ok || scan.kind !== "garment" || !scan.boxes) return null;
  const boxes = scan.boxes.filter((b) => b.name && !looksLikeFace(b.name, b.category, b.box));
  if (boxes.length !== 1) return null;
  const name = boxes[0]!.name.trim().slice(0, 48);
  if (!name || isFakeName(name)) return null;
  return { name, category: boxes[0]!.category };
}

type TagFn = (image: string) => Promise<CameraTag>;

function chosenPatch(decision: CameraTagDecision): CameraPatch | null {
  if (decision.action === "update") return decision.patch;
  if (decision.action === "worn" && decision.fallback) return decision.fallback;
  return null;
}

async function readTag(tag: TagFn, image: string, ms: number): Promise<CameraTag> {
  try {
    return await withTimeout(tag(image), ms);
  } catch {
    return null;
  }
}

function tagExtras(tag: CameraTag, patch: CameraPatch): Partial<Garment> {
  if (!tag || tag.ok !== true || !("formality" in tag)) return {};
  const full = tag as Extract<TagResult, { ok: true }>;
  return {
    fit: full.fit,
    formality: full.formality,
    warmth: full.warmth,
    tuck: full.tuck ?? guessTuck({ name: patch.name, subtype: patch.subtype, notes: "" }),
  };
}

type RowStamp = {
  name: string;
  category: string;
  subtype: string;
  colors: string;
  material: string;
};

function stampOf(g: { name: string; category: string; subtype?: string; colors?: string[]; material?: string }): RowStamp {
  return {
    name: g.name,
    category: g.category,
    subtype: g.subtype ?? "",
    colors: (g.colors ?? []).join("\u0000"),
    material: g.material ?? "",
  };
}

function rowEdited(id: string, snap: RowStamp): boolean {
  const g = useCloset.getState().garments.find((item) => item.id === id);
  if (!g) return true;
  const now = stampOf(g);
  return (
    now.name !== snap.name ||
    now.category !== snap.category ||
    now.subtype !== snap.subtype ||
    now.colors !== snap.colors ||
    now.material !== snap.material
  );
}

function applyTag(id: string, patch: CameraPatch, tag: CameraTag, mirror?: () => void) {
  useCloset.getState().updateGarment(id, {
    name: patch.name,
    category: patch.category,
    subtype: patch.subtype,
    colors: patch.colors,
    material: patch.material,
    needsCategory: false,
    ...(patch.brand ? { brand: patch.brand } : {}),
    ...tagExtras(tag, patch),
  });
  if (mirror) {
    mirror();
    return;
  }
  void mirrorGarmentFields(
    garmentWriter(getSupabase()),
    getAccount().user?.id ?? null,
    garmentV2Fields({ id, ...patch, subtype: patch.subtype }),
  ).catch(() => false);
}

function applyHint(id: string, hint: TagHint | null | undefined) {
  if (!hint) return;
  const g = useCloset.getState().garments.find((item) => item.id === id);
  if (!g || g.name !== NEW_PIECE_NAME || g.category !== "other") return;
  useCloset.getState().updateGarment(id, { name: hint.name, category: hint.category });
}

function markUnnamed(id: string) {
  const g = useCloset.getState().garments.find((item) => item.id === id);
  if (!g || g.name !== NEW_PIECE_NAME) return;
  useCloset.getState().updateGarment(id, { needsCategory: true });
}

/**
 * Tag after the garment is already in the closet. One retry on a timeout or a failure.
 * A worn decision that carries a fallback (a jacket, a pair of shoes) is applied.
 * Both failures leave "New piece" and the needs-category flag. Tests inject `tag`.
 */
export function enqueueTag(
  id: string,
  cover: string,
  opts?: { tag?: TagFn; hint?: TagHint | null; timeoutMs?: number; mirror?: () => void },
): Promise<void> {
  const run = tagChain.then(async () => {
    const started = useCloset.getState().garments.find((g) => g.id === id);
    if (!started) return;
    let snap = stampOf(started);
    const tagFn = opts?.tag ?? ((image: string) => tagGarment({ data: { image } }));
    const ms = opts?.timeoutMs ?? CAMERA_TAG_MS;
    try {
      const image = await shrinkForAi(cover);
      let reply = await readTag(tagFn, image, ms);
      let patch = chosenPatch(decideCameraTag(reply));
      if (!patch) {
        if (!rowEdited(id, snap)) {
          applyHint(id, opts?.hint);
          const hinted = useCloset.getState().garments.find((g) => g.id === id);
          if (hinted) snap = stampOf(hinted);
        }
        if (!useCloset.getState().garments.some((g) => g.id === id)) return;
        reply = await readTag(tagFn, image, ms);
        patch = chosenPatch(decideCameraTag(reply));
        if (!patch) {
          if (!rowEdited(id, snap)) markUnnamed(id);
          return;
        }
      }
      if (rowEdited(id, snap)) return;
      applyTag(id, patch, reply, opts?.mirror);
    } catch {
      if (!rowEdited(id, snap)) markUnnamed(id);
    }
  });
  tagChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function enqueuePrint(id: string, original: string): void {
  chain = chain.then(async () => {
    const started = useCloset.getState().garments.find((item) => item.id === id);
    if (!started) return;
    await noteGarmentCoverBytes(started);
    const g = useCloset.getState().garments.find((item) => item.id === id) ?? started;
    const previous = keptPlateKey(g);
    try {
      const written = await placeHeldGarment({
        photo: original,
        previous,
        crop: () => cropHeldPhoto(original),
        print: async (src, attempt) => {
          try {
            const image = await shrinkJpeg(src, 1024);
            const retry = Boolean(attempt?.retry);
            return await printGarment({ data: { image, held: retry, retry } });
          } catch {
            return { ok: false, error: "print" };
          }
        },
        check: async (plate) => {
          try {
            const image = await shrinkJpeg(plate, 768);
            const verdict = await withTimeout(
              judgeHeldPlate({ data: { image } }).catch(() => null),
              4000,
            );
            return holderCheckerText(verdict);
          } catch {
            return "";
          }
        },
        showTile: () => {},
        save: () => {},
      });
      if (!useCloset.getState().garments.some((item) => item.id === id)) return;
      const plateKey = imageKey(id, "c");
      const patch = await guardedPlatePatch({
        id,
        photoSrc: g.imageSrc,
        written,
        plateKey,
        previous,
        noun: singleGarmentNoun(g),
      });
      if (patch.matteQuality === "clean" && written.cutoutSrc.startsWith("data:")) {
        const cutout = await shrinkJpeg(await toLocalDataUrl(written.cutoutSrc), 900, 0.85);
        await putImage(plateKey, dataUrlToBlob(cutout));
        await putThumb(id, cutout).catch(() => {});
        useCloset.getState().updateGarment(id, patch);
        return;
      }
      const current = useCloset.getState().garments.find((item) => item.id === id);
      if (current && hasCleanCover(current)) return;
      useCloset.getState().updateGarment(id, patch);
    } catch {
      /* keep the matte */
    }
  });
}

import { useSyncExternalStore } from "react";
import { classifyScan, printGarment, tagGarment } from "./ai.ts";
import { fetchCloudBlob } from "./cloud/blobs.ts";
import { closetImagesBucket, getSupabase } from "./cloud/client.ts";
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
import { getAccount } from "./cloud/account.ts";
import { findOfficialCover, judgeHeldPlate, judgeSingleGarment } from "./packshot-search.ts";
import { maySearchOfficial, officialCoverPatch } from "./packshot.ts";
import {
  coverBytesKnown,
  hasCleanCover,
  jacketsNeedingPlate,
  keptPlateKey,
  markBlobUnreadable,
  noteBlob,
  plateCandidate,
  plateResultPatch,
  runPlatePass,
  type PlatePatch,
} from "./plate.ts";
import { cropToBox, holderCheckerText, placeHeldGarment } from "./scan.ts";
import {
  checkSingleGarment,
  colorsFromPlateTag,
  singleGarmentNoun,
  type SingleGarmentAsk,
  type SingleGarmentCheck,
} from "./single-garment.ts";
import { useCloset } from "./store.ts";

export type PlateOpts = {
  /** After a clean plate, read the colours off the plate (Joe's own action, never the auto pass). */
  recolor?: boolean;
};

const autoStarted = new Set<string>();
const searched = new Set<string>();
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

function unversionedCloudFile(path: string): boolean {
  return /\/[oct]\.jpg$/.test(path);
}

/** Read a cover or original. Does not upload, and does not write o.jpg. */
async function readSrcBlob(id: string, src: string): Promise<Blob | null> {
  if (src.startsWith("data:")) return dataUrlToBlob(src);
  if (isIdbKey(src)) {
    try {
      return await getImage(src);
    } catch {
      return null;
    }
  }
  if (!isCloudSrc(src)) return null;
  const parsed = parseCloudSrc(src);
  if (!parsed) return null;
  const pathKey = cloudImageKey(parsed.path);
  try {
    const hit = await getImage(pathKey);
    if (hit && hit.size > 0) return hit;
  } catch {
    /* IDB miss falls through */
  }
  if (unversionedCloudFile(parsed.path)) {
    try {
      const legacy = await getImage(imageKey(id || parsed.id, parsed.kind));
      if (legacy && legacy.size > 0) return legacy;
    } catch {
      /* still try storage */
    }
  }
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.storage.from(closetImagesBucket()).download(parsed.path);
  if (error || !data || data.size === 0) return null;
  try {
    await putImage(pathKey, data);
  } catch {
    /* the hash can still use this blob */
  }
  return data;
}

const hashInflight = new Map<string, Promise<void>>();
let hashActive = 0;
const hashWaiters: Array<() => void> = [];

function takeHashSlot(): Promise<void> {
  if (hashActive < 2) {
    hashActive += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    hashWaiters.push(() => {
      hashActive += 1;
      resolve();
    });
  });
}

function releaseHashSlot(): void {
  hashActive = Math.max(0, hashActive - 1);
  const next = hashWaiters.shift();
  if (next) next();
}

/** Hash the cover and the original. A copied phone photo is then not a plate. */
export async function noteGarmentCoverBytes(g: {
  id?: string;
  imageSrc?: string;
  cutoutSrc?: string;
}): Promise<void> {
  const image = g.imageSrc?.trim() ?? "";
  const cutout = g.cutoutSrc?.trim() ?? "";
  if (!image || !cutout || image === cutout) return;
  if (coverBytesKnown(g)) return;
  const token = `${cutout}\n${image}`;
  const pending = hashInflight.get(token);
  if (pending) return pending;
  const job = (async () => {
    await takeHashSlot();
    try {
      const [cover, photo] = await Promise.all([
        readSrcBlob(g.id ?? "", cutout),
        readSrcBlob(g.id ?? "", image),
      ]);
      if (cover) await noteBlob(cutout, cover);
      else markBlobUnreadable(cutout);
      if (photo) await noteBlob(image, photo);
      else markBlobUnreadable(image);
    } finally {
      releaseHashSlot();
    }
  })();
  hashInflight.set(token, job);
  try {
    await job;
  } finally {
    hashInflight.delete(token);
  }
}

/** Original photo bytes. Does not change imageSrc. */
export async function readGarmentPhoto(id: string, src: string): Promise<string | null> {
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

function startCoverJob(id: string, run: () => Promise<void>): Promise<void> {
  const existing = inflight.get(id);
  if (existing) return existing;
  const job = run().finally(() => {
    inflight.delete(id);
  });
  inflight.set(id, job);
  return job;
}

/** Same held-jacket print as a camera shot. imageSrc is not written. */
export function makePlate(id: string, opts: PlateOpts = {}): Promise<void> {
  return startCoverJob(id, () => printOnePlate(id, opts));
}

/** The vision helper behind the single-garment check. A failed call is null (unclear). */
export const askSingleGarment: SingleGarmentAsk = async ({ image, noun }) => {
  try {
    const shrunk = await shrinkForPrint(image, 768).catch(() => image);
    const answer: { one: string; why: string } | null | undefined = await judgeSingleGarment({
      data: { image: shrunk, noun },
    });
    return answer ?? null;
  } catch {
    return null;
  }
};

/**
 * The one door to a clean stamp. Every plate path (the jacket pass, the print queue, the
 * outline box-crop, the add flow, the official cover) builds its patch here: the candidate
 * cover is read, the single-garment check looks at it, and `plateResultPatch` stamps clean
 * only on yes. `ask` is the server function; tests pass a mocked verdict.
 */
export async function guardedPlatePatch(input: {
  id: string;
  /** The garment's original photo key (its imageSrc). Read to tell a plate from the photo; never written. */
  photoSrc: string;
  written: { reprint: boolean; cutoutSrc: string };
  plateKey: string;
  previous?: string;
  noun: string;
  ask?: SingleGarmentAsk;
}): Promise<PlatePatch> {
  const previous = input.previous ?? "";
  const candidate = plateCandidate(input.photoSrc, input.written, input.plateKey, previous);
  let image = "";
  if (candidate) {
    image = candidate.image.startsWith("data:")
      ? candidate.image
      : ((await readGarmentPhoto(input.id, candidate.image).catch(() => null)) ?? "");
  }
  const check = await checkSingleGarment({ image, noun: input.noun }, input.ask ?? askSingleGarment);
  return plateResultPatch(input.photoSrc, input.written, input.plateKey, previous, check);
}

/** A check of a picture that is not a plate result (the official cover). */
export function checkCover(image: string, noun: string, ask: SingleGarmentAsk = askSingleGarment): Promise<SingleGarmentCheck> {
  return checkSingleGarment({ image, noun }, ask);
}

/**
 * Colours read off a clean cut-out, not the source photo: the sweater's navy and green came
 * from the jacket and collar in the model shot. Writes only when the tag named a colour.
 */
export async function recolorFromPlate(
  id: string,
  plate: string,
  tag: (input: { data: { image: string } }) => Promise<Parameters<typeof colorsFromPlateTag>[0]> = tagGarment,
): Promise<string[]> {
  try {
    const image = await shrinkForPrint(plate, 768).catch(() => plate);
    const colors = colorsFromPlateTag(await withTimeout(tag({ data: { image } }), 12000));
    const g = useCloset.getState().garments.find((item) => item.id === id);
    if (!g || !colors.length) return [];
    const same = colors.length === g.colors.length && colors.every((c, i) => c === g.colors[i]);
    if (!same) useCloset.getState().updateGarment(id, { colors });
    return colors;
  } catch {
    return [];
  }
}

async function heldChecker(plate: string): Promise<string> {
  try {
    const image = await shrinkForPrint(plate, 768);
    const verdict = await withTimeout(
      judgeHeldPlate({ data: { image } }).catch(() => null),
      4000,
    );
    return holderCheckerText(verdict);
  } catch {
    return "";
  }
}

export async function cropHeldPhoto(photo: string): Promise<string | null> {
  try {
    const image = await shrinkForPrint(photo, 1024);
    const scan = await withTimeout(classifyScan({ data: { image } }).catch(() => null), 4000);
    if (!scan || !("ok" in scan) || !scan.ok) return null;
    const box = scan.boxes?.[0]?.box;
    if (!box) return null;
    return await cropToBox(photo, box);
  } catch {
    return null;
  }
}

async function printOnePlate(id: string, opts: PlateOpts = {}): Promise<void> {
  const started = useCloset.getState().garments.find((item) => item.id === id);
  if (!started || started.archived) return;
  await noteGarmentCoverBytes(started);
  const g = useCloset.getState().garments.find((item) => item.id === id);
  if (!g || g.archived || hasCleanCover(g)) return;
  const previous = keptPlateKey(g);
  try {
    const photo = await readGarmentPhoto(g.id, g.imageSrc);
    if (!photo) {
      if (!previous && useCloset.getState().garments.some((item) => item.id === id)) {
        useCloset.getState().updateGarment(id, {
          cutoutSrc: "",
          imageSource: "cutout",
          reprint: true,
        });
      }
      return;
    }
    const written = await placeHeldGarment({
      photo,
      previous,
      crop: () => cropHeldPhoto(photo),
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
      check: (plate) => heldChecker(plate),
      showTile: () => {},
      save: () => {},
    });
    const plateKey = imageKey(id, "c");
    const patch = await guardedPlatePatch({
      id,
      photoSrc: g.imageSrc,
      written,
      plateKey,
      previous,
      noun: singleGarmentNoun(g),
    });
    const fresh = patch.matteQuality === "clean" && written.cutoutSrc.startsWith("data:");
    if (fresh) {
      await putImage(plateKey, dataUrlToBlob(written.cutoutSrc));
      await putThumb(id, written.cutoutSrc).catch(() => {});
    }
    if (!useCloset.getState().garments.some((item) => item.id === id)) return;
    const current = useCloset.getState().garments.find((item) => item.id === id);
    if (current && hasCleanCover(current) && written.reprint) return;
    useCloset.getState().updateGarment(id, patch);
    if (fresh && opts.recolor) await recolorFromPlate(id, written.cutoutSrc);
  } catch {
    const current = useCloset.getState().garments.find((item) => item.id === id);
    if (current && !hasCleanCover(current)) {
      useCloset.getState().updateGarment(id, {
        cutoutSrc: previous,
        imageSource: "cutout",
        reprint: previous ? false : true,
      });
    }
  }
}

/**
 * One search, then the plate if nothing matched. imageSrc is not written.
 * A 403 or a rejected download falls through. It does not fail the tile.
 */
export function findRealPhoto(id: string, opts: PlateOpts = {}): Promise<void> {
  return startCoverJob(id, () => searchThenPlate(id, opts));
}

async function searchThenPlate(id: string, opts: PlateOpts = {}): Promise<void> {
  const g = useCloset.getState().garments.find((item) => item.id === id);
  if (!g || g.archived) return;
  if (!maySearchOfficial(g.id, g.brand)) {
    await printOnePlate(id, opts);
    return;
  }
  if (searched.has(id)) return;
  searched.add(id);
  try {
    const photo = await readGarmentPhoto(g.id, g.imageSrc);
    if (photo) {
      const shrunk = await shrinkForPrint(photo, 1024);
      const hit = await findOfficialCover({
        data: {
          id: g.id,
          brand: g.brand,
          name: g.name,
          color: (g.colors ?? []).join(" "),
          subtype: g.subtype ?? "",
          material: g.material ?? "",
          photo: shrunk,
        },
      }).catch(() => null);
      if (hit?.ok && hit.image) {
        const jpeg = await shrinkForPrint(hit.image, 1280).catch(() => "");
        const stored = jpeg.startsWith("data:image/jpeg")
          ? jpeg
          : hit.image.startsWith("data:image/jpeg")
            ? hit.image
            : "";
        if (stored && useCloset.getState().garments.some((item) => item.id === id)) {
          /* A shop picture can be a model shot too: it is a cover only when it shows one piece. */
          const patch = officialCoverPatch(
            imageKey(id, "c"),
            hit.pageUrl,
            await checkCover(stored, singleGarmentNoun(g)),
          );
          if (patch.matteQuality === "clean") {
            await putImage(patch.cutoutSrc, dataUrlToBlob(stored));
            await putThumb(id, stored).catch(() => {});
            useCloset.getState().updateGarment(id, patch);
            if (opts.recolor) await recolorFromPlate(id, stored);
            return;
          }
        }
      }
    }
  } catch {
    /* the plate pass below */
  }
  await printOnePlate(id, opts);
}

let plateNote = "";
let passDepth = 0;
const noteListeners = new Set<() => void>();

function setPlateNote(next: string) {
  plateNote = next;
  for (const fn of noteListeners) fn();
}

export function usePlatePassNote(): string {
  return useSyncExternalStore(
    (cb) => {
      noteListeners.add(cb);
      return () => noteListeners.delete(cb);
    },
    () => plateNote,
    () => "",
  );
}

function needsByteCheck(g: {
  archived?: boolean;
  category?: string;
  imageSrc?: string;
  cutoutSrc?: string;
  imageSource?: string;
  reprint?: boolean;
}): boolean {
  if (g.archived || g.category !== "outerwear") return false;
  if (g.reprint === true || g.imageSource === "photo") return false;
  if (g.imageSource !== "official" && g.imageSource !== "cutout" && g.imageSource !== "segmented") {
    return false;
  }
  const image = g.imageSrc?.trim() ?? "";
  const cutout = g.cutoutSrc?.trim() ?? "";
  if (!image || !cutout || image === cutout) return false;
  return !coverBytesKnown(g);
}

let passChain: Promise<void> = Promise.resolve();

async function hashThenPass(): Promise<void> {
  if (!getAccount().user) return;
  const suspects = useCloset.getState().garments.filter(needsByteCheck);
  await runPlatePass(suspects, (g) => noteGarmentCoverBytes(g), 2);
  if (!getAccount().user) return;
  const items = jacketsNeedingPlate(useCloset.getState().garments).filter(
    (g) => g.id && !autoStarted.has(g.id),
  );
  for (const g of items) {
    if (g.id) autoStarted.add(g.id);
  }
  if (!items.length) return;
  const n = items.length;
  passDepth += 1;
  setPlateNote(n === 1 ? "Cleaning 1 jacket." : `Cleaning ${n} jackets.`);
  try {
    await runPlatePass(items, (g) => makePlate(g.id!), 2);
  } finally {
    passDepth = Math.max(0, passDepth - 1);
    if (passDepth === 0) setPlateNote("");
  }
}

/** Fire-and-forget. Once per id this session. Signed in only. Does not search the web. */
export function scheduleOuterwearPlates(): void {
  if (!getAccount().user) return;
  passChain = passChain.then(() => hashThenPass()).catch(() => {});
}

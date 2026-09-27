import { useEffect, useState } from "react";
import { getAccount } from "./cloud/account";
import { fetchCloudBlob, signedCloudUrl } from "./cloud/blobs";
import { garmentObjectPath } from "./cloud/client";
import { isCloudSrc, paintSrc, parseCloudSrc, parseIdbImageKey } from "./cloud/src";
import { cloudImageKey, getImage, imageKey, isIdbKey, putImage, resolveImage, watchImage } from "./images";

/** o.jpg / t.jpg / c.jpg from before path-keyed cache. Not c-<sha>.jpg. */
function unversionedCloudFile(path: string): boolean {
  return /\/[oct]\.jpg$/.test(path);
}

async function resolveDisplaySrc(src: string): Promise<string> {
  if (isCloudSrc(src)) {
    const parsed = parseCloudSrc(src);
    if (!parsed) return "";
    const pathKey = cloudImageKey(parsed.path);
    let hit = await resolveImage(pathKey);
    if (!hit && unversionedCloudFile(parsed.path)) {
      const legacyKey = imageKey(parsed.id, parsed.kind);
      try {
        const blob = await getImage(legacyKey);
        if (blob) {
          try {
            await putImage(pathKey, blob);
          } catch {
            /* still show the copy cached under the old key */
          }
          hit = (await resolveImage(pathKey)) || (await resolveImage(legacyKey));
        }
      } catch {
        /* IDB unavailable — fall through to storage */
      }
    }
    if (hit) return paintSrc(hit, "");
    const signed = await signedCloudUrl(parsed.path);
    void fetchCloudBlob(parsed.id, parsed.kind, parsed.userId, src);
    return paintSrc("", signed);
  }
  if (isIdbKey(src)) {
    const hit = await resolveImage(src);
    if (hit) return paintSrc(hit, "");
    const parsed = parseIdbImageKey(src);
    if (!parsed) return "";
    await fetchCloudBlob(parsed.id, parsed.kind);
    const after = await resolveImage(src);
    if (after) return paintSrc(after, "");
    const uid = getAccount().user?.id;
    if (!uid) return "";
    const kinds = parsed.kind === "t" ? (["t", "c"] as const) : ([parsed.kind] as const);
    for (const k of kinds) {
      const signed = await signedCloudUrl(garmentObjectPath(uid, parsed.id, k));
      if (signed) return paintSrc("", signed);
    }
    return "";
  }
  return paintSrc(src, "");
}

function watchKey(src: string): string {
  if (isCloudSrc(src)) {
    const parsed = parseCloudSrc(src);
    return parsed ? cloudImageKey(parsed.path) : src;
  }
  return src;
}

/** Display URL for idb: / sb: keys. Fresh browser fills IDB from storage. */
export function useImageSrc(src: string | undefined | null): string {
  const key = src ?? "";
  const [url, setUrl] = useState(() =>
    isIdbKey(key) || isCloudSrc(key) ? "" : key,
  );
  const [gen, setGen] = useState(0);
  const watch = watchKey(key);
  useEffect(() => {
    if (!isIdbKey(watch)) return;
    return watchImage(watch, () => setGen((n) => n + 1));
  }, [watch]);
  useEffect(() => {
    if (!key) {
      setUrl("");
      return;
    }
    if (!isIdbKey(key) && !isCloudSrc(key)) {
      setUrl(paintSrc(key, ""));
      return;
    }
    let live = true;
    void resolveDisplaySrc(key).then((u) => {
      if (live) setUrl(u);
    });
    return () => {
      live = false;
    };
  }, [key, gen]);
  return url;
}

import { useEffect, useState } from "react";
import { fetchCloudBlob } from "./cloud/blobs";
import { isCloudSrc, parseCloudSrc, parseIdbImageKey } from "./cloud/src";
import { imageKey, isIdbKey, resolveImage, watchImage } from "./images";

async function resolveDisplaySrc(src: string): Promise<string> {
  if (isCloudSrc(src)) {
    const parsed = parseCloudSrc(src);
    if (!parsed) return "";
    const key = imageKey(parsed.id, parsed.kind);
    const hit = await resolveImage(key);
    if (hit) return hit;
    await fetchCloudBlob(parsed.id, parsed.kind, parsed.userId);
    return resolveImage(key);
  }
  if (isIdbKey(src)) {
    const hit = await resolveImage(src);
    if (hit) return hit;
    const parsed = parseIdbImageKey(src);
    if (parsed) {
      await fetchCloudBlob(parsed.id, parsed.kind);
      return resolveImage(src);
    }
    return "";
  }
  return src;
}

function watchKey(src: string): string {
  if (isCloudSrc(src)) {
    const parsed = parseCloudSrc(src);
    return parsed ? imageKey(parsed.id, parsed.kind) : src;
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
      setUrl(key);
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

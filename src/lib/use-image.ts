import { useEffect, useState } from "react";
import { getAccount } from "./cloud/account";
import { fetchCloudBlob, signedCloudUrl } from "./cloud/blobs";
import { garmentObjectPath } from "./cloud/client";
import { isCloudSrc, paintSrc, parseCloudSrc, parseIdbImageKey } from "./cloud/src";
import { imageKey, isIdbKey, resolveImage, watchImage } from "./images";

async function resolveDisplaySrc(src: string): Promise<string> {
  if (isCloudSrc(src)) {
    const parsed = parseCloudSrc(src);
    if (!parsed) return "";
    const key = imageKey(parsed.id, parsed.kind);
    const hit = await resolveImage(key);
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
    const kinds = parsed.kind === "t" ? (["t", "c", "o"] as const) : ([parsed.kind] as const);
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

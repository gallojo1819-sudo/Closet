import { useEffect, useState } from "react";
import { isIdbKey, resolveImage, watchImage } from "./images";

/** Display URL for a stored src. Resolves "idb:" keys to cached blob URLs. */
export function useImageSrc(src: string | undefined | null): string {
  const key = src ?? "";
  const [url, setUrl] = useState(() => (isIdbKey(key) ? "" : key));
  const [gen, setGen] = useState(0);
  useEffect(() => {
    if (!isIdbKey(key)) return;
    return watchImage(key, () => setGen((n) => n + 1));
  }, [key]);
  useEffect(() => {
    if (!isIdbKey(key)) {
      setUrl(key);
      return;
    }
    let live = true;
    void resolveImage(key).then((u) => {
      if (live) setUrl(u);
    });
    return () => {
      live = false;
    };
  }, [key, gen]);
  return url;
}

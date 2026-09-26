/** Phone-open download plan. Names come from meta; blobs are optional. */

export const OPEN_THUMB_BATCH = 12;
export const OPEN_THUMB_CONCURRENCY = 4;

export type BlobKind = "t" | "c" | "o";

export type OpenDownloadPlan = {
  eager: string[];
  deferred: string[];
  kinds: BlobKind[];
  concurrency: number;
};

export function openDownloadPlan(ids: string[]): OpenDownloadPlan {
  return {
    eager: ids.slice(0, OPEN_THUMB_BATCH),
    deferred: ids.slice(OPEN_THUMB_BATCH),
    kinds: ["t"],
    concurrency: OPEN_THUMB_CONCURRENCY,
  };
}

export function openBlobRequests(plan: OpenDownloadPlan): { id: string; kind: BlobKind }[] {
  return plan.eager.flatMap((id) => plan.kinds.map((kind) => ({ id, kind })));
}

export function loadingPhotosCopy(done: number, total: number): string {
  return `Loading photos · ${done}/${total}`;
}

/** Rows already in memory. Opening Closet does not wait on the network for these. */
export function closetFirstRows<T extends { archived?: boolean }>(garments: T[]): T[] {
  return garments.filter((g) => !g.archived);
}

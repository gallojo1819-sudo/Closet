import {
  getImage,
  isIdbKey,
  refImageKey,
} from "../images.ts";
import { livePool, scrubRack } from "../rack.ts";
import { useCloset } from "../store.ts";
import type { DailyDrop, Garment, Look, WearEntry } from "../types.ts";
import { getAccount, patchAccount, setAccountProgress, setLocalOnly } from "./account.ts";
import {
  countListedThumbs,
  forgetUploaded,
  isForbidden,
  mapPool,
  prefetchEagerThumbs,
  uploadKind,
  wasUploaded,
} from "./blobs.ts";
import {
  mergeForSync,
  packCloud,
  pushIfDirty,
  rememberPull,
  rowToCloud,
  rpcFailurePlan,
  shouldSchedulePush,
  freshMemory,
  markDirty,
  type FetchCloud,
  type SyncMemory,
  type WriteResult,
} from "./commit.ts";
import { clearPendingEdit, onUserEdit, peekPendingEdit } from "./edit.ts";
import { isHomeEmail, WRONG_ACCOUNT } from "./home.ts";
import { idbCount, isCloudSrc, rewriteCloudSrcs } from "./src.ts";
import {
  addLookTombstone,
  addTombstone,
  clearLookTombstones,
  clearTombstones,
  readLookTombstones,
  readTombstones,
} from "./tombstone.ts";
import {
  closetImagesBucket,
  getSupabase,
  refObjectPath,
} from "./client.ts";
import {
  LOCAL_ONLY_CAPTION,
  cloudErrorCopy,
  pulledCopy,
} from "./copy.ts";
import { supabaseConfigured } from "./env.ts";
import { accountPool, type CloudMeta } from "./merge.ts";
import { onOnlineIntent } from "./online.ts";

const LAST_KEY = "closet.cloud.last";
const PUSH_MS = 1000;
const BASE_COLS = "garments, looks, journal, avoid, drop, ref_photo, v, updated_at";
const EXT_COLS = `${BASE_COLS}, rev, deleted_garments, deleted_looks`;

type LastSnap = { userId: string; ids: string[] };

let linking = false;
let pushing = false;
let pushAgain = false;
let holdPush = false;
let pushTimer: number | undefined;
let started = false;
let mem: SyncMemory = freshMemory();
/** null until the first select. False when rev/deleted_* are not on the row yet. */
let revColumns: boolean | null = null;
/** null until the first push. False when closet_meta_push is not deployed. */
let rpcOk: boolean | null = null;
let refDirty = false;
const uploadedRef = new Set<string>();

function writeLast(userId: string, ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    const snap: LastSnap = { userId, ids };
    window.localStorage.setItem(LAST_KEY, JSON.stringify(snap));
  } catch {
    /* private mode */
  }
}

function snapshot(): CloudMeta {
  const s = useCloset.getState();
  return {
    garments: s.garments,
    looks: s.looks,
    journal: s.journal,
    avoid: s.avoid,
    drop: s.drop,
    refPhoto: Boolean(s.refPhoto),
    v: 6,
  };
}

function tombstonesNow(): { garments: string[]; looks: string[] } {
  return { garments: readTombstones(), looks: readLookTombstones() };
}

function isMissingColumn(error: { code?: string; message?: string }): boolean {
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return /column|schema cache/i.test(error.message ?? "");
}

function isMissingRpc(error: { code?: string; message?: string; status?: number }): boolean {
  return rpcFailurePlan(error) === "fallback";
}

async function fetchCloud(userId: string): Promise<FetchCloud> {
  const sb = getSupabase();
  if (!sb) return { ok: false };
  const cols = revColumns === false ? BASE_COLS : EXT_COLS;
  const { data, error } = await sb
    .from("closet_meta")
    .select(cols)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (revColumns !== false && isMissingColumn(error)) {
      revColumns = false;
      return fetchCloud(userId);
    }
    setAccountProgress("Could not reach your account.");
    return { ok: false };
  }
  if (revColumns !== false) revColumns = true;
  return { ok: true, cloud: rowToCloud(data as Parameters<typeof rowToCloud>[0]) };
}

async function casWrite(
  userId: string,
  expected: { rev: number | null; updatedAt: string | null },
  payload: CloudMeta,
): Promise<WriteResult> {
  const sb = getSupabase();
  if (!sb) return { ok: false, conflict: false };
  const packed = packCloud(payload);
  if (rpcOk !== false) {
    const { data, error } = await sb.rpc("closet_meta_push", {
      p_expected_rev: expected.rev ?? 0,
      p_garments: packed.garments,
      p_looks: packed.looks,
      p_journal: packed.journal,
      p_avoid: packed.avoid,
      p_drop: packed.drop,
      p_ref_photo: packed.refPhoto,
      p_deleted_garments: packed.deletedGarments ?? [],
      p_deleted_looks: packed.deletedLooks ?? [],
    });
    if (error) {
      if (!isMissingRpc(error)) {
        if (!isForbidden(error)) setAccountProgress("Could not save to your account.");
        return { ok: false, conflict: false };
      }
      rpcOk = false;
    } else if (data && typeof data === "object") {
      rpcOk = true;
      const body = data as { ok?: boolean; conflict?: boolean; rev?: number; updated_at?: string };
      if (body.conflict) return { ok: false, conflict: true };
      if (body.ok) {
        return {
          ok: true,
          rev: typeof body.rev === "number" ? body.rev : (expected.rev ?? 0) + 1,
          updatedAt: typeof body.updated_at === "string" ? body.updated_at : new Date().toISOString(),
        };
      }
      return { ok: false, conflict: false };
    } else {
      return { ok: false, conflict: false };
    }
  }
  return fallbackCas(userId, expected, packed);
}

async function fallbackCas(
  userId: string,
  expected: { rev: number | null; updatedAt: string | null },
  payload: CloudMeta,
): Promise<WriteResult> {
  const sb = getSupabase();
  if (!sb) return { ok: false, conflict: false };
  const updatedAt = new Date().toISOString();
  const body: Record<string, unknown> = {
    garments: payload.garments,
    looks: payload.looks,
    journal: payload.journal,
    avoid: payload.avoid,
    drop: payload.drop,
    ref_photo: payload.refPhoto,
    v: 6,
    updated_at: updatedAt,
  };
  if (revColumns) {
    body.deleted_garments = payload.deletedGarments ?? [];
    body.deleted_looks = payload.deletedLooks ?? [];
  }
  if (!expected.updatedAt && expected.rev === null) {
    if (revColumns) body.rev = 1;
    const { data, error } = await sb
      .from("closet_meta")
      .insert({ user_id: userId, ...body })
      .select("updated_at");
    if (error) {
      if (error.code === "23505" || /duplicate|already exists/i.test(error.message ?? "")) {
        return { ok: false, conflict: true };
      }
      if (!isForbidden(error)) setAccountProgress("Could not save to your account.");
      return { ok: false, conflict: false };
    }
    const row = Array.isArray(data) ? data[0] : null;
    return { ok: true, rev: revColumns ? 1 : 0, updatedAt: row?.updated_at ?? updatedAt };
  }
  const nextRev = expected.rev === null ? null : expected.rev + 1;
  if (nextRev !== null) body.rev = nextRev;
  let query = sb.from("closet_meta").update(body).eq("user_id", userId);
  query = nextRev !== null && expected.rev !== null
    ? query.eq("rev", expected.rev)
    : query.eq("updated_at", expected.updatedAt ?? "");
  const { data, error } = await query.select("updated_at");
  if (error) {
    if (!isForbidden(error)) setAccountProgress("Could not save to your account.");
    return { ok: false, conflict: false };
  }
  if (!data || data.length === 0) return { ok: false, conflict: true };
  return { ok: true, rev: nextRev ?? 0, updatedAt: data[0]?.updated_at ?? updatedAt };
}

function liveGarments(meta: CloudMeta): Garment[] {
  return accountPool(meta.garments).filter((g) => g.tombstone !== true) as Garment[];
}

function needsBlobUpload(g: { imageSrc?: string; cutoutSrc?: string }): boolean {
  if (isIdbKey(g.imageSrc) || isIdbKey(g.cutoutSrc)) return true;
  return !isCloudSrc(g.imageSrc) || !isCloudSrc(g.cutoutSrc);
}

async function uploadMissing(userId: string, garments: Garment[]): Promise<Set<string>> {
  const targets = garments.filter((g) => needsBlobUpload(g));
  if (targets.length) {
    await mapPool(targets, 2, async (g) => {
      await uploadKind(userId, g, "t");
      await uploadKind(userId, g, "c");
      await uploadKind(userId, g, "o");
    });
  }
  const uploadedKinds = new Set<string>();
  for (const g of targets) {
    for (const kind of ["t", "c", "o"] as const) {
      if (wasUploaded(g.id, kind)) uploadedKinds.add(`${g.id}:${kind}`);
    }
  }
  return uploadedKinds;
}

async function uploadRef(userId: string, refPhoto: string | null): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const path = refObjectPath(userId);
  if (!refPhoto) {
    if (refDirty) {
      await sb.storage.from(closetImagesBucket()).remove([path]);
      uploadedRef.delete("me:ref");
    }
    refDirty = false;
    return;
  }
  const { data: listed } = await sb.storage.from(closetImagesBucket()).list(`${userId}/me`, { limit: 10 });
  const exists = (listed ?? []).some((row) => row.name === "ref.jpg");
  if (exists && !refDirty) {
    uploadedRef.add("me:ref");
    return;
  }
  const key = isIdbKey(refPhoto) ? refPhoto : refImageKey();
  let blob: Blob | null = null;
  try {
    blob = await getImage(key);
  } catch {
    blob = null;
  }
  if (!blob) return;
  const { error } = await sb.storage.from(closetImagesBucket()).upload(path, blob, {
    upsert: Boolean(exists && refDirty),
    contentType: blob.type || "image/jpeg",
  });
  if (!error) {
    uploadedRef.add("me:ref");
    refDirty = false;
  }
}

function applyMerged(next: CloudMeta) {
  const current = useCloset.getState();
  const peeled = {
    ...next,
    garments: next.garments.filter((g) => g.tombstone !== true),
    looks: next.looks.filter((l) => l.tombstone !== true),
  };
  const mixed = {
    garments: peeled.garments as Garment[],
    looks: peeled.looks as Look[],
    journal: peeled.journal as WearEntry[],
    drop: peeled.drop as DailyDrop | null,
    seenLooks: current.seenLooks,
  };
  const { purgedIds, ...clean } = scrubRack(mixed);
  void purgedIds;
  holdPush = true;
  try {
    useCloset.setState({
      garments: clean.garments,
      looks: clean.looks,
      journal: clean.journal,
      avoid: next.avoid,
      drop: clean.drop,
      seenLooks: clean.seenLooks ?? current.seenLooks,
    });
    if (next.refPhoto && !current.refPhoto) {
      useCloset.setState({ refPhoto: refImageKey() });
    }
  } finally {
    holdPush = false;
  }
}

async function absorb(userId: string, fetched: FetchCloud): Promise<void> {
  if (!fetched.ok) return;
  if (
    mem.pulled &&
    !mem.dirty &&
    fetched.cloud?.updatedAt &&
    fetched.cloud.updatedAt === mem.updatedAt &&
    (typeof fetched.cloud.rev === "number" ? fetched.cloud.rev : null) === mem.rev
  ) {
    return;
  }
  if (peekPendingEdit()) mem = markDirty(mem);
  const merged = mergeForSync({
    local: snapshot(),
    cloud: fetched.cloud,
    tombstones: tombstonesNow(),
    base: mem.base,
  });
  mem = rememberPull(mem, fetched.cloud, merged);
  for (const id of merged.deletedGarments ?? []) addTombstone(id);
  for (const id of merged.deletedLooks ?? []) addLookTombstone(id);
  applyMerged(merged);
  writeLast(
    userId,
    accountPool(useCloset.getState().garments).map((g) => g.id),
  );
}

async function pushNow() {
  const user = getAccount().user;
  if (!user) return;
  if (linking || holdPush) {
    pushAgain = true;
    return;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setLocalOnly(true);
    setAccountProgress(LOCAL_ONLY_CAPTION);
    return;
  }
  if (!shouldSchedulePush(mem)) return;
  if (pushing) {
    pushAgain = true;
    return;
  }
  pushing = true;
  try {
    const result = await pushIfDirty({
      mem,
      local: snapshot(),
      tombstones: tombstonesNow(),
      fetchCloud: () => fetchCloud(user.id),
      write: (expected, payload) => casWrite(user.id, expected, payload),
      prepare: async (merged) => {
        try {
          const kinds = await uploadMissing(user.id, liveGarments(merged));
          if (!kinds.size) return merged;
          const rewritten = rewriteCloudSrcs(
            liveGarments(merged).map((g) => ({
              ...g,
              imageSrc: g.imageSrc ?? "",
              cutoutSrc: g.cutoutSrc ?? "",
            })),
            user.id,
            kinds,
          );
          const byId = new Map(rewritten.map((g) => [g.id, g]));
          return {
            ...merged,
            garments: merged.garments.map((g) => byId.get(g.id) ?? g),
          };
        } catch (err) {
          setLocalOnly(true);
          setAccountProgress(cloudErrorCopy(err));
          return merged;
        }
      },
      log: (message, detail) => {
        console.warn(message, detail);
      },
    });
    mem = result.mem;
    if (pushAgain) mem = markDirty(mem);
    if (result.refused) {
      setAccountProgress("Didn't save — that would drop pieces you didn't delete.");
      return;
    }
    if (!result.wrote || !result.merged) return;
    if (!pushAgain) {
      applyMerged(result.merged);
      clearPendingEdit();
      const deletedG = result.merged.deletedGarments ?? [];
      const deletedL = result.merged.deletedLooks ?? [];
      clearTombstones(deletedG);
      clearLookTombstones(deletedL);
      writeLast(
        user.id,
        liveGarments(result.merged).map((g) => g.id),
      );
      setLocalOnly(false);
      void uploadRef(user.id, useCloset.getState().refPhoto);
    }
  } finally {
    pushing = false;
    if (pushAgain) {
      pushAgain = false;
      schedulePush();
    }
  }
}

/** Explicit Backup. Uploads only objects that are not already in the bucket. Does not rewrite closet_meta. */
export function backupPhotos(): void {
  const user = getAccount().user;
  if (!user) return;
  void (async () => {
    try {
      await uploadMissing(user.id, accountPool(useCloset.getState().garments) as Garment[]);
      await uploadRef(user.id, useCloset.getState().refPhoto);
    } catch (err) {
      setLocalOnly(true);
      setAccountProgress(cloudErrorCopy(err));
    }
  })();
}

function schedulePush() {
  if (!shouldSchedulePush(mem)) return;
  if (linking || holdPush || pushing) {
    pushAgain = true;
    return;
  }
  if (!getAccount().user) return;
  if (typeof window === "undefined") return;
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    void pushNow();
  }, PUSH_MS);
}

async function firstLink(userId: string) {
  linking = true;
  try {
    const email = getAccount().user?.email;
    const fetched = await fetchCloud(userId);
    if (!fetched.ok) return;
    const cloudCount = fetched.cloud ? accountPool(fetched.cloud.garments).length : 0;
    if (!isHomeEmail(email) && cloudCount === 0) {
      patchAccount({ wrongAccount: true, progress: WRONG_ACCOUNT });
      return;
    }
    patchAccount({ wrongAccount: false });
    await absorb(userId, fetched);
    const pool = livePool(useCloset.getState().garments);
    if (pool.length > 0) void prefetchEagerThumbs(pool.map((g) => g.id));
    const idbN = idbCount(accountPool(useCloset.getState().garments));
    if (idbN > 0) {
      try {
        const thumbs = await countListedThumbs(userId);
        patchAccount({ listedThumbs: thumbs });
      } catch (err) {
        setLocalOnly(true);
        setAccountProgress(cloudErrorCopy(err));
      }
    }
    const n = accountPool(useCloset.getState().garments).length;
    if (n > 0) setAccountProgress(pulledCopy(n));
  } finally {
    linking = false;
    if (shouldSchedulePush(mem)) schedulePush();
  }
}

async function pullOnVisible() {
  if (linking || pushing) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  const user = getAccount().user;
  if (!user) return;
  const sb = getSupabase();
  if (sb) {
    try {
      await sb.auth.startAutoRefresh();
      await sb.auth.getSession();
    } catch {
      /* session restore is best-effort */
    }
  }
  linking = true;
  try {
    const fetched = await fetchCloud(user.id);
    await absorb(user.id, fetched);
  } finally {
    linking = false;
    if (shouldSchedulePush(mem)) schedulePush();
  }
}

export function startCloudSync(): () => void {
  if (started) return () => {};
  started = true;
  const configured = supabaseConfigured();
  patchAccount({ configured, pending: configured });
  const sb = getSupabase();
  if (!sb) {
    patchAccount({ pending: false, configured: false });
    return () => {
      started = false;
    };
  }

  const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
    const user = session?.user
      ? { id: session.user.id, email: session.user.email ?? null }
      : null;
    patchAccount({ user, pending: false, configured: true });
    if (!user) {
      mem = freshMemory();
      return;
    }
    if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
      mem = freshMemory();
      if (peekPendingEdit()) mem = markDirty(mem);
      void firstLink(user.id);
    }
  });

  const onVis = () => {
    if (document.visibilityState === "hidden") {
      void sb.auth.stopAutoRefresh();
      return;
    }
    void pullOnVisible();
  };
  const retryOnline = () => {
    if (
      onOnlineIntent({
        online: typeof navigator === "undefined" || navigator.onLine !== false,
        signedIn: Boolean(getAccount().user),
        pendingEdit: mem.dirty || peekPendingEdit(),
        pulled: mem.pulled,
      }) !== "push"
    ) {
      return;
    }
    schedulePush();
  };
  const onOffline = () => {
    setLocalOnly(true);
    setAccountProgress(LOCAL_ONLY_CAPTION);
  };
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("focus", onVis);
  window.addEventListener("pageshow", onVis);
  window.addEventListener("online", retryOnline);
  window.addEventListener("offline", onOffline);
  const conn = (
    navigator as Navigator & {
      connection?: {
        addEventListener?: typeof window.addEventListener;
        removeEventListener?: typeof window.removeEventListener;
      };
    }
  ).connection;
  conn?.addEventListener?.("change", retryOnline);

  const unsubStore = useCloset.subscribe((s, prev) => {
    if (s.refPhoto !== prev.refPhoto) {
      uploadedRef.delete("me:ref");
      refDirty = true;
    }
    if (s.garments !== prev.garments) {
      const ids = new Set(s.garments.map((g) => g.id));
      for (const g of prev.garments) {
        if (!ids.has(g.id)) forgetUploaded(g.id);
      }
    }
  });
  const unsubEdit = onUserEdit(() => {
    mem = markDirty(mem);
    schedulePush();
  });

  return () => {
    started = false;
    sub.subscription.unsubscribe();
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("focus", onVis);
    window.removeEventListener("pageshow", onVis);
    window.removeEventListener("online", retryOnline);
    window.removeEventListener("offline", onOffline);
    conn?.removeEventListener?.("change", retryOnline);
    unsubStore();
    unsubEdit();
    if (pushTimer !== undefined) window.clearTimeout(pushTimer);
  };
}

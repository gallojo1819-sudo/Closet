import {
  getImage,
  isIdbKey,
  refImageKey,
} from "../images.ts";
import { livePool, scrubRack } from "../rack.ts";
import { openPersistGate, useCloset } from "../store.ts";
import type { DailyDrop, Garment, Look, WearEntry } from "../types.ts";
import { getAccount, patchAccount, setAccountProgress, setLocalOnly } from "./account.ts";
import {
  clearUploaded,
  countListedThumbs,
  forgetUploaded,
  isForbidden,
  mapPool,
  prefetchEagerThumbs,
  uploadKind,
  wasUploaded,
} from "./blobs.ts";
import { isHomeEmail, WRONG_ACCOUNT } from "./home.ts";
import { applyBackupToStore, backupRemaining, idbCount } from "./src.ts";
import {
  closetImagesBucket,
  getSupabase,
  refObjectPath,
} from "./client.ts";
import {
  LOCAL_ONLY_CAPTION,
  backingUpCopy,
  cloudErrorCopy,
  pulledCopy,
  savedAccountCopy,
  stillOnPhoneCopy,
} from "./copy.ts";
import { supabaseConfigured } from "./env.ts";
import {
  accountPool,
  mergeAccount,
  type CloudMeta,
} from "./merge.ts";
import { onOnlineIntent, visibleCloudIntent } from "./online.ts";
import { loadingPhotosCopy } from "./open-plan.ts";

const LAST_KEY = "closet.cloud.last";
const PUSH_MS = 1000;

type LastSnap = { userId: string; ids: string[] };

let linking = false;
let pushing = false;
let holdPush = false;
let pushTimer: number | undefined;
let started = false;
const uploadedRef = new Set<string>();

function readLast(userId: string): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastSnap;
    if (parsed.userId !== userId || !Array.isArray(parsed.ids)) return null;
    return parsed.ids;
  } catch {
    return null;
  }
}

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

async function fetchMeta(userId: string): Promise<CloudMeta | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("closet_meta")
    .select("garments, looks, journal, avoid, drop, ref_photo, v")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    setAccountProgress("Could not reach your account.");
    return null;
  }
  if (!data) return null;
  return {
    garments: Array.isArray(data.garments) ? (data.garments as CloudMeta["garments"]) : [],
    looks: Array.isArray(data.looks) ? (data.looks as CloudMeta["looks"]) : [],
    journal: Array.isArray(data.journal) ? (data.journal as CloudMeta["journal"]) : [],
    avoid:
      data.avoid && typeof data.avoid === "object" && !Array.isArray(data.avoid)
        ? (data.avoid as Record<string, number>)
        : {},
    drop: (data.drop as CloudMeta["drop"]) ?? null,
    refPhoto: Boolean(data.ref_photo),
    v: typeof data.v === "number" ? data.v : 6,
  };
}

async function upsertMeta(userId: string) {
  const sb = getSupabase();
  if (!sb) return;
  const s = useCloset.getState();
  const garments = accountPool(s.garments);
  const { error } = await sb.from("closet_meta").upsert(
    {
      user_id: userId,
      garments,
      looks: s.looks,
      journal: s.journal,
      avoid: s.avoid,
      drop: s.drop,
      ref_photo: Boolean(s.refPhoto),
      v: 6,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    setLocalOnly(true);
    if (!isForbidden(error)) setAccountProgress("Could not save to your account.");
    return;
  }
  setLocalOnly(false);
  writeLast(userId, garments.map((g) => g.id));
}

async function uploadRef(userId: string, refPhoto: string | null): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const mark = "me:ref";
  if (!refPhoto) {
    if (uploadedRef.has(mark)) {
      await sb.storage.from(closetImagesBucket()).remove([refObjectPath(userId)]);
      uploadedRef.delete(mark);
    }
    return;
  }
  if (uploadedRef.has(mark)) return;
  const key = isIdbKey(refPhoto) ? refPhoto : refImageKey();
  let blob: Blob | null = null;
  try {
    blob = await getImage(key);
  } catch {
    blob = null;
  }
  if (!blob) return;
  const { error } = await sb.storage.from(closetImagesBucket()).upload(
    refObjectPath(userId),
    blob,
    { upsert: true, contentType: blob.type || "image/jpeg" },
  );
  if (!error) uploadedRef.add(mark);
}

function applyLocal(next: CloudMeta) {
  const current = useCloset.getState();
  const mixed = {
    garments: next.garments as Garment[],
    looks: next.looks as Look[],
    journal: next.journal as WearEntry[],
    drop: next.drop as DailyDrop | null,
    seenLooks: current.seenLooks,
  };
  const { purgedIds, ...clean } = scrubRack({
    garments: mixed.garments,
    looks: mixed.looks,
    journal: mixed.journal,
    drop: mixed.drop,
    seenLooks: mixed.seenLooks,
  });
  void purgedIds;
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
}

async function countAccountThumbs(userId: string): Promise<number> {
  try {
    return await countListedThumbs(userId);
  } catch {
    return 0;
  }
}

async function pullThumbs(garments: CloudMeta["garments"]) {
  const pool = accountPool(garments);
  const n = pool.length;
  if (n === 0) return;
  setAccountProgress(pulledCopy(n));
  await prefetchEagerThumbs(
    pool.map((g) => g.id),
    (done, total) => setAccountProgress(loadingPhotosCopy(done, total)),
  );
  setAccountProgress(pulledCopy(n));
  window.setTimeout(() => {
    if (getAccount().progress === pulledCopy(n)) setAccountProgress(null);
  }, 4000);
}

async function pushNow(withProgress: boolean) {
  const user = getAccount().user;
  if (!user) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setLocalOnly(true);
    setAccountProgress(LOCAL_ONLY_CAPTION);
    return;
  }
  if (pushing) return;
  pushing = true;
  try {
    const garments = accountPool(useCloset.getState().garments) as Garment[];
    const total = garments.length;
    const conc = total && withProgress ? 3 : 2;
    try {
      if (total > 0) {
        let done = 0;
        await mapPool(garments, conc, async (g) => {
          await uploadKind(user.id, g, "t");
          done += 1;
          if (withProgress) setAccountProgress(backingUpCopy(done, total));
        });
        await mapPool(garments, 2, async (g) => {
          await uploadKind(user.id, g, "c");
          await uploadKind(user.id, g, "o");
        });
      }
    } catch (err) {
      setLocalOnly(true);
      setAccountProgress(cloudErrorCopy(err));
    }
    const uploadedKinds = new Set<string>();
    for (const g of garments) {
      for (const kind of ["t", "c", "o"] as const) {
        if (wasUploaded(g.id, kind)) uploadedKinds.add(`${g.id}:${kind}`);
      }
    }
    holdPush = true;
    try {
      openPersistGate();
      applyBackupToStore(
        () => useCloset.getState().garments,
        (next) => useCloset.setState({ garments: next }),
        user.id,
        uploadedKinds,
      );
      await upsertMeta(user.id);
    } finally {
      holdPush = false;
    }
    void uploadRef(user.id, useCloset.getState().refPhoto);
    const liveN = livePool(useCloset.getState().garments).length;
    let listed = 0;
    try {
      listed = await countListedThumbs(user.id);
    } catch (err) {
      setLocalOnly(true);
      setAccountProgress(cloudErrorCopy(err));
    }
    patchAccount({ listedThumbs: listed });
    const remaining = backupRemaining({
      idbRemaining: idbCount(accountPool(useCloset.getState().garments)),
      listedThumbs: listed,
      liveCount: liveN,
    });
    if (remaining > 0) {
      setLocalOnly(true);
      if (!getAccount().progress || getAccount().progress?.startsWith("Backing up") || getAccount().progress?.startsWith("Saved")) {
        setAccountProgress(stillOnPhoneCopy(remaining));
      }
      return;
    }
    if (getAccount().localOnly) {
      setAccountProgress(LOCAL_ONLY_CAPTION);
      return;
    }
    if (withProgress) {
      setAccountProgress(savedAccountCopy(total));
      window.setTimeout(() => {
        if (getAccount().progress === savedAccountCopy(total)) setAccountProgress(null);
      }, 4000);
    }
  } finally {
    pushing = false;
  }
}

export function backupPhotos(): void {
  clearUploaded();
  void pushNow(true);
}

function schedulePush() {
  if (linking || holdPush) return;
  if (!getAccount().user) return;
  if (typeof window === "undefined") return;
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    void pushNow(false);
  }, PUSH_MS);
}

async function firstLink(userId: string) {
  linking = true;
  try {
    const email = getAccount().user?.email;
    const cloud = await fetchMeta(userId);
    const local = snapshot();
    const last = readLast(userId);
    const localCount = accountPool(local.garments).length;
    const cloudCount = cloud ? accountPool(cloud.garments).length : 0;
    if (!isHomeEmail(email) && cloudCount === 0) {
      patchAccount({ wrongAccount: true, progress: WRONG_ACCOUNT });
      void localCount;
      return;
    }
    patchAccount({ wrongAccount: false });
    const result = mergeAccount({ local, cloud, lastCloudIds: last });
    if (result.appliedCloud) {
      applyLocal(result.next);
      const n = accountPool(result.next.garments).length;
      if (n > 0) setAccountProgress(pulledCopy(n));
      await new Promise<void>((resolve) => {
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
        else resolve();
      });
      await pullThumbs(result.next.garments);
    }
    if (result.action === "push" || result.action === "union") {
      await pushNow(result.action === "push");
    } else {
      writeLast(
        userId,
        accountPool(useCloset.getState().garments).map((g) => g.id),
      );
    }
    const pool = livePool(useCloset.getState().garments);
    if (pool.length > 0) {
      const thumbs = await countAccountThumbs(userId);
      if (thumbs < pool.length) {
        clearUploaded();
        await pushNow(true);
      }
    }
  } finally {
    linking = false;
  }
}

async function pullOnVisible() {
  if (linking) return;
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
  let needPush = getAccount().localOnly;
  linking = true;
  try {
    const cloud = await fetchMeta(user.id);
    const local = snapshot();
    const last = readLast(user.id);
    const result = mergeAccount({ local, cloud, lastCloudIds: last });
    const intent = visibleCloudIntent({
      action: result.action,
      appliedCloud: result.appliedCloud,
    });
    if (intent === "push") needPush = true;
    if (intent !== "apply") return;
    const before = new Set(accountPool(local.garments).map((g) => g.id));
    const after = accountPool(result.next.garments).map((g) => g.id);
    const changed =
      after.length !== before.size || after.some((id) => !before.has(id));
    if (!changed && result.next.looks.length === local.looks.length) return;
    applyLocal(result.next);
    const n = after.length;
    if (n > 0) setAccountProgress(pulledCopy(n));
    await pullThumbs(result.next.garments);
    writeLast(user.id, after);
    if (result.action === "union" || result.action === "push") needPush = true;
  } finally {
    linking = false;
  }
  if (needPush) schedulePush();
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
    if (user && (event === "INITIAL_SESSION" || event === "SIGNED_IN")) {
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
    const localCount = accountPool(useCloset.getState().garments).length;
    if (
      onOnlineIntent({
        online: typeof navigator === "undefined" || navigator.onLine !== false,
        signedIn: Boolean(getAccount().user),
        localCount,
        localOnly: getAccount().localOnly,
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
    navigator as Navigator & { connection?: { addEventListener?: typeof window.addEventListener; removeEventListener?: typeof window.removeEventListener } }
  ).connection;
  conn?.addEventListener?.("change", retryOnline);

  const unsubStore = useCloset.subscribe((s, prev) => {
    if (s.refPhoto !== prev.refPhoto) uploadedRef.delete("me:ref");
    if (s.garments !== prev.garments) {
      if (s.garments.length === 0 && prev.garments.length > 0) clearUploaded();
      else {
        const ids = new Set(s.garments.map((g) => g.id));
        for (const g of prev.garments) {
          if (!ids.has(g.id)) forgetUploaded(g.id);
        }
      }
    }
    if (
      s.garments === prev.garments &&
      s.looks === prev.looks &&
      s.journal === prev.journal &&
      s.avoid === prev.avoid &&
      s.drop === prev.drop &&
      s.refPhoto === prev.refPhoto
    ) {
      return;
    }
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
    if (pushTimer !== undefined) window.clearTimeout(pushTimer);
  };
}

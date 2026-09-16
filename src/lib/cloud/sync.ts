import {
  getImage,
  imageKey,
  isIdbKey,
  putImage,
  refImageKey,
} from "../images.ts";
import { scrubRack } from "../rack.ts";
import { useCloset } from "../store.ts";
import type { DailyDrop, Garment, Look, WearEntry } from "../types.ts";
import { getAccount, patchAccount, setAccountProgress } from "./account.ts";
import {
  closetImagesBucket,
  garmentObjectPath,
  getSupabase,
  refObjectPath,
} from "./client.ts";
import { pulledCopy, savingProgress } from "./copy.ts";
import { supabaseConfigured } from "./env.ts";
import {
  accountPool,
  mergeAccount,
  type CloudMeta,
} from "./merge.ts";

const LAST_KEY = "closet.cloud.last";
const PUSH_MS = 1000;

type LastSnap = { userId: string; ids: string[] };

let linking = false;
let pushTimer: number | undefined;
let started = false;
const uploaded = new Set<string>();

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

async function mapPool<T>(items: T[], n: number, worker: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      const item = items[i++];
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
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
  if (error) setAccountProgress("Could not save to your account.");
  else writeLast(userId, garments.map((g) => g.id));
}

async function blobFor(g: Garment, kind: "o" | "c" | "t"): Promise<Blob | null> {
  const primary = imageKey(g.id, kind);
  try {
    const hit = await getImage(primary);
    if (hit) return hit;
  } catch {
    /* */
  }
  try {
    if (kind === "o" && isIdbKey(g.imageSrc)) return await getImage(g.imageSrc);
    if (kind === "c" && isIdbKey(g.cutoutSrc)) return await getImage(g.cutoutSrc);
  } catch {
    /* */
  }
  return null;
}

async function uploadGarment(userId: string, g: Garment): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  for (const kind of ["t", "c", "o"] as const) {
    const mark = `${g.id}:${kind}`;
    if (uploaded.has(mark)) continue;
    const blob = await blobFor(g, kind);
    if (!blob) continue;
    const { error } = await sb.storage.from(closetImagesBucket()).upload(
      garmentObjectPath(userId, g.id, kind),
      blob,
      { upsert: true, contentType: blob.type || "image/jpeg" },
    );
    if (!error) uploaded.add(mark);
  }
}

async function uploadRef(userId: string, refPhoto: string | null): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const mark = "me:ref";
  if (!refPhoto) {
    if (uploaded.has(mark)) {
      await sb.storage.from(closetImagesBucket()).remove([refObjectPath(userId)]);
      uploaded.delete(mark);
    }
    return;
  }
  if (uploaded.has(mark)) return;
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
  if (!error) uploaded.add(mark);
}

async function downloadKind(userId: string, id: string, kind: "o" | "c" | "t"): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const key = imageKey(id, kind);
  try {
    const existing = await getImage(key);
    if (existing) {
      uploaded.add(`${id}:${kind}`);
      return;
    }
  } catch {
    /* */
  }
  const { data, error } = await sb.storage
    .from(closetImagesBucket())
    .download(garmentObjectPath(userId, id, kind));
  if (error || !data) return;
  await putImage(key, data);
  uploaded.add(`${id}:${kind}`);
}

async function downloadRef(userId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const key = refImageKey();
  try {
    const existing = await getImage(key);
    if (existing) {
      uploaded.add("me:ref");
      if (!useCloset.getState().refPhoto) useCloset.setState({ refPhoto: key });
      return;
    }
  } catch {
    /* */
  }
  const { data, error } = await sb.storage.from(closetImagesBucket()).download(refObjectPath(userId));
  if (error || !data) return;
  await putImage(key, data);
  uploaded.add("me:ref");
  useCloset.setState({ refPhoto: key });
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
  useCloset.getState().ensureLookbook();
}

async function pullBlobs(userId: string, garments: CloudMeta["garments"], announce: boolean) {
  const pool = accountPool(garments) as Garment[];
  await mapPool(pool, 6, async (g) => {
    await downloadKind(userId, g.id, "t");
  });
  if (announce) {
    setAccountProgress(pulledCopy(pool.length));
    window.setTimeout(() => {
      if (getAccount().progress === pulledCopy(pool.length)) setAccountProgress(null);
    }, 4000);
  }
  void mapPool(pool, 3, async (g) => {
    await downloadKind(userId, g.id, "c");
    await downloadKind(userId, g.id, "o");
  });
  if (useCloset.getState().refPhoto || garments.length > 0) {
    void downloadRef(userId);
  }
}

async function pushNow(withProgress: boolean) {
  const user = getAccount().user;
  if (!user) return;
  const garments = accountPool(useCloset.getState().garments) as Garment[];
  if (withProgress && garments.length > 0) {
    let done = 0;
    await mapPool(garments, 3, async (g) => {
      await uploadGarment(user.id, g);
      done += 1;
      setAccountProgress(savingProgress(done, garments.length));
    });
    await uploadRef(user.id, useCloset.getState().refPhoto);
    setAccountProgress(null);
  } else {
    await mapPool(garments, 3, async (g) => {
      await uploadGarment(user.id, g);
    });
    await uploadRef(user.id, useCloset.getState().refPhoto);
  }
  await upsertMeta(user.id);
}

function schedulePush() {
  if (linking) return;
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
    const cloud = await fetchMeta(userId);
    const local = snapshot();
    const last = readLast(userId);
    const result = mergeAccount({ local, cloud, lastCloudIds: last });
    if (result.appliedCloud) {
      applyLocal(result.next);
      const pulled = result.action === "pull";
      await pullBlobs(userId, result.next.garments, pulled);
    }
    if (result.action === "push" || result.action === "union") {
      await pushNow(result.action === "push");
    } else {
      writeLast(
        userId,
        accountPool(useCloset.getState().garments).map((g) => g.id),
      );
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
  linking = true;
  try {
    const cloud = await fetchMeta(user.id);
    const local = snapshot();
    const last = readLast(user.id);
    const result = mergeAccount({ local, cloud, lastCloudIds: last });
    if (!result.appliedCloud) return;
    const before = new Set(accountPool(local.garments).map((g) => g.id));
    const after = accountPool(result.next.garments).map((g) => g.id);
    const changed =
      after.length !== before.size || after.some((id) => !before.has(id));
    if (!changed && result.next.looks.length === local.looks.length) return;
    applyLocal(result.next);
    await pullBlobs(user.id, result.next.garments, false);
    writeLast(user.id, after);
    if (result.action === "union" || result.action === "push") schedulePush();
  } finally {
    linking = false;
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
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("focus", onVis);
  window.addEventListener("pageshow", onVis);

  const unsubStore = useCloset.subscribe((s, prev) => {
    if (s.refPhoto !== prev.refPhoto) uploaded.delete("me:ref");
    if (s.garments !== prev.garments) {
      if (s.garments.length === 0 && prev.garments.length > 0) uploaded.clear();
      else {
        const ids = new Set(s.garments.map((g) => g.id));
        for (const mark of [...uploaded]) {
          const id = mark.split(":")[0];
          if (id && id !== "me" && !ids.has(id)) uploaded.delete(mark);
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
    unsubStore();
    if (pushTimer !== undefined) window.clearTimeout(pushTimer);
  };
}

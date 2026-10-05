import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useAccount } from "@/lib/cloud/account";
import { bindLiveCopies, reconcileAccountCopies } from "@/lib/data/copies-live";
import { setCopyParity } from "@/lib/data/copies";
import { setV2Port } from "@/lib/data/v2-port";
import { accountPool } from "@/lib/cloud/merge";
import { stillOnPhoneCopy } from "@/lib/cloud/copy";
import { backupRemaining, idbCount, shouldShowBackupBanner } from "@/lib/cloud/src";
import { backupPhotos, startCloudSync } from "@/lib/cloud/sync";
import { scheduleOuterwearPlates, usePlatePassNote } from "@/lib/plate-pass";
import { livePool } from "@/lib/rack";
import { migrateImagesToIdb } from "@/lib/migrate";
import { openPersistGate, useCloset } from "@/lib/store";
import { cn } from "@/lib/utils";
import { noteRoute } from "@/lib/stylist-page";
import { BottomNav } from "./bottom-nav";
import { StylistDock } from "./stylist-dock";
import { TopBar } from "./top-bar";

function BackupBanner() {
  const account = useAccount();
  const garments = useCloset((s) => s.garments);
  const liveCount = livePool(garments).length;
  const idbRemaining = idbCount(accountPool(garments));
  const remaining =
    account.listedThumbs == null
      ? idbRemaining
      : backupRemaining({
          idbRemaining,
          listedThumbs: account.listedThumbs,
          liveCount,
        });
  const show = shouldShowBackupBanner({
    signedIn: Boolean(account.user),
    liveCount,
    remaining: idbRemaining,
    localOnly: account.localOnly,
    listedThumbs: account.listedThumbs,
  });
  if (!show) return null;
  const objectsExist =
    typeof account.listedThumbs === "number" && account.listedThumbs >= liveCount;
  const progress = account.progress;
  const label = objectsExist
    ? progress && !/still on this phone/i.test(progress)
      ? progress
      : ""
    : progress && !progress.startsWith("Saved")
      ? progress
      : stillOnPhoneCopy(remaining);
  return (
    <div className="fixed top-12 md:top-16 inset-x-0 z-30 border-b bg-paper text-ink border-hairline">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 md:px-6 py-2">
        <p className="micro min-w-0 truncate text-ink-soft">{label}</p>
        <button
          type="button"
          onClick={() => backupPhotos()}
          className="h-9 shrink-0 bg-accent px-3 text-sm text-paper"
        >
          Backup photos
        </button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hydrated = useCloset((s) => s.hydrated);
  const account = useAccount();
  const garments = useCloset((s) => s.garments);
  const backupOpen = shouldShowBackupBanner({
    signedIn: Boolean(account.user),
    liveCount: livePool(garments).length,
    remaining: idbCount(accountPool(garments)),
    localOnly: account.localOnly,
    listedThumbs: account.listedThumbs,
  });

  useEffect(() => {
    let live = true;
    let stopSync = () => {};
    void (async () => {
      try {
        await useCloset.persist.rehydrate();
      } catch (e) {
        console.error("[closet] rehydrate failed", e);
      }
      openPersistGate();
      if (!live) return;
      if (useCloset.getState().garments.length === 0) {
        await useCloset.getState().restoreFromIdbMeta();
      }
      if (!live) return;
      await useCloset.getState().restoreRefPhoto();
      if (!live) return;
      useCloset.setState({ hydrated: true });
      useCloset.getState().purgeDemoRack();
      const s = useCloset.getState();
      if (s.garments.length > 0) {
        useCloset.setState({ garments: s.garments });
      }
      void useCloset.getState().retitleFakeNames();
      void migrateImagesToIdb().catch(() => {});
      if (live) stopSync = startCloudSync();
    })();
    return () => {
      live = false;
      stopSync();
    };
  }, []);

  const userId = account.user?.id ?? null;
  const cleaning = usePlatePassNote();

  useEffect(() => {
    if (!hydrated || !userId) return;
    scheduleOuterwearPlates();
  }, [hydrated, userId, garments]);

  useEffect(() => {
    if (!hydrated) return;
    if (!userId) {
      setV2Port(null);
      setCopyParity(null);
      return;
    }
    bindLiveCopies(userId);
    void reconcileAccountCopies(userId, {
      looks: () => useCloset.getState().looks,
      drop: () => useCloset.getState().drop,
      removeLook: (id) => useCloset.getState().removeLook(id),
      metaGarments: () => useCloset.getState().garments.filter((g) => g.demo !== true).length,
      metaLooks: () => useCloset.getState().looks.length,
    }).catch(() => {});
  }, [hydrated, userId]);

  useEffect(() => {
    noteRoute(pathname);
  }, [pathname]);

  useEffect(() => {
    if (typeof document.startViewTransition === "function") return;
    const main = document.querySelector("main");
    if (!main) return;
    main.classList.remove("route-enter");
    void main.offsetWidth;
    main.classList.add("route-enter");
  }, [pathname]);

  useEffect(() => {
    if (pathname !== "/lookbook" || !hydrated) return;
    const run = () => {
      if (useCloset.getState().garments.length > 0) {
        useCloset.getState().ensureLookbook();
      }
    };
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(run);
      return () => cancelIdleCallback(id);
    }
    const t = window.setTimeout(run, 0);
    return () => window.clearTimeout(t);
  }, [pathname, hydrated]);

  return (
    <div className="paper-grain min-h-dvh bg-paper text-ink">
      <TopBar />
      <BackupBanner />
      <main
        className={cn(
          "pb-20 md:pb-10",
          backupOpen ? "pt-24 md:pt-28" : "pt-12 md:pt-16",
        )}
      >
        {cleaning ? <p className="micro px-4 py-1 text-ink-soft md:px-6">{cleaning}</p> : null}
        {children}
      </main>
      <StylistDock />
      <BottomNav />
    </div>
  );
}

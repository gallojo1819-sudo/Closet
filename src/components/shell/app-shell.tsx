import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useAccount } from "@/lib/cloud/account";
import { accountPool } from "@/lib/cloud/merge";
import { stillOnPhoneCopy } from "@/lib/cloud/copy";
import { backupRemaining, idbCount, shouldShowBackupBanner } from "@/lib/cloud/src";
import { backupPhotos, startCloudSync } from "@/lib/cloud/sync";
import { livePool } from "@/lib/rack";
import { migrateImagesToIdb } from "@/lib/migrate";
import { openPersistGate, useCloset } from "@/lib/store";
import { cn } from "@/lib/utils";
import { BottomNav } from "./bottom-nav";
import { TopBar } from "./top-bar";

function BackupBanner({ night }: { night: boolean }) {
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
  const label =
    account.progress && !account.progress.startsWith("Saved")
      ? account.progress
      : stillOnPhoneCopy(remaining);
  return (
    <div
      className={cn(
        "fixed top-12 md:top-16 inset-x-0 z-30 border-b",
        night ? "bg-night text-champagne border-champagne/20" : "bg-paper text-ink border-hairline",
      )}
    >
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
  const night = pathname.startsWith("/stylist");
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

  useEffect(() => {
    document.documentElement.classList.toggle("vt-night", night);
  }, [night]);

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
    <div
      className={cn(
        "paper-grain min-h-dvh",
        night ? "theme-night" : "bg-paper text-ink",
      )}
    >
      <TopBar />
      <BackupBanner night={night} />
      <main className={cn("pb-20 md:pb-10", backupOpen ? "pt-24 md:pt-28" : "pt-12 md:pt-16")}>
        {children}
      </main>
      <BottomNav />
    </div>
  );
}

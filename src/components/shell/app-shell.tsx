import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { migrateImagesToIdb } from "@/lib/migrate";
import { openPersistGate, useCloset } from "@/lib/store";
import { cn } from "@/lib/utils";
import { BottomNav } from "./bottom-nav";
import { TopBar } from "./top-bar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const night = pathname.startsWith("/stylist");
  const hydrated = useCloset((s) => s.hydrated);

  useEffect(() => {
    let live = true;
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
      const s = useCloset.getState();
      if (s.garments.length > 0) {
        useCloset.setState({ garments: s.garments });
      }
      void migrateImagesToIdb().catch(() => {});
    })();
    return () => {
      live = false;
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
      <main className="pt-12 md:pt-16 pb-20 md:pb-10">{children}</main>
      <BottomNav />
    </div>
  );
}

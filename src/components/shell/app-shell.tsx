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
        s.ensureLookbook();
      }
      void migrateImagesToIdb().catch(() => {});
    })();
    return () => {
      live = false;
    };
  }, []);

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

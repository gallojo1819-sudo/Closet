import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useCloset } from "@/lib/store";
import { cn } from "@/lib/utils";
import { BottomNav } from "./bottom-nav";
import { TopBar } from "./top-bar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const night = pathname.startsWith("/stylist");

  useEffect(() => {
    void Promise.resolve(useCloset.persist.rehydrate()).finally(() => {
      useCloset.setState({ hydrated: true });
    });
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

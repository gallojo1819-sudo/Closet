import { Link, useRouterState } from "@tanstack/react-router";
import { BookOpen, Shirt, Sparkles, SquarePlus, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/", label: "Today", icon: Sun },
  { to: "/closet", label: "Closet", icon: Shirt },
  { to: "/add", label: "Add", icon: SquarePlus },
  { to: "/lookbook", label: "Lookbook", icon: BookOpen },
  { to: "/stylist", label: "Stylist", icon: Sparkles },
] as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const night = pathname.startsWith("/stylist");

  return (
    <nav
      className={cn(
        "fixed bottom-0 inset-x-0 z-40 border-t md:hidden",
        night
          ? "bg-night text-champagne border-champagne/20"
          : "bg-paper text-ink border-hairline",
      )}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="grid grid-cols-5 h-14">
        {TABS.map((tab) => {
          const active =
            tab.to === "/" ? pathname === "/" : pathname.startsWith(tab.to);
          const Icon = tab.icon;
          return (
            <li key={tab.to}>
              <Link
                to={tab.to}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-0.5 micro",
                  active
                    ? night
                      ? "text-champagne"
                      : "text-ink"
                    : night
                      ? "text-champagne/45"
                      : "text-ink-soft",
                )}
              >
                <Icon className="size-4" strokeWidth={1.5} />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

import { Link, useRouterState } from "@tanstack/react-router";
import { useCloset } from "@/lib/store";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Today" },
  { to: "/closet", label: "Closet" },
  { to: "/add", label: "Add" },
  { to: "/stylist", label: "Stylist" },
  { to: "/outfits", label: "Outfits" },
];

export function TopBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const night = pathname.startsWith("/stylist");
  const garments = useCloset((s) => s.garments);
  const count = garments.filter((g) => !g.archived).length;
  const sample = garments.some((g) => g.demo);
  const loadSample = useCloset((s) => s.loadSample);
  const emptyCloset = useCloset((s) => s.emptyCloset);

  return (
    <header
      className={cn(
        "fixed top-0 inset-x-0 z-40 border-b",
        night
          ? "h-12 md:h-16 bg-night text-champagne border-champagne/20"
          : "h-12 md:h-16 bg-paper text-ink border-hairline",
      )}
    >
      <div className="mx-auto flex h-full max-w-6xl items-center gap-4 px-4 md:px-6">
        <Link
          to="/"
          className="font-editorial text-lg tracking-tight md:text-xl"
        >
          Closet
        </Link>
        <nav className="hidden md:flex items-center gap-5 ml-6 micro text-ink-soft">
          {NAV.map((item) => {
            const active =
              item.to === "/"
                ? pathname === "/"
                : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "transition-opacity",
                  night && "text-champagne/70",
                  active
                    ? night
                      ? "text-champagne"
                      : "text-ink"
                    : "hover:opacity-80",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className={cn("micro hidden sm:inline", night ? "text-champagne/70" : "text-ink-soft")}>
            {count} pieces
          </span>
          <span
            className={cn(
              "micro hidden sm:inline border px-2 py-1",
              night ? "border-champagne/30 text-champagne/80" : "border-hairline text-ink-soft",
            )}
          >
            Fit · 5′8 reg
          </span>
          <Link
            to="/stylist"
            className={cn(
              "micro hidden md:inline h-8 px-3 inline-flex items-center",
              night ? "bg-champagne text-night" : "bg-accent text-paper",
            )}
          >
            Stylist
          </Link>
          {sample ? (
            <button
              type="button"
              onClick={() => {
                if (confirm("Remove the sample rack? Your photos stay if you’ve added any.")) emptyCloset();
              }}
              className={cn(
                "micro opacity-60 hover:opacity-100",
                night ? "text-champagne" : "text-ink-soft",
              )}
            >
              Clear sample
            </button>
          ) : count === 0 ? (
            <button
              type="button"
              onClick={() => loadSample()}
              className={cn(
                "micro opacity-60 hover:opacity-100",
                night ? "text-champagne" : "text-ink-soft",
              )}
            >
              Sample rack
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

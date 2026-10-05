import { useEffect } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { openStylistPanel } from "@/components/shell/stylist-dock";

export const Route = createFileRoute("/stylist")({ component: StylistPage });

/**
 * /stylist opens the one dock's panel, then hands back to the page he was on.
 * No second dock, no night. noteRoute writes nothing for /stylist, so the
 * sentence he had stays.
 */
export function StylistPage() {
  const router = useRouter();
  useEffect(() => {
    openStylistPanel();
    router.history.back();
    const t = window.setTimeout(() => {
      if (window.location.pathname.startsWith("/stylist")) {
        void router.navigate({ to: "/" });
      }
    }, 60);
    return () => window.clearTimeout(t);
  }, [router]);
  return null;
}

import { createFileRoute } from "@tanstack/react-router";
import { StylistDock } from "@/components/shell/stylist-dock";

export const Route = createFileRoute("/stylist")({ component: StylistPage });

/** /stylist is the dock opened, not a separate thread. */
export function StylistPage() {
  return <StylistDock open />;
}

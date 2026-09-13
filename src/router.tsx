import { createRouter } from "@tanstack/react-router";
import { AppErrorComponent } from "@/lib/error-component";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultErrorComponent: AppErrorComponent,
    defaultViewTransition: {
      types: ({ fromLocation, toLocation }) => {
        const heavy = (p?: string) => p === "/closet" || p === "/lookbook";
        if (heavy(fromLocation?.pathname) || heavy(toLocation.pathname)) return false;
        if (toLocation.pathname.startsWith("/stylist")) return ["to-night"];
        return ["to-paper"];
      },
    },
  });
}

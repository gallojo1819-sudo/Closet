import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/outfits")({
  component: () => <Navigate to="/lookbook" replace />,
});

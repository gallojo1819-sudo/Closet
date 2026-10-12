import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Renders children at document.body. A page container animates in with a transform (`.rise`),
 * and a transformed ancestor becomes the containing block for `position: fixed`, so a sheet
 * rendered inside the page lands at the page's bottom instead of the viewport's. Nothing is
 * rendered on the server or before mount.
 */
export function BodyPortal({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready || typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

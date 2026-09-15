import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { placeBesideTile, useMdUp } from "@/components/closet/detail";
import { cn } from "@/lib/utils";

let scrollLocks = 0;

function lockScroll() {
  scrollLocks += 1;
  document.body.style.overflow = "hidden";
  document.documentElement.style.overflow = "hidden";
}

function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) {
    document.body.style.overflow = "";
    document.documentElement.style.overflow = "";
  }
}

/** Viewport overlay via portal so `.rise` transform cannot trap `position:fixed`. */
export function Overlay({
  children,
  onClose,
  getAnchor,
  zClass = "z-[60]",
}: {
  children: ReactNode;
  onClose: () => void;
  getAnchor?: () => HTMLElement | null;
  zClass?: string;
}) {
  const md = useMdUp();
  const [box, setBox] = useState<ReturnType<typeof placeBesideTile> | null>(() => {
    if (typeof window === "undefined") return null;
    if (!window.matchMedia("(min-width: 768px)").matches) return null;
    const el = getAnchor?.();
    return el ? placeBesideTile(el.getBoundingClientRect()) : null;
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
    lockScroll();
    return () => unlockScroll();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!md) {
      setBox(null);
      return;
    }
    const el = getAnchor?.();
    if (!el) {
      setBox(null);
      return;
    }
    setBox(placeBesideTile(el.getBoundingClientRect()));
  }, [md, getAnchor]);

  if (!ready || typeof document === "undefined") return null;

  const placed = Boolean(md && box);

  return createPortal(
    <div className={cn("fixed inset-0", zClass, !md && "flex items-end")}>
      <button
        type="button"
        className={cn("absolute inset-0", md ? "bg-ink/10" : "bg-ink/30")}
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative z-10 overflow-y-auto overscroll-contain bg-paper border border-hairline",
          md
            ? placed
              ? "fixed"
              : "fixed left-1/2 top-1/2 w-[min(100%-2rem,45rem)] max-h-[90dvh] -translate-x-1/2 -translate-y-1/2"
            : "w-full max-h-[90dvh]",
        )}
        style={
          placed && box
            ? {
                top: box.top,
                left: box.left,
                width: box.width,
                maxHeight: box.maxHeight,
                transform: "none",
              }
            : undefined
        }
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

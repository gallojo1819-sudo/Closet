import { useEffect, useRef, useState, type ReactNode } from "react";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** Press → "Wearing today" → the write lands and the toast slides up. */
export const WEAR_CONFIRM_MS = 400;
export const WEAR_TOAST = "Logged for today";

type Phase = "idle" | "confirming" | "done";

/**
 * The Wear this button in three steps. Click: the label crossfades to "Wearing today" and the
 * check draws in; after WEAR_CONFIRM_MS the existing wear-log write runs (onWear) and the
 * toast says "Logged for today". `onConfirming` lets the card scale toward the strip.
 */
export function WearButton({
  onWear,
  onConfirming,
  disabled,
  done,
  className,
  idleLabel = "Wear this",
  doneLabel = "Logged for today",
}: {
  onWear: () => void;
  onConfirming?: () => void;
  disabled?: boolean;
  /** Already logged today: the button stays in its done state. */
  done?: boolean;
  className?: string;
  idleLabel?: ReactNode;
  doneLabel?: ReactNode;
}) {
  const [phase, setPhase] = useState<Phase>(done ? "done" : "idle");
  const timer = useRef(0);
  const wear = useRef(onWear);
  wear.current = onWear;

  useEffect(() => {
    if (done) setPhase("done");
    else setPhase((p) => (p === "done" ? "idle" : p));
  }, [done]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const press = () => {
    if (phase !== "idle" || disabled) return;
    setPhase("confirming");
    onConfirming?.();
    timer.current = window.setTimeout(() => {
      wear.current();
      setPhase("done");
      showToast(WEAR_TOAST);
    }, WEAR_CONFIRM_MS);
  };

  const confirming = phase === "confirming";
  const finished = phase === "done";
  return (
    <button
      type="button"
      data-wear-button
      data-phase={phase}
      aria-live="polite"
      disabled={disabled || confirming || finished}
      onClick={press}
      className={cn(
        "wear-button relative inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-medium select-none",
        confirming || finished ? "bg-success text-paper" : "bg-accent text-paper",
        "disabled:pointer-events-none",
        finished && "opacity-70",
        className,
      )}
    >
      <span className="wear-check inline-flex" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="wear-labels grid">
        <span className={cn("wear-label col-start-1 row-start-1", phase !== "idle" && "is-hidden")}>{idleLabel}</span>
        <span className={cn("wear-label col-start-1 row-start-1", !confirming && "is-hidden")}>Wearing today</span>
        <span className={cn("wear-label col-start-1 row-start-1", !finished && "is-hidden")}>{doneLabel}</span>
      </span>
    </button>
  );
}

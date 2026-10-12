import { dismissToast, useToasts } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** The toast host: fixed above the bottom nav, transform and opacity only. */
export function Toasts() {
  const toasts = useToasts();
  if (!toasts.length) return null;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-[90] flex flex-col items-center gap-2 px-4 md:bottom-8"
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          data-toast
          onClick={() => dismissToast(t.id)}
          className={cn(
            "toast pointer-events-auto inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[13px] text-paper shadow-[0_8px_24px_-8px_rgb(23_20_15/0.45)]",
            t.leaving && "is-leaving",
          )}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t.text}
        </button>
      ))}
    </div>
  );
}

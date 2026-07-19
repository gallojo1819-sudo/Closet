import { Sparkles } from "lucide-react";

// Dark editorial shell. No backend yet, so this is a composed empty state — an
// eyebrow over a calm display headline with generous top space (the score-ref
// quality), a single quiet accent, and an honest "coming soon" line. When the
// stylist ships, the message list + prompt bar drop into this same rhythm.
export default function StylistPage() {
  return (
    <section className="mx-auto flex min-h-svh w-full max-w-md flex-col px-5 pb-28 pt-[calc(env(safe-area-inset-top)+2.5rem)]">
      <p className="font-ui text-[11px] uppercase tracking-[0.22em] text-neutral-500">
        Stylist
      </p>
      <h1 className="mt-2 font-display text-4xl leading-[1.05] text-neutral-100">
        Dressed by your closet
      </h1>

      <div className="mt-auto flex flex-col items-start gap-4 pt-16">
        <span className="inline-flex size-11 items-center justify-center rounded-full bg-neutral-900 text-neutral-300 ring-1 ring-neutral-800">
          <Sparkles className="size-5" aria-hidden />
        </span>
        <p className="max-w-sm font-ui text-[15px] leading-relaxed text-neutral-400">
          Outfit suggestions built from the pieces you own — grounded in what’s
          actually in your closet, never generic. Coming soon.
        </p>
      </div>

      {/* Anchored, disabled prompt bar — signals where the conversation will live. */}
      <div className="mt-8 flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/60 px-4 py-3">
        <span className="flex-1 font-ui text-sm text-neutral-600">
          Ask for an outfit…
        </span>
        <span className="inline-flex size-8 items-center justify-center rounded-full bg-neutral-800 text-neutral-600">
          <Sparkles className="size-4" aria-hidden />
        </span>
      </div>
    </section>
  );
}

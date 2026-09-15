import { createFileRoute } from "@tanstack/react-router";
import { Studio } from "@/components/add/studio";

export const Route = createFileRoute("/add")({ component: AddPage });

function AddPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 md:px-6 py-8 md:py-12 rise">
      <p className="micro text-ink-soft">Camera roll. Clothes only.</p>
      <h1 className="mt-2 font-editorial text-4xl md:text-5xl tracking-tight">
        Scan photos
      </h1>
      <p className="mt-3 text-ink-soft max-w-xl">
        Drop a pile. We keep the garments — not the pizza, not the selfie.
        One product plate still goes in as one piece.
      </p>

      <div className="mt-8">
        <Studio />
      </div>
    </div>
  );
}

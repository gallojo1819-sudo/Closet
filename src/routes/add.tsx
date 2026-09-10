import { createFileRoute } from "@tanstack/react-router";
import { Studio } from "@/components/add/studio";

export const Route = createFileRoute("/add")({ component: AddPage });

function AddPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 md:px-6 py-8 md:py-12 rise">
      <p className="micro text-ink-soft">Your photo. Never a stand-in.</p>
      <h1 className="mt-2 font-editorial text-4xl md:text-5xl tracking-tight">
        Add to the closet
      </h1>
      <p className="mt-3 text-ink-soft max-w-xl">
        Paste or shoot the actual piece. We float <em>your</em> pixels onto
        paper — we will not generate a generic shirt to replace it.
      </p>
      <div className="mt-8">
        <Studio />
      </div>
    </div>
  );
}

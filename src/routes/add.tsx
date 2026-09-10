import { createFileRoute } from "@tanstack/react-router";
import { Studio } from "@/components/add/studio";

export const Route = createFileRoute("/add")({ component: AddPage });

const SHOOT = [
  { n: "01", t: "One piece", d: "Not a pile. Not you wearing it." },
  { n: "02", t: "Laid flat", d: "Sleeves out, collar true, no bunched hem." },
  { n: "03", t: "Plain surface", d: "Cream sheet, paper, or a clean table." },
  { n: "04", t: "Window light", d: "Even, no flash, no overhead yellow." },
  { n: "05", t: "Fill the frame", d: "The garment is the picture." },
];

function AddPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 md:px-6 py-8 md:py-12 rise">
      <p className="micro text-ink-soft">Your photo. Never a stand-in.</p>
      <h1 className="mt-2 font-editorial text-4xl md:text-5xl tracking-tight">
        Add to the closet
      </h1>
      <p className="mt-3 text-ink-soft max-w-xl">
        Drop a dozen. We float each one on paper and name it. No form.
      </p>

      <aside className="mt-8 border border-hairline bg-card px-5 py-5">
        <p className="micro text-ink-soft">Tonight, at home</p>
        <p className="mt-2 font-editorial text-2xl tracking-tight">
          Twenty minutes. A cream sheet. Phone from above.
        </p>
        <ol className="mt-5 grid sm:grid-cols-2 gap-4">
          {SHOOT.map((s) => (
            <li key={s.n} className="flex gap-3">
              <span className="micro text-accent pt-1">{s.n}</span>
              <div>
                <p className="text-sm">{s.t}</p>
                <p className="text-sm text-ink-soft">{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
      </aside>

      <div className="mt-8">
        <Studio />
      </div>
    </div>
  );
}

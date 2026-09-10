import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { askStylist } from "@/lib/ai";
import { useCloset } from "@/lib/store";

export const Route = createFileRoute("/stylist")({ component: StylistPage });

const PROMPTS = [
  "Dinner in the West Village, 62°",
  "Client meeting, uptown",
  "Saturday with no plans",
];

function StylistPage() {
  const garmentsAll = useCloset((s) => s.garments);
  const garments = useMemo(
    () => garmentsAll.filter((g) => !g.archived),
    [garmentsAll],
  );
  const owned = useMemo(
    () => garments.filter((g) => !g.demo),
    [garments],
  );
  const forStylist = owned.length ? owned : garments;
  const messages = useCloset((s) => s.messages);
  const pushMessage = useCloset((s) => s.pushMessage);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async (prompt: string) => {
    const q = prompt.trim();
    if (!q || busy) return;
    pushMessage({ role: "user", text: q });
    setText("");
    setBusy(true);
    const closet = forStylist
      .map(
        (g) =>
          `- ${g.name} [${g.id}] (${g.category}/${g.subtype || "—"}, ${g.colors.join(" ")}, ${g.material})${g.demo ? " SAMPLE" : ""}`,
      )
      .join("\n");
    const res = await askStylist({ data: { prompt: q, closet } });
    pushMessage({
      role: "stylist",
      text: res.ok ? res.text : res.error,
    });
    setBusy(false);
  };

  return (
    <div className="mx-auto max-w-2xl px-4 md:px-6 py-8 md:py-12 rise">
      <p className="micro text-champagne/60">The atelier</p>
      <h1 className="mt-2 font-editorial text-4xl md:text-5xl tracking-tight text-champagne">
        Dress from what you own.
      </h1>
      <p className="mt-3 text-champagne/70 text-sm">
        The stylist can only see your closet. It will not invent a garment.
      </p>

      <div className="mt-8 space-y-4 min-h-64">
        {messages.length === 0 && (
          <p className="text-champagne/50 text-sm">
            Name an occasion. You’ll get a look built from the pieces above.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "user"
                ? "text-champagne/90"
                : "border border-champagne/20 bg-night-elev px-4 py-3 text-champagne"
            }
          >
            {m.role === "user" && <p className="micro text-champagne/50 mb-1">You</p>}
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.text}</p>
          </div>
        ))}
        {busy && (
          <p className="flex items-center gap-2 text-sm text-champagne/60">
            <Loader2 className="size-4 animate-spin" /> Considering the closet…
          </p>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => void send(p)}
            className="micro border border-champagne/25 px-3 py-2 text-champagne/80 hover:border-champagne/60"
          >
            {p}
          </button>
        ))}
      </div>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="An occasion, a constraint, a feeling…"
          className="h-12 flex-1 border border-champagne/25 bg-night-elev px-3 text-sm text-champagne placeholder:text-champagne/40"
        />
        <Button variant="night" type="submit" disabled={busy}>
          Send
        </Button>
      </form>
    </div>
  );
}

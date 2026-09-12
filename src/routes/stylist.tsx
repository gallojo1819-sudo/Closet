import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { askStylist } from "@/lib/ai";
import { daysIdle, HOUSE_LABEL, housesOf } from "@/lib/style";
import { useCloset } from "@/lib/store";

export const Route = createFileRoute("/stylist")({ component: StylistPage });

const PROMPTS = [
  "Client meeting, uptown, afternoon",
  "Dinner in the West Village",
  "Saturday, nothing planned",
  "Wear something I keep skipping",
];

function StylistPage() {
  const garmentsAll = useCloset((s) => s.garments);
  const drop = useCloset((s) => s.drop);
  const journal = useCloset((s) => s.journal);
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
    if (!q || busy || owned.length === 0) return;
    pushMessage({ role: "user", text: q });
    setText("");
    setBusy(true);
    const closet = forStylist
      .map((g) => {
        const idle = daysIdle(g);
        const last = idle >= 120 ? "never worn" : `${idle}d idle`;
        const house = housesOf(g).map((h) => HOUSE_LABEL[h]).join("/");
        return `- ${g.name} [${g.id}] (${g.category}/${g.subtype || "—"}, ${g.colors.join(" ")}, ${g.material}, ${house}, ${last})${g.demo ? " SAMPLE" : ""}`;
      })
      .join("\n");
    const sitting = forStylist
      .filter((g) => daysIdle(g) >= 21)
      .sort((a, b) => daysIdle(b) - daysIdle(a))
      .slice(0, 6)
      .map((g) => `${g.name} (${daysIdle(g)}d)`)
      .join(", ");
    const wornLately = journal
      .filter((j) => j.verdict === "worn")
      .slice(0, 5)
      .map((j) => j.garmentIds.map((id) => forStylist.find((g) => g.id === id)?.name).filter(Boolean).join(" + "))
      .filter(Boolean)
      .join("; ");
    const skippedLately = journal
      .filter((j) => j.verdict === "skipped")
      .slice(0, 3)
      .map((j) => j.garmentIds.map((id) => forStylist.find((g) => g.id === id)?.name).filter(Boolean).join(" + "))
      .filter(Boolean)
      .join("; ");
    const context = [
      drop?.weather ? `NYC ${drop.weather.f}° ${drop.weather.label}` : "NYC",
      drop?.occasion ?? "",
      drop?.moment ?? "",
      sitting ? `Sitting idle: ${sitting}` : "",
      wornLately ? `Recently worn: ${wornLately}` : "",
      skippedLately ? `He skipped: ${skippedLately}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const res = await askStylist({
      data: {
        prompt: q,
        closet,
        context,
        garments: forStylist,
        weatherF: drop?.weather?.f ?? 68,
      },
    });
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
        Ralph. Italian. Street.
      </h1>
      <p className="mt-3 text-champagne/70 text-sm">
        Mixed from your closet. Never a garment you don’t own.
      </p>

      {owned.length === 0 && (
        <div className="mt-10 border border-champagne/20 bg-night-elev px-4 py-5">
          <p className="text-sm text-champagne/80">
            The stylist has nothing to dress. Photograph a piece first.
          </p>
          <Link
            to="/add"
            className="mt-4 inline-flex h-11 items-center bg-champagne px-4 text-sm text-night"
          >
            Add a piece
          </Link>
        </div>
      )}

      <div className="mt-8 space-y-4 min-h-64">
        {messages.length === 0 && owned.length > 0 && (
          <p className="text-champagne/50 text-sm">
            Name an occasion, a time, a constraint. The look will come from the
            pieces above — especially the ones sitting.
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
            disabled={owned.length === 0}
            className="micro border border-champagne/25 px-3 py-2 text-champagne/80 hover:border-champagne/60 disabled:opacity-40"
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
          placeholder="Occasion, time, weather, a feeling…"
          disabled={owned.length === 0}
          className="h-12 flex-1 border border-champagne/25 bg-night-elev px-3 text-sm text-champagne placeholder:text-champagne/40 disabled:opacity-40"
        />
        <Button variant="night" type="submit" disabled={busy || owned.length === 0}>
          Send
        </Button>
      </form>
    </div>
  );
}

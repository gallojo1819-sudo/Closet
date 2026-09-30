import { useMemo, useState } from "react";
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { FlatLay } from "@/components/closet/flat-lay";
import { Button } from "@/components/ui/button";
import { askStylist } from "@/lib/ai";
import {
  WHICH_PIECE,
  dressReply,
  dressThisPiece,
  looksLikePieceAsk,
  occasionFromDressPrompt,
  resolvePiecesFromText,
} from "@/lib/dress";
import { draftFromMessage, recordStylistQuestion, stylistLookToSave } from "@/lib/stylist-thread";
import { appendHouseGap, houseFromPrompt } from "@/lib/houses";
import { nameLook } from "@/lib/look";
import { livePool } from "@/lib/rack";
import { daysIdle, defaultOccasion, HOUSE_LABEL, housesOf, momentOfDay } from "@/lib/style";
import { useCloset } from "@/lib/store";
import type { Garment, Occasion } from "@/lib/types";
import { todayISO } from "@/lib/utils";

export const Route = createFileRoute("/stylist")({ component: StylistPage });

function StylistNote({ text }: { text: string }) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const missing = lines.filter((l) => /^MISSING:/i.test(l));
  const body = lines.filter((l) => !/^MISSING:/i.test(l) && !/^LOOK:/i.test(l));
  return (
    <div className="space-y-1">
      {body.map((l, i) => (
        <p
          key={`${i}-${l}`}
          className={
            i === 0
              ? "text-sm leading-relaxed text-champagne"
              : "text-sm leading-relaxed text-champagne/80"
          }
        >
          {l}
        </p>
      ))}
      {missing.map((l) => (
        <p key={l} className="mt-2 text-sm text-champagne/70">
          {l.replace(/^MISSING:\s*/i, "Missing: ")}
        </p>
      ))}
    </div>
  );
}

const PROMPTS = [
  "Out, uptown, afternoon",
  "Dinner in the West Village",
  "Saturday, nothing planned",
  "Wear something I keep skipping",
];

function StylistPage() {
  const hydrated = useCloset((s) => s.hydrated);
  const garmentsAll = useCloset((s) => s.garments);
  const drop = useCloset((s) => s.drop);
  const journal = useCloset((s) => s.journal);
  const garments = useMemo(() => livePool(garmentsAll), [garmentsAll]);
  const owned = garments;
  const forStylist = garments;
  const messages = useCloset((s) => s.messages);
  const pushMessage = useCloset((s) => s.pushMessage);
  const stampMessage = useCloset((s) => s.stampMessage);
  const saveLook = useCloset((s) => s.saveLook);
  const setDrop = useCloset((s) => s.setDrop);
  const looks = useCloset((s) => s.looks);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async (prompt: string) => {
    const q = prompt.trim();
    if (!q || busy || owned.length === 0) return;
    recordStylistQuestion(useCloset.getState(), q);
    pushMessage({ role: "user", text: q });
    setText("");
    setBusy(true);
    const named = resolvePiecesFromText(q, owned);
    const houseHint = houseFromPrompt(q);
    if (named.length === 0 && looksLikePieceAsk(q) && !houseHint) {
      pushMessage({ role: "stylist", text: "Tap the piece on Closet." });
      setBusy(false);
      return;
    }
    if (named.length > 0 || houseHint) {
      const occasion = occasionFromDressPrompt(q, drop?.occasion);
      const house = houseFromPrompt(q);
      const dressed = dressThisPiece({
        lockedIds: named.map((g) => g.id),
        garments: owned,
        looks,
        occasion,
        weather: drop?.weather,
        journal,
        house: house ?? houseHint ?? undefined,
      });
      if (dressed) {
        const pieces = dressed.pieces;
        const activeHouse = house ?? houseHint ?? null;
        pushMessage({
          role: "stylist",
          text: appendHouseGap(
            dressReply(pieces, occasion, named.map((g) => g.id)),
            activeHouse,
            owned,
            occasion,
          ),
          garmentIds: dressed.garmentIds,
          draftName: nameLook(pieces),
          draftOccasion: occasion,
        });
      } else {
        pushMessage({ role: "stylist", text: WHICH_PIECE });
      }
      setBusy(false);
      return;
    }
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
        house: houseFromPrompt(q),
      },
    });
    if (res.ok && res.garmentIds.length) {
      const pieces = res.garmentIds
        .map((id) => forStylist.find((g) => g.id === id))
        .filter((g): g is Garment => Boolean(g));
      const occasion = (res.occasion ?? defaultOccasion()) as Occasion;
      pushMessage({
        role: "stylist",
        text: res.text,
        garmentIds: res.garmentIds,
        draftName: nameLook(pieces),
        draftOccasion: occasion,
      });
    } else {
      pushMessage({
        role: "stylist",
        text: res.ok ? res.text : res.error,
      });
    }
    setBusy(false);
  };

  const wearDraft = (messageId: string) => {
    const message = messages.find((m) => m.id === messageId);
    const draft = message ? draftFromMessage(message) : null;
    if (!draft) return;
    setDrop({
      date: todayISO(),
      garmentIds: draft.garmentIds,
      worn: false,
      verdict: "pending",
      weather: drop?.weather,
      occasion: draft.occasion,
      moment: drop?.moment ?? momentOfDay(),
    });
  };

  const saveDraft = (messageId: string) => {
    const message = messages.find((m) => m.id === messageId);
    const draft = message ? draftFromMessage(message) : null;
    if (!draft || message?.lookId) return;
    const id = saveLook(stylistLookToSave(draft));
    stampMessage(messageId, { lookId: id });
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

      {!hydrated ? null : owned.length === 0 ? (
        <Navigate to="/add" />
      ) : null}

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
            {m.role === "stylist" ? (
              <StylistNote text={m.text} />
            ) : (
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.text}</p>
            )}
            {m.role === "stylist" && m.garmentIds && m.garmentIds.length > 0 && (
              <FlatLay
                pieces={m.garmentIds
                  .map((id) => forStylist.find((g) => g.id === id))
                  .filter((g): g is Garment => Boolean(g))}
                className="mt-3 max-w-sm border border-champagne/20"
              />
            )}
            {m.role === "stylist" && (draftFromMessage(m) || m.lookId) && (
              <div className="mt-3 flex flex-wrap gap-3">
                {draftFromMessage(m) && (
                  <button
                    type="button"
                    onClick={() => saveDraft(m.id)}
                    className="micro text-champagne/80 hover:text-champagne underline-offset-2 hover:underline"
                  >
                    {m.lookId ? "Saved" : "Save"}
                  </button>
                )}
                {draftFromMessage(m) && (
                  <button
                    type="button"
                    onClick={() => wearDraft(m.id)}
                    className="micro text-champagne/80 hover:text-champagne underline-offset-2 hover:underline"
                  >
                    Wear this
                  </button>
                )}
                {m.lookId && (
                  <Link
                    to="/lookbook"
                    search={{ look: m.lookId }}
                    className="micro text-champagne/80 hover:text-champagne underline-offset-2 hover:underline"
                  >
                    See on you →
                  </Link>
                )}
              </div>
            )}
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
          placeholder="Wear the cream cable"
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

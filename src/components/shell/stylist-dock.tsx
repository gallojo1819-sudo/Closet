import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, Navigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { FlatLay } from "@/components/closet/flat-lay";
import { Button } from "@/components/ui/button";
import { askStylist, trendLayer } from "@/lib/ai";
import {
  WHICH_PIECE,
  dressThisPiece,
  looksLikePieceAsk,
  occasionFromDressPrompt,
  resolvePiecesFromText,
} from "@/lib/dress";
import { draftFromMessage, recordStylistQuestion, restoreIfAskWrote, stylistLookToSave } from "@/lib/stylist-thread";
import {
  NOT_IN_CLOSET,
  acceptStylistReply,
  answerAsked,
  readStylistPage,
  rememberedLooks,
  replyFromStylistResult,
  screenSentence,
  stylistAskFields,
  stylistPayload,
  stylistProse,
  subscribeStylistPage,
} from "@/lib/stylist-page";
import { nameLook } from "@/lib/look";
import { livePool } from "@/lib/rack";
import { daysIdle, defaultOccasion, momentOfDay } from "@/lib/style";
import { useCloset } from "@/lib/store";
import {
  acceptTrend,
  atlasText,
  emptyTaste,
  learnFromAsk,
  learnFromSave,
  logWear,
  pieceVetoIds,
  swapDraft,
  swapSlot,
  techniqueUsed,
  trendDue,
} from "@/lib/taste";
import { OCCASIONS, type Garment, type Occasion } from "@/lib/types";
import { todayISO } from "@/lib/utils";

let trendPassStarted = false;

const PROMPTS = [
  "Out, uptown, afternoon",
  "Dinner in the West Village",
  "Saturday, nothing planned",
  "Wear something I keep skipping",
];

function StylistNote({ text }: { text: string }) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const missing = lines.filter((l) => /^MISSING:/i.test(l));
  const body = lines.filter((l) => !/^MISSING:/i.test(l) && !/^LOOK:/i.test(l));
  const shown = body.length ? body : [stylistProse(text)];
  return (
    <div className="space-y-1">
      {shown.map((l, i) => (
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

function pageOccasion(value: string | undefined, fallback: Occasion): Occasion {
  return OCCASIONS.some((row) => row.id === value) ? (value as Occasion) : fallback;
}

/** The same panel on every page. /stylist opens it. */
export function StylistDock({ open = false }: { open?: boolean }) {
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
  const setTaste = useCloset((s) => s.setTaste);
  const looks = useCloset((s) => s.looks);
  const page = useSyncExternalStore(subscribeStylistPage, readStylistPage, readStylistPage);
  const sentence = useMemo(
    () => screenSentence(page, owned, rememberedLooks(page)),
    [page, owned],
  );
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const explicitWrite = useRef(false);

  useEffect(() => {
    if (!hydrated || trendPassStarted) return;
    const taste = useCloset.getState().taste ?? emptyTaste();
    if (!trendDue(taste, Date.now())) return;
    trendPassStarted = true;
    void trendLayer({ data: {} })
      .then((res) => {
        if (!res.ok) return;
        const state = useCloset.getState();
        const next = acceptTrend(state.taste ?? emptyTaste(), res.sentence, livePool(state.garments), Date.now());
        if (!next) return;
        setTaste(next);
      })
      .catch(() => {});
  }, [hydrated, setTaste]);

  const send = async (prompt: string) => {
    const q = prompt.trim();
    if (!q || busy || owned.length === 0) return;
    explicitWrite.current = false;
    const before = useCloset.getState();
    const staged = recordStylistQuestion(before, q);
    const snap = { looks: before.looks, drop: before.drop };
    pushMessage({ role: "user", text: q });
    setText("");
    setBusy(true);
    try {
    const previous = [...before.messages].reverse().find((m) => m.role === "stylist" && m.garmentIds?.length);
    const taste = learnFromAsk(before.taste ?? emptyTaste(), {
      text: q,
      garments: owned,
      previousIds: previous?.garmentIds ?? [],
      now: Date.now(),
    });
    setTaste(taste);
    const vetoed = pieceVetoIds(taste);
    const here = readStylistPage();
    const local = answerAsked({
      prompt: q,
      page: here,
      garments: owned,
      looks: rememberedLooks(here),
    });
    if (local.kind === "reject") {
      pushMessage({ role: "stylist", text: NOT_IN_CLOSET });
      return;
    }
    if (local.kind === "answer") {
      const pieces = local.garmentIds
        .map((id) => owned.find((g) => g.id === id))
        .filter((g): g is Garment => Boolean(g));
      const occasion = pageOccasion(here.occasion, (previous?.draftOccasion ?? defaultOccasion()) as Occasion);
      pushMessage({
        role: "stylist",
        text: local.text,
        ...(pieces.length
          ? {
              garmentIds: pieces.map((g) => g.id),
              draftName: nameLook(pieces),
              draftOccasion: occasion,
            }
          : {}),
      });
      return;
    }
    const slot = swapSlot(q);
    if (slot && previous?.garmentIds?.length) {
      const occasion = pageOccasion(
        here.occasion,
        (previous.draftOccasion ?? drop?.occasion ?? defaultOccasion()) as Occasion,
      );
      const edited = swapDraft({
        ids: previous.garmentIds,
        slot,
        garments: owned,
        taste,
        occasion,
        ...(typeof here.weatherF === "number" ? { weatherF: here.weatherF } : {}),
      });
      const garmentIds = edited?.garmentIds ?? previous.garmentIds;
      const pieces = garmentIds
        .map((id) => owned.find((g) => g.id === id))
        .filter((g): g is Garment => Boolean(g));
      const technique = edited?.technique ?? techniqueUsed(taste, pieces);
      pushMessage({
        role: "stylist",
        text: edited?.text ?? atlasText({ technique, pieces, occasion, missing: null }),
        garmentIds,
        draftName: nameLook(pieces),
        draftOccasion: occasion,
        technique: technique ?? undefined,
      });
      return;
    }
    const askText = q.replace(/(?:\bnot the\b|\bdon't use\b|\bdo not use\b|\bdont use\b|\bwithout the\b|\bno\b)\s+[^.,\n]+/gi, " ");
    const named = resolvePiecesFromText(askText, owned).filter((g) => !vetoed.has(g.id));
    if (named.length === 0 && looksLikePieceAsk(q) && !vetoed.size && !slot) {
      pushMessage({ role: "stylist", text: "Tap the piece on Closet." });
      return;
    }
    if (named.length > 0) {
      const occasion = occasionFromDressPrompt(
        q,
        pageOccasion(here.occasion, (drop?.occasion ?? defaultOccasion()) as Occasion),
      );
      const pool = owned.filter((g) => !vetoed.has(g.id) || named.some((n) => n.id === g.id));
      const dressed = dressThisPiece({
        lockedIds: named.map((g) => g.id),
        garments: pool,
        looks,
        occasion,
        weather: typeof here.weatherF === "number" ? drop?.weather : undefined,
        journal,
      });
      if (dressed) {
        const pieces = dressed.pieces.filter((g) => !vetoed.has(g.id) || named.some((n) => n.id === g.id));
        const technique = techniqueUsed(taste, pieces);
        const line = atlasText({ technique, pieces, occasion: dressed.occasion, missing: null });
        pushMessage({
          role: "stylist",
          text: acceptStylistReply(line, owned) ?? NOT_IN_CLOSET,
          garmentIds: pieces.map((g) => g.id),
          draftName: nameLook(pieces),
          draftOccasion: dressed.occasion,
          technique: technique ?? undefined,
        });
      } else {
        pushMessage({ role: "stylist", text: WHICH_PIECE });
      }
      return;
    }
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
      typeof here.weatherF === "number" ? `NYC ${here.weatherF}°` : "NYC",
      here.occasion ?? "",
      here.season ?? "",
      here.route === "today" ? (drop?.moment ?? "") : "",
      sitting ? `Sitting idle: ${sitting}` : "",
      wornLately ? `Recently worn: ${wornLately}` : "",
      skippedLately ? `He skipped: ${skippedLately}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const thread = before.messages.slice(-8).map((m) => ({ role: m.role, text: m.text }));
    const res = await askStylist({
      data: stylistAskFields({
        prompt: q,
        context,
        garments: forStylist,
        taste,
        lockedIds: named.map((g) => g.id),
        thread,
        page: here,
      }),
    });
    const payload = await stylistPayload(res);
    const painted = replyFromStylistResult(payload, owned);
    const pieces = painted.garmentIds
      .map((id) => owned.find((g) => g.id === id))
      .filter((g): g is Garment => Boolean(g));
    pushMessage({
      role: "stylist",
      text: painted.text,
      ...(pieces.length
        ? {
            garmentIds: pieces.map((g) => g.id),
            draftName: nameLook(pieces),
            draftOccasion: pageOccasion(here.occasion, (payload.occasion ?? defaultOccasion()) as Occasion),
            technique: payload.technique ?? undefined,
          }
        : {}),
    });
    } catch {
      pushMessage({ role: "stylist", text: NOT_IN_CLOSET });
    } finally {
      const undo = restoreIfAskWrote(staged, snap, useCloset.getState(), explicitWrite.current);
      if (undo) useCloset.setState(undo);
      setBusy(false);
    }
  };

  const wearDraft = (messageId: string) => {
    const message = messages.find((m) => m.id === messageId);
    const draft = message ? draftFromMessage(message) : null;
    if (!draft) return;
    explicitWrite.current = true;
    setDrop({
      date: todayISO(),
      garmentIds: draft.garmentIds,
      worn: false,
      verdict: "pending",
      weather: drop?.weather,
      occasion: draft.occasion,
      moment: drop?.moment ?? momentOfDay(),
    });
    const state = useCloset.getState();
    setTaste(logWear(state.taste ?? emptyTaste(), state.garments, draft.garmentIds, Date.now()));
  };

  const saveDraft = (messageId: string) => {
    const message = messages.find((m) => m.id === messageId);
    const draft = message ? draftFromMessage(message) : null;
    if (!draft || message?.lookId) return;
    explicitWrite.current = true;
    const state = useCloset.getState();
    setTaste(learnFromSave(state.taste ?? emptyTaste(), draft.garmentIds, state.garments, Date.now()));
    const id = saveLook(stylistLookToSave(draft));
    stampMessage(messageId, { lookId: id });
  };

  const form = (
    <form
      className="flex gap-2"
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
        className={
          open
            ? "h-12 flex-1 border border-champagne/25 bg-night-elev px-3 text-sm text-champagne placeholder:text-champagne/40 disabled:opacity-40"
            : "h-11 flex-1 border border-hairline bg-paper px-3 text-sm text-ink placeholder:text-ink-soft disabled:opacity-40"
        }
      />
      <Button variant={open ? "night" : "primary"} type="submit" disabled={busy || owned.length === 0}>
        Send
      </Button>
    </form>
  );

  if (!open) {
    const last = [...messages].reverse().find((m) => m.role === "stylist");
    const lastLine = last ? stylistProse(last.text).split("\n")[0] : "";
    return (
      <aside
        data-stylist-dock
        className="fixed inset-x-0 bottom-14 z-30 border-t border-hairline bg-paper px-4 py-3 md:bottom-0"
      >
        <p data-stylist-screen className="text-sm text-ink">
          {sentence}
        </p>
        {lastLine ? (
          <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{lastLine}</p>
        ) : null}
        {busy ? (
          <p className="mt-1 flex items-center gap-2 text-sm text-ink-soft">
            <Loader2 className="size-4 animate-spin" /> Considering the closet…
          </p>
        ) : null}
        <div className="mt-2">{form}</div>
      </aside>
    );
  }

  return (
    <div data-stylist-dock className="mx-auto max-w-2xl px-4 md:px-6 py-8 md:py-12 rise">
      <p className="micro text-champagne/60">Atlas</p>
      <h1 className="mt-2 font-editorial text-4xl md:text-5xl tracking-tight text-champagne">
        The stylist
      </h1>
      <p className="mt-3 text-champagne/70 text-sm">
        Dressed from this closet. It remembers what you wear, skip, and lock.
      </p>

      {hydrated && owned.length === 0 ? <Navigate to="/add" /> : null}

      <p data-stylist-screen className="mt-6 text-sm text-champagne">
        {sentence}
      </p>

      <div className="mt-8 space-y-4 min-h-64">
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
            {m.role === "stylist" && m.technique && (
              <p className="mt-2 text-xs text-champagne/50">{m.technique}</p>
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

      <div className="mt-4">{form}</div>
    </div>
  );
}

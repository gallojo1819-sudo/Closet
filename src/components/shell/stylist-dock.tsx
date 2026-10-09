import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
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
  answerAsked,
  answerTodayAsk,
  briefLine,
  briefOccasion,
  isAdviceAsk,
  isTodayOutfitAsk,
  lookReply,
  looksLikeAtlasBlock,
  readStylistPage,
  rememberedLooks,
  replyFromStylistResult,
  screenSentence,
  stylistAskFields,
  stylistPayload,
  stylistProse,
  subscribeStylistPage,
  swapBaseIds,
  visibleReplyLines,
} from "@/lib/stylist-page";
import { nameLook } from "@/lib/look";
import { livePool } from "@/lib/rack";
import { daysIdle, defaultOccasion, momentOfDay, todayOccasion } from "@/lib/style";
import { useCloset } from "@/lib/store";
import {
  acceptTrend,
  composeAtlasLook,
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
import { cn, todayISO } from "@/lib/utils";

let trendPassStarted = false;

const panelListeners = new Set<() => void>();

/** Open the one agent's panel from anywhere (top bar, /stylist). No navigation. */
export function openStylistPanel(): void {
  for (const fn of panelListeners) fn();
}

/** The visible lines of a reply: plain ink, never a LOOK row or a bare occasion id on top. */
function replyLines(text: string): string[] {
  const lines = visibleReplyLines(text);
  return lines.length ? lines : [stylistProse(text)];
}

function pageOccasion(value: string | undefined, fallback: Occasion): Occasion {
  return OCCASIONS.some((row) => row.id === value) ? (value as Occasion) : fallback;
}

/** The slot as he says it, for the line when no swap exists. */
const SWAP_WORD: Record<"top" | "bottom" | "footwear" | "outerwear", string> = {
  footwear: "shoes",
  top: "top",
  bottom: "trousers",
  outerwear: "jacket",
};

/** One small agent on every page. The Stylist chip opens the card. */
export function StylistDock() {
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
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [ring, setRing] = useState(false);
  const [unread, setUnread] = useState(false);
  const seenRef = useRef(messages.length);

  useEffect(() => {
    const fn = () => setOpen(true);
    panelListeners.add(fn);
    return () => {
      panelListeners.delete(fn);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setShown(false);
    const raf = requestAnimationFrame(() => setShown(true));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!busy) return;
    setRing(true);
    const t = window.setTimeout(() => setRing(false), 1200);
    return () => window.clearTimeout(t);
  }, [busy]);

  useEffect(() => {
    if (open) {
      seenRef.current = messages.length;
      setUnread(false);
      return;
    }
    if (messages.length > seenRef.current) setUnread(true);
  }, [messages, open]);

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
    /* "What should I wear today?" is today's look, on every page, before the page answers. */
    if (isTodayOutfitAsk(q)) {
      const today = answerTodayAsk({
        drop,
        garments: owned,
        taste,
        ...(typeof here.weatherF === "number" ? { weatherF: here.weatherF } : {}),
      });
      const pieces = today.garmentIds
        .map((id) => owned.find((g) => g.id === id))
        .filter((g): g is Garment => Boolean(g));
      pushMessage({
        role: "stylist",
        text: today.text,
        ...(pieces.length
          ? { garmentIds: pieces.map((g) => g.id), draftName: nameLook(pieces), draftOccasion: today.occasion }
          : {}),
      });
      return;
    }
    /* A swap edits the last stylist look, else the look on this page, else today's drop. */
    const slot = swapSlot(q);
    const base = slot
      ? swapBaseIds({
          previousIds: previous?.garmentIds,
          page: here,
          looks: rememberedLooks(here),
          drop,
          garments: owned,
        })
      : [];
    if (slot && base.length) {
      const occasion = pageOccasion(
        here.occasion,
        (previous?.draftOccasion ?? todayOccasion(drop)) as Occasion,
      );
      const edited = swapDraft({
        ids: base,
        slot,
        garments: owned,
        taste,
        occasion,
        ...(typeof here.weatherF === "number" ? { weatherF: here.weatherF } : {}),
      });
      if (!edited) {
        /* Nothing else fits the slot. Say so; never re-send the same look as if it moved. */
        pushMessage({
          role: "stylist",
          text: `No other ${SWAP_WORD[slot]} in your closet works with this look.`,
        });
        return;
      }
      const garmentIds = edited.garmentIds;
      const pieces = garmentIds
        .map((id) => owned.find((g) => g.id === id))
        .filter((g): g is Garment => Boolean(g));
      const technique = edited.technique ?? techniqueUsed(taste, pieces);
      /* One sentence for the look, never the raw block. */
      pushMessage({
        role: "stylist",
        text: lookReply(pieces) ?? WHICH_PIECE,
        garmentIds,
        draftName: nameLook(pieces),
        draftOccasion: occasion,
        technique: technique ?? undefined,
      });
      return;
    }
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
    const brief = briefOccasion(q);
    if (brief) {
      const rolled = composeAtlasLook({
        garments: [...owned],
        prompt: q,
        occasion: brief,
        taste,
        ...(typeof here.weatherF === "number" ? { weatherF: here.weatherF } : {}),
      });
      const pieces = rolled.garmentIds
        .map((id) => owned.find((g) => g.id === id))
        .filter((g): g is Garment => Boolean(g));
      const line = briefLine(q, pieces);
      if (!line) {
        /* No full look for the brief. The piece-ask line is not the answer here. */
        const label = OCCASIONS.find((row) => row.id === brief)?.label.toLowerCase() ?? brief;
        pushMessage({
          role: "stylist",
          text: `Nothing in your closet makes a full ${label} look right now.`,
        });
        return;
      }
      pushMessage({
        role: "stylist",
        text: line,
        garmentIds: rolled.garmentIds,
        draftName: nameLook(pieces),
        draftOccasion: brief,
        ...(rolled.technique ? { technique: rolled.technique } : {}),
      });
      return;
    }
    const askText = q.replace(/(?:\bnot the\b|\bdon't use\b|\bdo not use\b|\bdont use\b|\bwithout the\b|\bno\b)\s+[^.,\n]+/gi, " ");
    /* A care or how question is not a dressing ask: nothing is locked, the server answers it. */
    const advice = isAdviceAsk(q);
    const named = advice ? [] : resolvePiecesFromText(askText, owned).filter((g) => !vetoed.has(g.id));
    if (!advice && named.length === 0 && looksLikePieceAsk(q) && !vetoed.size && !slot) {
      pushMessage({ role: "stylist", text: "Tap the piece on Closet." });
      return;
    }
    if (named.length > 0) {
      const occasion = occasionFromDressPrompt(
        q,
        pageOccasion(here.occasion, todayOccasion(drop)),
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
        /* One sentence for the look, never the raw block. The pieces are owned. */
        pushMessage({
          role: "stylist",
          text: lookReply(pieces) ?? WHICH_PIECE,
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
    /* Real prose stays as written. A raw block with resolvable pieces becomes one sentence. */
    const sentence = pieces.length && looksLikeAtlasBlock(painted.text) ? lookReply(pieces) : null;
    pushMessage({
      role: "stylist",
      ...(sentence ? { text: sentence } : { text: painted.text }),
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
      pushMessage({ role: "stylist", text: "Couldn't answer. Try again." });
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
        placeholder="Saturday, nothing planned"
        disabled={owned.length === 0}
        className="h-11 flex-1 border border-hairline bg-paper px-3 text-sm text-ink placeholder:text-ink-soft disabled:opacity-40"
      />
      <Button variant="primary" type="submit" disabled={busy || owned.length === 0}>
        Send
      </Button>
    </form>
  );

  const lastStylist = [...messages].reverse().find((m) => m.role === "stylist");
  const error = lastStylist?.text === NOT_IN_CLOSET ? lastStylist.text : null;
  const look = lastStylist && !error ? lastStylist : null;

  return (
    <>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close the stylist"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            data-stylist-dock
            className="fixed right-4 bottom-[calc(3.5rem+0.75rem+2.75rem+0.5rem+env(safe-area-inset-bottom))] z-50 flex max-h-[70dvh] w-[min(100vw-2rem,22rem)] flex-col overflow-auto border border-hairline bg-paper text-ink md:right-6 md:bottom-[4.75rem]"
            style={{
              opacity: shown ? 1 : 0,
              transform: shown ? "translateY(0)" : "translateY(8px)",
              transition: "opacity 160ms ease-out, transform 160ms ease-out",
            }}
          >
            <div className="px-4 pt-3">
              <p className="micro text-ink-soft">This page</p>
              <p data-stylist-screen className="mt-1 text-sm text-ink">
                {sentence}
              </p>
            </div>
            <div className="mt-3 border-t border-hairline px-4 pt-3">
              <p className="micro text-ink-soft">This look</p>
              {look ? (
                <>
                  <div className="mt-1 space-y-1">
                    {replyLines(look.text).map((l, i) => (
                      <p key={`${i}-${l}`} className="text-sm leading-relaxed text-ink">
                        {l}
                      </p>
                    ))}
                  </div>
                  {look.technique && (
                    <p className="mt-2 text-xs text-ink-soft">{look.technique}</p>
                  )}
                  {(draftFromMessage(look) || look.lookId) && (
                    <div className="mt-3 flex flex-wrap gap-3">
                      {draftFromMessage(look) && (
                        <button
                          type="button"
                          onClick={() => saveDraft(look.id)}
                          className="micro text-ink-soft hover:text-ink underline-offset-2 hover:underline"
                        >
                          {look.lookId ? "Saved" : "Save"}
                        </button>
                      )}
                      {draftFromMessage(look) && (
                        <button
                          type="button"
                          onClick={() => wearDraft(look.id)}
                          className="micro text-ink-soft hover:text-ink underline-offset-2 hover:underline"
                        >
                          Wear this
                        </button>
                      )}
                      {look.lookId && (
                        <Link
                          to="/lookbook"
                          search={{ look: look.lookId }}
                          className="micro text-ink-soft hover:text-ink underline-offset-2 hover:underline"
                        >
                          See on you →
                        </Link>
                      )}
                    </div>
                  )}
                </>
              ) : busy ? (
                <p className="mt-1 flex items-center gap-2 text-sm text-ink-soft">
                  <Loader2 className="size-4 animate-spin" /> Considering the closet…
                </p>
              ) : (
                <p className="mt-1 text-sm text-ink-soft">Nothing yet.</p>
              )}
            </div>
            <div className="mt-3 border-t border-hairline px-4 pt-3 pb-4">
              {form}
              {error ? (
                <p className="mt-2 text-sm text-accent">{error}</p>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
      <button
        type="button"
        data-stylist-fab
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "fixed right-4 bottom-[calc(3.5rem+0.75rem+env(safe-area-inset-bottom))] z-50 h-11 rounded-full border bg-paper px-4 text-sm text-ink md:right-6 md:bottom-6",
          ring ? "border-accent" : "border-hairline",
        )}
      >
        Stylist
        {unread && !open ? (
          <span aria-hidden className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-accent" />
        ) : null}
      </button>
    </>
  );
}

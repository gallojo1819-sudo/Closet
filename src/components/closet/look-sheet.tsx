import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { GarmentImg } from "@/components/closet/gimg";
import { LookKit } from "@/components/closet/look-kit";
import { Overlay } from "@/components/closet/overlay";
import {
  ON_ME_BUSY_HINT,
  ON_ME_BUSY_SHORT,
  ON_ME_CLIENT_MS,
  ensureLookOnMe,
  onMeErrorText,
} from "@/components/closet/on-me";
import { WearButton } from "@/components/closet/wear-button";
import { dataUrlToBlob, getImage, lookOnMeKey } from "@/lib/images";
import { openRefPhotoDialog } from "@/components/shell/top-bar";
import { colorLine } from "@/lib/color";
import { cutoutsForOnYou, leadTop, lookTuckDecision, nameLook, spreadTitle } from "@/lib/look";
import { tuckMark } from "@/lib/tuck";
import { useTuckHabits } from "@/lib/use-tuck-habits";
import { pieceLabel } from "@/lib/piece-label";
import { editJacket, lastResortNote, legacyJacketAction, reconcileOpenLook, selectedOuter, type JacketContext } from "@/lib/jacket-edit";
import { effectiveIds, jacketDraftAccount, readJacketDraft, rememberJacketDraft } from "@/lib/jacket-draft";
import { countsAsOuter } from "@/lib/stylist/jackets";
import { moreOutfitsForLook } from "@/lib/dress";
import type { House } from "@/lib/houses";
import { comboKey } from "@/lib/lookbook";
import { mapOccasion } from "@/lib/types";
import { slotOf } from "@/lib/style";
import { useCloset } from "@/lib/store";
import type { Garment, Look, Occasion } from "@/lib/types";
import { useImageSrc } from "@/lib/use-image";
import { cn } from "@/lib/utils";

type WearSlot = "top" | "bottom" | "footwear" | "outerwear";

function wearSlot(g: Garment): WearSlot | null {
  const s = slotOf(g);
  if (s === "top" || s === "dress") return "top";
  if (s === "bottom" || s === "footwear" || s === "outerwear") return s;
  return null;
}

export function LookSheet({
  look,
  pieces,
  book,
  closet,
  onClose,
  onWear,
  onOpenLook,
  getCard,
  initialLocked,
  house,
  onBack,
  backLabel,
  closeOnEscape = true,
  draftBaseIds,
  draftStamp: draftStampProp,
  jacketCtx,
}: {
  look: Look;
  pieces: Garment[];
  book: Look[];
  closet: Garment[];
  onClose: () => void;
  onWear: (ids: string[]) => void;
  onOpenLook: (look: Look) => void;
  getCard?: () => HTMLElement | null;
  initialLocked?: string[];
  house?: House | "all" | null;
  /** List path only. Outfit-with-this looks omit it. */
  onBack?: () => void;
  /** "← Back to N looks", with the real card count. */
  backLabel?: string;
  /** Closet owns Escape for its stack and passes false. */
  closeOnEscape?: boolean;
  /** Original ids of this look. The session draft is keyed by these, not the edited ids. */
  draftBaseIds?: string[];
  /** Occasion, season, date and weather. A look without one keeps its draft to itself. */
  draftStamp?: string;
  /** Today's measured weather and the chapter season. Off in required weather warns. */
  jacketCtx?: Partial<JacketContext>;
}) {
  void book;
  const baseIds = draftBaseIds ?? look.garmentIds;
  const stamp = draftStampProp ?? `look:${look.id}`;
  const [ids, setIds] = useState(() => {
    const owned = new Set(closet.filter((g) => !g.archived).map((g) => g.id));
    return effectiveIds(baseIds, stamp, owned) ?? look.garmentIds;
  });
  const [jacketNote, setJacketNote] = useState<string | null>(null);
  const [jacketWarning, setJacketWarning] = useState<string | null>(null);
  const [swapSlot, setSwapSlot] = useState<WearSlot | null>(null);
  const closetById = useMemo(() => new Map(closet.map((g) => [g.id, g])), [closet]);
  const activePieces = useMemo(
    () => ids.map((id) => closetById.get(id)).filter((g): g is Garment => Boolean(g)),
    [ids, closetById],
  );
  const extra = comboKey(activePieces.map((p) => p.id));
  const cacheKey = lookOnMeKey(look.id, extra);
  const liveSrc = useImageSrc(cacheKey);
  const cachedSrc = liveSrc;
  const [frame, setFrame] = useState<string | null>(null);
  const [showMe, setShowMe] = useState(false);
  const [dressing, setDressing] = useState(false);
  const [dressError, setDressError] = useState<string | null>(null);
  const [showAlts, setShowAlts] = useState(false);
  const [landing, setLanding] = useState(false);
  const [lockedIds, setLockedIds] = useState<string[]>(
    () => initialLocked?.filter((id) => look.garmentIds.includes(id)) ?? [],
  );
  const gen = useRef(0);
  const piecesRef = useRef(activePieces);
  piecesRef.current = activePieces;
  const saveLook = useCloset((s) => s.saveLook);
  const taste = useCloset((s) => s.taste);
  const applyJacket = (action: "off" | "on" | "next" | "set", chooseId?: string) => {
    const draft = readJacketDraft(baseIds, stamp);
    const result = editJacket({
      ids,
      closet,
      action,
      chooseId,
      ctx: {
        occasion: jacketCtx?.occasion ?? mapOccasion(look.occasion),
        season: jacketCtx?.season ?? "fall",
        weatherF: jacketCtx?.weatherF,
        measured: jacketCtx?.measured,
        highF: jacketCtx?.highF,
        wet: jacketCtx?.wet,
        windy: jacketCtx?.windy,
        lockedIds,
        taste,
      },
      lastJacketId: draft?.lastJacketId,
    });
    setIds(result.ids);
    setJacketNote(result.note);
    setJacketWarning(result.warning);
    rememberJacketDraft({
      baseIds,
      ids: result.ids,
      stamp,
      accountId: "",
      off: result.off,
      jacketId: result.jacketId,
      lastJacketId: result.lastJacketId,
      weatherWarned: result.weatherWarned,
      warning: result.warning,
      note: result.note,
      outdoorsValid: result.outdoorsValid,
    });
    setShowMe(false);
  };
  const outer = selectedOuter(activePieces);
  const jacketOn = Boolean(outer.jacket);
  const habits = useTuckHabits();
  const looks = useCloset((s) => s.looks);
  const refPhoto = useCloset((s) => s.refPhoto);
  const painted = frame || cachedSrc;
  const comboSaved = looks.some(
    (l) => l.source === "manual" && comboKey(l.garmentIds) === extra,
  );

  useEffect(() => {
    return () => {
      if (frame) URL.revokeObjectURL(frame);
    };
  }, [frame]);

  useEffect(() => {
    if (cachedSrc) setShowMe(true);
  }, [cachedSrc]);

  useEffect(() => {
    gen.current += 1;
    const n = gen.current;
    setFrame(null);
    setDressError(null);
    setDressing(false);
    let live = true;
    void (async () => {
      const hit = await getImage(cacheKey);
      if (!live || n !== gen.current) return;
      if (hit) {
        setShowMe(true);
        return;
      }
      setShowMe(false);
    })();
    return () => {
      live = false;
    };
  }, [look.id, cacheKey]);

  const idsRef = useRef(ids);
  idsRef.current = ids;
  const openedLook = useRef<string | null>(null);
  const fitKey = closet.map((g) => `${g.id}:${g.archived ? 1 : 0}:${g.oversized === undefined ? "" : g.oversized ? 1 : 0}:${g.fit ?? ""}`).join(",");
  const jacketCtxKey = `${jacketCtx?.occasion ?? ""}|${jacketCtx?.season ?? ""}|${jacketCtx?.weatherF ?? ""}|${jacketCtx?.measured ? 1 : 0}|${jacketCtx?.wet ?? ""}|${jacketCtx?.windy ?? ""}|${jacketCtx?.highF ?? ""}`;
  useEffect(() => {
    const owned = new Set(closet.filter((g) => !g.archived).map((g) => g.id));
    const ctx: JacketContext = {
      occasion: jacketCtx?.occasion ?? mapOccasion(look.occasion),
      season: jacketCtx?.season ?? "fall",
      weatherF: jacketCtx?.weatherF,
      measured: jacketCtx?.measured,
      highF: jacketCtx?.highF,
      wet: jacketCtx?.wet,
      windy: jacketCtx?.windy,
      lockedIds,
      taste,
    };
    const sameLook = openedLook.current === look.id;
    openedLook.current = look.id;
    const drafted = effectiveIds(baseIds, stamp, owned, { closet, ctx });
    if (drafted) {
      const next = reconcileOpenLook(drafted, closet, ctx);
      setIds(next.ids);
      setJacketNote(next.note);
      setJacketWarning(next.warning);
    } else if (!sameLook) {
      setIds(look.garmentIds);
      setJacketNote(null);
      setJacketWarning(null);
    } else {
      const next = reconcileOpenLook(idsRef.current, closet, ctx);
      if (next.ids.join(",") !== idsRef.current.join(",")) {
        setIds(next.ids);
        setJacketNote(next.note);
        setJacketWarning(next.warning);
      }
    }
    setSwapSlot(null);
    setLockedIds((initialLocked ?? []).filter((id) => look.garmentIds.includes(id)));
  }, [look.id, stamp, fitKey, jacketCtxKey, jacketDraftAccount()]);

  const lockForMore = lockedIds.length ? lockedIds : look.garmentIds.slice(0, 1);
  const alts = showAlts
    ? moreOutfitsForLook({
        seedIds: ids,
        lockedIds: lockForMore,
        garments: closet,
        looks,
        occasion: mapOccasion(look.occasion),
        n: 3,
        house,
      }).map((a, i) => ({
        id: `more_${look.id}_${i}_${a.garmentIds.join("_")}`,
        name: a.pieces[0]?.name ?? look.name,
        occasion: look.occasion,
        garmentIds: a.garmentIds,
        source: "manual" as const,
        lookbook: false,
        createdAt: look.createdAt,
      }))
    : null;

  const runDress = () => {
    if (dressing) return;
    if (painted && !dressError) {
      setShowMe((v) => !v);
      return;
    }
    const n = gen.current;
    setDressing(true);
    setDressError(null);
    void (async () => {
      try {
        const plan = cutoutsForOnYou(piecesRef.current);
        const image = await ensureLookOnMe(
          look.id,
          piecesRef.current,
          ON_ME_CLIENT_MS,
          mapOccasion(look.occasion),
        );
        if (n !== gen.current) return;
        if (plan.skipped) setDressError(`${plan.skipped} has no clean cover.`);
        const url = URL.createObjectURL(dataUrlToBlob(image));
        setFrame((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        setShowMe(true);
      } catch (e) {
        if (n !== gen.current) return;
        const msg = e instanceof Error ? e.message : "Could not dress you.";
        setDressError(onMeErrorText(msg));
      } finally {
        if (n === gen.current) setDressing(false);
      }
    })();
  };

  const tuckText = tuckMark(
    lookTuckDecision(activePieces, look.occasion, habits),
    leadTop(activePieces),
  );
  const byId = new Map(closet.map((g) => [g.id, g]));
  const altPieces = (l: Look) =>
    l.garmentIds.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));

  return (
    <Overlay onClose={onClose} getAnchor={getCard} zClass="z-[60]" closeOnEscape={closeOnEscape}>
        {onBack ? (
          <button
            type="button"
            data-look-back
            onClick={onBack}
            className="sticky top-0 z-20 w-full border-b border-hairline bg-paper px-4 py-3 text-left text-sm text-ink"
          >
            {backLabel ?? "← Back"}
          </button>
        ) : null}
        <div className={cn("look-landing relative border-b border-hairline bg-paper aspect-[4/5] overflow-hidden", landing && "is-landing")}>
          <LookKit pieces={activePieces} thumb={false} className="border-0" />
          {showMe && painted && (
            <img
              key={painted}
              src={painted}
              alt={look.name}
              className="on-you-glass absolute inset-0 z-10 h-full w-full object-contain bg-paper"
            />
          )}
        </div>
        <div className="p-4 flex flex-col gap-4">
          <div>
            <p>{look.name.includes(" · ") ? look.name : spreadTitle(activePieces, look.occasion as Occasion)}</p>
            <p className="micro text-ink-soft">
              {activePieces
                .filter((g) => !look.name.toLowerCase().includes(g.name.toLowerCase()))
                .map((g) => pieceLabel(g, closet))
                .join(" · ") || colorLine(activePieces).replace(/\.$/, "") || look.occasion}
              {tuckText ? ` · ${tuckText}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <WearButton
              className="h-9 px-4 text-[13px]"
              onConfirming={() => setLanding(true)}
              onWear={() => onWear(activePieces.map((g) => g.id))}
            />
            <button
              type="button"
              disabled={comboSaved}
              onClick={() => {
                if (comboSaved) return;
                saveLook({
                  name: nameLook(activePieces) || look.name,
                  occasion: mapOccasion(look.occasion),
                  garmentIds: activePieces.map((g) => g.id),
                  source: "manual",
                  lookbook: false,
                });
              }}
              className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong disabled:opacity-60"
            >
              {comboSaved ? "Saved" : "Save look"}
            </button>
            {refPhoto ? (
              <button
                type="button"
                onClick={runDress}
                className={cn(
                  "micro inline-flex items-center gap-2 whitespace-nowrap border px-3 py-2",
                  showMe && painted
                    ? "border-ink bg-ink text-paper"
                    : "border-hairline text-ink-soft hover:border-hairline-strong",
                )}
              >
                {dressing && <Loader2 className="size-3 animate-spin" />}
                {dressing ? ON_ME_BUSY_SHORT : "On you"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openRefPhotoDialog()}
                className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong"
              >
                Set Fit photo
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong"
            >
              Close
            </button>
          </div>
          <div data-jacket-edit className="flex flex-wrap gap-2">
            <button
              type="button"
              data-jacket-off
              aria-pressed={!jacketOn}
              onClick={() => applyJacket("off")}
              className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong"
            >
              Jacket off
            </button>
            <button
              type="button"
              data-jacket-on
              aria-pressed={jacketOn}
              onClick={() => applyJacket("on")}
              className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong"
            >
              Jacket on
            </button>
            <button
              type="button"
              data-jacket-next
              onClick={() => applyJacket("next")}
              className="micro border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong"
            >
              Try another jacket
            </button>
          </div>
          {jacketWarning ? (
            <p data-weather-warned className="text-sm text-ink">
              {jacketWarning}
            </p>
          ) : null}
          {jacketNote ? <p data-jacket-note className="text-sm text-ink-soft">{jacketNote}</p> : null}
          {!jacketNote && lastResortNote(activePieces) ? (
            <p data-last-resort className="text-sm text-ink-soft">{lastResortNote(activePieces)}</p>
          ) : null}
          {dressing && <p className="micro text-ink-soft">{ON_ME_BUSY_HINT}</p>}
          {dressError && <p className="text-sm text-accent">{dressError}</p>}
          <ul className="flex gap-2 overflow-x-auto">
            {[
              ...activePieces,
              ...pieces.filter((g) => !ids.includes(g.id)),
            ].map((g) => {
              const on = ids.includes(g.id);
              const locked = lockedIds.includes(g.id);
              const slot = wearSlot(g);
              return (
                <li key={g.id} className="w-16 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      const kind = on ? "remove" : "add";
                      const action = legacyJacketAction(g, activePieces, kind);
                      if (action === "off") {
                        applyJacket("off");
                        return;
                      }
                      if (action === "set") {
                        applyJacket("set", g.id);
                        return;
                      }
                      if (action === "blocked") {
                        applyJacket("off");
                        return;
                      }
                      if (on) {
                        if (ids.length <= 2) return;
                        setIds((cur) => cur.filter((id) => id !== g.id));
                        setShowMe(false);
                      } else {
                        setIds((cur) => [...cur, g.id]);
                        setShowMe(false);
                      }
                    }}
                    className={cn(
                      "relative aspect-page w-full border border-hairline bg-paper overflow-hidden",
                      !on && "opacity-40",
                    )}
                    aria-label={on ? `Remove ${pieceLabel(g, closet)}` : `Add ${pieceLabel(g, closet)}`}
                  >
                    <GarmentImg
                      garment={g}
                      className="h-full w-full object-contain p-[8%]"
                    />
                    {locked && (
                      <span className="absolute left-1 top-1 micro bg-paper px-1 py-0.5 text-ink border border-hairline">
                        Lock
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setLockedIds((cur) =>
                        cur.includes(g.id) ? cur.filter((id) => id !== g.id) : [...cur, g.id],
                      )
                    }
                    className="micro mt-1 text-ink-soft hover:text-ink"
                  >
                    {locked ? "Unlock" : "Lock"}
                  </button>
                  {on && (slot || outer.jacket?.id === g.id) && (
                    <button
                      type="button"
                      onClick={() => {
                        if (legacyJacketAction(g, activePieces, "swap") === "next") {
                          applyJacket("next");
                          return;
                        }
                        if (legacyJacketAction(g, activePieces, "swap") === "blocked") {
                          applyJacket("off");
                          return;
                        }
                        if (slot) setSwapSlot((cur) => (cur === slot ? null : slot));
                      }}
                      className="micro mt-1 block text-ink-soft hover:text-ink"
                    >
                      Swap
                    </button>
                  )}
                  {on && (
                    <button
                      type="button"
                      onClick={() => {
                        const action = legacyJacketAction(g, activePieces, "remove");
                        if (action === "off" || action === "blocked") {
                          applyJacket("off");
                          return;
                        }
                        if (ids.length <= 2) return;
                        setIds((cur) => cur.filter((id) => id !== g.id));
                        setLockedIds((cur) => cur.filter((id) => id !== g.id));
                        setShowMe(false);
                      }}
                      className="micro mt-1 block text-ink-soft hover:text-ink"
                    >
                      Remove
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {swapSlot && (
            <div className="flex flex-wrap gap-2 border border-hairline p-2">
              {closet.filter((g) => wearSlot(g) === swapSlot && !ids.includes(g.id) && !countsAsOuter(g))
                .slice(0, 24)
                .map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => {
                      if (swapSlot === "outerwear" && outer.jacket && countsAsOuter(g)) {
                        applyJacket("set", g.id);
                        setSwapSlot(null);
                        return;
                      }
                      const occupant = activePieces.find((x) => wearSlot(x) === swapSlot);
                      setIds((cur) => {
                        if (!occupant) return [...cur, g.id];
                        return cur.map((id) => (id === occupant.id ? g.id : id));
                      });
                      setSwapSlot(null);
                      setShowMe(false);
                    }}
                    className="w-14 shrink-0"
                    aria-label={pieceLabel(g, closet)}
                  >
                    <div className="aspect-page border border-hairline bg-paper overflow-hidden">
                      <GarmentImg garment={g} className="h-full w-full object-contain p-[8%]" />
                    </div>
                  </button>
                ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowAlts(true)}
            className="micro self-start border border-hairline px-3 py-2 text-ink-soft hover:border-hairline-strong"
          >
            More like this
          </button>
          {alts &&
            (alts.length === 0 ? (
              <p className="text-sm text-ink-soft">Nothing else in this register.</p>
            ) : (
              <ul className="grid grid-cols-3 gap-2">
                {alts.map((alt) => {
                  const shot = altPieces(alt);
                  return (
                    <li key={alt.id}>
                      <button
                        type="button"
                        onClick={() => onOpenLook(alt)}
                        className="block w-full text-left"
                        aria-label={alt.name}
                      >
                        <LookKit
                          pieces={shot}
                          className="pointer-events-none aspect-[4/5]"
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ))}
        </div>
    </Overlay>
  );
}

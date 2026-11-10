/**
 * Dev-only frames for the look-ask screenshots. The query is ignored in production.
 * Nothing here writes closet.v6. A swapped frame seeds the session draft only.
 */
import { LookSheet } from "@/components/closet/look-sheet";
import { readJacketDraft, rememberJacketDraft } from "@/lib/jacket-draft";
import { SEED_GARMENTS } from "@/lib/seed";
import type { Look } from "@/lib/types";

const BASE = ["g_oxford", "g_trousers", "g_loafers"];
const SWAPPED = ["g_oxford", "g_trousers", "g_sneakers"];
const STAMP = "look:preview";

function seedSwap(): void {
  if (readJacketDraft(BASE, STAMP)?.preSwapIds?.length) return;
  rememberJacketDraft({
    baseIds: BASE,
    ids: SWAPPED,
    stamp: STAMP,
    accountId: "",
    off: true,
    jacketId: null,
    lastJacketId: null,
    weatherWarned: false,
    warning: null,
    note: null,
    outdoorsValid: true,
    preSwapIds: BASE,
  });
}

/** Renders only when `?lookAsk=` is set and the build is a dev build. */
export function LookAskPreview() {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  const mode = new URLSearchParams(window.location.search).get("lookAsk");
  if (!mode || mode === "open") return null;
  if (mode === "swapped") seedSwap();
  const look: Look = {
    id: "preview-look",
    name: "Quiet office",
    occasion: "weekend",
    garmentIds: BASE,
    source: "manual",
    lookbook: false,
    createdAt: "2026-11-10T15:00:00.000Z",
  };
  const pieces = BASE.map((id) => SEED_GARMENTS.find((g) => g.id === id)).filter((g) => Boolean(g));
  return (
    <LookSheet
      look={look}
      pieces={pieces as typeof SEED_GARMENTS}
      draftBaseIds={BASE}
      draftStamp={STAMP}
      book={[]}
      closet={SEED_GARMENTS}
      onClose={() => {}}
      onWear={() => {}}
      onOpenLook={() => {}}
      closeOnEscape={false}
    />
  );
}

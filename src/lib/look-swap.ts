/**
 * Apply a stylist's structured swaps onto the open look sheet.
 * Memory only: the session draft, never closet.v6 or closet_meta.
 * The dock does not call this. The mounted sheet does.
 */
import { editJacket, selectedOuter, type JacketContext } from "./jacket-edit.ts";
import { readJacketDraft, rememberJacketDraft, type JacketDraft } from "./jacket-draft.ts";
import { leadTop, lookTuckDecision } from "./look.ts";
import { lookFitsSeason } from "./season.ts";
import { clashes } from "./style.ts";
import { explain, isLegal } from "./stylist/legal.ts";
import { oversizedOf } from "./stylist/oversized.ts";
import { shortOuterHits } from "./stylist/short-outer.ts";
import { isKnitTop, tuckMark } from "./tuck.ts";
import type { Garment, Occasion, Season } from "./types.ts";

export type LookAskSwap = {
  fromId: string;
  toId: string;
  slot: "top" | "bottom" | "footwear" | "outerwear";
};

export type SwapApplyResult = {
  ids: string[];
  applied: number;
  preSwapIds: string[] | null;
  note: string | null;
  warning: string | null;
  wrote: boolean;
};

const MAX_APPLIED = 3;

function asSeason(raw: string): Season {
  if (raw === "spring" || raw === "summer" || raw === "fall" || raw === "winter") return raw;
  return "fall";
}

function asOccasion(raw: string): Occasion {
  if (raw === "weekday" || raw === "out" || raw === "weekend" || raw === "comfy" || raw === "travel") return raw;
  return "weekend";
}

function piecesOf(ids: readonly string[], owned: ReadonlyMap<string, Garment>): Garment[] {
  return ids.map((id) => owned.get(id)).filter((g): g is Garment => Boolean(g));
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Hard rules the sheet and closet_check_look already use. A miss stays in the chat only. */
export function swapIsLegal(pieces: readonly Garment[], ctx: JacketContext, closet: readonly Garment[]): boolean {
  if (pieces.length < 2) return false;
  const season = asSeason(String(ctx.season));
  const occasion = asOccasion(String(ctx.occasion));
  const legalCtx = { occasion, season, house: null as null, pool: closet.filter((g) => !g.archived) };
  if (!isLegal([...pieces], legalCtx)) return false;
  if (explain([...pieces], legalCtx).hits.some((hit) => hit.severity === "hard")) return false;
  if (!lookFitsSeason([...pieces], season)) return false;
  if (clashes([...pieces])) return false;
  if (shortOuterHits(pieces).length > 0) return false;
  const lead = leadTop(pieces);
  const mark = tuckMark(lookTuckDecision(pieces, occasion), lead);
  if (lead && oversizedOf(lead) && mark === "tucked") return false;
  if (lead && isKnitTop(lead) && mark === "tucked") return false;
  return true;
}

function fieldsFrom(ids: readonly string[], closet: readonly Garment[], prev: JacketDraft | null, jacket: ReturnType<typeof editJacket> | null) {
  if (jacket) {
    return {
      off: jacket.off,
      jacketId: jacket.jacketId,
      lastJacketId: jacket.lastJacketId,
      weatherWarned: jacket.weatherWarned,
      warning: jacket.warning,
      note: jacket.note,
      outdoorsValid: jacket.outdoorsValid,
    };
  }
  const pieces = ids.map((id) => closet.find((g) => g.id === id)).filter((g): g is Garment => Boolean(g));
  const outer = selectedOuter(pieces);
  const jacketId = prev?.jacketId && ids.includes(prev.jacketId) ? prev.jacketId : (outer.jacket?.id ?? null);
  return {
    off: prev ? prev.off : !outer.jacket,
    jacketId,
    lastJacketId: prev?.lastJacketId ?? outer.jacket?.id ?? null,
    weatherWarned: prev?.weatherWarned ?? false,
    warning: prev?.warning ?? null,
    note: prev?.note ?? null,
    outdoorsValid: prev?.outdoorsValid ?? true,
  };
}

/**
 * Apply up to three swaps against the current ids. The first legal one snapshots preSwapIds.
 * A later swap that repeats a fromId or a slot is skipped. Nothing is written when none apply.
 */
export function applyLookAskSwaps(input: {
  ids: readonly string[];
  baseIds: readonly string[];
  stamp: string;
  closet: readonly Garment[];
  swaps: readonly LookAskSwap[];
  ctx: JacketContext;
}): SwapApplyResult {
  const owned = new Map(input.closet.filter((g) => !g.archived).map((g) => [g.id, g]));
  const prev = readJacketDraft(input.baseIds, input.stamp);
  let ids = [...input.ids];
  let applied = 0;
  let snapshot: string[] | null = null;
  let jacket: ReturnType<typeof editJacket> | null = null;
  const seenFrom = new Set<string>();
  const seenSlot = new Set<string>();

  for (const swap of input.swaps) {
    if (applied >= MAX_APPLIED) break;
    if (seenFrom.has(swap.fromId) || seenSlot.has(swap.slot)) continue;
    seenFrom.add(swap.fromId);
    seenSlot.add(swap.slot);
    const to = owned.get(swap.toId);
    if (!to || !ids.includes(swap.fromId)) continue;

    if (swap.slot === "outerwear") {
      const result = editJacket({
        ids,
        closet: input.closet,
        action: "set",
        chooseId: swap.toId,
        ctx: input.ctx,
        lastJacketId: jacket?.lastJacketId ?? prev?.lastJacketId,
      });
      if (!result.changed || sameIds(result.ids, ids) || !result.ids.includes(swap.toId)) continue;
      const pieces = piecesOf(result.ids, owned);
      if (pieces.length !== result.ids.length || !swapIsLegal(pieces, input.ctx, input.closet)) continue;
      if (!snapshot) snapshot = [...ids];
      ids = [...result.ids];
      jacket = result;
      applied += 1;
      continue;
    }

    const nextIds = ids.map((id) => (id === swap.fromId ? swap.toId : id));
    const pieces = piecesOf(nextIds, owned);
    if (pieces.length !== nextIds.length || !swapIsLegal(pieces, input.ctx, input.closet)) continue;
    if (!snapshot) snapshot = [...ids];
    ids = nextIds;
    applied += 1;
  }

  if (!applied || !snapshot) {
    return {
      ids: [...input.ids],
      applied: 0,
      preSwapIds: prev?.preSwapIds ?? null,
      note: null,
      warning: null,
      wrote: false,
    };
  }

  const fields = fieldsFrom(ids, input.closet, prev, jacket);
  rememberJacketDraft({
    baseIds: [...input.baseIds],
    ids,
    stamp: input.stamp,
    accountId: "",
    ...fields,
    preSwapIds: snapshot,
  });
  return {
    ids,
    applied,
    preSwapIds: snapshot,
    note: fields.note,
    warning: fields.warning,
    wrote: true,
  };
}

/** Restore the pre-swap ids and clear the snapshot. One level. */
export function undoLookAskSwap(input: {
  baseIds: readonly string[];
  stamp: string;
  preSwapIds: readonly string[];
  closet: readonly Garment[];
}): string[] {
  const ids = [...input.preSwapIds];
  const prev = readJacketDraft(input.baseIds, input.stamp);
  const pieces = ids.map((id) => input.closet.find((g) => g.id === id)).filter((g): g is Garment => Boolean(g));
  const outer = selectedOuter(pieces);
  rememberJacketDraft({
    baseIds: [...input.baseIds],
    ids,
    stamp: input.stamp,
    accountId: "",
    off: !outer.jacket,
    jacketId: outer.jacket?.id ?? null,
    lastJacketId: prev?.lastJacketId ?? null,
    weatherWarned: prev?.weatherWarned ?? false,
    warning: null,
    note: null,
    outdoorsValid: prev?.outdoorsValid ?? true,
    preSwapIds: null,
  });
  return ids;
}

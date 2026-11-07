/**
 * Session draft for a jacket edit. Memory only: not closet.v6, not the
 * IndexedDB mirror, not the rotation, not the conditions keys, and not the
 * cloud payload. A reload or a new tab drops it. Sign-out clears it.
 * Toggling calls rememberJacketDraft and nothing else.
 */
import { reconcileOpenLook } from "./jacket-edit.ts";
import type { JacketContext } from "./jacket-edit.ts";
import type { Garment, WeatherSnap } from "./types.ts";
import { pageJacketWeather } from "./jacket-weather.ts";

export type JacketDraft = {
  baseIds: string[];
  ids: string[];
  stamp: string;
  accountId: string;
  off: boolean;
  jacketId: string | null;
  lastJacketId: string | null;
  weatherWarned: boolean;
  warning: string | null;
  note: string | null;
  outdoorsValid: boolean;
};

const drafts = new Map<string, JacketDraft>();
const listeners = new Set<() => void>();
let version = 0;
let accountId = "";

function emit(): void {
  version += 1;
  for (const fn of listeners) fn();
}

export function subscribeJacketDrafts(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function jacketDraftVersion(): number {
  return version;
}

export function jacketDraftCount(): number {
  return drafts.size;
}

/** Test and sign-out. Drops every session draft. */
export function clearJacketDrafts(): void {
  if (drafts.size === 0) return;
  drafts.clear();
  emit();
}

/** Account change and sign-out drop the draft. The same id does not. */
export function setJacketDraftAccount(id: string): void {
  if (id === accountId) return;
  accountId = id;
  if (drafts.size) drafts.clear();
  emit();
}

export function jacketDraftAccount(): string {
  return accountId;
}

export function draftStamp(input: {
  date: string;
  occasion: string;
  season: string;
  weather?: WeatherSnap | null;
}): string {
  const page = pageJacketWeather(input.weather ?? null);
  return [
    input.date,
    input.occasion,
    input.season,
    page.weatherF ?? "",
    page.measured ? "1" : "0",
    page.conditions?.wet ?? "",
    page.conditions?.windy ?? "",
    page.conditions?.highF ?? "",
  ].join("|");
}

function keyOf(baseIds: readonly string[], stamp: string): string {
  return `${[...baseIds].sort().join(",")}|${stamp}`;
}

export function rememberJacketDraft(draft: JacketDraft): void {
  const next: JacketDraft = {
    ...draft,
    accountId: accountId,
    baseIds: [...draft.baseIds],
    ids: [...draft.ids],
  };
  drafts.set(keyOf(next.baseIds, next.stamp), next);
  emit();
}

export function readJacketDraft(baseIds: readonly string[], stamp: string): JacketDraft | null {
  const hit = drafts.get(keyOf(baseIds, stamp));
  if (!hit || hit.accountId !== accountId) return null;
  return hit;
}

export type DraftCheck = {
  closet: readonly Garment[];
  ctx: JacketContext;
};

/**
 * The effective ids when a draft matches this look and still passes.
 * Archived or missing pieces drop it. A fit or oversized change that makes the
 * jacket illegal is repaired to a strict jacket, or the jacket comes off.
 * Passing only the owned set checks ownership. Pass `check` to revalidate the garments.
 */
export function effectiveIds(
  baseIds: readonly string[],
  stamp: string,
  owned: ReadonlySet<string>,
  check?: DraftCheck,
): string[] | null {
  const hit = readJacketDraft(baseIds, stamp);
  if (!hit) return null;
  if (hit.ids.some((id) => !owned.has(id))) {
    drafts.delete(keyOf(baseIds, stamp));
    emit();
    return null;
  }
  if (!check) return [...hit.ids];
  const repaired = reconcileOpenLook(hit.ids, check.closet, check.ctx);
  const same = repaired.ids.length === hit.ids.length && repaired.ids.every((id, i) => id === hit.ids[i]);
  if (!same || repaired.warning !== hit.warning || repaired.note !== hit.note) {
    drafts.set(keyOf(baseIds, stamp), {
      ...hit,
      ids: [...repaired.ids],
      off: repaired.off,
      jacketId: repaired.jacketId,
      lastJacketId: repaired.lastJacketId,
      weatherWarned: repaired.weatherWarned,
      warning: repaired.warning,
      note: repaired.note,
      outdoorsValid: repaired.outdoorsValid,
    });
    emit();
  }
  return [...repaired.ids];
}

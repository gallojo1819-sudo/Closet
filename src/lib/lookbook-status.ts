/**
 * The Lookbook's count line. "0 looks" is only true once the ranked row for the current
 * chapter has resolved; before that the page is still finding them.
 */
export const FINDING_LOOKS = "Finding your looks…";

export function lookbookCountLine(opts: {
  resolved: boolean;
  count: number;
  chapter: string;
  season: string;
}): string {
  if (!opts.resolved) return FINDING_LOOKS;
  return `${opts.count} looks · ${opts.chapter} · ${opts.season}`;
}

/** Skeletons stand in while the row is unresolved and nothing real is on screen yet. */
export function weekShowsSkeletons(opts: { resolved: boolean; shown: number }): boolean {
  return !opts.resolved && opts.shown === 0;
}

/** The empty-row reason is only a fact once the row has resolved. */
export function weekShowsEmptyReason(opts: { resolved: boolean; shown: number }): boolean {
  return opts.resolved && opts.shown === 0;
}

# Closet

Personal wardrobe app (TanStack Start + React 19, Zustand store persisted as `closet.v6`, images in IndexedDB).

## Routes

- `/` Today, `/closet`, `/add`, `/lookbook` are the pages.
- `/outfits` redirects to `/lookbook` on purpose: the Outfits room was folded into the Lookbook in
  "Five rooms. Tap a look." (1d3ab5b, Sep 12 2026). Keep the redirect; old links still land.
- `/stylist` has no page of its own on purpose: it opens the stylist dock's panel and steps back to
  the page you were on ("The stylist is a small Ask control on every page", cb7e338, Oct 5 2026).
  The chat UI lives in `src/components/shell/stylist-dock.tsx`.

## Working rules

- Never wipe `closet.v6` or `closet_meta`. No bulk rewrites of stored garments: fix at read/display
  (`src/lib/garment-category.ts`, `garment-color.ts`, `garment-notes.ts`) and stop bad writes at add time.
- A skip never writes a veto. No house or brand names in copy or fixtures.
- Engine outputs are pinned to a snapshot (`src/lib/engine-speed.test.ts`); `canonicalize` in
  `color.ts` and the occasion gates feed it, so change them only with the snapshot in mind.
- Overlays go through a body portal (`Overlay`, `BodyPortal`): the page containers animate with a
  transform (`.rise`), which traps `position: fixed`.
- Tests need Node 22 (`--experimental-strip-types`): `npm test`, `npm run typecheck`, `npm run lint`.

## Round log

- row-dupe-count (Oct 13 2026): a piece sat twice in one Lookbook row because two garments stored
  under one name ("light grey pleated trousers", material "wool" vs. empty) got different twinKeys
  (the material falls back to a name word). Fix: `twinGroups` in `detectors/ideas.ts` merges groups
  whose members share `slot|normalised name` (only ever groups more); the storedRows fallback in
  `rowWays` now checks twins per row too. The header read "8 looks" because it counted only the
  week row (capped at 8): `screenLookCount` in `lookbook-status.ts` counts the week cards that
  render plus the idea-row cards. `nameWithColor` replaces the whole leading colour phrase.
- header-count (Oct 13 2026): the header's "N looks" and DetectorSections read one list,
  `sectionRows` in `detectors/cells.ts` (both branches, "Your usual" included);
  `renderedSectionLooks` is that list flattened. `lookbook-header-count.test.tsx` renders the
  section to markup over six Re-dress pages per chapter on the 157-piece fixture and checks the
  header against the cards drawn. `detectors.test.ts` pins the component's import line and the
  `{row.title}` heading. vitest resolves `@/` via an alias in `vitest.config.ts`.

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
- Tests need Node 22.6+ (`--experimental-strip-types`; Node 20 has no type stripping and no loader
  is bundled, so `npm test` fails there at once): `npm test`, `npm run typecheck`, `npm run lint`.
  `package.json` says so in `engines`.

## Round log

- row-dupe-count (Oct 13 2026): a piece sat twice in one Lookbook row because two garments stored
  under one name ("light grey pleated trousers", material "wool" vs. empty) got different twinKeys
  (the material falls back to a name word). Fix: `twinGroups` in `detectors/ideas.ts` merged groups
  whose members share `slot|normalised name` (only ever groups more); the storedRows fallback in
  `rowWays` now checks twins per row too. (The name merge was replaced by a photo-hash merge in
  twin-by-photo, Oct 13 2026: a shared name is not a shared piece.) The header read "8 looks" because it counted only the
  week row (capped at 8): `screenLookCount` in `lookbook-status.ts` counts the week cards that
  render plus the idea-row cards. `nameWithColor` replaces the whole leading colour phrase.
- header-count (Oct 13 2026): the header's "N looks" and DetectorSections read one list,
  `sectionRows` in `detectors/cells.ts` (both branches, "Your usual" included);
  `renderedSectionLooks` is that list flattened. `lookbook-header-count.test.tsx` renders the
  section to markup over six Re-dress pages per chapter on the 157-piece fixture and checks the
  header against the cards drawn. `detectors.test.ts` pins the component's import line and the
  `{row.title}` heading. vitest resolves `@/` via an alias in `vitest.config.ts`.
- stylist-memory (Oct 13 2026, claude/stylist-memory): the stylist keeps what the user tells it.
  `supabase/migrations/20261013200000_stylist_notes.sql` (hand-applied, not `migrations/`) makes
  `stylist_notes` with RLS; `src/lib/stylist-notes/` holds the module (`notes.ts`: add/listActive/
  delete over a backend, same-topic supersede keeps the older row), the pure classifier
  (`classify.ts`, cue words, no model call), the top-8-by-topic-then-recency ranker and prompt
  block (`rank.ts`), the dock hook (`remember.ts`, runs beside learnFromAsk, never on a Skip), and
  the server loader (`notes.server.ts`, caller token under RLS). `askStylist` appends a REMEMBERED
  block after NOTES. The notes view is `components/shell/stylist-notes.tsx`, toggled in the dock.
  `policy.test.ts` runs the migration verbatim in PGlite with a stubbed auth schema.
- real-fixture (Oct 13 2026, claude/stylist-memory): the test closet is the owner's real pieces
  only. `engine-garments.json` holds all 157 active pieces of the Oct 13 export (the 15 added Oct
  10 included); the 15 hand-drafted `x_*` stand-ins in `redress-extra.json` are gone, and
  `__fixtures__/snapshot.ts` exports one list (`testCloset` = `liveSnapshot`). The refresh
  script takes `--from-file <path>` to reduce an export kept outside the repo with the same
  filter and strip as the Supabase read (no network). `engine-snapshot.json` was re-recorded
  from the 58d7b8c tree on the 157 pieces. Finding: the "out" chapter's week row has 5 cards on
  the real closet (five or six non-sneaker shoe groups pair, and a row never repeats a piece);
  the stand-ins' fake shoes and jackets had hidden that. `redress-fill.test.ts` now asks for a
  full week row only where the scarcest core slot has eight look-alike groups, and
  `redress-rowdupe.test.ts` allows one look in a relaxed plain row, as redress-fill already did.
- mules-fall (Oct 13 2026, claude/stylist-memory): the brown suede mules (casual and dressy) never
  paired on out or weekend in fall because `XC-SEA-3` in `stylist/rules.ts` hard-failed every mule
  in fall and winter (the `summer_fabric_piece` signal names all mules). Now `coldMule` (a mule
  whose name, subtype or material says suede, leather, shearling, wool, felt or velvet) is a fall
  shoe: not a summer piece, soft -5 (the rule JSON's `mule_delta`) on fall weekday/out, hard in
  winter only; summer mules are unchanged. `weekRotationRow` now `settle`s the verdict of core
  pieces the row never tried (scarcest slot first, least-recently-shown first) with the page's
  search budget, which counts tries (PAIR_SEARCHES × PAIR_TRIES) rather than calls, so a piece no
  legal look can hold is in `unpairable` on the first page that can judge it (the mules in winter:
  weekend tap 1), never silent. Out/fall week row: 6 cards (six pairable shoe groups) and no
  one-look row. `redress-fill.test.ts` pins the week row to min(8, the scarcest core slot's
  pairable groups) and counts coverage by the page's merged twin groups; `redress-rowdupe.test.ts`
  allows a one-look row only under ROW_MIN pairable shoe groups and pins the header to the cards.
  Fixture names are the stored names without the maker (`fixtureName` in the refresh script: the
  brand phrase, `HOUSE_WORDS` and logo initials cut, a placeholder falls back to `builtName`), so
  the pattern and colour words are back ("red gingham shirt", "blue pinstripe trousers"); 123 of
  157 names changed and `engine-snapshot.json` was re-recorded from the 58d7b8c tree with the same
  rule patch. `matrix.test.ts` allows a cold-weather mule in fall. Side effect caught by
  `houses-rank.test.ts`: the matrix spreads jackets across every row built in a session, and the
  mule looks in earlier house rows shifted which jacket the weekend/fall matrix gave two looks, so
  the navy colour row fell to 2. `finishStyled` now has `publishColor`: a colour row short of
  `COLOR_ROW_MIN` (3) re-dresses the next matrix looks with a legal in-season jacket that carries
  the colour (colour rows are not among the pinned engine outputs; `publish` is untouched).
  With the names back, two "brown blue plaid shirt" pieces get different twinKeys but one merged
  group (nameKey), so the route handed `advanceRotation` the merged `twinGroups` key (was
  twinKey): otherwise the never-shown name-twin blocked the cycle reset (undone in twin-by-photo,
  below). The rule JSON (`2026-09-30-proposed-stylist-rules.json`) is a law
  file pinned by hash in `profiles.test.ts`, so its XC-SEA-3 #1 case ("fail: mules in fall") is
  overridden in `rules.test.ts` (`SUPERSEDED`), not edited.
- twin-by-photo (Oct 13 2026, claude/stylist-memory): the name merge was wrong. g_z6syv3lx30tn
  (regular collar, warmth 3) and g_21b6d3qcohmu (button-down, warmth 2) are two shirts both stored
  as "brown blue plaid shirt"; merged, the second never led a row (a group ranks by its
  latest-shown member) and never got a card. `twinGroups` now merges twinKey groups only when
  members share a photo (`photoKey`: slot + `fileHash`, the source-file fingerprint rack.ts
  already dedupes on); a name alone never merges. With the shirts apart, every chapter's cycle
  closes on twinKey-level keys, so the route hands the rotation `twinGroups(garments).key`
  (= twinKey on the fixture, which has no hashes) and the tests' `ALIKE`/`KEY` are the same.
  `redress-live.test.ts` pins the shirts as two pieces that each get a card where allowed;
  `redress-rowdupe.test.ts` gives its two trousers one `fileHash` and checks the shirts stay
  apart. In the Oct 13 export no same-name pair shares a hash (one unrelated pair does). Row
  counts unchanged; out's final unpairable count is 74 (was 75). `docs/closet-out-clashes.md`
  derives, by running the engine on the fixture before and after the renames, why out pairs
  under half the closet: the out gate (top must be an oxford, polo, camp collar or knit; no
  sneaker while loafers are owned; no distressed jeans), not the pattern words; XC-PAT-1 hard
  hits are 0.3% of sampled out looks and cost no piece its pairability.

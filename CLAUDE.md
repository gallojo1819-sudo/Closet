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
- today-consistency (Oct 14 2026, claude/today-consistency): four live-audit findings. (1) Today
  changed on every load: the open effect's `rerollDrop` ran in memory (never persisted) with
  inputs that moved between loads (`momentOfDay`, the live degrees, the memory-only `thisWeek`
  row, `lookCountMap(looks)`, and an `ownedCount` dep that re-ran on the sample rack and again
  on the real closet). Now `rerollDrop(..., { season })` is the daily pick (`src/lib/daily-pick.ts`):
  salt = FNV of `todayISO()` + the sorted live ids, moment fixed to `DAILY_MOMENT`, weather =
  `weatherForSeason(bucket)` (unmeasured, so jackets go by season), no week keys, no auto-look
  counts; Skip/Reshuffle keep their salts. The bucket is frozen per day under localStorage
  `closet.today-season.v1` (not closet.v6). The effect waits for a settled closet (`hasRealPieces`
  or a local-only sample) and re-runs on `liveIdsKey`, not `ownedCount`. The pick stays in memory
  on purpose: a gate-open `setDrop` stamps `setAt`, which `mergeDrop` lets outrank a Skip made on
  another device. (2) The dock's "This look" was the last persisted stylist message; it is now
  Today's look through one selector, `todayLookPieces` in `src/lib/today-look.ts` (the Today
  page's `shown`, `answerTodayAsk`, the dock), until an ask in this session answers; the thread
  (`components/shell/stylist-thread.tsx`) renders the user's own messages in order;
  `swapBaseIds` takes `todayIds` and `asksAboutToday`. (3) `retitleFakeNames` wrote "Cream knit"
  into stored names on every load (`nameFromPixels` defaulted lead "Cream" and kind "knit"): the
  store action and its app-shell call are gone; `nameFromPixels` names only with a sampled colour
  and a real kind (an "other" stays a "piece", pattern word kept). `pieceLabel` picks a suffix
  unique within the same-name group (colour, material, subtype, fit; never brand), else "· 2".
  The two "New piece" ids had no `garments_v2` row because the mirror ran only after a camera
  tag; the studio now mirrors at add time (`mirrorAdded`); the backfill for the two existing ids
  is written up in `docs/relational-copy-backfill.md`, not run. (5) A piece led several rows:
  `rowWays` keeps a page-wide `leads` set (twin keys of each row's first card, the week row's
  via `leadIds`), and `heroRow` orders lead heroes last and keeps lead partners off a row's first
  card while another hero can dress. Row counts unchanged (6 out/fall, 8 elsewhere). Tests:
  `today-pin`, `stylist-today`, `piece-label`, `lookbook-crossrow` (vitest). Source pins updated
  in `look.test.ts`, `stylist-page.test.ts`, `look-collage.test.ts`, `lookbook.test.ts`,
  `data/copies.test.ts`. `diag/qa-today-pin.mjs` loads the preview twice (CHROME_PATH,
  CLOSET_V6_FILE) and compares the page with the dock.
- today-consistency-fix (Oct 14 2026, claude/today-consistency-fix): the live check of f51a011
  (signed in) still failed on three counts. (1) Dock: the daily pick lived in the Today page's
  effect, so on any other page (or before its weather fetch) the dock read yesterday's drop,
  and "this session" was a module-load timestamp (a kept-alive tab or a future-stamped message
  from another device counted). Now `useDailyPick` (`src/lib/use-daily-pick.ts`, called by
  AppShell) rolls the pick on every page; `todayLookPieces` falls back to the pick itself
  (`dailyPickIds` → `pickDropIds` in `drop-pick.ts`, the pure assembly `rerollDrop` now also
  uses, under the bucket from `today-season.ts`) when no cell holds today's look, so the page,
  the dock and `answerTodayAsk` agree before and after the effect lands. The dock's thread is
  the ids it pushed this session (`stylist-session.ts`: `sessionThread` with the dock's own
  echo, `thisLookMessage` = a stylist answer pushed today), and an ask is bounded:
  `askWithDeadline` (8 s) then `localStylistReply` (composeAtlasLook) so a reply always
  renders; `xaiFetch` has `AbortSignal.timeout` and the notes read a 3 s race. (2) Names:
  `displayName` in `piece-label.ts` sets aside untrusted stored names (placeholders, bare
  category words, filenames, the old renamer's "Cream knit" with no cream tagged) and builds
  one from the fields; `pieceLabel` groups by the shown name and suffixes with a real word
  (colour, material, subtype, fit, pattern), then formality/warmth words, then "added <day>",
  and an ordinal only when every field is the same (on the fixture: one white/blue sneaker
  pair, the two "other" placeholders). `pieceLine`, `plainName`, `nameLook`, `speakPiece`
  and the plate fallbacks read it; nothing writes a name. (3) Lookbook: a piece leads at most
  one card on the whole page, where a card's lead is what it shows first: a week card its top
  (`weekLeadPiece`, the stacked plate's first band), an idea card its jacket else its top
  (`leadPiece` in `look-collage.ts`). `RowOpts.led` (twin keys) is threaded through heroRow,
  spreadJackets, the forgotten row and the stored fallback; `weekRotationRow` returns `leads`
  and the route hands them to `rowWays` as `leadIds`. Week rows unchanged (6 out/fall, 8
  elsewhere); on weekday/fall seven rows across six pages are 1–2 cards shorter than at
  f51a011 because every card there must carry a jacket, 15 jacket groups pair, and
  `wayCanDress` (exhaustive, theme-aware) shows no row could take the one un-led jacket left;
  `lookbook-crossrow.test.ts` pins the f51a011 row sizes (BEFORE) and allows a shorter row only
  under that proof.
- added-time-labels (Oct 14 2026, claude/today-consistency-fix): no label ends in a bare number.
  `pieceLabel` tells same-name pieces alike in every real field apart by when they were added, in
  Eastern time (`ADDED_TIME_ZONE`): the day ("added Sep 12"), the minute when the day is shared
  ("added Sep 12, 5:07 PM"), the second when the minute is, then the id; the "· 2" ordinal and
  `labelIsOrdinal` are gone. The fixture keeps the stored createdAt (`storedCreatedAt` in the
  refresh script; only an unreadable one gets `FALLBACK_CREATED_AT`), so the two white leather
  sneakers (Sep 12, four minutes apart) and the two placeholders (Oct 10, eight minutes apart)
  read their added time in tests as they do live. Real dates feed `daysIdle`, so
  `engine-snapshot.json` was re-recorded from the 58d7b8c tree with the mules-fall rules patch
  (the recipe reproduced the old pin byte for byte first), and `lookbook-variety.test.ts` runs
  on Oct 14 2026: on Oct 9 no piece of a closet begun Sep 12 is 30 days idle, so no forgotten
  row forms and the out screen falls back to two one-look stored rows. `diag/lookbook-leads.ts`
  is removed.
- photo-library (Oct 15 2026, claude/photo-library): the On-me sheet and the hangtag input were
  camera-only on phones (`capture="environment"` hides Photos on iOS and Android). Both now
  mount `PhotoSourceInputs` (`components/ui/photo-source.tsx`): a "Take photo" input
  (`cameraInputProps`) and a "Choose from Photos" input (`libraryPickProps` in `camera.ts`: no
  capture, no multiple, `CAMERA_ACCEPT` so HEIC comes through), with aria-labels
  `TAKE_PHOTO_LABEL`/`CHOOSE_PHOTOS_LABEL`. The sheet's two buttons sit under the
  `refPhotoLabel` caption ("Add photo"/"Replace photo"); the hangtag row is `HangtagSource`
  (`components/add/hangtag-source.tsx`), and `processHangtag` reports `HEIC_ERROR` when a HEIC
  fails to decode. `photo-source.test.tsx` (vitest) renders `RefPhotoDialog` (now exported) and
  `HangtagSource` to markup and checks both inputs' attributes; it also pins that neither
  component file carries `capture=` or `accept="image/*"` any more.

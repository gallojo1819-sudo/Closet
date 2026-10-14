# Relational copy: the two "New piece" rows (write-up only, nothing executed)

Date: Oct 14 2026. Branch `claude/today-consistency`.

## What is missing

Two live pieces in `closet_meta` have no row in `garments_v2`:

| legacy id        | stored name | category | colors | subtype |
| ---------------- | ----------- | -------- | ------ | ------- |
| `g_c5tgp57bcuub` | New piece   | other    | `[]`   | (empty) |
| `g_okvtcabq289s` | New piece   | other    | `[]`   | (empty) |

(The public snapshot fixture names them "other": `fixtureName` in
`scripts/refresh-closet-snapshot.ts` replaces a placeholder name with `builtName`, which with
no colour, material or subtype is the category word.)

## The code cause

`mirrorGarmentFields` (`src/lib/data/mirror.ts`) was only ever called after a successful camera
tag: `nameCameraPiece` in `src/components/add/studio.tsx` and the tag step of
`src/lib/print-queue.ts` mirror the piece when `decideCameraTag` (`src/lib/camera-tag.ts`)
answers `update` or `worn` with a fallback. A tag that failed, timed out, or came back with a
placeholder name answers `keep`, so the piece stayed "New piece" in `closet_meta` and no
`garments_v2` row was ever inserted. Nothing in `copies.ts` / `copies-live.ts` filters by
`isFakeName` or category; the row simply never existed.

Fixed on this branch: the studio mirrors a piece at add time (`mirrorAdded`, the same writer
and the update-then-insert path), so a later tag updates the row and a failed tag still leaves
one. The fix does not reach back: the two ids above still need their rows.

## The data step (for Joe; read-safe; run nothing from code)

1. Confirm the rows are absent, as the signed-in owner (RLS) or with the service role:

   ```sql
   select legacy_id from garments_v2
   where user_id = '<owner user id>'
     and legacy_id in ('g_c5tgp57bcuub', 'g_okvtcabq289s');
   -- expect 0 rows
   ```

2. Insert the two rows, with the fields `closet_meta` holds for them today (name "New piece",
   category "other", empty subcategory, colors `{}`, empty fabric and brand), `status`
   `in_closet`, `version` 1:

   ```sql
   insert into garments_v2 (user_id, legacy_id, status, name, category, subcategory, colors, fabric, brand, version)
   values
     ('<owner user id>', 'g_c5tgp57bcuub', 'in_closet', 'New piece', 'other', '', '{}', '', '', 1),
     ('<owner user id>', 'g_okvtcabq289s', 'in_closet', 'New piece', 'other', '', '{}', '', '', 1)
   on conflict do nothing;
   ```

   `on conflict do nothing` keeps the step idempotent if a row has appeared since. If the
   table's unique key is not `(user_id, legacy_id)`, check the constraint name first.

3. Re-run the SELECT from step 1: expect 2 rows. The app's parity line
   (`parityLine` in `src/lib/data/copies.ts`) then reads equal counts on the next signed-in
   open, with no change to `closet_meta`.

Nothing here touches `closet.v6` or `closet_meta`. Once Joe names the two pieces in the app,
the normal edit path updates the mirrored rows.

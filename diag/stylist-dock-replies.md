# Stylist dock — keep the page you left, and paint the reply

Branch: `stylist-dock-replies` (from `main` @ `8357fa6`, which contains `22ac8cc`).
Live browser: **UNEXECUTED** — no click was performed on the live site.

## S0 — Census (read before any edit)

1. `noteRoute` and `screenSentence` in `src/lib/stylist-page.ts` (main @ `8357fa6`):
   - `noteRoute` at `src/lib/stylist-page.ts:187-191`. The `/stylist` branch is line 189: `if (route === "stylist") return;` — already returns without writing.
   - The branches that set `"Watching this page."` are in `screenSentence` (`src/lib/stylist-page.ts:591-623`), line 610 inside the on-screen-looks branch (`return "Watching this page.";`) and line 622 as the final fall-through.
2. `acceptStylistReply` at `src/lib/stylist-page.ts:321-337`. Every reject is `return null;`. The garment-phrase reject, verbatim:

   ```ts
   GARMENT_NOUN.lastIndex = 0;
   let match: RegExpExecArray | null;
   while ((match = GARMENT_NOUN.exec(clean.toLower()))) {
     const phrase = `${match[1] ?? ""}${match[2] ?? ""}`.trim();
     if (!phraseOwned(phrase, garments)) return null;
   }
   ```

   It returns `string | null`; it never returns an empty string. The reject string the codebase already renders next to it is `NOT_IN_CLOSET` (`src/lib/stylist-page.ts:339`): `"That piece is not in this closet."`
3. The 200 handler is in `src/components/shell/stylist-dock.tsx`, inside `send` (main lines 277-304). Lines that read the response:

   ```ts
   const res = await askStylist({ data: stylistAskFields({ /* … */ }) });
   const payload = await stylistPayload(res);
   const painted = replyFromStylistResult(payload, owned);
   ```

   Lines that put text on screen:

   ```ts
   pushMessage({
     role: "stylist",
     text: painted.text,
     /* … */
   });
   ```

   Reply renderer found in that file — no second dock invented.
4. `bindClosetPiece` is **not** in `detail.tsx`; the real location is `src/lib/stylist-page.ts:197-210`. `src/components/closet/detail.tsx:170` only calls it: `useEffect(() => bindClosetPiece(garment.id), [garment.id]);`. The function, pasted:

   ```ts
   export function bindClosetPiece(id: string): () => void {
     closetDrawer += 1;
     writeStylistPage({ route: "closet", openGarmentId: id, onScreenLookIds: [] });
     return () => {
       closetDrawer -= 1;
       queueMicrotask(() => {
         if (closetDrawer > 0) return;
         const page = readStylistPage();
         if (page.route === "closet" && page.openGarmentId === id) {
           writeStylistPage({ route: "closet", onScreenLookIds: [] });
         }
       });
     };
   }
   ```

   It already writes the open garment id (`src/lib/stylist-page.ts:199`), so `detail.tsx` was not edited (0 lines).
5. `screenLooks` is built at `src/routes/lookbook.tsx:387-399` (main). Source arrays:

   ```ts
   for (const look of realRow) add(look.id, look.garmentIds);
   for (const look of sectionLooks) add(look.id, look.garmentIds);
   for (const look of heroCards) add(look.id, look.garmentIds);
   ```

   `realRow` = This week cards (`realWeekLooks`, ≥3 owned pieces, gates dropped — matches the render filter at `lookbook.tsx:680-681`). `sectionLooks` = `renderedSectionLooks(shownWays, occasion, wayId)` (`src/lib/detectors/cells.ts:800`), whose `dressedLooks` is character-for-character the render filter `chapterLooks` in `src/components/closet/detector-sections.tsx:15-17`. `heroCards` = the hero overlay cards. **Not This-week-only** — per S1 it was not rebuilt; only pinned by tests.
6. `git merge-base --is-ancestor 22ac8cc HEAD` → `HAS_22ac8cc`.
7. `git remote -v` → `origin https://github.com/gallojo1819-sudo/Closet.git`; `git rev-parse --short HEAD` → `8357fa6` (census taken on `main`; work proceeds on `stylist-dock-replies`).

Fence checks: remote correct, cwd is the repo root (`C:\Users\JoeRe\Closet`, not a nested `Closet\Closet`), Vite app (`src/routes`, no `app/(app)`), `22ac8cc` is an ancestor. No STOP condition hit.

## Root causes found

- **The open piece died on the way to /stylist.** `noteRoute("/stylist")` must not write, so the context route stays `"closet"`. The drawer's unmount cleanup (`bindClosetPiece`) cleared the open piece whenever the context route was `"closet"` — which is exactly what it still is on `/stylist`. Result: `/stylist` showed `"Watching this page."` even though he left a piece open.
- **`screenSentence` ranked looks before the open piece.** With look ids on screen but none rankable (line 610) it returned `"Watching this page."`; with route lookbook/stylist, zero looks, and chips set, it returned the chips line — both ahead of the `openGarmentId` branch. An open piece fell through.
- The 200 paint path (`stylistPayload` → `replyFromStylistResult` → `pushMessage(painted.text)`) was already correct from the previous round; its rejection string was duplicated as three literals in the dock.

## Changes

- `src/lib/stylist-page.ts`
  - `noteRoute` records the last noted path (`lastNotedPath`) before the `/stylist` early return — bookkeeping only, no context write.
  - `bindClosetPiece` cleanup now clears the piece only while he is still on a closet path (`routeFromPath(lastNotedPath) !== "closet"` → keep). Closing the drawer on Closet still clears; leaving for `/stylist` keeps the piece until he opens Today, Closet, Lookbook, or Add.
  - `screenSentence`: the `openGarmentId` branch leads. An open piece is the sentence (what goes with it, or that it does not) in every route and chip state; it can no longer fall through to `"Watching this page."` or the chips line. No looks and no piece still gives `"Watching this page."`; Lookbook with zero cards and no piece still gives `"…Nothing is on screen."`
  - Note: gating the constructed open-sentence through `acceptStylistReply` was tried and reverted — `acceptStylistReply`'s polo heuristic false-rejects a real polo whose brand is Polo (guarded by the existing "an open polo is the sentence" test). The open sentence is built only from his rack via `speakPiece`/`openSentence`, so it cannot name an unowned garment; the reject string stays on the reply path where rejection actually happens (`replyFromStylistResult` → `NOT_IN_CLOSET`), and unknown garments stay rejected (`acceptStylistReply` untouched).
- `src/components/shell/stylist-dock.tsx`
  - The three rejection literals (`local.kind === "reject"`, the `dressThisPiece` fallback, and the `catch`) now use the exported `NOT_IN_CLOSET` — the existing reject string — so a local rejection and a 200 rejection render the same line. The 200 handler still reads `stylistPayload(res)` and pushes `painted.text`.
- `src/lib/stylist-page.test.ts`
  - Six acceptance tests added (see below).

## Acceptance tests (all in `src/lib/stylist-page.test.ts`)

- `acceptance: /stylist keeps the lookbook context and its sentence` — Lookbook, weekday, fall, color, look ids; `noteRoute("/stylist")` leaves every field; the sentence is unchanged and not `"Watching this page."`
- `acceptance: opening closet with no piece open drops the lookbook context` — `noteRoute("/closet")` clears chips; sentence is `"Watching this page."`
- `acceptance: an open piece is the sentence, never Watching this page` — `openGarmentId` set with zero looks + chips, and with looks on screen; both name the piece.
- `acceptance: the open piece survives the drawer unmount on the way to /stylist` — `bindClosetPiece` → `noteRoute("/stylist")` → release; the id and the piece sentence stay; closing on Closet still clears.
- `acceptance: a 200 naming an unowned garment paints the rejection line` — a 200 body (`stylistPayload` with a `json()` body) naming "Loro Piana cashmere sweater" renders `"That piece is not in this closet."`, not empty text; dock source pins the paint path.
- `acceptance: screenLooks counts cards outside This week and never a hidden id` — lookbook source builds from `realRow` + `sectionLooks` + `heroCards`; a `way:` section id is ranked, `l_hidden` is excluded from ids, fields, and answers.

## Verification

- `npm test`: PASS — node `--test`: 449 pass / 0 fail / 144 suites (baseline before edits was 443 pass); `test:rules` (vitest): 4 files, 208 pass / 0 fail.
- `npm run typecheck`: PASS (`tsc --noEmit`, no errors).
- `npx eslint` on the three changed files: clean.
- Live site: UNEXECUTED.

## git diff

Pasted in the chat report (stat + name-only). Staged by name only:

- `src/lib/stylist-page.ts`
- `src/components/shell/stylist-dock.tsx`
- `src/lib/stylist-page.test.ts`
- `diag/stylist-dock-replies.md`

Nothing committed until Joe says. Proposed message: **The stylist keeps the page and shows its reply.**

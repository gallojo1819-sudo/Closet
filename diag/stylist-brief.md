# STYLIST — a brief dresses him

Branch: stylist-brief (from main @ a014540). Remote: gallojo1819-sudo/Closet. Vite app, no app/(app).

## Fences

- `git merge-base --is-ancestor a01454034ce0e281067dce33fc2f83fa3abf2998 HEAD` → HAS_a014540
- Remote `origin` = https://github.com/gallojo1819-sudo/Closet.git ✓
- Root `C:\Users\JoeRe\Closet`; no nested Closet app; no Thesium ✓
- No new occasion id, no Imagine, no closet.v6/closet_meta wipe.

## S0 — Census (file:line, pre-edit state)

1. `src/lib/stylist-page.ts` — `answerAsked` on-screen branch at 685-715: after the reject guards it filtered `looks` by `page.onScreenLookIds` and, whenever any look was on screen, ranked them and returned a wear sentence — for every prompt. `wearSentence` at 470-483: one top (`slotOf` top|dress), one bottom, one shoe, optional `under the {jacket}.`; null unless all three named. Final return of answerAsked: `return { kind: "pass" };` at 732 (after the open-piece branch at 716-728 and the nothing-on-screen answer at 729-731).
2. `src/components/shell/stylist-dock.tsx` — `send()` span from the answerAsked call (was ~203-209: `const local = answerAsked({ prompt: q, page: here, garments: owned, looks: rememberedLooks(here) });`) through the askStylist call (was ~328-338: `const res = await askStylist({ data: stylistAskFields({...}) })`). Between them: swapSlot branch, named-piece dress branch, context building. A prompt like "tuesday, boards meeting dinner" answered `pass` locally and fell through to askStylist — and answerAsked on a page with looks never passed.
3. The Today roller: `rerollDrop`, `src/lib/store.ts:487` — `rerollDrop: (weather, occasion, previousIds) => {…}` — the store action the Today route calls (`src/routes/index.tsx:101` and `217`). Its engine is `pickDrop` (store.ts:148, not exported) → `pickLook`. The exported pure roller built on the same engine is `composeAtlasLook`, `src/lib/taste.ts:957` — `composeAtlasLook(opts: { garments: Garment[]; prompt: string; weatherF?: number; taste: TasteMemory; modelText?: string; lockedIds?: string[]; previousIds?: string[]; occasion?: Occasion; avoid?: Record<string, number> }): AtlasLook`. Occasion ids (`src/lib/types.ts:102-108`): `weekday`, `out`, `weekend`, `comfy`, `travel`. `mapOccasion` (types.ts:113) documents old client/dinner → Out, so dinner → `out` and meeting/boards/client (no dinner) → `out` are existing ids, none invented.
4. Tests that force an on-screen prompt → page sentence: `src/lib/stylist-page.test.ts:101-114` ("Which look is strongest?"), `477-482` (same), `493-509` and `518-526` ("What is the strongest look on this page?"), `544-553` (same, nothing on screen). All prompts carry strongest/look/page, so none is a brief and none broke.
5. `git merge-base --is-ancestor a014540… HEAD` → HAS_a014540.

## What changed

- `src/lib/stylist-page.ts`:
  - `BRIEF_WORDS` / `isBrief` — weekday, dinner, meeting, boards, client, travel, weekend, comfy, or outfit, and not strongest-look / this page / on screen.
  - `answerAsked` now returns `{ kind: "pass" }` for a brief immediately after the reject guards, before the on-screen branch (stylist-page.ts:738). The strongest-look question still answers from the page.
  - `briefOccasion(prompt): Occasion | null` — dinner → `out` (wins over meeting/boards); meeting|boards|client without dinner → `out`; weekend/comfy/travel → their existing ids; bare weekday → `weekday`; non-brief → null.
  - `briefLine(prompt, pieces): string | null` — the exact leads: dinner+meeting "Boards, then dinner."; dinner only "Dinner."; meeting only "For the meeting."; weekday only "Tuesday."-style; then wearSentence's "Wear your {top} with the {bottom} and the {shoe}[ under the {jacket}]." Null when the closet can't dress top+bottom+shoe.
- `src/components/shell/stylist-dock.tsx` — in `send()`, after the local `answerAsked` reject/answer branches: if `briefOccasion(q)` returns an occasion, roll `composeAtlasLook({ garments: [...owned], prompt: q, occasion, taste, weatherF? })` (the existing roller — no new scorer), build the message with `briefLine`, push it with `garmentIds`, `draftName: nameLook(pieces)`, `draftOccasion`, and `return`. No `askStylist` call on this path, no page look, no 403/`NOT_IN_CLOSET` line (if the roller cannot dress him it says "Which piece? Tap it on Closet."). Everything after the insert (swap, named-piece, askStylist) is untouched.
- `src/lib/stylist-page.test.ts` (the census-named test file) — new acceptance test: "tuesday, boards meeting dinner" with looks on screen → `pass`; strongest-look question with the same page → wear line from those looks; `briefOccasion` mapping (dinner outranks boards; boards → weekday; bare weekday → weekday; strongest-look → null); `briefLine` exact copy for dinner+meeting and weekday-only, no `g_`/`LOOK:` in the line.

The card chrome from the previous task is untouched: it still leads with This look, This page is not the answer, busy reads "Considering the closet…".

## git diff --stat

```
 src/components/shell/stylist-dock.tsx | 30 +++++++++++++++++++
 src/lib/stylist-page.test.ts          | 42 +++++++++++++++++++++++++++
 src/lib/stylist-page.ts               | 54 +++++++++++++++++++++++++++++++++++
 3 files changed, 126 insertions(+)
```

## git diff --name-only

```
src/components/shell/stylist-dock.tsx
src/lib/stylist-page.test.ts
src/lib/stylist-page.ts
```

## npm test

- node suite: tests 454, pass 454, fail 0 (exit 0).
- `test:rules` (vitest): Test Files 4 passed (4), Tests 208 passed (208).
- Note: two intermediate full runs appeared to hang past 25 min. Diagnosis: the first timed-out run left an orphaned `lookbook.test.ts` child process spinning at 100% CPU, which starved every subsequent run. After killing the orphans, the suite completed in ~9.5 min. `lookbook.test.ts`/`lookbook.invariants.test.ts` are inherently CPU-heavy (minutes each, dominated by the pre-existing legality evaluator) and do not import anything changed here. The post-occasion-change run is the one reported above.

## npm run typecheck

- `tsc --noEmit` — clean, no errors.

## Acceptance

- "tuesday, boards meeting dinner" with looks on screen → `answerAsked` returns `pass` ✓ (new test)
- "what is the strongest look on this page?" with looks on screen still returns a page wear line ✓ (existing + new test)
- `send()` calls the roller, not `askStylist`, for a brief ✓ (brief branch returns before the askStylist block)
- Live browser: UNEXECUTED
- Staged by name only; nothing committed.

Proposed message: A brief dresses him. The page does not answer it.

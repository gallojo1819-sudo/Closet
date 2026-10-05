# Stylist dock — a question on Lookbook must show a new line

Branch: `stylist-dock-reply` (from `main` @ `42ecf69`, which contains `42ecf6940d20906bbef14cfd52f1e89d0aa3afca`).
Live browser: **UNEXECUTED** — no click was performed on the live site.
Checks 1–5 (previous round) untouched and still passing: open polo, /stylist keeps it, Lookbook sentence survives /stylist, empty Closet says "Watching this page.", Loro Piana says "That piece is not in this closet."

## S0 — Census (read before any edit, on main @ 42ecf69)

1. Collapsed dock (`open` is false) in `src/components/shell/stylist-dock.tsx:369-385`:
   - the page sentence, `:376-378`: `<p data-stylist-screen className="text-sm text-ink">{sentence}</p>`
   - the line that hides a reply when it equals the sentence, `:379-381`:

     ```tsx
     {last && stylistProse(last.text).split("\n")[0] !== sentence ? (
       <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{stylistProse(last.text).split("\n")[0]}</p>
     ) : null}
     ```

   - "Considering the closet…" is rendered only in the open panel at `src/components/shell/stylist-dock.tsx:465` (`<Loader2 className="size-4 animate-spin" /> Considering the closet…`). **The spinner does not exist when `open` is false.**
2. `answerAsked` (`src/lib/stylist-page.ts:649-702`) and `screenSentence` (`:599-631`):
   - the branch that returns `formatStrongest` (answerAsked, `:683-686` on main):

     ```ts
     const winner = pool[index]!;
     const text = formatStrongest(index, winner.pieces, page) ?? "Watching this page.";
     if (!acceptStylistReply(text, garments)) return { kind: "reject" };
     return { kind: "answer", text, garmentIds: winner.pieces.map((g) => g.id) };
     ```

   - the branch that returns the screen sentence when `rankIndex` is below 0 (answerAsked, `:675-682` on main):

     ```ts
     const index = rankIndex(pool, page);
     if (index < 0) {
       return {
         kind: "answer",
         text: screenSentence({ ...page, onScreenLookIds: pool.map((row) => row.id) }, garments, looks),
         garmentIds: [],
       };
     }
     ```

3. `formatStrongest`'s return string, verbatim (`src/lib/stylist-page.ts:475`):

   ```ts
   return `The ${ord} look is the strongest: ${body}${holdClause(page)}${weather}.`;
   ```

4. `git merge-base --is-ancestor 42ecf6940d20906bbef14cfd52f1e89d0aa3afca HEAD` → `HAS_42ecf69`.
5. `git remote -v` → `origin https://github.com/gallojo1819-sudo/Closet.git`; `git rev-parse --short HEAD` → `42ecf69` (census on `main`; work proceeds on `stylist-dock-reply`).

Fence checks: remote correct, cwd is the repo root (`C:\Users\JoeRe\Closet`, not a nested `Closet\Closet`), Vite app (no `app/(app)`), `42ecf69` is an ancestor of HEAD. S1: the real hide was found and pasted above (no invented cause); `onScreenLookIds` empty stays off the model path. No STOP condition hit.

## Root cause

The page line already names the strongest look — `screenSentence` and the `answerAsked` answer were the same `formatStrongest` sentence. The collapsed dock hid any reply whose first line equaled the page sentence (`!== sentence`, `:379`), so "What is the strongest look on this page?" left only the old page line. Two fixes were required: the answer must be its own sentence, and the collapsed dock must show the latest stylist line even when the words match.

## Changes

- `src/lib/stylist-page.ts`
  - New `wearSentence(pieces)`: exactly `Wear your {top} with the {bottom} and the {shoe}.` — one top (top or dress slot), one bottom, one shoe, from the winning look only, all named with `speakPiece`; a jacket in that look adds ` under the {jacket}` before the period. Returns null when a slot is unnamed.
  - New `asksAboutOnScreenLooks(prompt)`: true when the prompt is about the looks on the page (`look(s)` or `this page` / `on screen`). Dressing prompts ("Swap the shirt", "Wear the cream cable") stay `pass`.
  - `answerAsked`, looks branch: `rankIndex` below 0 now answers `"None of these looks holds them."` (not the page line). The winner answers with the Wear sentence when `acceptStylistReply` accepts it; if the Wear sentence is rejected, the same winning pieces are shown joined with ` · ` — never `NOT_IN_CLOSET`, never a model call. `garmentIds` stay the winner's pieces.
  - `answerAsked`, nothing on screen: an on-screen-looks question with empty `onScreenLookIds` and no open piece answers `"Nothing is on screen."` (kind `answer`, not a model pass). An open piece still leads; `"Watching this page."` is still only the no-piece-no-looks sentence.
  - `STOP` gains `"under"` — a join word like its sibling `"over"`, never a garment word. Without it the mandated `under the {jacket}` phrase failed `phraseOwned` and every jacketed Wear sentence fell into the ` · ` fallback. No rejection was weakened: "Wear the under the camel overcoat" still rejects on camel/overcoat, and an unknown garment still answers "That piece is not in this closet." (`acceptStylistReply` logic untouched).
- `src/components/shell/stylist-dock.tsx`
  - Collapsed dock computes `lastLine` (first prose line of the latest stylist message) and renders it under the page line unconditionally — the `!== sentence` hide is gone. While `busy`, the same `Considering the closet…` line as the open panel renders there too (same `Loader2`, no second spinner).
- `src/lib/stylist-page.test.ts`
  - Four acceptance tests added (below). Fixture id `g_loafer` (singular) used as in the file's rack.

## Acceptance tests (all in `src/lib/stylist-page.test.ts`)

- `acceptance: the strongest-look answer is its own Wear sentence` — looks on screen; `answerAsked("What is the strongest look on this page?")` is kind `answer`, starts with `Wear your `, ≠ `screenSentence`, names only the winning look's pieces (`under the navy blazer.` for a jacketed look; the plain template for a summer no-jacket look), no `LOOK:` / `g_` / house / brand; the same page with "Pair my Loro Piana cashmere sweater" is kind `reject`.
- `acceptance: a look question with nothing on screen is not a model pass` — empty `onScreenLookIds`: text is exactly `Nothing is on screen.`; `Swap the shirt` still passes through.
- `acceptance: looks that cannot rank answer none holds them` — unrankable look: text is exactly `None of these looks holds them.`
- `acceptance: the collapsed dock shows the last line even when it equals the sentence` — dock source no longer contains `!== sentence`, exposes `lastLine`, and `Considering the closet…` appears twice (open panel + collapsed).

## Verification

- `npm test`: PASS — node `--test`: 453 pass / 0 fail / 144 suites (449 before this round → +4 acceptance tests); `test:rules` (vitest): 4 files, 208 pass / 0 fail.
- `npm run typecheck`: PASS (`tsc --noEmit`, no errors).
- `npx eslint` on the three changed files: clean.
- Live site: UNEXECUTED.

## git diff

Pasted in the chat report (stat + name-only). Staged by name only:

- `src/lib/stylist-page.ts`
- `src/components/shell/stylist-dock.tsx`
- `src/lib/stylist-page.test.ts`
- `diag/stylist-dock-reply.md`

Nothing committed until Joe says. Proposed message: **A question on Lookbook shows its own line.**

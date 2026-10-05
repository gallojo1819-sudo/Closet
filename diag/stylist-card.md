# STYLIST — a card, not a chat

Branch: stylist-card (from main @ cb7e338). Remote: gallojo1819-sudo/Closet. Vite app, no app/(app).

## Fences

- `git merge-base --is-ancestor cb7e338a7a009490130e5b4c1ffc7d645d99c45c HEAD` → HAS_cb7e338
- Remote `origin` = https://github.com/gallojo1819-sudo/Closet.git ✓
- Root `C:\Users\JoeRe\Closet`; no nested Closet app; no Thesium ✓
- `send()` diff is empty (extracted the function from HEAD and the worktree and diffed — identical). `answerAsked` / `acceptStylistReply` untouched.

## S0 — Census (file:line, pre-edit state)

1. `src/components/shell/bottom-nav.tsx:17` — nav className was `fixed bottom-0 inset-x-0 z-40 border-t bg-paper text-ink border-hairline`. `md:hidden` was NOT there (removed by the previous task).
2. `src/components/shell/top-bar.tsx:291-297` — the burgundy button: `<button type="button" onClick={() => openStylistPanel()} className="micro hidden md:inline-flex h-8 items-center px-3 bg-accent text-paper">Stylist</button>`.
3. `src/components/shell/stylist-dock.tsx`:
   - Closed control (520-534): 44px `Ask` circle, `fixed right-4 bottom-[calc(3.5rem+0.75rem+env(safe-area-inset-bottom))] z-40 size-11 rounded-full border bg-paper text-ink md:right-6 md:bottom-6` — z-40, same as the tab bar and earlier in the DOM, so the bar painted over it (the clip defect).
   - Open panel (425-517): `w-[min(100vw-2rem,20rem)]` transcript — `messages.map` with per-message boxes, `You` label at line 447 (`<p className="micro text-ink-soft mb-1">You</p>`), prompt chips row, gray-bordered reply boxes.
   - Input className (407): `h-11 flex-1 border border-hairline bg-paper px-3 text-sm text-ink placeholder:text-ink-soft disabled:opacity-40`, placeholder "Wear the cream cable".
4. `git merge-base --is-ancestor cb7e338… HEAD` → HAS_cb7e338.

## What changed

- `bottom-nav.tsx`: `md:hidden` back on the nav (bottom-nav.tsx:17). Phone-only tab bar; desktop keeps the top links. No Stylist item added anywhere.
- `top-bar.tsx`: burgundy Stylist button and its `openStylistPanel` import deleted (top-bar.tsx:287-297 area). One control on the site.
- `stylist-dock.tsx`:
  - Closed control is a paper chip: `fixed right-4 bottom-[calc(3.5rem+0.75rem+env(safe-area-inset-bottom))] z-50 h-11 rounded-full border bg-paper px-4 text-sm text-ink md:right-6 md:bottom-6` (stylist-dock.tsx:482-492). Word "Stylist". z-50 — nothing clips it. Busy ring (`border-accent`, 1.2s) and unread 6px `bg-accent` dot kept.
  - Open card above the chip, no URL change: `w-[min(100vw-2rem,22rem)] max-h-[70dvh] overflow-auto border border-hairline bg-paper`, same 160ms opacity/8px motion. `data-stylist-dock` on the card.
  - Card body: micro "This page" → the page sentence in `data-stylist-screen`, text-ink; hairline rule; micro "This look" → the latest stylist reply only, text-ink, `replyLines()` splits it one piece name per line (LOOK:/MISSING: lines never printed); technique line and Save / Wear this / See on you actions kept for that look; busy shows "Considering the closet…"; otherwise "Nothing yet."
  - One field: `text-ink bg-paper border border-hairline`, placeholder `text-ink-soft` reads "Saturday, nothing planned" (stylist-dock.tsx:376-378). Never text-paper/text-champagne/white — grep confirms none of those strings remain in the file. Send stays `Button variant="primary"` = `bg-accent text-paper` (white allowed on that button only).
  - No `You`, no gray boxes, no transcript, no prompt chips. Render grep for `YOU`/`text-paper`/`text-champagne`/`text-white`: no matches.
  - Error line: when the latest reply is the failure/rejection line (`NOT_IN_CLOSET`, which `send()` pushes on a failed ask such as a 403), it renders under the field in `text-accent` — never the field's value, never white. Derived in render from state; `send()` untouched.
- `app-shell.tsx`: not changed — the chip is `fixed`, not covered by the main padding (`pb-20 md:pb-10` already clears the h-14 tab bar).
- `src/lib/stylist-page.test.ts` (the one allowed test file): the test that asserted the Ask circle now asserts the Stylist chip; the shell test's stale `messages.map` (transcript) assertion now asserts `replyLines` (latest-reply card).

Unchanged per OUT: how a question is answered (`send()`, `answerAsked`, `acceptStylistReply` — all byte-identical), no memory/taste/outfit-generator changes, lookbook, closet cards, cloud untouched. No LOOK:, g_, house, or brand printed in new copy.

## git diff --stat

```
 src/components/shell/bottom-nav.tsx   |   2 +-
 src/components/shell/stylist-dock.tsx | 146 ++++++++++++----------------------
 src/components/shell/top-bar.tsx      |   8 --
 src/lib/stylist-page.test.ts          |  10 +--
 4 files changed, 58 insertions(+), 108 deletions(-)
```

## git diff --name-only

```
src/components/shell/bottom-nav.tsx
src/components/shell/stylist-dock.tsx
src/components/shell/top-bar.tsx
src/lib/stylist-page.test.ts
```

## npm test

- node suite: tests 453, pass 453, fail 0 (exit 0).
- `test:rules` (vitest): Test Files 4 passed (4), Tests 208 passed (208).

## npm run typecheck

- `tsc --noEmit` — clean, no errors.

## Acceptance

- bottom-nav className includes `md:hidden` ✓ (bottom-nav.tsx:17)
- Top bar has no button whose text is Stylist ✓ (grep for "Stylist" in top-bar.tsx: no matches)
- Input className includes `text-ink`; no `text-paper`/`text-white` ✓
- Render has no string YOU ✓; `send()` diff empty ✓
- Live browser: UNEXECUTED
- Staged by name only; nothing committed.

Proposed message: The stylist is a card on the page, not a chat.

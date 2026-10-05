# STYLIST — one small agent, not a tab

Branch: stylist-mark (from main @ d3c22d8). Remote: gallojo1819-sudo/Closet. Vite app, no app/(app).

## Fences

- `git merge-base --is-ancestor d3c22d88784d3ab9b6fe9bebf316962410e060d8 HEAD` → HAS_d3c22d8
- Remote `origin` = https://github.com/gallojo1819-sudo/Closet.git ✓
- Root `C:\Users\JoeRe\Closet`, no nested Closet app, no Thesium ✓
- StylistDock is the only agent UI. No second thread, no Sparkles, no illustrated person, no eyes.

## S0 — Census (file:line, pre-edit state)

1. `src/components/shell/bottom-nav.tsx:5-10` — TABS already had four entries (Today, Closet, Add, Lookbook); the old fifth `{ to: "/stylist", label: "Stylist", icon: Sparkles }` was removed in this change. Grid class `grid grid-cols-5 h-14` → `grid grid-cols-4 h-14` (bottom-nav.tsx:20).
2. `src/components/shell/app-shell.tsx:180` — `<StylistDock />` mounted unconditionally (the old `night ? null : <StylistDock />` skip is gone; no `pathname.startsWith("/stylist")` remains anywhere in the shell). Main padding at app-shell.tsx:172-175 changed from `night ? "pb-20 md:pb-10" : "pb-44 md:pb-36"` to `"pb-20 md:pb-10"` — the bar's reserved space (pb-44) is gone; what remains covers the tab bar only.
3. `src/routes/stylist.tsx` (whole file, 25 lines): `createFileRoute("/stylist")` component calls `openStylistPanel()`, then `router.history.back()`; if still on `/stylist` after 60ms it navigates to `/`. Returns null — no second dock, no night.
4. `src/components/shell/stylist-dock.tsx` — collapsed state: no full-width bar; the closed control is the 44px `Ask` circle (stylist-dock.tsx:520-534: `fixed right-4 bottom-[calc(3.5rem+0.75rem+env(safe-area-inset-bottom))] z-40 size-11 rounded-full border bg-paper text-ink md:right-6 md:bottom-6`, `border-hairline` → `border-accent` for 1.2s while busy, 6px `bg-accent` unread dot). Open panel first heading sentence at stylist-dock.tsx:434 (`data-stylist-screen`). `data-stylist-dock` at stylist-dock.tsx:426.
5. Grep `/stylist` under src/components and src/routes, pre-edit links:
   - `src/components/shell/top-bar.tsx` — `/stylist` Nav item and `to="/stylist"` Stylist link (removed; now a button calling `openStylistPanel()`).
   - `src/routes/stylist.tsx:5` — the route itself.
   - `src/routes/index.tsx:502` — `to="/stylist"` "Ask the stylist" Link. **Not touched**: `src/routes/index.tsx` is outside the allowed edit list. Navigating there lands on the `/stylist` route, which opens the panel and immediately hands back to the previous page — net effect: panel opens, no page change.
6. `git merge-base --is-ancestor d3c22d8… HEAD` → HAS_d3c22d8.

## What changed

- `bottom-nav.tsx`: Stylist tab removed; four columns; all night branches removed.
- `app-shell.tsx`: night shell (`theme-night`, `vt-night`, BackupBanner night prop) removed; StylistDock always rendered; main padding `pb-20 md:pb-10`.
- `stylist-dock.tsx`: `open` prop and full-width bar removed. One dock, own `open` state, `openStylistPanel()` listener. Panel: `w-[min(100vw-2rem,20rem)] max-h-[70dvh] overflow-auto border border-hairline bg-paper`, fixed above the circle; open motion opacity + translateY(8px), 160ms ease-out; close via the Ask circle, Escape, or the `fixed inset-0` backdrop. Busy ring 1200ms `border-accent`; unread 6px `bg-accent` dot. `send()` byte-identical (diff of the extracted function is empty).
- `top-bar.tsx`: Nav Stylist item and `/stylist` Link removed; "Stylist" is now a button calling `openStylistPanel()` (no navigation); night classes removed.
- `routes/stylist.tsx`: opens the shell dock's panel, `history.back()`, fallback to `/`. `noteRoute` skips the stylist route (`src/lib/stylist-page.ts:196`, unchanged), so the page sentence he had stays.
- `src/lib/stylist-page.test.ts` (the one allowed test file): the test asserting the old route (`/StylistDock/` in routes/stylist.tsx) now asserts `openStylistPanel`; the test asserting the old collapsed bar (`lastLine`, busy string ×2) now asserts the Ask circle (no `inset-x-0 bottom-14`, `rounded-full`, busy string ×1).

Unchanged per OUT: stylist-page.ts, ai.ts, lookbook, closet cards, plates, cloud, the Wear sentence, the Loro Piana rejection.

## git diff --stat

```
 src/components/shell/app-shell.tsx    |  27 +--
 src/components/shell/bottom-nav.tsx   |  21 +--
 src/components/shell/stylist-dock.tsx | 300 +++++++++++++++++++---------------
 src/components/shell/top-bar.tsx      |  47 ++----
 src/lib/stylist-page.test.ts          |  14 +-
 src/routes/stylist.tsx                |  24 ++-
 6 files changed, 223 insertions(+), 210 deletions(-)
```

## git diff --name-only

```
src/components/shell/app-shell.tsx
src/components/shell/bottom-nav.tsx
src/components/shell/stylist-dock.tsx
src/components/shell/top-bar.tsx
src/lib/stylist-page.test.ts
src/routes/stylist.tsx
```

## npm test

- node suite: tests 453, pass 453, fail 0, cancelled 0, skipped 0 (144 suites).
- `test:rules` (vitest): Test Files 4 passed (4), Tests 208 passed (208).

## npm run typecheck

- `tsc --noEmit` — clean, no errors.

## Acceptance

- bottom-nav: no `/stylist`, no `grid-cols-5`, no night colors ✓
- app-shell: always renders `<StylistDock />`; no `/stylist` skip ✓
- Closed control text is `Ask`; `inset-x-0 bottom-14` gone from the dock ✓
- `send()` diff is empty ✓
- `data-stylist-dock` and `data-stylist-screen` still exist ✓
- Live browser: UNEXECUTED.
- Staged by name only; nothing committed.

Proposed message: The stylist is a small Ask control on every page.

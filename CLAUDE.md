# Closet — Project Context for Claude

Standalone app. Shares nothing with any other repo. Do not import from,
reference, or reuse code outside this repository.

Read this file before doing anything. Follow the conventions strictly —
they are standing rules for every round, not one-time setup.

---

## Standing Conventions (never violate)

1. **RLS on every table from day one.** Every table has Row Level
   Security enabled and owner-scoped policies keyed on `auth.uid()`.
   No table ships without RLS. No policy is broader than owner-scoped
   unless a round explicitly calls for it.

2. **Never expose the service-role key.** The Supabase service-role key
   is server-only and must never reach the client bundle or any
   unauthenticated route. Client and browser code use only the
   publishable (anon) key. Server routes that use elevated privileges
   must authenticate the caller first.

3. **All schema changes are numbered SQL migrations.** Every schema
   change is a new numbered file under `supabase/migrations/`
   (`001_*.sql`, `002_*.sql`, ...). Never mutate schema ad hoc. Never
   `ALTER TABLE` per-import to add a field.

4. **Cache enriched API results in the DB.** Results from paid or slow
   external APIs (vision, stylist, enrichment) are cached in Postgres,
   not re-fetched. Enrichment writes back to the row.

5. **Flexible per-item fields go in a JSONB column.** Variable or
   per-item attributes live in a `JSONB` column (e.g. `attributes`),
   never as per-import `ALTER TABLE` schema churn. Promote a field to a
   real column only via a numbered migration when it becomes load-bearing.

6. **Never auto-commit.** Claude never runs `git commit`, `git push`, or
   any history-changing git command. Finish work, then present a Diff
   Review summary. Joe reviews and commits manually.

---

## PowerShell / Environment Rules (Windows)

- Windows, PowerShell 5.1. **One command per line** — no `&&` chaining.
- No Unix `rm -rf`. Use PowerShell-native (`Remove-Item -Recurse -Force`)
  or git-bash for multi-step shell work.
- Always install with `--legacy-peer-deps`.
- Branch is `main`.
- Any authored `.ps1` must be ASCII-only, saved UTF-8 with BOM, PS 5.1.

---

## Stack

- Next.js (App Router, React 19) + TypeScript + Tailwind.
- Supabase (Postgres + Auth + Storage) via **`@supabase/ssr`**
  (never `@supabase/auth-helpers` — deprecated).
- Anthropic Claude API (server-only) for vision + stylist routes.

### Supabase SSR wiring (from the official starter)

- Browser client: `lib/supabase/client.ts` (`createBrowserClient`).
- Server client: `lib/supabase/server.ts` (`createServerClient`, cookies).
- Session refresh: `proxy.ts` (Next middleware) → `lib/supabase/proxy.ts`
  `updateSession`. This also redirects unauthenticated users to
  `/auth/login` for any non-public path.

### Environment variables

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL (public).
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — publishable/anon key (public).
- `ANTHROPIC_API_KEY` — server-only. Never referenced in client code.
- `.env.local` is gitignored. `.env.example` lists every variable with
  no secret values and is committed. Never commit real secrets.

### Storage

- Private bucket `garments` (no public read). Access is owner-scoped via
  RLS policies on `storage.objects`.

---

## App Structure

- `/` — routes authenticated users to `/closet`, everyone else to
  `/auth/login`.
- `/auth/login` — clean Google sign-in.
- `/auth/callback` — OAuth code exchange, then redirect into the app.
- App shell (`app/(app)/`) — mobile-first, bottom tab bar:
  `/closet`, `/add`, `/stylist`.

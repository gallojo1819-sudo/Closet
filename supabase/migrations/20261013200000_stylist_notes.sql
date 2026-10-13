-- Stylist notes: what the user told the stylist, one row per statement.
-- Additive and idempotent. Touches no other table. Nothing here reads or writes closet_meta.
-- Does not run on Vercel: this folder is applied by hand in the Supabase SQL editor.
-- Do not apply it from the app. Production stays unchanged until someone runs this file.

create table if not exists public.stylist_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  text text not null check (length(text) between 1 and 400),
  kind text not null check (kind in ('never', 'lean')),
  topic text not null check (length(topic) between 1 and 80),
  source text not null check (source in ('stated', 'correction')),
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  superseded_by uuid references public.stylist_notes (id) on delete set null,
  -- A superseded_by without a superseded_at is a half-write. The reverse is allowed:
  -- deleting the newer note nulls superseded_by and the older one stays superseded.
  constraint stylist_notes_superseded_pair check (superseded_by is null or superseded_at is not null)
);

comment on table public.stylist_notes is
  'What the user told the stylist: a never or a lean on one topic. A newer note on the same topic supersedes the older one; the older row is kept. Never part of closet_meta.';

comment on column public.stylist_notes.kind is 'never: a rule. lean: a preference.';
comment on column public.stylist_notes.topic is 'What the note is about, normalised (a piece id, a category phrase, a colour, a habit).';
comment on column public.stylist_notes.source is 'stated: said outright. correction: said about a look the stylist had just shown.';

create index if not exists stylist_notes_user_active
  on public.stylist_notes (user_id, created_at desc)
  where superseded_at is null;

alter table public.stylist_notes enable row level security;
alter table public.stylist_notes force row level security;

-- Only the owner reads, adds, or deletes. Update is allowed on own rows so a newer note can
-- mark an older one superseded; the column grant below keeps text, kind, topic and source fixed.

drop policy if exists stylist_notes_select_own on public.stylist_notes;
create policy stylist_notes_select_own
  on public.stylist_notes
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists stylist_notes_insert_own on public.stylist_notes;
create policy stylist_notes_insert_own
  on public.stylist_notes
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists stylist_notes_delete_own on public.stylist_notes;
create policy stylist_notes_delete_own
  on public.stylist_notes
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists stylist_notes_supersede_own on public.stylist_notes;
create policy stylist_notes_supersede_own
  on public.stylist_notes
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.stylist_notes from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select, insert, delete on table public.stylist_notes to authenticated;
grant update (superseded_at, superseded_by) on table public.stylist_notes to authenticated;

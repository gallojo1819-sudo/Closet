-- Closet account: one row per user + private image bucket.
-- Joe: enable Apple + Email (magic link) in Supabase Auth.
-- Redirect URLs must include the Vercel origin (closet-ten-hazel) and localhost.

create table if not exists public.closet_meta (
  user_id uuid primary key references auth.users (id) on delete cascade,
  garments jsonb not null default '[]'::jsonb,
  looks jsonb not null default '[]'::jsonb,
  journal jsonb not null default '[]'::jsonb,
  avoid jsonb not null default '{}'::jsonb,
  drop jsonb,
  ref_photo boolean not null default false,
  v integer not null default 6,
  updated_at timestamptz not null default now()
);

comment on table public.closet_meta is
  'Account closet JSON. Local closet.v6 + IDB are a cache. Never treat a missing/empty row as a wipe of a non-empty phone.';

alter table public.closet_meta enable row level security;
alter table public.closet_meta force row level security;

drop policy if exists closet_meta_select_own on public.closet_meta;
create policy closet_meta_select_own
  on public.closet_meta
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists closet_meta_insert_own on public.closet_meta;
create policy closet_meta_insert_own
  on public.closet_meta
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists closet_meta_update_own on public.closet_meta;
create policy closet_meta_update_own
  on public.closet_meta
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists closet_meta_delete_own on public.closet_meta;
create policy closet_meta_delete_own
  on public.closet_meta
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.closet_meta to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'closet-images',
  'closet-images',
  false,
  10485760,
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Paths: {user_id}/{garmentId}/o.jpg|c.jpg|t.jpg and {user_id}/me/ref.jpg
-- Upsert needs INSERT + SELECT + UPDATE.

drop policy if exists closet_images_select_own on storage.objects;
create policy closet_images_select_own
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'closet-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists closet_images_insert_own on storage.objects;
create policy closet_images_insert_own
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'closet-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists closet_images_update_own on storage.objects;
create policy closet_images_update_own
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'closet-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'closet-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists closet_images_delete_own on storage.objects;
create policy closet_images_delete_own
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'closet-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

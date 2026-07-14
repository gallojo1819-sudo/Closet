-- 001_garments_storage.sql
--
-- Creates the private `garments` storage bucket and owner-scoped RLS policies
-- on storage.objects for it.
--
-- Notes:
--   * `storage.objects` already has Row Level Security ENABLED by Supabase, so
--     we do NOT enable it here (and cannot, without table ownership). We only
--     add policies.
--   * Every policy is scoped to the `authenticated` role and to rows where
--     bucket_id = 'garments' AND owner = auth.uid(), so a user can only touch
--     their own objects in this bucket.
--   * `drop policy if exists` precedes each `create policy` so this migration
--     is safely re-runnable.

-- Private bucket (public = false → no anonymous access to object URLs).
insert into storage.buckets (id, name, public)
values ('garments', 'garments', false)
on conflict (id) do nothing;

-- SELECT: owners can read their own garment objects.
drop policy if exists "garments owner select" on storage.objects;
create policy "garments owner select"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'garments' and owner = auth.uid());

-- INSERT: owners can upload objects into the garments bucket.
drop policy if exists "garments owner insert" on storage.objects;
create policy "garments owner insert"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'garments' and owner = auth.uid());

-- UPDATE: owners can modify their own garment objects.
drop policy if exists "garments owner update" on storage.objects;
create policy "garments owner update"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'garments' and owner = auth.uid())
  with check (bucket_id = 'garments' and owner = auth.uid());

-- DELETE: owners can delete their own garment objects.
drop policy if exists "garments owner delete" on storage.objects;
create policy "garments owner delete"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'garments' and owner = auth.uid());

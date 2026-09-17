-- closet-images: private, 15MB, jpeg/png/webp/heic/heif.
-- RLS: authenticated CRUD only in their own {auth.uid()}/ folder.
-- Idempotent. Joe can paste this in the SQL editor if CLI is not logged in.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'closet-images',
  'closet-images',
  false,
  15728640,
  array[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

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

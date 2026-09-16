-- Idempotent storage.objects policies for closet-images.
-- Same four as 20260916120000_closet_account.sql. Run if Joe skipped that file.

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

-- 005_product_identification.sql
--
-- Product identification: a garment's displayed image should be REAL — the
-- official manufacturer product image when we can find it, otherwise the user's
-- own photographed pixels (segmented, or an honest cropped photo). This
-- migration adds the columns that hold an identified product, and nothing else.
--
--  * These are real, load-bearing columns (queried, filtered, displayed), so
--    they are promoted out of the `attributes` JSONB per the standing rule.
--  * `brand` already exists from 002; only the missing product columns are added.
--  * image_source already allows 'official' (added in 004); no constraint change.
--  * garments already has RLS enabled with owner-scoped policies for every verb
--    (002). No new table, so no new policies are required.
--
-- All adds are `if not exists` so this migration is safely re-runnable and never
-- conflicts with a column an earlier round happened to add.

alter table garments
  add column if not exists product_name        text,
  add column if not exists retailer            text,
  add column if not exists retailer_product_id text,
  add column if not exists size                text,
  add column if not exists product_url         text,
  add column if not exists product_image_path  text,  -- {user_id}/products/{garment_id}.jpg in the private bucket
  add column if not exists brand_verified       boolean not null default false;

-- A partial index to make the "verified" closet filter cheap.
create index if not exists garments_user_verified_idx
  on garments (user_id) where brand_verified;

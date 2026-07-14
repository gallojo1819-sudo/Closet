-- 002_schema.sql
--
-- Core schema for the Closet app: seven tables plus Row Level Security.
--
-- Standing conventions honored here:
--   * RLS is ENABLED on every table with EXPLICIT owner-scoped policies for
--     select / insert / update / delete. A table with RLS on and zero policies
--     is deny-all and silently false-misses, so every verb is covered.
--   * Owner scoping is keyed on auth.uid(). Tables carrying user_id scope
--     directly; look_garments (no user_id) scopes through its parent look.
--   * Flexible per-item fields live in JSONB (attributes, unknowns, payload).
--   * `drop policy if exists` precedes each `create policy` so this migration
--     is safely re-runnable.
--
-- Storage: the `garments` bucket and its policies were created in
-- 001_garments_storage.sql. This migration does NOT recreate the bucket. It
-- DOES re-scope the bucket's object policies onto our path convention
-- ({user_id}/...) — see the STORAGE POLICY FIX section at the bottom.

-- ---------------------------------------------------------------------------
-- 1. garments
-- ---------------------------------------------------------------------------
create table garments (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  image_path            text not null,          -- original uploaded photo path in `garments` bucket
  thumb_path            text,                   -- generated thumbnail path
  cutout_path           text,                   -- transparent RGBA catalog PNG (filled by cutout worker)
  status                text not null default 'pending'
                          check (status in ('pending','tagged','cutout_ready','cutout_failed','hold')),
                          -- pending = uploaded, awaiting vision; tagged = attributes set, cropped-photo display;
                          -- cutout_ready = catalog PNG done; cutout_failed = generation/QA failed, retryable;
                          -- hold = too obscured to recover, kept but flagged
  source_bbox           jsonb,                  -- normalized [left,top,right,bottom] floats in the source photo
  category              text not null,          -- top|bottom|outerwear|dress|footwear|accessory|other
  subtype               text,
  colors                text[] default '{}',
  pattern               text default 'solid',
  material              text,
  brand                 text,
  formality             int check (formality between 1 and 5),
  warmth                int check (warmth between 1 and 5),
  seasons               text[] default '{}',
  notes                 text,
  unknowns              jsonb default '[]'::jsonb,   -- attributes vision could NOT verify (never guessed)
  possible_duplicate_of uuid references garments(id) on delete set null,
                          -- similarity flag only; merge is ALWAYS a manual user action, never automatic
  attributes            jsonb default '{}'::jsonb,
  created_at            timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- 2. looks
-- ---------------------------------------------------------------------------
create table looks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text,
  occasion   text,
  source     text check (source in ('ai','manual')) default 'manual',
  notes      text,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- 3. look_garments  (join table; no user_id — scoped through parent look)
-- ---------------------------------------------------------------------------
create table look_garments (
  look_id    uuid references looks(id) on delete cascade,
  garment_id uuid references garments(id) on delete cascade,
  role       text,
  position   int,
  primary key (look_id, garment_id)
);

-- ---------------------------------------------------------------------------
-- 4. wear_log
-- ---------------------------------------------------------------------------
create table wear_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  garment_id uuid not null references garments(id) on delete cascade,
  worn_on    date not null default current_date,
  occasion   text,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- 5. enrichment_cache
-- ---------------------------------------------------------------------------
create table enrichment_cache (
  image_hash   text primary key,               -- sha256 of uploaded bytes
  user_id      uuid references auth.users(id) on delete cascade,
  raw_response jsonb not null,                  -- full vision manifest for the photo; re-process = free
  created_at   timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- 6. processing_jobs
-- ---------------------------------------------------------------------------
create table processing_jobs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  garment_id uuid references garments(id) on delete cascade,
  kind       text not null check (kind in ('vision_inventory','cutout_generate')),
  status     text not null default 'queued'
               check (status in ('queued','running','done','failed')),
  attempts   int not null default 0,
  last_error text,
  payload    jsonb default '{}'::jsonb,         -- crop path, chroma_key, prompt used, etc.
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- 7. shop_recs
-- ---------------------------------------------------------------------------
create table shop_recs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  source            text not null check (source in ('stylist_gap','wardrobe_analysis','manual_ask')),
  gap_description   text,
  product_name      text not null,
  retailer          text,
  price             text,                       -- text, not numeric: search-result prices aren't verified
  url               text,
  rationale         text,
  cited_garment_ids uuid[] default '{}',        -- every "pairs with" claim must cite real garment ids
  status            text not null default 'suggested'
                      check (status in ('suggested','saved','dismissed','purchased')),
  created_at        timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index garments_user_category_idx      on garments (user_id, category);
create index garments_user_status_idx        on garments (user_id, status);
create index wear_log_user_garment_worn_idx  on wear_log (user_id, garment_id, worn_on);
create index look_garments_garment_idx       on look_garments (garment_id);
create index processing_jobs_user_status_idx on processing_jobs (user_id, status);
create index shop_recs_user_status_idx       on shop_recs (user_id, status);

-- ===========================================================================
-- Row Level Security
--
-- Every table below: RLS ENABLED + one explicit policy per verb. No table is
-- left policy-less (which would be deny-all-by-omission). All policies are
-- scoped to the `authenticated` role, matching 001's convention.
-- ===========================================================================

-- --- garments --------------------------------------------------------------
alter table garments enable row level security;

drop policy if exists "garments owner select" on garments;
create policy "garments owner select" on garments
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "garments owner insert" on garments;
create policy "garments owner insert" on garments
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "garments owner update" on garments;
create policy "garments owner update" on garments
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "garments owner delete" on garments;
create policy "garments owner delete" on garments
  for delete to authenticated using (user_id = auth.uid());

-- --- looks ------------------------------------------------------------------
alter table looks enable row level security;

drop policy if exists "looks owner select" on looks;
create policy "looks owner select" on looks
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "looks owner insert" on looks;
create policy "looks owner insert" on looks
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "looks owner update" on looks;
create policy "looks owner update" on looks
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "looks owner delete" on looks;
create policy "looks owner delete" on looks
  for delete to authenticated using (user_id = auth.uid());

-- --- look_garments  (scoped through parent look) ---------------------------
alter table look_garments enable row level security;

drop policy if exists "look_garments owner select" on look_garments;
create policy "look_garments owner select" on look_garments
  for select to authenticated
  using (exists (select 1 from looks
                 where looks.id = look_garments.look_id
                   and looks.user_id = auth.uid()));

drop policy if exists "look_garments owner insert" on look_garments;
create policy "look_garments owner insert" on look_garments
  for insert to authenticated
  with check (exists (select 1 from looks
                      where looks.id = look_garments.look_id
                        and looks.user_id = auth.uid()));

drop policy if exists "look_garments owner update" on look_garments;
create policy "look_garments owner update" on look_garments
  for update to authenticated
  using (exists (select 1 from looks
                 where looks.id = look_garments.look_id
                   and looks.user_id = auth.uid()))
  with check (exists (select 1 from looks
                      where looks.id = look_garments.look_id
                        and looks.user_id = auth.uid()));

drop policy if exists "look_garments owner delete" on look_garments;
create policy "look_garments owner delete" on look_garments
  for delete to authenticated
  using (exists (select 1 from looks
                 where looks.id = look_garments.look_id
                   and looks.user_id = auth.uid()));

-- --- wear_log ---------------------------------------------------------------
alter table wear_log enable row level security;

drop policy if exists "wear_log owner select" on wear_log;
create policy "wear_log owner select" on wear_log
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "wear_log owner insert" on wear_log;
create policy "wear_log owner insert" on wear_log
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "wear_log owner update" on wear_log;
create policy "wear_log owner update" on wear_log
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "wear_log owner delete" on wear_log;
create policy "wear_log owner delete" on wear_log
  for delete to authenticated using (user_id = auth.uid());

-- --- enrichment_cache -------------------------------------------------------
alter table enrichment_cache enable row level security;

drop policy if exists "enrichment_cache owner select" on enrichment_cache;
create policy "enrichment_cache owner select" on enrichment_cache
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "enrichment_cache owner insert" on enrichment_cache;
create policy "enrichment_cache owner insert" on enrichment_cache
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "enrichment_cache owner update" on enrichment_cache;
create policy "enrichment_cache owner update" on enrichment_cache
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "enrichment_cache owner delete" on enrichment_cache;
create policy "enrichment_cache owner delete" on enrichment_cache
  for delete to authenticated using (user_id = auth.uid());

-- --- processing_jobs --------------------------------------------------------
alter table processing_jobs enable row level security;

drop policy if exists "processing_jobs owner select" on processing_jobs;
create policy "processing_jobs owner select" on processing_jobs
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "processing_jobs owner insert" on processing_jobs;
create policy "processing_jobs owner insert" on processing_jobs
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "processing_jobs owner update" on processing_jobs;
create policy "processing_jobs owner update" on processing_jobs
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "processing_jobs owner delete" on processing_jobs;
create policy "processing_jobs owner delete" on processing_jobs
  for delete to authenticated using (user_id = auth.uid());

-- --- shop_recs --------------------------------------------------------------
alter table shop_recs enable row level security;

drop policy if exists "shop_recs owner select" on shop_recs;
create policy "shop_recs owner select" on shop_recs
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "shop_recs owner insert" on shop_recs;
create policy "shop_recs owner insert" on shop_recs
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "shop_recs owner update" on shop_recs;
create policy "shop_recs owner update" on shop_recs
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "shop_recs owner delete" on shop_recs;
create policy "shop_recs owner delete" on shop_recs
  for delete to authenticated using (user_id = auth.uid());

-- ===========================================================================
-- STORAGE POLICY FIX
--
-- 001_garments_storage.sql scoped the `garments` bucket policies by
-- `owner = auth.uid()`. Our object path convention is:
--     {user_id}/originals/{garment_id}.{ext}
--     {user_id}/thumbs/{garment_id}.jpg
--     {user_id}/cutouts/{garment_id}.png
-- i.e. the FIRST path segment is the owner's user_id. We re-scope the policies
-- onto that path prefix using (storage.foldername(name))[1], which returns the
-- first folder in the object path. This makes ownership follow the path
-- convention the app writes to, and blocks a user from writing an object into
-- another user's {user_id}/ prefix (which `owner`-only scoping allowed).
-- ===========================================================================

drop policy if exists "garments owner select" on storage.objects;
create policy "garments owner select"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'garments'
         and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "garments owner insert" on storage.objects;
create policy "garments owner insert"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'garments'
              and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "garments owner update" on storage.objects;
create policy "garments owner update"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'garments'
         and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'garments'
              and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "garments owner delete" on storage.objects;
create policy "garments owner delete"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'garments'
         and (storage.foldername(name))[1] = auth.uid()::text);

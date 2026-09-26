-- Phase 0. New row tables beside closet_meta.
-- Does not drop closet_meta. Does not alter public.garments (Gmail island, 31 rows).
-- public.wear_log already FKs to public.garments and stays. The new log is wear_log_v2.

create table if not exists public.closet_meta_snapshot (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  taken_at timestamptz not null default now(),
  payload jsonb not null,
  sha256 text not null,
  unique (user_id, sha256)
);

create index if not exists closet_meta_snapshot_user_taken_idx
  on public.closet_meta_snapshot (user_id, taken_at desc);

create table if not exists public.garments_v2 (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  legacy_id text not null,
  status text not null default 'in_closet',
  name text not null default '',
  category text not null default 'other',
  subcategory text not null default '',
  colors text[] not null default '{}',
  pattern text,
  fabric text not null default '',
  weight text,
  formality integer,
  warmth integer,
  seasons text[] not null default '{}',
  occasions text[] not null default '{}',
  house_fit jsonb not null default '{}'::jsonb,
  fit text,
  tuck text,
  brand text not null default '',
  notes text not null default '',
  paid_cents integer,
  image_path text,
  cutout_path text,
  thumb_path text,
  image_source text,
  phash text,
  ai_raw jsonb,
  ai_confidence jsonb,
  version integer not null default 1,
  deleted_at timestamptz,
  unique (user_id, legacy_id)
);

create index if not exists garments_v2_user_status_idx
  on public.garments_v2 (user_id, status);

create table if not exists public.outfits_v2 (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  legacy_id text not null,
  name text not null default '',
  occasion text not null default '',
  source text not null default 'ai',
  recipe_id text,
  lookbook boolean not null default false,
  version integer not null default 1,
  created_at timestamptz,
  unique (user_id, legacy_id)
);

create index if not exists outfits_v2_user_idx
  on public.outfits_v2 (user_id, legacy_id);

create table if not exists public.outfit_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  outfit_id uuid not null references public.outfits_v2 (id) on delete cascade,
  garment_id uuid not null references public.garments_v2 (id) on delete cascade,
  slot text not null,
  position integer not null default 0,
  unique (outfit_id, garment_id),
  constraint outfit_items_slot_chk check (
    slot = any (array['top', 'bottom', 'footwear', 'outer', 'accessory', 'mid'])
  )
);

create index if not exists outfit_items_user_idx
  on public.outfit_items (user_id, outfit_id);

create table if not exists public.wear_log_v2 (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  garment_id uuid not null references public.garments_v2 (id) on delete cascade,
  worn_on date not null,
  occasion text,
  outfit_id uuid references public.outfits_v2 (id) on delete set null,
  unique (user_id, garment_id, worn_on)
);

create index if not exists wear_log_v2_user_day_idx
  on public.wear_log_v2 (user_id, worn_on);

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  garment_id uuid references public.garments_v2 (id) on delete cascade,
  outfit_id uuid references public.outfits_v2 (id) on delete set null,
  kind text not null,
  occurred_on date,
  source text,
  created_at timestamptz not null default now(),
  constraint feedback_kind_chk check (
    kind = any (array['wear', 'skip', 'like', 'never', 'swap_out'])
  )
);

create index if not exists feedback_user_kind_idx
  on public.feedback (user_id, kind);

create table if not exists public.ingest_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  garment_id uuid references public.garments_v2 (id) on delete set null,
  status text not null default 'queued',
  kind text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ingest_jobs_user_status_idx
  on public.ingest_jobs (user_id, status);

alter table public.closet_meta_snapshot enable row level security;
alter table public.closet_meta_snapshot force row level security;
alter table public.garments_v2 enable row level security;
alter table public.garments_v2 force row level security;
alter table public.outfits_v2 enable row level security;
alter table public.outfits_v2 force row level security;
alter table public.outfit_items enable row level security;
alter table public.outfit_items force row level security;
alter table public.wear_log_v2 enable row level security;
alter table public.wear_log_v2 force row level security;
alter table public.feedback enable row level security;
alter table public.feedback force row level security;
alter table public.ingest_jobs enable row level security;
alter table public.ingest_jobs force row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'closet_meta_snapshot',
    'garments_v2',
    'outfits_v2',
    'outfit_items',
    'wear_log_v2',
    'feedback',
    'ingest_jobs'
  ]
  loop
    execute format('drop policy if exists %I_select_own on public.%I', t, t);
    execute format(
      'create policy %I_select_own on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      t, t
    );
    execute format('drop policy if exists %I_insert_own on public.%I', t, t);
    execute format(
      'create policy %I_insert_own on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',
      t, t
    );
    execute format('drop policy if exists %I_update_own on public.%I', t, t);
    execute format(
      'create policy %I_update_own on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      t, t
    );
    execute format('drop policy if exists %I_delete_own on public.%I', t, t);
    execute format(
      'create policy %I_delete_own on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',
      t, t
    );
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

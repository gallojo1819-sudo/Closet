-- Phase 0 loader. Service role / owner only. Does not modify closet_meta or public.garments.
-- Slot rules match src/lib/data/migrate.ts outfitSlot.

create or replace function public.phase0_outfit_slot(p_name text, p_subtype text, p_category text)
returns text
language plpgsql
immutable
as $$
declare
  blob text := lower(coalesce(p_subtype, '') || ' ' || coalesce(p_name, ''));
  footwear boolean;
  bottom boolean;
  hoodie boolean;
  is_top boolean;
  is_outer boolean;
  mid boolean;
begin
  hoodie := blob ~ '(hoodies?|sweatshirts?)' or blob ~ 'graphic[[:space:]]*knits?';
  mid := blob ~ '(cardigan|fleece|quarter[- ]?zip|zip[- ]?(up)?[[:space:]]*(sweater|knit))';
  if mid and not hoodie then
    return 'mid';
  end if;
  footwear := blob ~ '(shoes?|loafers?|mules?|sneakers?|boots?|booties)';
  bottom := blob ~ '(pants?|chinos?|jeans?|trousers?|shorts?)';
  is_top := hoodie or blob ~ '(t-shirts?|tees?|shirts?|oxfords?|polos?|knits?|sweaters?|rugbys?|cardigans?|jumpers?|pullovers?|crewnecks?|henleys?|cable[- ]?knits?|fleece)';
  is_outer := blob ~ '(jackets?|coats?|overshirts?|blazers?|bombers?|parkas?|trench|puffers?|windbreakers?|anoraks?|shearlings?)';
  if footwear and not bottom then return 'footwear'; end if;
  if bottom then return 'bottom'; end if;
  if hoodie then return 'top'; end if;
  if is_top then return 'top'; end if;
  if is_outer then return 'outer'; end if;
  if p_category = 'outerwear' then return 'outer'; end if;
  if p_category in ('top', 'bottom', 'footwear', 'accessory') then return p_category; end if;
  if p_category = 'dress' then return 'top'; end if;
  return null;
end;
$$;

create or replace function public.phase0_load_joe()
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  uid uuid := '5d458205-b3ca-433a-8b75-4c0a2bbfa1ee';
  live_sha text;
  snap_sha text;
  misses text;
  g_count int;
  o_count int;
  d_count int;
  w_count int;
  s_count int;
  gmail int;
  report jsonb;
begin
  select encode(extensions.digest(convert_to(to_jsonb(c)::text, 'UTF8'), 'sha256'), 'hex')
    into live_sha
  from public.closet_meta c
  where c.user_id = uid;
  select s.sha256 into snap_sha
  from public.closet_meta_snapshot s
  where s.user_id = uid
  order by s.taken_at desc
  limit 1;
  if live_sha is null or snap_sha is null or live_sha <> snap_sha then
    raise exception 'phase0 stop: closet_meta hash does not match snapshot';
  end if;

  create temp table phase0_live on commit drop as
  select
    g->>'id' as legacy_id,
    coalesce(g->>'name', '') as name,
    coalesce(g->>'category', 'other') as category,
    coalesce(g->>'subtype', '') as subcategory,
    case when jsonb_typeof(g->'colors') = 'array'
      then array(select jsonb_array_elements_text(g->'colors')) else '{}'::text[] end as colors,
    coalesce(g->>'material', '') as fabric,
    case when (g->>'formality') ~ '^[0-9]+$' then (g->>'formality')::int else null end as formality,
    case when (g->>'warmth') ~ '^[0-9]+$' then (g->>'warmth')::int else null end as warmth,
    case when jsonb_typeof(g->'seasons') = 'array'
      then array(select jsonb_array_elements_text(g->'seasons')) else '{}'::text[] end as seasons,
    g->>'fit' as fit,
    g->>'tuck' as tuck,
    coalesce(g->>'brand', '') as brand,
    coalesce(g->>'notes', '') as notes,
    case when g->>'imageSrc' like 'sb:%' then substring(g->>'imageSrc' from 4) else null end as image_path,
    case when g->>'cutoutSrc' like 'sb:%' then substring(g->>'cutoutSrc' from 4) else null end as cutout_path,
    regexp_replace(
      case
        when g->>'imageSrc' like 'sb:%' then substring(g->>'imageSrc' from 4)
        when g->>'cutoutSrc' like 'sb:%' then substring(g->>'cutoutSrc' from 4)
        else null
      end,
      '/[oct]\.jpg$',
      '/t.jpg'
    ) as thumb_path,
    g->>'imageSource' as image_source,
    g as ai_raw,
    case when jsonb_typeof(g->'wornOn') = 'array' then g->'wornOn' else '[]'::jsonb end as worn_on
  from public.closet_meta c,
       lateral jsonb_array_elements(c.garments) g
  where c.user_id = uid
    and coalesce(g->>'archived', 'false') <> 'true'
    and coalesce(g->>'demo', 'false') <> 'true'
    and coalesce(g->>'id', '') <> '';

  select string_agg(p.path, ', ')
    into misses
  from (
    select image_path as path from phase0_live
    union select cutout_path from phase0_live
    union select thumb_path from phase0_live
  ) p
  where p.path is null
     or not exists (
       select 1 from storage.objects o
       where o.bucket_id = 'closet-images' and o.name = p.path
     );
  if misses is not null then
    raise exception 'phase0 stop: image HEAD failure %', misses;
  end if;

  if (select count(*) from phase0_live) <> 143 then
    raise exception 'phase0 stop: garments % <> 143', (select count(*) from phase0_live);
  end if;

  insert into public.garments_v2 (
    user_id, legacy_id, status, name, category, subcategory, colors, pattern, fabric, weight,
    formality, warmth, seasons, occasions, house_fit, fit, tuck, brand, notes, paid_cents,
    image_path, cutout_path, thumb_path, image_source, phash, ai_raw, ai_confidence, version, deleted_at
  )
  select
    uid, legacy_id, 'in_closet', name, category, subcategory, colors, null, fabric, null,
    formality, warmth, seasons, '{}', '{}'::jsonb, fit, tuck, brand, notes, null,
    image_path, cutout_path, thumb_path, image_source, null, ai_raw, null, 1, null
  from phase0_live
  on conflict (user_id, legacy_id) do update set
    name = excluded.name,
    category = excluded.category,
    subcategory = excluded.subcategory,
    colors = excluded.colors,
    fabric = excluded.fabric,
    formality = excluded.formality,
    warmth = excluded.warmth,
    seasons = excluded.seasons,
    fit = excluded.fit,
    tuck = excluded.tuck,
    brand = excluded.brand,
    notes = excluded.notes,
    image_path = excluded.image_path,
    cutout_path = excluded.cutout_path,
    thumb_path = excluded.thumb_path,
    image_source = excluded.image_source,
    ai_raw = excluded.ai_raw,
    version = public.garments_v2.version + 1
  where public.garments_v2.name is distinct from excluded.name
     or public.garments_v2.category is distinct from excluded.category
     or public.garments_v2.image_path is distinct from excluded.image_path
     or public.garments_v2.ai_raw is distinct from excluded.ai_raw;

  create temp table phase0_looks on commit drop as
  select
    l->>'id' as legacy_id,
    coalesce(l->>'name', '') as name,
    coalesce(l->>'occasion', '') as occasion,
    coalesce(l->>'source', 'ai') as source,
    l->>'recipeId' as recipe_id,
    coalesce(l->>'lookbook', 'false') = 'true' as lookbook,
    l->>'createdAt' as created_at,
    l->'garmentIds' as ids,
    (
      select count(distinct gid)
      from jsonb_array_elements_text(coalesce(l->'garmentIds', '[]'::jsonb)) gid
      where gid in (select legacy_id from phase0_live)
    ) as resolved,
    (
      select coalesce(jsonb_agg(distinct gid), '[]'::jsonb)
      from jsonb_array_elements_text(coalesce(l->'garmentIds', '[]'::jsonb)) gid
      where gid not in (select legacy_id from phase0_live)
    ) as missing_ids
  from public.closet_meta c,
       lateral jsonb_array_elements(c.looks) l
  where c.user_id = uid;

  if (select count(*) from phase0_looks) <> 598 then
    raise exception 'phase0 stop: looks % <> 598', (select count(*) from phase0_looks);
  end if;

  insert into public.outfits_v2 (
    user_id, legacy_id, name, occasion, source, recipe_id, lookbook, version, created_at
  )
  select
    uid, legacy_id, name, occasion, source, recipe_id, lookbook, 1,
    case when created_at ~ '^[0-9]{4}-' then created_at::timestamptz else null end
  from phase0_looks
  where resolved >= 2 and legacy_id is not null
  on conflict (user_id, legacy_id) do update set
    name = excluded.name,
    occasion = excluded.occasion,
    source = excluded.source,
    recipe_id = excluded.recipe_id,
    lookbook = excluded.lookbook,
    version = public.outfits_v2.version + 1
  where public.outfits_v2.name is distinct from excluded.name
     or public.outfits_v2.occasion is distinct from excluded.occasion;

  delete from public.outfit_items i
  using public.outfits_v2 o
  where i.outfit_id = o.id and o.user_id = uid;

  insert into public.outfit_items (user_id, outfit_id, garment_id, slot, position)
  select uid, o.id, g.id, s.slot, ids.position
  from phase0_looks l
  join public.outfits_v2 o on o.user_id = uid and o.legacy_id = l.legacy_id
  join lateral (
    select gid, min(ord)::int as position
    from jsonb_array_elements_text(l.ids) with ordinality as t(gid, ord)
    group by gid
  ) ids on true
  join phase0_live live on live.legacy_id = ids.gid
  join public.garments_v2 g on g.user_id = uid and g.legacy_id = live.legacy_id
  join lateral (
    select public.phase0_outfit_slot(live.name, live.subcategory, live.category) as slot
  ) s on s.slot is not null
  where l.resolved >= 2;

  delete from public.wear_log_v2 w
  using public.garments_v2 g
  where w.garment_id = g.id and g.user_id = uid;

  insert into public.wear_log_v2 (user_id, garment_id, worn_on, occasion)
  select distinct on (g.id, days.day) uid, g.id, days.day::date, days.occ
  from (
    select live.legacy_id, jsonb_array_elements_text(live.worn_on) as day, null::text as occ
    from phase0_live live
    union
    select gid, j->>'date', j->>'occasion'
    from public.closet_meta c,
         lateral jsonb_array_elements(c.journal) j,
         lateral jsonb_array_elements_text(coalesce(j->'garmentIds', '[]'::jsonb)) gid
    where c.user_id = uid and j->>'verdict' = 'worn'
  ) days
  join public.garments_v2 g on g.user_id = uid and g.legacy_id = days.legacy_id
  where days.day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  order by g.id, days.day, days.occ nulls last
  on conflict (user_id, garment_id, worn_on) do nothing;

  delete from public.feedback f
  where f.user_id = uid and f.source in ('journal', 'avoid');

  insert into public.feedback (user_id, garment_id, kind, occurred_on, source)
  select uid, g.id, 'skip',
    case when j.day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then j.day::date else null end,
    'journal'
  from (
    select distinct gid, j->>'date' as day
    from public.closet_meta c,
         lateral jsonb_array_elements(c.journal) j,
         lateral jsonb_array_elements_text(coalesce(j->'garmentIds', '[]'::jsonb)) gid
    where c.user_id = uid and j->>'verdict' = 'skipped'
  ) j
  join public.garments_v2 g on g.user_id = uid and g.legacy_id = j.gid;

  insert into public.feedback (user_id, garment_id, kind, occurred_on, source)
  select uid, g.id, 'skip', null, 'avoid'
  from public.closet_meta c,
       lateral jsonb_object_keys(c.avoid) aid
  join public.garments_v2 g on g.user_id = uid and g.legacy_id = aid
  where c.user_id = uid;

  select count(*) into g_count from public.garments_v2 where user_id = uid and deleted_at is null;
  select count(*) into o_count from public.outfits_v2 where user_id = uid;
  select count(*) into d_count from phase0_looks where resolved < 2;
  select count(*) into w_count from public.wear_log_v2 w
    join public.garments_v2 g on g.id = w.garment_id where g.user_id = uid;
  select count(*) into s_count from public.feedback where user_id = uid and kind = 'skip';
  select count(*) into gmail from public.garments;

  if g_count <> 143 then
    raise exception 'phase0 stop: garments_v2 % <> 143', g_count;
  end if;
  if o_count + d_count <> 598 then
    raise exception 'phase0 stop: outfits % + dropped % <> 598', o_count, d_count;
  end if;
  if gmail <> 31 then
    raise exception 'phase0 stop: gmail garments % <> 31', gmail;
  end if;

  select encode(extensions.digest(convert_to(to_jsonb(c)::text, 'UTF8'), 'sha256'), 'hex')
    into live_sha
  from public.closet_meta c
  where c.user_id = uid;
  if live_sha is distinct from snap_sha then
    raise exception 'phase0 stop: closet_meta changed during load';
  end if;

  report := jsonb_build_object(
    'garments_v2', g_count,
    'outfits_migrated', o_count,
    'looks_dropped', d_count,
    'dropped', coalesce((
      select jsonb_agg(jsonb_build_object('id', legacy_id, 'missingIds', missing_ids))
      from phase0_looks where resolved < 2
    ), '[]'::jsonb),
    'wear_rows', w_count,
    'skip_rows', s_count,
    'image_head_failures', 0,
    'gmail_garments', gmail,
    'snapshot_sha', snap_sha
  );
  return report;
end;
$$;

revoke all on function public.phase0_load_joe() from public;
revoke all on function public.phase0_outfit_slot(text, text, text) from public;
grant execute on function public.phase0_outfit_slot(text, text, text) to postgres;
grant execute on function public.phase0_load_joe() to postgres;

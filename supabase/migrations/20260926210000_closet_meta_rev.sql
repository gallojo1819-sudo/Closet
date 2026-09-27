-- Closet meta conflict token + durable tombstones.
-- Additive and idempotent. Does not rewrite garments, looks, or any other table.
-- Does not run on Vercel: this folder is applied by hand in the Supabase SQL editor.
-- Do not apply it from the app. Production stays unchanged until someone runs this file.

alter table public.closet_meta
  add column if not exists rev bigint not null default 0;

alter table public.closet_meta
  add column if not exists deleted_garments jsonb not null default '[]'::jsonb;

alter table public.closet_meta
  add column if not exists deleted_looks jsonb not null default '[]'::jsonb;

comment on column public.closet_meta.rev is
  'Monotonic write counter. v stays 6 (schema). Clients compare-and-swap on rev.';

comment on column public.closet_meta.deleted_garments is
  'Garment ids the user deleted. Absence from garments is not a delete.';

comment on column public.closet_meta.deleted_looks is
  'Look ids the user deleted. The critic must not add ids here.';

create or replace function public.closet_meta_push(
  p_expected_rev bigint,
  p_garments jsonb,
  p_looks jsonb,
  p_journal jsonb,
  p_avoid jsonb,
  p_drop jsonb,
  p_ref_photo boolean,
  p_deleted_garments jsonb,
  p_deleted_looks jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  cur public.closet_meta%rowtype;
  new_rev bigint;
  new_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into cur
  from public.closet_meta
  where user_id = auth.uid()
  for update;

  if not found then
    new_at := now();
    begin
      insert into public.closet_meta (
        user_id, garments, looks, journal, avoid, drop, ref_photo, v, rev,
        deleted_garments, deleted_looks, updated_at
      ) values (
        auth.uid(),
        coalesce(p_garments, '[]'::jsonb),
        coalesce(p_looks, '[]'::jsonb),
        coalesce(p_journal, '[]'::jsonb),
        coalesce(p_avoid, '{}'::jsonb),
        p_drop,
        coalesce(p_ref_photo, false),
        6,
        1,
        coalesce(p_deleted_garments, '[]'::jsonb),
        coalesce(p_deleted_looks, '[]'::jsonb),
        new_at
      );
    exception
      when unique_violation then
        return jsonb_build_object('ok', false, 'conflict', true);
    end;
    return jsonb_build_object('ok', true, 'rev', 1, 'updated_at', new_at);
  end if;

  if cur.rev is distinct from p_expected_rev then
    return jsonb_build_object(
      'ok', false,
      'conflict', true,
      'rev', cur.rev,
      'updated_at', cur.updated_at
    );
  end if;

  new_rev := cur.rev + 1;
  new_at := now();
  update public.closet_meta set
    garments = coalesce(p_garments, '[]'::jsonb),
    looks = coalesce(p_looks, '[]'::jsonb),
    journal = coalesce(p_journal, '[]'::jsonb),
    avoid = coalesce(p_avoid, '{}'::jsonb),
    drop = p_drop,
    ref_photo = coalesce(p_ref_photo, false),
    v = 6,
    rev = new_rev,
    deleted_garments = coalesce(p_deleted_garments, '[]'::jsonb),
    deleted_looks = coalesce(p_deleted_looks, '[]'::jsonb),
    updated_at = new_at
  where user_id = auth.uid();

  return jsonb_build_object('ok', true, 'rev', new_rev, 'updated_at', new_at);
end;
$$;

revoke all on function public.closet_meta_push(bigint, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, jsonb, jsonb) from public;
grant execute on function public.closet_meta_push(bigint, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, jsonb, jsonb) to authenticated;

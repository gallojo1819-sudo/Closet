-- Matches the BEFORE UPDATE trigger already live in production.
-- Re-running replaces the same function and trigger; it does not add a second one.
-- Do not apply this file to production from the agent.

create or replace function public.closet_meta_require_rev_bump()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.rev is distinct from old.rev + 1 then
    raise exception 'closet_meta: stale write refused (rev must be %, got %)',
      old.rev + 1, new.rev
      using errcode = '40001';
  end if;
  return new;
end;
$$;

drop trigger if exists closet_meta_require_rev_bump on public.closet_meta;
create trigger closet_meta_require_rev_bump
  before update on public.closet_meta
  for each row
  execute function public.closet_meta_require_rev_bump();

drop trigger if exists closet_meta_rev_update on public.closet_meta;
drop trigger if exists closet_meta_rev_insert on public.closet_meta;
drop function if exists public.closet_meta_rev_guard();

-- Separate from the production update trigger. A raw insert cannot pick its own rev.
create or replace function public.closet_meta_force_rev_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.rev := 1;
  return new;
end;
$$;

drop trigger if exists closet_meta_force_rev_insert on public.closet_meta;
create trigger closet_meta_force_rev_insert
  before insert on public.closet_meta
  for each row
  execute function public.closet_meta_force_rev_insert();

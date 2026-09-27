-- Old app bundles still have UPDATE on closet_meta and write v = 6 without
-- bumping rev. Reject those writes. closet_meta_push already sets rev = old + 1.
-- Do not apply this file to production from the agent.

create or replace function public.closet_meta_rev_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.rev := 1;
    return new;
  end if;
  if new.rev is distinct from old.rev + 1 then
    raise exception 'closet_meta rev must increase by 1 (old %, new %)', old.rev, new.rev;
  end if;
  return new;
end;
$$;

drop trigger if exists closet_meta_rev_insert on public.closet_meta;
create trigger closet_meta_rev_insert
  before insert on public.closet_meta
  for each row
  execute function public.closet_meta_rev_guard();

drop trigger if exists closet_meta_rev_update on public.closet_meta;
create trigger closet_meta_rev_update
  before update on public.closet_meta
  for each row
  execute function public.closet_meta_rev_guard();

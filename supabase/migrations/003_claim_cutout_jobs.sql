-- 003_claim_cutout_jobs.sql
--
-- Atomic claim for the cutout worker queue. A single UPDATE ... IN (SELECT ...
-- FOR UPDATE SKIP LOCKED) flips up to `max_jobs` of the caller's queued
-- cutout jobs to 'running' and returns them. Because the select-and-flip is one
-- statement with row locks, two concurrent callers can never claim the same
-- job (the loser skips the locked rows).
--
-- SECURITY INVOKER (the default): the function runs with the caller's
-- privileges, so RLS on processing_jobs still applies and auth.uid() resolves
-- to the caller. No service-role key is involved. The explicit user_id filter
-- is belt-and-suspenders on top of the owner-scoped RLS policies.

create or replace function public.claim_cutout_jobs(max_jobs int)
returns setof public.processing_jobs
language plpgsql
security invoker
as $$
begin
  return query
  update public.processing_jobs j
  set status = 'running', updated_at = now()
  where j.id in (
    select c.id
    from public.processing_jobs c
    where c.user_id = auth.uid()
      and c.kind = 'cutout_generate'
      and c.status = 'queued'
    order by c.created_at
    limit greatest(max_jobs, 0)
    for update skip locked
  )
  returning j.*;
end;
$$;

grant execute on function public.claim_cutout_jobs(int) to authenticated;

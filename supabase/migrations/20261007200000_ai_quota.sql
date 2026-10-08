-- Per-account AI quota. One row per user, bucket and window.
-- Additive and idempotent. Touches no other table.
-- Does not run on Vercel: this folder is applied by hand in the Supabase SQL editor.
-- Do not apply it from the app. Production stays unchanged until someone runs this file.

create table if not exists public.ai_quota (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  used int not null default 0,
  primary key (user_id, bucket, window_start)
);

comment on table public.ai_quota is
  'AI calls taken per user, bucket and window. Written only by ai_quota_take. No client policy.';

alter table public.ai_quota enable row level security;
alter table public.ai_quota force row level security;
revoke all on table public.ai_quota from public, anon, authenticated;

-- One take. Counts the call in the window holding now() and says whether it was within the limit.
-- Runs as definer so the table needs no client policy; auth.uid() scopes every row.
create or replace function public.ai_quota_take(
  p_bucket text,
  p_window_seconds int,
  p_limit int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  win timestamptz;
  n int;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'reason', 'signed_out');
  end if;
  if p_window_seconds is null or p_window_seconds < 60 then
    p_window_seconds := 3600;
  end if;
  if p_bucket is null or length(p_bucket) = 0 or length(p_bucket) > 32 then
    p_bucket := 'chat';
  end if;

  win := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.ai_quota (user_id, bucket, window_start, used)
  values (uid, p_bucket, win, 1)
  on conflict (user_id, bucket, window_start)
  do update set used = public.ai_quota.used + 1
  returning used into n;

  delete from public.ai_quota
  where user_id = uid and window_start < now() - interval '2 days';

  return jsonb_build_object(
    'ok', n <= coalesce(p_limit, 0),
    'used', n,
    'limit', p_limit,
    'reset_at', win + make_interval(secs => p_window_seconds)
  );
end;
$$;

revoke all on function public.ai_quota_take(text, int, int) from public, anon;
grant execute on function public.ai_quota_take(text, int, int) to authenticated;

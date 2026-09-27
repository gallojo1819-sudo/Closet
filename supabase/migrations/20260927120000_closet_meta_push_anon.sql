-- Anon must not call the compare-and-swap. Authenticated already has execute.
-- Does not alter closet_meta_push's body. The rev migration is already applied.

revoke execute on function public.closet_meta_push(bigint, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, jsonb, jsonb) from anon;

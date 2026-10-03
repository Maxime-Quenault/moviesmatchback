\set ON_ERROR_STOP on
begin;
insert into auth.users(id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000001', 'alice@example.test', '{}'),
  ('10000000-0000-0000-0000-000000000002', 'bob@example.test', '{}');

select public.apply_media_mutations('10000000-0000-0000-0000-000000000001',
  '[{"mediaKey":"tmdb:movie:1","action":"liked","updatedAt":"2026-01-01T00:00:00Z","mutationId":"20000000-0000-0000-0000-000000000001"}]');
select public.apply_media_mutations('10000000-0000-0000-0000-000000000001',
  '[{"mediaKey":"tmdb:movie:1","deleted":true,"updatedAt":"2026-02-01T00:00:00Z","mutationId":"20000000-0000-0000-0000-000000000002"}]');
select public.apply_media_mutations('10000000-0000-0000-0000-000000000001',
  '[{"mediaKey":"tmdb:movie:1","action":"liked","updatedAt":"2026-01-15T00:00:00Z","mutationId":"20000000-0000-0000-0000-000000000003"}]');
select public.apply_media_mutations('10000000-0000-0000-0000-000000000001',
  '[{"mediaKey":"tmdb:movie:1","action":"liked"}]');
do $$ begin
  if not exists (select 1 from public.user_title_actions where title_id='tmdb:movie:1' and deleted_at is not null) then
    raise exception 'A stale device resurrected a deletion';
  end if;
end $$;

select public.apply_media_mutations('10000000-0000-0000-0000-000000000001',
  '[{"mediaKey":"tmdb:movie:1","action":"to_watch","updatedAt":"2026-03-01T00:00:00Z","mutationId":"20000000-0000-0000-0000-000000000004"}]');
-- Retrying the same mutation ID with a different payload must have no effect.
select public.apply_media_mutations('10000000-0000-0000-0000-000000000001',
  '[{"mediaKey":"tmdb:movie:1","deleted":true,"updatedAt":"2026-04-01T00:00:00Z","mutationId":"20000000-0000-0000-0000-000000000004"}]');
do $$ begin
  if not exists (select 1 from public.user_title_actions where title_id='tmdb:movie:1' and action='to_watch' and deleted_at is null) then
    raise exception 'Mutation retries are not idempotent';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
do $$ begin
  if exists(select 1 from public.user_title_actions) then raise exception 'RLS exposed another account'; end if;
  if exists(select 1 from public.profiles where id='10000000-0000-0000-0000-000000000001') then
    raise exception 'RLS exposed a private profile';
  end if;
  begin
    perform public.apply_media_mutations('10000000-0000-0000-0000-000000000001', '[]');
    raise exception 'Authenticated clients can bypass the backend';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select public.clear_media_actions('10000000-0000-0000-0000-000000000001');
do $$ begin
  if exists(select 1 from public.user_title_actions where deleted_at is null) then raise exception 'Clear did not preserve tombstones'; end if;
end $$;
delete from auth.users where id='10000000-0000-0000-0000-000000000001';
do $$ begin
  if exists(select 1 from public.user_title_actions) or exists(select 1 from public.media_mutation_receipts) then
    raise exception 'Account deletion did not cascade';
  end if;
end $$;
rollback;

begin;

alter table public.user_title_actions add column if not exists deleted_at timestamptz;
-- Preserve the mutation's timestamp instead of replacing it on every retry.
drop trigger if exists set_user_title_actions_updated_at on public.user_title_actions;

create table public.media_mutation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, mutation_id)
);
alter table public.media_mutation_receipts enable row level security;
revoke all on public.media_mutation_receipts from anon, authenticated;

-- Only the backend service role may write actions; clients cannot bypass
-- tombstones or manufacture a receipt. Owner-only reads remain available.
revoke insert, update, delete on public.user_title_actions from authenticated;

create or replace function public.apply_media_mutations(p_user_id uuid, p_items jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  item jsonb;
  mutation_id uuid;
  mutation_time timestamptz;
  is_deleted boolean;
  previous public.user_title_actions%rowtype;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 500 then
    raise exception 'Invalid mutation batch';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  for item in select value from jsonb_array_elements(p_items) loop
    if coalesce(length(item->>'mediaKey'), 0) not between 1 and 160 then
      raise exception 'Invalid media key';
    end if;
    mutation_id := nullif(item->>'mutationId', '')::uuid;
    if mutation_id is not null then
      insert into public.media_mutation_receipts(user_id, mutation_id)
      values (p_user_id, mutation_id) on conflict do nothing;
      if not found then continue; end if;
    end if;
    select * into previous from public.user_title_actions
      where user_id = p_user_id and title_id = item->>'mediaKey';
    is_deleted := coalesce((item->>'deleted')::boolean, false);
    -- Old clients without a timestamp may not resurrect a deleted action.
    if previous.deleted_at is not null and item->>'updatedAt' is null then continue; end if;
    mutation_time := least(coalesce((item->>'updatedAt')::timestamptz, clock_timestamp()), clock_timestamp());
    if previous.updated_at is not null and
       (mutation_time < previous.updated_at or
        (mutation_time = previous.updated_at and previous.deleted_at is not null and not is_deleted)) then
      continue;
    end if;
    insert into public.user_title_actions(user_id, title_id, action, updated_at, deleted_at)
    values (p_user_id, item->>'mediaKey',
      case when is_deleted then coalesce(previous.action, 'rejected'::public.user_title_action)
           else (item->>'action')::public.user_title_action end,
      mutation_time, case when is_deleted then mutation_time else null end)
    on conflict (user_id, title_id) do update set
      action = excluded.action, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at;
  end loop;
end;
$$;

create or replace function public.clear_media_actions(p_user_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  update public.user_title_actions set deleted_at = clock_timestamp(), updated_at = clock_timestamp()
    where user_id = p_user_id and deleted_at is null;
end;
$$;

revoke all on function public.apply_media_mutations(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.clear_media_actions(uuid) from public, anon, authenticated;
grant execute on function public.apply_media_mutations(uuid, jsonb) to service_role;
grant execute on function public.clear_media_actions(uuid) to service_role;
grant all on public.media_mutation_receipts to service_role;

commit;

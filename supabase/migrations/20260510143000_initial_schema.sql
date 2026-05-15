create extension if not exists pgcrypto;

do $$
begin
  create type public.user_title_action as enum ('liked', 'to_watch', 'rejected', 'watched');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.list_visibility as enum ('private', 'public', 'followers');
exception
  when duplicate_object then null;
end $$;

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text,
  avatar_url text,
  bio text,
  is_public boolean not null default false,
  preferred_genres text[] not null default '{}'::text[],
  release_year_min integer,
  release_year_max integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (
    username is null or username ~ '^[a-zA-Z0-9_]{3,32}$'
  ),
  constraint profiles_release_year_range check (
    (release_year_min is null or release_year_min between 1888 and 9999)
    and (release_year_max is null or release_year_max between 1888 and 9999)
    and (
      release_year_min is null
      or release_year_max is null
      or release_year_min <= release_year_max
    )
  )
);

create table if not exists public.genres (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table if not exists public.user_title_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title_id text not null,
  action public.user_title_action not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, title_id)
);

comment on column public.user_title_actions.title_id is
  'Lightweight media key stored for sync, e.g. tmdb:movie:123, tmdb:tv:456, jikan:anime:789.';

create table if not exists public.user_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  visibility public.list_visibility not null default 'private',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.user_lists(id) on delete cascade,
  title_id text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (list_id, title_id)
);

comment on column public.user_list_items.title_id is
  'Lightweight media key stored for sync, e.g. tmdb:movie:123, tmdb:tv:456, jikan:anime:789.';

create table if not exists public.follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references auth.users(id) on delete cascade,
  followed_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (follower_id, followed_id),
  constraint follows_not_self check (follower_id <> followed_id)
);

create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title_id text not null,
  score numeric not null default 0,
  reason text,
  created_at timestamptz not null default now(),
  unique (user_id, title_id)
);

comment on column public.recommendations.title_id is
  'Lightweight media key for a recommended external media.';

create index if not exists user_title_actions_user_updated_idx
  on public.user_title_actions (user_id, updated_at desc);

create index if not exists user_title_actions_user_action_idx
  on public.user_title_actions (user_id, action);

create index if not exists user_lists_user_updated_idx
  on public.user_lists (user_id, updated_at desc);

create index if not exists user_list_items_list_position_idx
  on public.user_list_items (list_id, position, created_at);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_user_title_actions_updated_at on public.user_title_actions;
create trigger set_user_title_actions_updated_at
before update on public.user_title_actions
for each row execute function public.set_updated_at();

drop trigger if exists set_user_lists_updated_at on public.user_lists;
create trigger set_user_lists_updated_at
before update on public.user_lists
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.genres enable row level security;
alter table public.user_title_actions enable row level security;
alter table public.user_lists enable row level security;
alter table public.user_list_items enable row level security;
alter table public.follows enable row level security;
alter table public.recommendations enable row level security;

drop policy if exists profiles_select_visible on public.profiles;
create policy profiles_select_visible on public.profiles
for select using (
  is_public
  or id = auth.uid()
  or exists (
    select 1
    from public.follows f
    where f.follower_id = auth.uid()
      and f.followed_id = profiles.id
  )
);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
for insert with check (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists genres_select_all on public.genres;
create policy genres_select_all on public.genres
for select using (true);

drop policy if exists user_title_actions_select_own on public.user_title_actions;
create policy user_title_actions_select_own on public.user_title_actions
for select using (user_id = auth.uid());

drop policy if exists user_title_actions_insert_own on public.user_title_actions;
create policy user_title_actions_insert_own on public.user_title_actions
for insert with check (user_id = auth.uid());

drop policy if exists user_title_actions_update_own on public.user_title_actions;
create policy user_title_actions_update_own on public.user_title_actions
for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists user_title_actions_delete_own on public.user_title_actions;
create policy user_title_actions_delete_own on public.user_title_actions
for delete using (user_id = auth.uid());

drop policy if exists user_lists_select_visible on public.user_lists;
create policy user_lists_select_visible on public.user_lists
for select using (
  user_id = auth.uid()
  or visibility = 'public'
  or (
    visibility = 'followers'
    and exists (
      select 1
      from public.follows f
      where f.follower_id = auth.uid()
        and f.followed_id = user_lists.user_id
    )
  )
);

drop policy if exists user_lists_insert_own on public.user_lists;
create policy user_lists_insert_own on public.user_lists
for insert with check (user_id = auth.uid());

drop policy if exists user_lists_update_own on public.user_lists;
create policy user_lists_update_own on public.user_lists
for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists user_lists_delete_own on public.user_lists;
create policy user_lists_delete_own on public.user_lists
for delete using (user_id = auth.uid());

drop policy if exists user_list_items_select_visible on public.user_list_items;
create policy user_list_items_select_visible on public.user_list_items
for select using (
  exists (
    select 1
    from public.user_lists l
    where l.id = user_list_items.list_id
      and (
        l.user_id = auth.uid()
        or l.visibility = 'public'
        or (
          l.visibility = 'followers'
          and exists (
            select 1
            from public.follows f
            where f.follower_id = auth.uid()
              and f.followed_id = l.user_id
          )
        )
      )
  )
);

drop policy if exists user_list_items_insert_own_list on public.user_list_items;
create policy user_list_items_insert_own_list on public.user_list_items
for insert with check (
  exists (
    select 1
    from public.user_lists l
    where l.id = user_list_items.list_id
      and l.user_id = auth.uid()
  )
);

drop policy if exists user_list_items_update_own_list on public.user_list_items;
create policy user_list_items_update_own_list on public.user_list_items
for update using (
  exists (
    select 1
    from public.user_lists l
    where l.id = user_list_items.list_id
      and l.user_id = auth.uid()
  )
) with check (
  exists (
    select 1
    from public.user_lists l
    where l.id = user_list_items.list_id
      and l.user_id = auth.uid()
  )
);

drop policy if exists user_list_items_delete_own_list on public.user_list_items;
create policy user_list_items_delete_own_list on public.user_list_items
for delete using (
  exists (
    select 1
    from public.user_lists l
    where l.id = user_list_items.list_id
      and l.user_id = auth.uid()
  )
);

drop policy if exists follows_select_related on public.follows;
create policy follows_select_related on public.follows
for select using (follower_id = auth.uid() or followed_id = auth.uid());

drop policy if exists follows_insert_own on public.follows;
create policy follows_insert_own on public.follows
for insert with check (follower_id = auth.uid() and follower_id <> followed_id);

drop policy if exists follows_delete_own on public.follows;
create policy follows_delete_own on public.follows
for delete using (follower_id = auth.uid());

drop policy if exists recommendations_select_own on public.recommendations;
create policy recommendations_select_own on public.recommendations
for select using (user_id = auth.uid());

grant usage on schema public to anon, authenticated;
grant select on public.genres to anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.user_title_actions to authenticated;
grant select, insert, update, delete on public.user_lists to authenticated;
grant select, insert, update, delete on public.user_list_items to authenticated;
grant select, insert, delete on public.follows to authenticated;
grant select on public.recommendations to authenticated;

create or replace function public.handle_new_user()
returns trigger
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  return new;
end;
$$ language plpgsql;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

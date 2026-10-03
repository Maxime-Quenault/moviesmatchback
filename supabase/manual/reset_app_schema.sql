-- Destructive reset migration for the Movie Match application schema.
-- This drops app-owned objects in public so the schema can be recreated cleanly.
-- It intentionally does not delete auth.users.

begin;

drop trigger if exists on_auth_user_created on auth.users;

drop view if exists public.titles_with_genres cascade;

drop table if exists
  public.recommendations,
  public.user_list_items,
  public.user_lists,
  public.user_title_actions,
  public.follows,
  public.title_genres,
  public.titles,
  public.genres,
  public.profiles
cascade;

drop function if exists public.handle_new_user() cascade;
drop function if exists public.set_updated_at() cascade;

drop type if exists public.user_title_action cascade;
drop type if exists public.list_visibility cascade;
drop type if exists public.title_type cascade;

commit;

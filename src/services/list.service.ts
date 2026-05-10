import type { SupabaseClient } from '@supabase/supabase-js';

import { badRequest, forbidden, notFound } from '../lib/api-error.js';
import { throwDatabaseError } from '../lib/supabase-error.js';
import type { Database, ListVisibility } from '../types/database.js';
import { ensureTitleExists, getTitlesByIds, type TitleDto } from './title.service.js';

type ListRow = Database['public']['Tables']['user_lists']['Row'];
type ListItemRow = Database['public']['Tables']['user_list_items']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export interface UserListItemDto {
  id: string;
  titleId: string;
  position: number;
  title: TitleDto | null;
  createdAt: string;
}

export interface UserListDto {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  visibility: ListVisibility;
  createdAt: string;
  updatedAt: string;
  items: UserListItemDto[];
}

export interface CreateListInput {
  name: string;
  description?: string | null;
  visibility?: ListVisibility;
}

export interface UpdateListInput {
  name?: string;
  description?: string | null;
  visibility?: ListVisibility;
}

export interface FollowDto {
  id: string;
  profile: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
  createdAt: string;
}

function mapList(row: ListRow, items: UserListItemDto[] = []): UserListDto {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items,
  };
}

async function getListRow(
  supabase: SupabaseClient<Database>,
  listId: string,
): Promise<ListRow> {
  const { data, error } = await supabase
    .from('user_lists')
    .select('*')
    .eq('id', listId)
    .maybeSingle();

  if (error) {
    throwDatabaseError(error, 'Unable to load list');
  }

  if (!data) {
    throw notFound('List not found');
  }

  return data;
}

async function assertListOwner(
  supabase: SupabaseClient<Database>,
  listId: string,
  userId: string,
): Promise<ListRow> {
  const list = await getListRow(supabase, listId);

  if (list.user_id !== userId) {
    throw forbidden('Only the list owner can change this list');
  }

  return list;
}

async function canViewList(
  supabase: SupabaseClient<Database>,
  list: ListRow,
  viewerId?: string,
): Promise<boolean> {
  if (list.visibility === 'public' || list.user_id === viewerId) {
    return true;
  }

  if (list.visibility !== 'followers' || !viewerId) {
    return false;
  }

  const { data, error } = await supabase
    .from('follows')
    .select('id')
    .eq('follower_id', viewerId)
    .eq('followed_id', list.user_id)
    .maybeSingle();

  if (error) {
    throwDatabaseError(error, 'Unable to verify list visibility');
  }

  return Boolean(data);
}

async function getListItems(
  supabase: SupabaseClient<Database>,
  listId: string,
): Promise<UserListItemDto[]> {
  const { data, error } = await supabase
    .from('user_list_items')
    .select('*')
    .eq('list_id', listId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throwDatabaseError(error, 'Unable to load list items');
  }

  const rows = data ?? [];
  const titles = await getTitlesByIds(
    supabase,
    rows.map((row) => row.title_id),
  );
  const titleById = new Map(titles.map((title) => [title.id, title]));

  return rows.map((row) => ({
    id: row.id,
    titleId: row.title_id,
    position: row.position,
    title: titleById.get(row.title_id) ?? null,
    createdAt: row.created_at,
  }));
}

export async function listOwnLists(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<UserListDto[]> {
  const { data, error } = await supabase
    .from('user_lists')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    throwDatabaseError(error, 'Unable to load user lists');
  }

  const result: UserListDto[] = [];
  for (const list of data ?? []) {
    result.push(mapList(list, await getListItems(supabase, list.id)));
  }

  return result;
}

export async function createList(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: CreateListInput,
): Promise<UserListDto> {
  const { data, error } = await supabase
    .from('user_lists')
    .insert({
      user_id: userId,
      name: input.name,
      description: input.description ?? null,
      visibility: input.visibility ?? 'private',
    })
    .select('*')
    .single();

  if (error) {
    throwDatabaseError(error, 'Unable to create list');
  }

  return mapList(data);
}

export async function updateList(
  supabase: SupabaseClient<Database>,
  userId: string,
  listId: string,
  input: UpdateListInput,
): Promise<UserListDto> {
  await assertListOwner(supabase, listId, userId);

  const { data, error } = await supabase
    .from('user_lists')
    .update({
      name: input.name,
      description: input.description,
      visibility: input.visibility,
      updated_at: new Date().toISOString(),
    })
    .eq('id', listId)
    .select('*')
    .single();

  if (error) {
    throwDatabaseError(error, 'Unable to update list');
  }

  return mapList(data, await getListItems(supabase, data.id));
}

export async function deleteList(
  supabase: SupabaseClient<Database>,
  userId: string,
  listId: string,
): Promise<void> {
  await assertListOwner(supabase, listId, userId);

  const { error } = await supabase.from('user_lists').delete().eq('id', listId);

  if (error) {
    throwDatabaseError(error, 'Unable to delete list');
  }
}

export async function getVisibleList(
  supabase: SupabaseClient<Database>,
  listId: string,
  viewerId?: string,
): Promise<UserListDto> {
  const list = await getListRow(supabase, listId);

  if (!(await canViewList(supabase, list, viewerId))) {
    throw notFound('List not found');
  }

  return mapList(list, await getListItems(supabase, list.id));
}

export async function listPublicLists(
  supabase: SupabaseClient<Database>,
  input: { limit: number; offset: number },
): Promise<{ items: UserListDto[]; count: number | null }> {
  const { data, error, count } = await supabase
    .from('user_lists')
    .select('*', { count: 'exact' })
    .eq('visibility', 'public')
    .order('updated_at', { ascending: false })
    .range(input.offset, input.offset + input.limit - 1);

  if (error) {
    throwDatabaseError(error, 'Unable to load public lists');
  }

  const items: UserListDto[] = [];
  for (const row of data ?? []) {
    items.push(mapList(row, await getListItems(supabase, row.id)));
  }

  return { items, count };
}

async function nextListPosition(
  supabase: SupabaseClient<Database>,
  listId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('user_list_items')
    .select('position')
    .eq('list_id', listId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throwDatabaseError(error, 'Unable to determine next list position');
  }

  return ((data as Pick<ListItemRow, 'position'> | null)?.position ?? -1) + 1;
}

export async function addListItem(
  supabase: SupabaseClient<Database>,
  userId: string,
  listId: string,
  titleId: string,
  position?: number,
): Promise<UserListDto> {
  await assertListOwner(supabase, listId, userId);
  await ensureTitleExists(supabase, titleId);

  const targetPosition = position ?? (await nextListPosition(supabase, listId));
  const { error } = await supabase.from('user_list_items').upsert(
    {
      list_id: listId,
      title_id: titleId,
      position: targetPosition,
    },
    { onConflict: 'list_id,title_id' },
  );

  if (error) {
    throwDatabaseError(error, 'Unable to add list item');
  }

  return getVisibleList(supabase, listId, userId);
}

export async function removeListItem(
  supabase: SupabaseClient<Database>,
  userId: string,
  listId: string,
  titleId: string,
): Promise<UserListDto> {
  await assertListOwner(supabase, listId, userId);

  const { error } = await supabase
    .from('user_list_items')
    .delete()
    .eq('list_id', listId)
    .eq('title_id', titleId);

  if (error) {
    throwDatabaseError(error, 'Unable to remove list item');
  }

  return getVisibleList(supabase, listId, userId);
}

export async function followProfile(
  supabase: SupabaseClient<Database>,
  followerId: string,
  followedId: string,
): Promise<void> {
  if (followerId === followedId) {
    throw badRequest('A user cannot follow themself');
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', followedId)
    .maybeSingle();

  if (profileError) {
    throwDatabaseError(profileError, 'Unable to load followed profile');
  }

  if (!profile) {
    throw notFound('Profile not found');
  }

  const { error } = await supabase.from('follows').upsert(
    {
      follower_id: followerId,
      followed_id: followedId,
    },
    { onConflict: 'follower_id,followed_id' },
  );

  if (error) {
    throwDatabaseError(error, 'Unable to follow profile');
  }
}

export async function unfollowProfile(
  supabase: SupabaseClient<Database>,
  followerId: string,
  followedId: string,
): Promise<void> {
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('followed_id', followedId);

  if (error) {
    throwDatabaseError(error, 'Unable to unfollow profile');
  }
}

export async function listFollowing(
  supabase: SupabaseClient<Database>,
  followerId: string,
): Promise<FollowDto[]> {
  const { data, error } = await supabase
    .from('follows')
    .select('*')
    .eq('follower_id', followerId)
    .order('created_at', { ascending: false });

  if (error) {
    throwDatabaseError(error, 'Unable to list follows');
  }

  const followedIds = (data ?? []).map((follow) => follow.followed_id);
  if (followedIds.length === 0) {
    return [];
  }

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .in('id', followedIds);

  if (profilesError) {
    throwDatabaseError(profilesError, 'Unable to load followed profiles');
  }

  const profilesById = new Map(
    (profiles ?? []).map((profile) => [
      profile.id,
      profile as Pick<ProfileRow, 'id' | 'username' | 'display_name' | 'avatar_url'>,
    ]),
  );

  return (data ?? [])
    .map((follow) => {
      const profile = profilesById.get(follow.followed_id);
      if (!profile) {
        return null;
      }

      return {
        id: follow.id,
        profile: {
          id: profile.id,
          username: profile.username,
          displayName: profile.display_name,
          avatarUrl: profile.avatar_url,
        },
        createdAt: follow.created_at,
      };
    })
    .filter((follow): follow is FollowDto => Boolean(follow));
}

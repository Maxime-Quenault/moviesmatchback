import type { SupabaseClient } from '@supabase/supabase-js';

import { badRequest, notFound } from '../lib/api-error.js';
import { throwDatabaseError } from '../lib/supabase-error.js';
import type {
  AuthenticatedUser,
  Database,
  TitleType,
  UserTitleAction,
} from '../types/database.js';
import { rankRecommendations, type RecommendationDto } from './recommendation.service.js';
import {
  ensureTitleExists,
  getTitlesByIds,
  listAllTitles,
  type TitleDto,
} from './title.service.js';

type ActionRow = Database['public']['Tables']['user_title_actions']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export interface ActionDto {
  id: string;
  titleId: string;
  action: UserTitleAction;
  createdAt: string;
  updatedAt: string;
}

export interface SelectionsDto {
  liked: TitleDto[];
  toWatch: TitleDto[];
  rejected: TitleDto[];
  watched: TitleDto[];
  totals: {
    liked: number;
    toWatch: number;
    rejected: number;
    watched: number;
    total: number;
  };
}

export interface ProfileDto {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileWithStatsDto extends ProfileDto {
  stats: SelectionsDto['totals'];
  favoriteGenres: string[];
}

export interface UpdateProfileInput {
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  isPublic?: boolean;
}

export function mapAction(row: ActionRow): ActionDto {
  return {
    id: row.id,
    titleId: row.title_id,
    action: row.action,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapProfile(row: ProfileRow): ProfileDto {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    isPublic: row.is_public,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getUserActions(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<ActionRow[]> {
  const { data, error } = await supabase
    .from('user_title_actions')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    throwDatabaseError(error, 'Unable to load user actions');
  }

  return data ?? [];
}

export async function setTitleAction(
  supabase: SupabaseClient<Database>,
  userId: string,
  titleId: string,
  action: UserTitleAction,
): Promise<ActionDto> {
  await ensureTitleExists(supabase, titleId);

  const { data, error } = await supabase
    .from('user_title_actions')
    .upsert(
      {
        user_id: userId,
        title_id: titleId,
        action,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,title_id' },
    )
    .select('*')
    .single();

  if (error) {
    throwDatabaseError(error, 'Unable to save title action');
  }

  return mapAction(data);
}

export async function deleteTitleAction(
  supabase: SupabaseClient<Database>,
  userId: string,
  titleId: string,
): Promise<void> {
  const { error } = await supabase
    .from('user_title_actions')
    .delete()
    .eq('user_id', userId)
    .eq('title_id', titleId);

  if (error) {
    throwDatabaseError(error, 'Unable to delete title action');
  }
}

export async function clearTitleActions(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from('user_title_actions')
    .delete()
    .eq('user_id', userId);

  if (error) {
    throwDatabaseError(error, 'Unable to clear title actions');
  }
}

export async function getSelections(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<SelectionsDto> {
  const actions = await getUserActions(supabase, userId);
  const titles = await getTitlesByIds(
    supabase,
    actions.map((action) => action.title_id),
  );
  const titleById = new Map(titles.map((title) => [title.id, title]));

  const selections: SelectionsDto = {
    liked: [],
    toWatch: [],
    rejected: [],
    watched: [],
    totals: {
      liked: 0,
      toWatch: 0,
      rejected: 0,
      watched: 0,
      total: 0,
    },
  };

  for (const action of actions) {
    const title = titleById.get(action.title_id);
    if (!title) {
      continue;
    }

    if (action.action === 'liked') {
      selections.liked.push(title);
    } else if (action.action === 'to_watch') {
      selections.toWatch.push(title);
    } else if (action.action === 'rejected') {
      selections.rejected.push(title);
    } else {
      selections.watched.push(title);
    }
  }

  selections.totals = {
    liked: selections.liked.length,
    toWatch: selections.toWatch.length,
    rejected: selections.rejected.length,
    watched: selections.watched.length,
    total:
      selections.liked.length +
      selections.toWatch.length +
      selections.rejected.length +
      selections.watched.length,
  };

  return selections;
}

export async function getDiscoverTitles(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: { type?: TitleType; limit: number; offset: number },
): Promise<{ items: TitleDto[]; count: number }> {
  const [actions, titles] = await Promise.all([
    getUserActions(supabase, userId),
    listAllTitles(supabase, input.type),
  ]);

  const selectedIds = new Set(actions.map((action) => action.title_id));
  const available = titles.filter((title) => !selectedIds.has(title.id));

  return {
    items: available.slice(input.offset, input.offset + input.limit),
    count: available.length,
  };
}

export async function getUserRecommendations(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: { limit: number; type?: TitleType },
): Promise<{ items: RecommendationDto[] }> {
  const actions = await getUserActions(supabase, userId);
  const actionTitles = await getTitlesByIds(
    supabase,
    actions.map((action) => action.title_id),
  );
  const titleById = new Map(actionTitles.map((title) => [title.id, title]));
  const actionContexts = actions
    .map((action) => {
      const title = titleById.get(action.title_id);
      return title ? { action: action.action, title } : null;
    })
    .filter((context): context is NonNullable<typeof context> => Boolean(context));

  const allTitles = await listAllTitles(supabase, input.type);
  const selectedIds = new Set(actions.map((action) => action.title_id));
  const availableTitles = allTitles.filter((title) => !selectedIds.has(title.id));

  return {
    items: rankRecommendations(availableTitles, actionContexts, input.limit),
  };
}

export function favoriteGenresFromSelections(selections: SelectionsDto): string[] {
  const counts = new Map<string, number>();

  for (const title of [...selections.liked, ...selections.toWatch]) {
    for (const genre of title.genres) {
      counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([genre]) => genre);
}

export async function ensureProfile(
  supabase: SupabaseClient<Database>,
  user: AuthenticatedUser,
): Promise<ProfileDto> {
  const { data: existing, error: loadError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (loadError) {
    throwDatabaseError(loadError, 'Unable to load profile');
  }

  if (existing) {
    return mapProfile(existing);
  }

  const fallbackName = user.email?.split('@')[0] ?? 'Compte local';
  const { data, error } = await supabase
    .from('profiles')
    .insert({
      id: user.id,
      display_name: fallbackName,
      is_public: false,
    })
    .select('*')
    .single();

  if (error) {
    throwDatabaseError(error, 'Unable to create profile');
  }

  return mapProfile(data);
}

export async function getProfileWithStats(
  supabase: SupabaseClient<Database>,
  user: AuthenticatedUser,
): Promise<ProfileWithStatsDto> {
  const [profile, selections] = await Promise.all([
    ensureProfile(supabase, user),
    getSelections(supabase, user.id),
  ]);

  return {
    ...profile,
    stats: selections.totals,
    favoriteGenres: favoriteGenresFromSelections(selections),
  };
}

export async function updateProfile(
  supabase: SupabaseClient<Database>,
  user: AuthenticatedUser,
  input: UpdateProfileInput,
): Promise<ProfileDto> {
  await ensureProfile(supabase, user);

  if (input.username === '') {
    throw badRequest('Username cannot be empty');
  }

  const { data, error } = await supabase
    .from('profiles')
    .update({
      username: input.username,
      display_name: input.displayName,
      avatar_url: input.avatarUrl,
      bio: input.bio,
      is_public: input.isPublic,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id)
    .select('*')
    .single();

  if (error) {
    throwDatabaseError(error, 'Unable to update profile');
  }

  return mapProfile(data);
}

export async function getVisibleProfile(
  supabase: SupabaseClient<Database>,
  profileId: string,
  viewerId?: string,
): Promise<ProfileDto> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', profileId)
    .maybeSingle();

  if (error) {
    throwDatabaseError(error, 'Unable to load profile');
  }

  if (!data) {
    throw notFound('Profile not found');
  }

  if (data.is_public || viewerId === data.id) {
    return mapProfile(data);
  }

  if (viewerId) {
    const { data: follow, error: followError } = await supabase
      .from('follows')
      .select('id')
      .eq('follower_id', viewerId)
      .eq('followed_id', data.id)
      .maybeSingle();

    if (followError) {
      throwDatabaseError(followError, 'Unable to verify follow access');
    }

    if (follow) {
      return mapProfile(data);
    }
  }

  throw notFound('Profile not found');
}

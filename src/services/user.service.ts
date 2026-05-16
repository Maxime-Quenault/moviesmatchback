import type { SupabaseClient } from '@supabase/supabase-js';

import type { AppEnv } from '../config/env.js';
import { badRequest, notFound, upstreamError } from '../lib/api-error.js';
import { throwDatabaseError } from '../lib/supabase-error.js';
import type {
  AuthenticatedUser,
  Database,
  TitleType,
  UserTitleAction,
} from '../types/database.js';
import {
  rankRecommendations,
  type RecommendationDto,
} from './recommendation.service.js';
import {
  resolveMediaKeys,
  type ResolvedMediaTitleDto,
} from './external-title-resolver.service.js';
import {
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

export interface MediaActionSyncInput {
  mediaKey: string;
  action: UserTitleAction;
  updatedAt?: string;
}

export interface MediaActionRefDto {
  id: string;
  mediaKey: string;
  action: UserTitleAction;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedMediaActionDto extends MediaActionRefDto {
  title: ResolvedMediaTitleDto | null;
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

type ShareableTitleDto = TitleDto | ResolvedMediaTitleDto;

export interface ShareableSelectionsDto {
  liked: ShareableTitleDto[];
  toWatch: ShareableTitleDto[];
  totals: {
    liked: number;
    toWatch: number;
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
  preferredGenres: string[];
  releaseYearMin: number | null;
  releaseYearMax: number | null;
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

export const profileAvatarMaxBytes = 3 * 1024 * 1024;

const avatarMimeTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

export interface UploadProfileAvatarInput {
  buffer: Buffer;
  mimeType: string;
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

export function mapMediaAction(row: ActionRow): MediaActionRefDto {
  return {
    id: row.id,
    mediaKey: row.title_id,
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
    preferredGenres: Array.isArray(row.preferred_genres)
      ? row.preferred_genres
      : [],
    releaseYearMin: row.release_year_min,
    releaseYearMax: row.release_year_max,
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

export async function listMediaActions(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<MediaActionRefDto[]> {
  const rows = await getUserActions(supabase, userId);
  return rows.map(mapMediaAction);
}

export async function setMediaAction(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: Pick<MediaActionSyncInput, 'mediaKey' | 'action'>,
): Promise<MediaActionRefDto> {
  const { data, error } = await supabase
    .from('user_title_actions')
    .upsert(
      {
        user_id: userId,
        title_id: input.mediaKey,
        action: input.action,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,title_id' },
    )
    .select('*')
    .single();

  if (error) {
    throwDatabaseError(error, 'Unable to save media action');
  }

  return mapMediaAction(data);
}

export async function deleteMediaAction(
  supabase: SupabaseClient<Database>,
  userId: string,
  mediaKey: string,
): Promise<void> {
  await deleteTitleAction(supabase, userId, mediaKey);
}

export async function clearMediaActions(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  await clearTitleActions(supabase, userId);
}

export async function syncMediaActions(
  supabase: SupabaseClient<Database>,
  env: AppEnv,
  userId: string,
  items: MediaActionSyncInput[],
): Promise<{ items: ResolvedMediaActionDto[] }> {
  await upsertMediaActionsIfNeeded(supabase, userId, items);

  const actions = await listMediaActions(supabase, userId);
  return {
    items: await attachResolvedMediaTitles(env, actions),
  };
}

async function upsertMediaActionsIfNeeded(
  supabase: SupabaseClient<Database>,
  userId: string,
  items: MediaActionSyncInput[],
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const existingRows = await getUserActions(supabase, userId);
  const existingByKey = new Map(existingRows.map((row) => [row.title_id, row]));
  const now = new Date().toISOString();
  const rows = items
    .filter((item) =>
      shouldUpsertMediaAction(existingByKey.get(item.mediaKey), item),
    )
    .map((item) => ({
      user_id: userId,
      title_id: item.mediaKey,
      action: item.action,
      updated_at: item.updatedAt ?? now,
    }));

  if (rows.length === 0) {
    return;
  }

  const { error } = await supabase
    .from('user_title_actions')
    .upsert(rows, { onConflict: 'user_id,title_id' });

  if (error) {
    throwDatabaseError(error, 'Unable to sync media actions');
  }
}

function shouldUpsertMediaAction(
  existing: ActionRow | undefined,
  input: MediaActionSyncInput,
): boolean {
  if (!existing || !input.updatedAt) {
    return true;
  }

  const localUpdatedAt = Date.parse(input.updatedAt);
  const remoteUpdatedAt = Date.parse(existing.updated_at);
  if (!Number.isFinite(localUpdatedAt) || !Number.isFinite(remoteUpdatedAt)) {
    return true;
  }

  return localUpdatedAt >= remoteUpdatedAt;
}

async function attachResolvedMediaTitles(
  env: AppEnv,
  actions: MediaActionRefDto[],
): Promise<ResolvedMediaActionDto[]> {
  const titlesByKey = await resolveMediaKeys(
    env,
    actions.map((action) => action.mediaKey),
  );

  return actions.map((action) => ({
    ...action,
    title: titlesByKey.get(action.mediaKey) ?? null,
  }));
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

export async function getShareableSelections(
  supabase: SupabaseClient<Database>,
  env: AppEnv,
  userId: string,
): Promise<ShareableSelectionsDto> {
  const actions = (await getUserActions(supabase, userId)).filter(
    (action) => action.action === 'liked' || action.action === 'to_watch',
  );
  const actionKeys = actions.map((action) => action.title_id);
  const [resolvedTitles, localTitles] = await Promise.all([
    resolveMediaKeys(env, actionKeys),
    getTitlesByIds(supabase, actionKeys),
  ]);
  const localTitleById = new Map(localTitles.map((title) => [title.id, title]));

  const selections: ShareableSelectionsDto = {
    liked: [],
    toWatch: [],
    totals: {
      liked: 0,
      toWatch: 0,
      total: 0,
    },
  };

  for (const action of actions) {
    const title =
      resolvedTitles.get(action.title_id) ??
      localTitleById.get(action.title_id) ??
      null;

    if (!title) {
      continue;
    }

    if (action.action === 'liked') {
      selections.liked.push(title);
    } else {
      selections.toWatch.push(title);
    }
  }

  selections.totals = {
    liked: selections.liked.length,
    toWatch: selections.toWatch.length,
    total: selections.liked.length + selections.toWatch.length,
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
    .filter((context): context is NonNullable<typeof context> =>
      Boolean(context),
    );

  const allTitles = await listAllTitles(supabase, input.type);
  const selectedIds = new Set(actions.map((action) => action.title_id));
  const availableTitles = allTitles.filter(
    (title) => !selectedIds.has(title.id),
  );

  return {
    items: rankRecommendations(availableTitles, actionContexts, input.limit),
  };
}

export function favoriteGenresFromSelections(
  selections: SelectionsDto,
): string[] {
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

  const updates: Database['public']['Tables']['profiles']['Update'] = {
    updated_at: new Date().toISOString(),
  };
  if (input.username !== undefined) {
    updates.username = input.username;
  }
  if (input.displayName !== undefined) {
    updates.display_name = input.displayName;
  }
  if (input.avatarUrl !== undefined) {
    updates.avatar_url = input.avatarUrl;
  }
  if (input.bio !== undefined) {
    updates.bio = input.bio;
  }
  if (input.isPublic !== undefined) {
    updates.is_public = input.isPublic;
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', user.id)
    .select('*')
    .single();

  if (error) {
    throwDatabaseError(error, 'Unable to update profile');
  }

  return mapProfile(data);
}

export async function uploadProfileAvatar(
  supabase: SupabaseClient<Database>,
  env: AppEnv,
  user: AuthenticatedUser,
  input: UploadProfileAvatarInput,
): Promise<ProfileDto> {
  await ensureProfile(supabase, user);

  const normalizedMimeType = input.mimeType.toLowerCase();
  const extension = avatarMimeTypes.get(normalizedMimeType);
  if (!extension) {
    throw badRequest('Format image non supporte');
  }

  if (input.buffer.length === 0) {
    throw badRequest('Image vide ou illisible');
  }

  if (input.buffer.length > profileAvatarMaxBytes) {
    throw badRequest('Image trop lourde');
  }

  if (!hasExpectedAvatarSignature(input.buffer, normalizedMimeType)) {
    throw badRequest('Image invalide');
  }

  const bucket = env.SUPABASE_AVATAR_BUCKET;
  await ensureAvatarBucket(supabase, bucket);

  const objectPath = `${user.id}/avatar-${Date.now()}.${extension}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(objectPath, input.buffer, {
      cacheControl: '31536000',
      contentType: normalizedMimeType,
      upsert: false,
    });

  if (error) {
    throw upstreamError('Impossible d envoyer la photo de profil', error);
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
  return updateProfile(supabase, user, { avatarUrl: data.publicUrl });
}

async function ensureAvatarBucket(
  supabase: SupabaseClient<Database>,
  bucket: string,
): Promise<void> {
  const { data: buckets, error: listError } =
    await supabase.storage.listBuckets();
  if (listError) {
    throw upstreamError(
      'Impossible de verifier le stockage des avatars',
      listError,
    );
  }

  if (buckets?.some((item) => item.name === bucket)) {
    return;
  }

  const { error } = await supabase.storage.createBucket(bucket, {
    public: true,
    fileSizeLimit: profileAvatarMaxBytes,
    allowedMimeTypes: [...avatarMimeTypes.keys()],
  });

  if (error) {
    throw upstreamError(
      'Impossible de preparer le stockage des avatars',
      error,
    );
  }
}

function hasExpectedAvatarSignature(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (mimeType === 'image/png') {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }

  if (mimeType === 'image/webp') {
    return (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    );
  }

  return false;
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

import type { SupabaseClient } from '@supabase/supabase-js';

import { notFound } from '../lib/api-error.js';
import { throwDatabaseError } from '../lib/supabase-error.js';
import type { Database, TitleType } from '../types/database.js';

type TitleViewRow = Database['public']['Views']['titles_with_genres']['Row'];

export interface TitleDto {
  id: string;
  type: TitleType;
  name: string;
  description: string | null;
  releaseYear: number | null;
  duration: string | null;
  posterUrl: string | null;
  rating: number | null;
  seenPercentage: number | null;
  externalSource: string | null;
  externalId: string | null;
  genres: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ListTitlesInput {
  type?: TitleType;
  genre?: string;
  q?: string;
  limit: number;
  offset: number;
}

export interface ExternalTitleRef {
  source: string;
  type: TitleType;
  externalId: string;
}

export function mapTitle(
  row: TitleViewRow,
  seenPercentage: number | null = null,
): TitleDto {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    description: row.description,
    releaseYear: row.release_year,
    duration: row.duration,
    posterUrl: row.poster_url,
    rating: row.rating,
    seenPercentage,
    externalSource: row.external_source,
    externalId: row.external_id,
    genres: Array.isArray(row.genres) ? row.genres : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listTitles(
  supabase: SupabaseClient<Database>,
  input: ListTitlesInput,
): Promise<{ items: TitleDto[]; count: number | null }> {
  let countQuery = supabase
    .from('titles_with_genres')
    .select('id', { count: 'exact', head: true });

  if (input.type) {
    countQuery = countQuery.eq('type', input.type);
  }

  if (input.q) {
    countQuery = countQuery.ilike('name', `%${input.q}%`);
  }

  if (input.genre) {
    countQuery = countQuery.contains('genres', [input.genre]);
  }

  const { error: countError, count } = await countQuery;

  if (countError) {
    throwDatabaseError(countError, 'Unable to count titles');
  }

  if (count !== null && input.offset >= count) {
    return {
      items: [],
      count,
    };
  }

  let query = supabase.from('titles_with_genres').select('*');

  if (input.type) {
    query = query.eq('type', input.type);
  }

  if (input.q) {
    query = query.ilike('name', `%${input.q}%`);
  }

  if (input.genre) {
    query = query.contains('genres', [input.genre]);
  }

  const { data, error } = await query
    .order('name', { ascending: true })
    .range(input.offset, input.offset + input.limit - 1);

  if (error) {
    throwDatabaseError(error, 'Unable to list titles');
  }

  return {
    items: await attachSeenPercentages(supabase, (data ?? []).map(mapTitle)),
    count,
  };
}

export async function listAllTitles(
  supabase: SupabaseClient<Database>,
  type?: TitleType,
): Promise<TitleDto[]> {
  let query = supabase.from('titles_with_genres').select('*');

  if (type) {
    query = query.eq('type', type);
  }

  const { data, error } = await query.order('name', { ascending: true });

  if (error) {
    throwDatabaseError(error, 'Unable to list titles');
  }

  return attachSeenPercentages(supabase, (data ?? []).map(mapTitle));
}

export async function getTitleById(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<TitleDto> {
  const { data, error } = await supabase
    .from('titles_with_genres')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throwDatabaseError(error, 'Unable to load title');
  }

  if (!data) {
    throw notFound('Title not found');
  }

  const [title] = await attachSeenPercentages(supabase, [mapTitle(data)]);

  return title;
}

export async function getTitlesByIds(
  supabase: SupabaseClient<Database>,
  ids: string[],
): Promise<TitleDto[]> {
  if (ids.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('titles_with_genres')
    .select('*')
    .in('id', ids);

  if (error) {
    throwDatabaseError(error, 'Unable to load titles');
  }

  const titles = await attachSeenPercentages(supabase, (data ?? []).map(mapTitle));
  const byId = new Map(titles.map((title) => [title.id, title]));
  return ids.map((id) => byId.get(id)).filter((title): title is TitleDto => Boolean(title));
}

export async function getTitlesByExternalRefs(
  supabase: SupabaseClient<Database>,
  refs: ExternalTitleRef[],
): Promise<TitleDto[]> {
  const uniqueRefs = dedupeExternalRefs(refs);
  if (uniqueRefs.length === 0) {
    return [];
  }

  const rows: TitleViewRow[] = [];
  for (const ref of uniqueRefs) {
    const { data, error } = await supabase
      .from('titles_with_genres')
      .select('*')
      .eq('external_source', ref.source)
      .eq('type', ref.type)
      .eq('external_id', ref.externalId)
      .limit(1);

    if (error) {
      throwDatabaseError(error, 'Unable to load titles by external references');
    }

    const row = data?.[0];
    if (row) {
      rows.push(row);
    }
  }

  return attachSeenPercentages(supabase, rows.map(mapTitle));
}

function dedupeExternalRefs(refs: ExternalTitleRef[]): ExternalTitleRef[] {
  const seen = new Set<string>();
  const uniqueRefs: ExternalTitleRef[] = [];

  for (const ref of refs) {
    const source = ref.source.trim();
    const externalId = ref.externalId.trim();
    if (!source || !externalId) {
      continue;
    }

    const key = `${source}:${ref.type}:${externalId}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueRefs.push({ source, type: ref.type, externalId });
  }

  return uniqueRefs;
}

async function attachSeenPercentages(
  supabase: SupabaseClient<Database>,
  titles: TitleDto[],
): Promise<TitleDto[]> {
  if (titles.length === 0) {
    return titles;
  }

  const { count: profileCount, error: profileError } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true });

  if (profileError) {
    throwDatabaseError(profileError, 'Unable to count profiles');
  }

  const totalProfiles = profileCount ?? 0;
  if (totalProfiles === 0) {
    return titles.map((title) => ({ ...title, seenPercentage: 0 }));
  }

  const ids = [...new Set(titles.map((title) => title.id))];
  const { data, error } = await supabase
    .from('user_title_actions')
    .select('title_id, user_id')
    .in('title_id', ids)
    .in('action', ['liked', 'watched']);

  if (error) {
    throwDatabaseError(error, 'Unable to load title seen stats');
  }

  const usersByTitle = new Map<string, Set<string>>();
  for (const row of data ?? []) {
    const users = usersByTitle.get(row.title_id) ?? new Set<string>();
    users.add(row.user_id);
    usersByTitle.set(row.title_id, users);
  }

  return titles.map((title) => {
    const seenCount = usersByTitle.get(title.id)?.size ?? 0;
    return {
      ...title,
      seenPercentage: Math.round((seenCount / totalProfiles) * 100),
    };
  });
}

export async function ensureTitleExists(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<void> {
  await getTitleById(supabase, id);
}

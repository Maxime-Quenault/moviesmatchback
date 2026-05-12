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

export function mapTitle(row: TitleViewRow): TitleDto {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    description: row.description,
    releaseYear: row.release_year,
    duration: row.duration,
    posterUrl: row.poster_url,
    rating: row.rating,
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
    items: (data ?? []).map(mapTitle),
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

  return (data ?? []).map(mapTitle);
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

  return mapTitle(data);
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

  const byId = new Map((data ?? []).map((row) => [row.id, mapTitle(row)]));
  return ids.map((id) => byId.get(id)).filter((title): title is TitleDto => Boolean(title));
}

export async function ensureTitleExists(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<void> {
  await getTitleById(supabase, id);
}

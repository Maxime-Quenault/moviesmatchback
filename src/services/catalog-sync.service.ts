import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { hasTmdbConfig, type AppEnv } from '../config/env.js';
import { badRequest, configurationError, upstreamError } from '../lib/api-error.js';
import { throwDatabaseError } from '../lib/supabase-error.js';
import type { Database, TitleType } from '../types/database.js';

const supportedTypes = ['movie', 'series', 'anime'] as const satisfies readonly TitleType[];

type GenreSelection = Partial<Record<TitleType, number[]>>;
type GenreNameSelection = Partial<Record<TitleType, string[]>>;
type TitleInsert = Database['public']['Tables']['titles']['Insert'];
type TitleGenreInsert = Database['public']['Tables']['title_genres']['Insert'];

export interface ExternalGenreDto {
  id: number;
  name: string;
  type: TitleType;
  source: 'tmdb' | 'jikan';
}

export interface SyncCatalogInput {
  types?: TitleType[];
  genreIds?: GenreSelection;
  genreNames?: GenreNameSelection;
  allGenres?: boolean;
  pages: number;
  limit: number;
  language?: string;
}

export interface SyncedGenreResult {
  id: number;
  name: string;
  fetched: number;
}

export interface SyncedTypeResult {
  type: TitleType;
  source: 'tmdb' | 'jikan';
  genres: SyncedGenreResult[];
}

export interface SyncCatalogResult {
  savedTitles: number;
  savedRelations: number;
  types: SyncedTypeResult[];
}

interface CatalogItem {
  title: TitleInsert;
  genres: string[];
}

const tmdbGenreSchema = z.object({
  id: z.number(),
  name: z.string(),
});

const tmdbGenreListSchema = z.object({
  genres: z.array(tmdbGenreSchema),
});

const tmdbResultSchema = z.object({
  id: z.number(),
  title: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  overview: z.string().optional().nullable(),
  release_date: z.string().optional().nullable(),
  first_air_date: z.string().optional().nullable(),
  poster_path: z.string().optional().nullable(),
  vote_average: z.number().optional().nullable(),
  genre_ids: z.array(z.number()).optional(),
});

const tmdbDiscoverSchema = z.object({
  results: z.array(tmdbResultSchema),
});

const jikanGenreSchema = z.object({
  mal_id: z.number(),
  name: z.string(),
});

const jikanGenreListSchema = z.object({
  data: z.array(jikanGenreSchema),
});

const jikanAnimeSchema = z.object({
  mal_id: z.number(),
  title: z.string().optional().nullable(),
  title_english: z.string().optional().nullable(),
  synopsis: z.string().optional().nullable(),
  year: z.number().int().optional().nullable(),
  aired: z
    .object({
      from: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
  duration: z.string().optional().nullable(),
  score: z.number().optional().nullable(),
  images: z
    .object({
      jpg: z
        .object({
          image_url: z.string().optional().nullable(),
          large_image_url: z.string().optional().nullable(),
        })
        .optional()
        .nullable(),
    })
    .optional()
    .nullable(),
  genres: z.array(jikanGenreSchema).optional(),
});

const jikanAnimeSearchSchema = z.object({
  data: z.array(jikanAnimeSchema),
});

export async function listExternalGenres(
  env: AppEnv,
  type: TitleType,
  language?: string,
): Promise<ExternalGenreDto[]> {
  if (type === 'anime') {
    return listJikanGenres(env);
  }

  return listTmdbGenres(env, type, language ?? env.TMDB_LANGUAGE);
}

export async function syncExternalCatalog(
  supabase: SupabaseClient<Database>,
  env: AppEnv,
  input: SyncCatalogInput,
): Promise<SyncCatalogResult> {
  const types = resolveTypes(input);
  const items: CatalogItem[] = [];
  const typeResults: SyncedTypeResult[] = [];

  for (const type of types) {
    const externalGenres = await listExternalGenres(env, type, input.language);
    const selectedGenres = selectGenresForType(type, externalGenres, input);

    if (selectedGenres.length === 0) {
      continue;
    }

    const typeResult: SyncedTypeResult = {
      type,
      source: type === 'anime' ? 'jikan' : 'tmdb',
      genres: [],
    };

    const genreNameById = new Map(externalGenres.map((genre) => [genre.id, genre.name]));

    for (const genre of selectedGenres) {
      const fetchedItems =
        type === 'anime'
          ? await fetchJikanAnimeByGenre(env, genre, input)
          : await fetchTmdbTitlesByGenre(env, type, genre, input, genreNameById);

      items.push(...fetchedItems);
      typeResult.genres.push({
        id: genre.id,
        name: genre.name,
        fetched: fetchedItems.length,
      });
    }

    typeResults.push(typeResult);
  }

  if (typeResults.length === 0) {
    throw badRequest('Provide at least one genreId or genreName for the selected content types');
  }

  const mergedItems = mergeCatalogItems(items);
  const upsertResult = await upsertCatalogItems(supabase, mergedItems);

  return {
    ...upsertResult,
    types: typeResults,
  };
}

async function listTmdbGenres(
  env: AppEnv,
  type: Exclude<TitleType, 'anime'>,
  language: string,
): Promise<ExternalGenreDto[]> {
  assertTmdbConfigured(env);

  const mediaPath = type === 'movie' ? 'movie' : 'tv';
  const url = tmdbUrl(env, `/genre/${mediaPath}/list`, { language });
  const data = await fetchJson(url, tmdbHeaders(env));
  const parsed = tmdbGenreListSchema.parse(data);

  return parsed.genres.map((genre) => ({
    id: genre.id,
    name: genre.name,
    type,
    source: 'tmdb',
  }));
}

async function fetchTmdbTitlesByGenre(
  env: AppEnv,
  type: Exclude<TitleType, 'anime'>,
  genre: ExternalGenreDto,
  input: SyncCatalogInput,
  genreNameById: Map<number, string>,
): Promise<CatalogItem[]> {
  assertTmdbConfigured(env);

  const mediaPath = type === 'movie' ? 'movie' : 'tv';
  const items: CatalogItem[] = [];

  for (let page = 1; page <= input.pages; page++) {
    const url = tmdbUrl(env, `/discover/${mediaPath}`, {
      include_adult: 'false',
      include_video: 'false',
      language: input.language ?? env.TMDB_LANGUAGE,
      page: String(page),
      sort_by: 'popularity.desc',
      with_genres: String(genre.id),
    });

    const data = await fetchJson(url, tmdbHeaders(env));
    const parsed = tmdbDiscoverSchema.parse(data);

    for (const result of parsed.results.slice(0, input.limit)) {
      const title = normalizeText(type === 'movie' ? result.title : result.name);
      if (!title) {
        continue;
      }

      const posterUrl = result.poster_path
        ? `${env.TMDB_IMAGE_BASE_URL}${result.poster_path}`
        : null;
      const releaseDate = type === 'movie' ? result.release_date : result.first_air_date;
      const genres = genreNamesFromIds(result.genre_ids ?? [genre.id], genreNameById);

      items.push({
        title: {
          id: `tmdb-${type}-${result.id}`,
          type,
          name: title,
          description: normalizeText(result.overview),
          release_year: yearFromDate(releaseDate),
          duration: null,
          poster_url: posterUrl,
          rating: normalizeRating(result.vote_average),
          external_source: 'tmdb',
          external_id: String(result.id),
        },
        genres: genres.length > 0 ? genres : [genre.name],
      });
    }
  }

  return items;
}

async function listJikanGenres(env: AppEnv): Promise<ExternalGenreDto[]> {
  const url = jikanUrl(env, '/genres/anime');
  const data = await fetchJson(url);
  const parsed = jikanGenreListSchema.parse(data);

  return parsed.data.map((genre) => ({
    id: genre.mal_id,
    name: genre.name,
    type: 'anime',
    source: 'jikan',
  }));
}

async function fetchJikanAnimeByGenre(
  env: AppEnv,
  genre: ExternalGenreDto,
  input: SyncCatalogInput,
): Promise<CatalogItem[]> {
  const items: CatalogItem[] = [];

  for (let page = 1; page <= input.pages; page++) {
    const url = jikanUrl(env, '/anime', {
      genres: String(genre.id),
      limit: String(Math.min(input.limit, 25)),
      order_by: 'score',
      page: String(page),
      sfw: 'true',
      sort: 'desc',
    });

    const data = await fetchJson(url);
    const parsed = jikanAnimeSearchSchema.parse(data);

    for (const result of parsed.data) {
      const title = normalizeText(result.title_english) ?? normalizeText(result.title);
      if (!title) {
        continue;
      }

      const image = result.images?.jpg?.large_image_url ?? result.images?.jpg?.image_url ?? null;
      const animeGenres =
        result.genres
          ?.map((item) => normalizeGenreName(item.name))
          .filter((name): name is string => Boolean(name)) ?? [];

      items.push({
        title: {
          id: `jikan-anime-${result.mal_id}`,
          type: 'anime',
          name: title,
          description: normalizeText(result.synopsis),
          release_year: result.year ?? yearFromDate(result.aired?.from),
          duration: normalizeText(result.duration),
          poster_url: image,
          rating: normalizeRating(result.score),
          external_source: 'jikan',
          external_id: String(result.mal_id),
        },
        genres: animeGenres.length > 0 ? animeGenres : [genre.name],
      });
    }
  }

  return items;
}

async function upsertCatalogItems(
  supabase: SupabaseClient<Database>,
  items: CatalogItem[],
): Promise<Pick<SyncCatalogResult, 'savedTitles' | 'savedRelations'>> {
  if (items.length === 0) {
    return {
      savedTitles: 0,
      savedRelations: 0,
    };
  }

  const titles = items.map((item) => item.title);
  const { error: titlesError } = await supabase
    .from('titles')
    .upsert(titles, { onConflict: 'id' });

  if (titlesError) {
    throwDatabaseError(titlesError, 'Unable to save imported titles');
  }

  const genreNames = unique(
    items.flatMap((item) =>
      item.genres.map(normalizeGenreName).filter((name): name is string => Boolean(name)),
    ),
  );

  if (genreNames.length === 0) {
    return {
      savedTitles: titles.length,
      savedRelations: 0,
    };
  }

  const { error: upsertGenresError } = await supabase
    .from('genres')
    .upsert(
      genreNames.map((name) => ({ name })),
      { onConflict: 'name' },
    );

  if (upsertGenresError) {
    throwDatabaseError(upsertGenresError, 'Unable to save imported genres');
  }

  const { data: genreRows, error: genresError } = await supabase
    .from('genres')
    .select('id,name')
    .in('name', genreNames);

  if (genresError) {
    throwDatabaseError(genresError, 'Unable to load imported genres');
  }

  const genreIdByName = new Map((genreRows ?? []).map((row) => [row.name, row.id]));
  const titleIds = unique(titles.map((title) => title.id));

  const { error: deleteRelationsError } = await supabase
    .from('title_genres')
    .delete()
    .in('title_id', titleIds);

  if (deleteRelationsError) {
    throwDatabaseError(deleteRelationsError, 'Unable to refresh imported title genres');
  }

  const relations = uniqueRelations(
    items.flatMap((item) =>
      item.genres
        .map(normalizeGenreName)
        .filter((name): name is string => Boolean(name))
        .map((name) => {
          const genreId = genreIdByName.get(name);
          return genreId
            ? {
                title_id: item.title.id,
                genre_id: genreId,
              }
            : null;
        })
        .filter((relation): relation is TitleGenreInsert => Boolean(relation)),
    ),
  );

  if (relations.length > 0) {
    const { error: relationsError } = await supabase
      .from('title_genres')
      .upsert(relations, { onConflict: 'title_id,genre_id' });

    if (relationsError) {
      throwDatabaseError(relationsError, 'Unable to save imported title genres');
    }
  }

  return {
    savedTitles: titles.length,
    savedRelations: relations.length,
  };
}

function resolveTypes(input: SyncCatalogInput): TitleType[] {
  if (input.types && input.types.length > 0) {
    return unique(input.types);
  }

  const selectedTypes = supportedTypes.filter(
    (type) => (input.genreIds?.[type]?.length ?? 0) > 0 || (input.genreNames?.[type]?.length ?? 0) > 0,
  );

  if (selectedTypes.length > 0) {
    return selectedTypes;
  }

  if (input.allGenres) {
    return [...supportedTypes];
  }

  return [];
}

function selectGenresForType(
  type: TitleType,
  externalGenres: ExternalGenreDto[],
  input: SyncCatalogInput,
): ExternalGenreDto[] {
  if (input.allGenres) {
    return externalGenres;
  }

  const selectedIds = new Set(input.genreIds?.[type] ?? []);
  const selectedNames = new Set(
    (input.genreNames?.[type] ?? []).map((name) => name.toLocaleLowerCase()),
  );

  return externalGenres.filter(
    (genre) =>
      selectedIds.has(genre.id) || selectedNames.has(genre.name.toLocaleLowerCase()),
  );
}

function mergeCatalogItems(items: CatalogItem[]): CatalogItem[] {
  const byId = new Map<string, CatalogItem & { genreSet: Set<string> }>();

  for (const item of items) {
    const existing = byId.get(item.title.id);

    if (!existing) {
      byId.set(item.title.id, {
        title: item.title,
        genres: [],
        genreSet: new Set(item.genres),
      });
      continue;
    }

    for (const genre of item.genres) {
      existing.genreSet.add(genre);
    }
  }

  return [...byId.values()].map((item) => ({
    title: item.title,
    genres: [...item.genreSet],
  }));
}

function genreNamesFromIds(ids: number[], genreNameById: Map<number, string>): string[] {
  return ids
    .map((id) => genreNameById.get(id))
    .map((name) => (name ? normalizeGenreName(name) : null))
    .filter((name): name is string => Boolean(name));
}

function tmdbUrl(env: AppEnv, path: string, query: Record<string, string>): URL {
  const url = new URL(`${env.TMDB_BASE_URL}${path}`);

  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  if (!env.TMDB_ACCESS_TOKEN && env.TMDB_API_KEY) {
    url.searchParams.set('api_key', env.TMDB_API_KEY);
  }

  return url;
}

function jikanUrl(env: AppEnv, path: string, query: Record<string, string> = {}): URL {
  const url = new URL(`${env.JIKAN_BASE_URL}${path}`);

  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  return url;
}

function tmdbHeaders(env: AppEnv): Record<string, string> {
  return {
    accept: 'application/json',
    ...(env.TMDB_ACCESS_TOKEN ? { Authorization: `Bearer ${env.TMDB_ACCESS_TOKEN}` } : {}),
  };
}

async function fetchJson(url: URL, headers?: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw upstreamError('External catalog request failed', {
      status: response.status,
      url: url.toString(),
    });
  }

  return response.json() as Promise<unknown>;
}

function assertTmdbConfigured(env: AppEnv): void {
  if (!hasTmdbConfig(env)) {
    throw configurationError(
      'TMDB is not configured. Set TMDB_ACCESS_TOKEN or TMDB_API_KEY on the backend.',
    );
  }
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeGenreName(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed : null;
}

function yearFromDate(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const year = Number(value.slice(0, 4));
  return Number.isInteger(year) && year > 0 ? year : null;
}

function normalizeRating(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return Math.round(value * 10) / 10;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function uniqueRelations(relations: TitleGenreInsert[]): TitleGenreInsert[] {
  const seen = new Set<string>();
  const uniqueItems: TitleGenreInsert[] = [];

  for (const relation of relations) {
    const key = `${relation.title_id}:${relation.genre_id}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueItems.push(relation);
  }

  return uniqueItems;
}

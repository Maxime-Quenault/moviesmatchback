import { z } from 'zod';

import { hasTmdbConfig, type AppEnv } from '../config/env.js';
import { configurationError, upstreamError } from '../lib/api-error.js';
import type { TitleType } from '../types/database.js';

type TmdbDiscoveryType = Exclude<TitleType, 'anime'>;

export interface TmdbDiscoveryInput {
  type: TmdbDiscoveryType;
  page?: number;
  limit: number;
  language?: string;
  genreId?: number;
  genreNames?: string[];
  releaseYearMin?: number;
  releaseYearMax?: number;
}

export interface TmdbSearchInput {
  query: string;
  type?: TmdbDiscoveryType;
  limit: number;
  language?: string;
}

export interface ExternalTitleDto {
  id: string;
  type: TmdbDiscoveryType;
  name: string;
  description: string | null;
  releaseYear: number | null;
  duration: string | null;
  posterUrl: string | null;
  rating: number | null;
  externalSource: 'tmdb';
  externalId: string;
  genres: string[];
  rawData?: unknown;
}

const tmdbGenreSchema = z.object({
  id: z.number(),
  name: z.string(),
});

const tmdbGenreListSchema = z.object({
  genres: z.array(tmdbGenreSchema),
});

const tmdbDiscoverResultSchema = z.object({
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
  page: z.number(),
  results: z.array(tmdbDiscoverResultSchema),
  total_pages: z.number().optional(),
});

const tmdbMovieDetailSchema = z.object({
  runtime: z.number().optional().nullable(),
  genres: z.array(tmdbGenreSchema).optional(),
});

const tmdbTvDetailSchema = z.object({
  episode_run_time: z.array(z.number()).optional(),
  genres: z.array(tmdbGenreSchema).optional(),
});

export async function discoverTmdbTitles(
  env: AppEnv,
  input: TmdbDiscoveryInput,
): Promise<ExternalTitleDto[]> {
  assertTmdbConfigured(env);

  const language = input.language ?? env.TMDB_LANGUAGE;
  const page = input.page ?? Math.floor(Math.random() * 50) + 1;
  const mediaPath = input.type === 'movie' ? 'movie' : 'tv';
  const genres = await listTmdbGenres(env, input.type, language);
  const discovery = await fetchTmdbJson(
    env,
    `/discover/${mediaPath}`,
    {
      include_adult: 'false',
      include_video: 'false',
      language,
      page: String(page),
      sort_by: 'popularity.desc',
      'vote_count.gte': '25',
      ...buildGenreQuery(input, genres),
      ...buildYearQuery(input),
    },
    tmdbDiscoverSchema,
  );
  const genreNameById = new Map(genres.map((genre) => [genre.id, genre.name]));
  const limitedResults = discovery.results.slice(0, input.limit);

  const items: Array<ExternalTitleDto | null> = await Promise.all(
    limitedResults.map(async (result) => {
      const title = normalizeText(
        input.type === 'movie' ? result.title : result.name,
      );
      if (!title || !result.poster_path) {
        return null;
      }

      const detail = await fetchTmdbDetail(
        env,
        input.type,
        result.id,
        language,
      );
      const detailGenres = detail.genres.length > 0 ? detail.genres : null;
      const genres =
        detailGenres ??
        genreNamesFromIds(result.genre_ids ?? [], genreNameById);
      const releaseDate =
        input.type === 'movie' ? result.release_date : result.first_air_date;

      return {
        id: String(result.id),
        type: input.type,
        name: title,
        description: normalizeText(result.overview),
        releaseYear: yearFromDate(releaseDate),
        duration: detail.duration,
        posterUrl: `${env.TMDB_IMAGE_BASE_URL}${result.poster_path}`,
        rating: normalizeRating(result.vote_average),
        externalSource: 'tmdb' as const,
        externalId: String(result.id),
        genres,
        rawData: result,
      };
    }),
  );

  return items.filter((item): item is ExternalTitleDto => Boolean(item));
}

export async function searchTmdbTitles(
  env: AppEnv,
  input: TmdbSearchInput,
): Promise<ExternalTitleDto[]> {
  assertTmdbConfigured(env);

  const query = normalizeText(input.query);
  if (!query) {
    return [];
  }

  const language = input.language ?? env.TMDB_LANGUAGE;
  const types = input.type
    ? [input.type]
    : (['movie', 'series'] as const satisfies readonly TmdbDiscoveryType[]);

  const batches = await Promise.all(
    types.map((type) =>
      searchTmdbTitlesByType(env, {
        query,
        type,
        limit: input.limit,
        language,
      }),
    ),
  );

  const mergedItems = input.type ? batches.flat() : interleaveBatches(batches);
  return dedupeExternalTitles(mergedItems).slice(0, input.limit);
}

async function searchTmdbTitlesByType(
  env: AppEnv,
  input: Required<TmdbSearchInput> & { type: TmdbDiscoveryType },
): Promise<ExternalTitleDto[]> {
  const mediaPath = input.type === 'movie' ? 'movie' : 'tv';
  const [genres, search] = await Promise.all([
    listTmdbGenres(env, input.type, input.language),
    fetchTmdbJson(
      env,
      `/search/${mediaPath}`,
      {
        include_adult: 'false',
        language: input.language,
        page: '1',
        query: input.query,
      },
      tmdbDiscoverSchema,
    ),
  ]);
  const genreNameById = new Map(genres.map((genre) => [genre.id, genre.name]));

  return search.results
    .slice(0, input.limit)
    .map((result): ExternalTitleDto | null => {
      const title = normalizeText(
        input.type === 'movie' ? result.title : result.name,
      );
      if (!title) {
        return null;
      }

      const releaseDate =
        input.type === 'movie' ? result.release_date : result.first_air_date;

      return {
        id: String(result.id),
        type: input.type,
        name: title,
        description: normalizeText(result.overview),
        releaseYear: yearFromDate(releaseDate),
        duration: null,
        posterUrl: result.poster_path
          ? `${env.TMDB_IMAGE_BASE_URL}${result.poster_path}`
          : null,
        rating: normalizeRating(result.vote_average),
        externalSource: 'tmdb' as const,
        externalId: String(result.id),
        genres: genreNamesFromIds(result.genre_ids ?? [], genreNameById),
        rawData: result,
      };
    })
    .filter((item): item is ExternalTitleDto => Boolean(item));
}

async function listTmdbGenres(
  env: AppEnv,
  type: TmdbDiscoveryType,
  language: string,
) {
  const mediaPath = type === 'movie' ? 'movie' : 'tv';
  const data = await fetchTmdbJson(
    env,
    `/genre/${mediaPath}/list`,
    { language },
    tmdbGenreListSchema,
  );

  return data.genres;
}

async function fetchTmdbDetail(
  env: AppEnv,
  type: TmdbDiscoveryType,
  id: number,
  language: string,
): Promise<{ duration: string | null; genres: string[] }> {
  if (type === 'movie') {
    const detail = await fetchTmdbJson(
      env,
      `/movie/${id}`,
      { language },
      tmdbMovieDetailSchema,
    );

    return {
      duration: formatMovieRuntime(detail.runtime),
      genres: detail.genres?.map((genre) => genre.name) ?? [],
    };
  }

  const detail = await fetchTmdbJson(
    env,
    `/tv/${id}`,
    { language },
    tmdbTvDetailSchema,
  );
  const runtime = detail.episode_run_time?.find((value) => value > 0);

  return {
    duration: runtime ? `${runtime} min / ep` : null,
    genres: detail.genres?.map((genre) => genre.name) ?? [],
  };
}

async function fetchTmdbJson<T>(
  env: AppEnv,
  path: string,
  query: Record<string, string>,
  schema: z.ZodType<T>,
): Promise<T> {
  const url = new URL(`${env.TMDB_BASE_URL}${path}`);

  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  if (!env.TMDB_ACCESS_TOKEN && env.TMDB_API_KEY) {
    url.searchParams.set('api_key', env.TMDB_API_KEY);
  }

  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      ...(env.TMDB_ACCESS_TOKEN
        ? { Authorization: `Bearer ${env.TMDB_ACCESS_TOKEN}` }
        : {}),
    },
  });

  if (!response.ok) {
    throw upstreamError('TMDB request failed', {
      status: response.status,
      url: url.toString(),
    });
  }

  return schema.parse(await response.json());
}

function assertTmdbConfigured(env: AppEnv): void {
  if (!hasTmdbConfig(env)) {
    throw configurationError(
      'TMDB is not configured. Set TMDB_ACCESS_TOKEN or TMDB_API_KEY on the backend.',
    );
  }
}

function genreNamesFromIds(
  ids: number[],
  genreNameById: Map<number, string>,
): string[] {
  return ids
    .map((id) => genreNameById.get(id))
    .filter((name): name is string => Boolean(name));
}

function buildGenreQuery(
  input: TmdbDiscoveryInput,
  genres: Array<{ id: number; name: string }>,
): Record<string, string> {
  const ids = new Set<number>();

  if (input.genreId) {
    ids.add(input.genreId);
  }

  for (const genreName of input.genreNames ?? []) {
    const genreId = resolveTmdbGenreId(genreName, genres);
    if (genreId) {
      ids.add(genreId);
    }
  }

  return ids.size > 0 ? { with_genres: [...ids].join('|') } : {};
}

function buildYearQuery(input: TmdbDiscoveryInput): Record<string, string> {
  const query: Record<string, string> = {};
  const min = input.releaseYearMin;
  const max = input.releaseYearMax;

  if (input.type === 'movie') {
    if (min) {
      query['primary_release_date.gte'] = `${min}-01-01`;
    }

    if (max) {
      query['primary_release_date.lte'] = `${max}-12-31`;
    }

    return query;
  }

  if (min) {
    query['first_air_date.gte'] = `${min}-01-01`;
  }

  if (max) {
    query['first_air_date.lte'] = `${max}-12-31`;
  }

  return query;
}

function resolveTmdbGenreId(
  genreName: string,
  genres: Array<{ id: number; name: string }>,
): number | null {
  const requested = normalizeGenreKey(genreName);
  const aliases = tmdbGenreAliases(requested);

  for (const genre of genres) {
    const key = normalizeGenreKey(genre.name);
    if (key === requested || aliases.has(key)) {
      return genre.id;
    }
  }

  return null;
}

function tmdbGenreAliases(key: string): Set<string> {
  const aliases = new Map<string, string[]>([
    ['aventure', ['adventure']],
    ['comedie', ['comedy']],
    ['documentaire', ['documentary']],
    ['drame', ['drama']],
    ['famille', ['family', 'familial']],
    ['fantastique', ['fantasy']],
    ['historique', ['histoire', 'history']],
    ['horreur', ['horror']],
    ['mystere', ['mystery']],
    ['romance', ['romance']],
    ['sciencefiction', ['sciencefiction', 'scifi', 'sciencefiction']],
    ['superheros', ['action']],
    ['guerre', ['war']],
    ['western', ['western']],
  ]);

  return new Set(aliases.get(key) ?? []);
}

function normalizeGenreKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function interleaveBatches(batches: ExternalTitleDto[][]): ExternalTitleDto[] {
  const items: ExternalTitleDto[] = [];
  const maxLength = Math.max(0, ...batches.map((batch) => batch.length));

  for (let index = 0; index < maxLength; index++) {
    for (const batch of batches) {
      const item = batch[index];
      if (item) {
        items.push(item);
      }
    }
  }

  return items;
}

function dedupeExternalTitles(items: ExternalTitleDto[]): ExternalTitleDto[] {
  const seen = new Set<string>();
  const uniqueItems: ExternalTitleDto[] = [];

  for (const item of items) {
    const key = `${item.externalSource}:${item.type}:${item.externalId}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueItems.push(item);
  }

  return uniqueItems;
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
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

function formatMovieRuntime(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) {
    return null;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours <= 0) {
    return `${remainingMinutes} min`;
  }

  return `${hours}h ${String(remainingMinutes).padStart(2, '0')}`;
}

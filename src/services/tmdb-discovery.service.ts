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
  const [genres, discovery] = await Promise.all([
    listTmdbGenres(env, input.type, language),
    fetchTmdbJson(
      env,
      `/discover/${mediaPath}`,
      {
        include_adult: 'false',
        include_video: 'false',
        language,
        page: String(page),
        sort_by: 'popularity.desc',
        'vote_count.gte': '25',
        ...(input.genreId ? { with_genres: String(input.genreId) } : {}),
      },
      tmdbDiscoverSchema,
    ),
  ]);
  const genreNameById = new Map(genres.map((genre) => [genre.id, genre.name]));
  const limitedResults = discovery.results.slice(0, input.limit);

  const items: Array<ExternalTitleDto | null> = await Promise.all(
    limitedResults.map(async (result) => {
      const title = normalizeText(input.type === 'movie' ? result.title : result.name);
      if (!title || !result.poster_path) {
        return null;
      }

      const detail = await fetchTmdbDetail(env, input.type, result.id, language);
      const detailGenres = detail.genres.length > 0 ? detail.genres : null;
      const genres = detailGenres ?? genreNamesFromIds(result.genre_ids ?? [], genreNameById);
      const releaseDate = input.type === 'movie' ? result.release_date : result.first_air_date;

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
      ...(env.TMDB_ACCESS_TOKEN ? { Authorization: `Bearer ${env.TMDB_ACCESS_TOKEN}` } : {}),
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

function genreNamesFromIds(ids: number[], genreNameById: Map<number, string>): string[] {
  return ids
    .map((id) => genreNameById.get(id))
    .filter((name): name is string => Boolean(name));
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

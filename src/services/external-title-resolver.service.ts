import { z } from 'zod';

import { hasTmdbConfig, type AppEnv } from '../config/env.js';
import { upstreamError } from '../lib/api-error.js';
import type { TitleType } from '../types/database.js';

type MediaSource = 'tmdb' | 'jikan' | 'local';

interface MediaKeyParts {
  source: MediaSource;
  type: TitleType;
  externalType: 'movie' | 'tv' | 'anime';
  externalId: string;
}

export interface ResolvedMediaTitleDto {
  id: string;
  type: TitleType;
  name: string;
  description: string | null;
  releaseYear: number | null;
  duration: string | null;
  posterUrl: string | null;
  rating: number | null;
  seenPercentage: number | null;
  externalSource: MediaSource;
  externalId: string;
  genres: string[];
  rawData?: unknown;
}

const tmdbGenreSchema = z.object({
  id: z.number(),
  name: z.string(),
});

const tmdbMovieDetailSchema = z.object({
  id: z.number(),
  title: z.string().optional().nullable(),
  overview: z.string().optional().nullable(),
  release_date: z.string().optional().nullable(),
  runtime: z.number().optional().nullable(),
  poster_path: z.string().optional().nullable(),
  vote_average: z.number().optional().nullable(),
  genres: z.array(tmdbGenreSchema).optional(),
});

const tmdbTvDetailSchema = z.object({
  id: z.number(),
  name: z.string().optional().nullable(),
  overview: z.string().optional().nullable(),
  first_air_date: z.string().optional().nullable(),
  episode_run_time: z.array(z.number()).optional(),
  poster_path: z.string().optional().nullable(),
  vote_average: z.number().optional().nullable(),
  genres: z.array(tmdbGenreSchema).optional(),
});

const jikanGenreSchema = z.object({
  mal_id: z.number(),
  name: z.string(),
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

const jikanAnimeResponseSchema = z.object({
  data: jikanAnimeSchema,
});

export function parseMediaKey(mediaKey: string): MediaKeyParts | null {
  const [source, rawType, externalId, ...extra] = mediaKey.split(':');

  if (!source || !rawType || !externalId || extra.length > 0) {
    return null;
  }

  if (source === 'tmdb') {
    if (rawType === 'movie') {
      return { source, type: 'movie', externalType: 'movie', externalId };
    }

    if (rawType === 'tv' || rawType === 'series') {
      return { source, type: 'series', externalType: 'tv', externalId };
    }
  }

  if (source === 'jikan' && rawType === 'anime') {
    return { source, type: 'anime', externalType: 'anime', externalId };
  }

  if (source === 'local') {
    if (rawType === 'movie' || rawType === 'anime' || rawType === 'series') {
      return {
        source,
        type: rawType,
        externalType: rawType === 'series' ? 'tv' : rawType,
        externalId,
      };
    }

    if (rawType === 'tv') {
      return { source, type: 'series', externalType: 'tv', externalId };
    }
  }

  return null;
}

export async function resolveMediaKeys(
  env: AppEnv,
  mediaKeys: string[],
): Promise<Map<string, ResolvedMediaTitleDto | null>> {
  const uniqueKeys = [...new Set(mediaKeys)];
  const resolved = new Map<string, ResolvedMediaTitleDto | null>();

  for (const mediaKey of uniqueKeys) {
    const parts = parseMediaKey(mediaKey);
    if (!parts || parts.source === 'local') {
      resolved.set(mediaKey, null);
      continue;
    }

    try {
      const title =
        parts.source === 'tmdb'
          ? await resolveTmdbTitle(env, parts)
          : await resolveJikanAnime(env, parts);
      resolved.set(mediaKey, title);
    } catch {
      resolved.set(mediaKey, null);
    }
  }

  return resolved;
}

async function resolveTmdbTitle(
  env: AppEnv,
  parts: MediaKeyParts,
): Promise<ResolvedMediaTitleDto | null> {
  if (!hasTmdbConfig(env)) {
    return null;
  }

  const id = Number(parts.externalId);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  const language = env.TMDB_LANGUAGE;
  if (parts.externalType === 'movie') {
    const detail = await fetchTmdbJson(
      env,
      `/movie/${id}`,
      { language },
      tmdbMovieDetailSchema,
    );
    const name = normalizeText(detail.title);
    if (!name) {
      return null;
    }

    return {
      id: String(detail.id),
      type: 'movie',
      name,
      description: normalizeText(detail.overview),
      releaseYear: yearFromDate(detail.release_date),
      duration: formatMovieRuntime(detail.runtime),
      posterUrl: detail.poster_path
        ? `${env.TMDB_IMAGE_BASE_URL}${detail.poster_path}`
        : null,
      rating: normalizeRating(detail.vote_average),
      seenPercentage: null,
      externalSource: 'tmdb',
      externalId: String(detail.id),
      genres: detail.genres?.map((genre) => genre.name) ?? [],
      rawData: detail,
    };
  }

  const detail = await fetchTmdbJson(
    env,
    `/tv/${id}`,
    { language },
    tmdbTvDetailSchema,
  );
  const name = normalizeText(detail.name);
  if (!name) {
    return null;
  }

  const runtime = detail.episode_run_time?.find((value) => value > 0);
  return {
    id: String(detail.id),
    type: 'series',
    name,
    description: normalizeText(detail.overview),
    releaseYear: yearFromDate(detail.first_air_date),
    duration: runtime ? `${runtime} min / ep` : null,
    posterUrl: detail.poster_path
      ? `${env.TMDB_IMAGE_BASE_URL}${detail.poster_path}`
      : null,
    rating: normalizeRating(detail.vote_average),
    seenPercentage: null,
    externalSource: 'tmdb',
    externalId: String(detail.id),
    genres: detail.genres?.map((genre) => genre.name) ?? [],
    rawData: detail,
  };
}

async function resolveJikanAnime(
  env: AppEnv,
  parts: MediaKeyParts,
): Promise<ResolvedMediaTitleDto | null> {
  const id = Number(parts.externalId);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  const url = new URL(`${env.JIKAN_BASE_URL}/anime/${id}`);
  const parsed = await fetchJson(url, undefined, jikanAnimeResponseSchema);
  const anime = parsed.data;
  const name = normalizeText(anime.title_english) ?? normalizeText(anime.title);
  if (!name) {
    return null;
  }

  const posterUrl =
    anime.images?.jpg?.large_image_url ?? anime.images?.jpg?.image_url ?? null;

  return {
    id: String(anime.mal_id),
    type: 'anime',
    name,
    description: normalizeText(anime.synopsis),
    releaseYear: anime.year ?? yearFromDate(anime.aired?.from),
    duration: normalizeText(anime.duration),
    posterUrl,
    rating: normalizeRating(anime.score),
    seenPercentage: null,
    externalSource: 'jikan',
    externalId: String(anime.mal_id),
    genres: anime.genres?.map((genre) => genre.name) ?? [],
    rawData: anime,
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

  return fetchJson(
    url,
    {
      accept: 'application/json',
      ...(env.TMDB_ACCESS_TOKEN
        ? { Authorization: `Bearer ${env.TMDB_ACCESS_TOKEN}` }
        : {}),
    },
    schema,
  );
}

async function fetchJson<T>(
  url: URL,
  headers: Record<string, string> | undefined,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw upstreamError('External title resolve request failed', {
      status: response.status,
      url: url.toString(),
    });
  }

  return schema.parse(await response.json());
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

import type { SupabaseClient } from '@supabase/supabase-js';

import { badRequest } from '../lib/api-error.js';
import { throwDatabaseError } from '../lib/supabase-error.js';
import type { AuthenticatedUser, Database } from '../types/database.js';
import { ensureProfile } from './user.service.js';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export interface GenreOptionDto {
  id: string;
  name: string;
}

export interface UserPreferencesDto {
  preferredGenres: string[];
  releaseYearMin: number | null;
  releaseYearMax: number | null;
}

export interface UpdateUserPreferencesInput {
  preferredGenres: string[];
  releaseYearMin?: number | null;
  releaseYearMax?: number | null;
}

export async function listPreferenceGenres(
  supabase: SupabaseClient<Database>,
): Promise<GenreOptionDto[]> {
  const { data, error } = await supabase
    .from('genres')
    .select('id,name')
    .order('name', { ascending: true });

  if (error) {
    throwDatabaseError(error, 'Unable to load preference genres');
  }

  return (data ?? []).map((genre) => ({
    id: genre.id,
    name: genre.name,
  }));
}

export async function getUserPreferences(
  supabase: SupabaseClient<Database>,
  user: AuthenticatedUser,
): Promise<UserPreferencesDto> {
  await ensureProfile(supabase, user);

  const { data, error } = await supabase
    .from('profiles')
    .select('preferred_genres, release_year_min, release_year_max')
    .eq('id', user.id)
    .single();

  if (error) {
    throwDatabaseError(error, 'Unable to load user preferences');
  }

  return mapPreferences(
    data as Pick<
      ProfileRow,
      'preferred_genres' | 'release_year_min' | 'release_year_max'
    >,
  );
}

export async function updateUserPreferences(
  supabase: SupabaseClient<Database>,
  user: AuthenticatedUser,
  input: UpdateUserPreferencesInput,
): Promise<UserPreferencesDto> {
  await ensureProfile(supabase, user);
  const normalized = await normalizePreferencesInput(supabase, input, {
    enforceMinimumGenres: true,
  });

  const { data, error } = await supabase
    .from('profiles')
    .update({
      preferred_genres: normalized.preferredGenres,
      release_year_min: normalized.releaseYearMin,
      release_year_max: normalized.releaseYearMax,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id)
    .select('preferred_genres, release_year_min, release_year_max')
    .single();

  if (error) {
    throwDatabaseError(error, 'Unable to update user preferences');
  }

  return mapPreferences(
    data as Pick<
      ProfileRow,
      'preferred_genres' | 'release_year_min' | 'release_year_max'
    >,
  );
}

export async function normalizePreferencesInput(
  supabase: SupabaseClient<Database>,
  input: UpdateUserPreferencesInput,
  options: { enforceMinimumGenres: boolean },
): Promise<UserPreferencesDto> {
  const preferredGenres = await normalizeGenreNames(
    supabase,
    input.preferredGenres,
  );

  if (options.enforceMinimumGenres && preferredGenres.length < 3) {
    throw badRequest('Select at least 3 preferred genres');
  }

  const releaseYearMin = input.releaseYearMin ?? null;
  const releaseYearMax = input.releaseYearMax ?? null;
  validateYearRange(releaseYearMin, releaseYearMax);

  return {
    preferredGenres,
    releaseYearMin,
    releaseYearMax,
  };
}

function mapPreferences(
  row: Pick<
    ProfileRow,
    'preferred_genres' | 'release_year_min' | 'release_year_max'
  >,
): UserPreferencesDto {
  return {
    preferredGenres: Array.isArray(row.preferred_genres)
      ? row.preferred_genres
      : [],
    releaseYearMin: row.release_year_min,
    releaseYearMax: row.release_year_max,
  };
}

async function normalizeGenreNames(
  supabase: SupabaseClient<Database>,
  genres: string[],
): Promise<string[]> {
  const requested = [
    ...new Set(genres.map((genre) => genre.trim()).filter(Boolean)),
  ];
  if (requested.length === 0) {
    return [];
  }

  const options = await listPreferenceGenres(supabase);
  const optionByKey = new Map(
    options.map((genre) => [normalizeKey(genre.name), genre.name]),
  );
  const normalized: string[] = [];
  const missing: string[] = [];

  for (const genre of requested) {
    const option = optionByKey.get(normalizeKey(genre));
    if (option) {
      normalized.push(option);
    } else {
      missing.push(genre);
    }
  }

  if (missing.length > 0) {
    throw badRequest('Unknown preferred genre', { genres: missing });
  }

  return normalized;
}

function validateYearRange(
  releaseYearMin: number | null,
  releaseYearMax: number | null,
): void {
  const currentYear = new Date().getUTCFullYear();
  const minAllowedYear = 1888;
  const maxAllowedYear = currentYear + 5;

  for (const year of [releaseYearMin, releaseYearMax]) {
    if (year === null) {
      continue;
    }

    if (
      !Number.isInteger(year) ||
      year < minAllowedYear ||
      year > maxAllowedYear
    ) {
      throw badRequest(
        `Release year must be between ${minAllowedYear} and ${maxAllowedYear}`,
      );
    }
  }

  if (
    releaseYearMin !== null &&
    releaseYearMax !== null &&
    releaseYearMin > releaseYearMax
  ) {
    throw badRequest('Release year minimum cannot be greater than maximum');
  }
}

function normalizeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

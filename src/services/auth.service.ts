import type { Session, SupabaseClient, User } from '@supabase/supabase-js';

import { badRequest, conflict, unauthorized } from '../lib/api-error.js';
import { throwDatabaseError } from '../lib/supabase-error.js';
import type { AuthenticatedUser, Database } from '../types/database.js';
import { normalizePreferencesInput } from './preference.service.js';
import { ensureProfile, mapProfile, type ProfileDto } from './user.service.js';

export interface AuthPayload {
  email: string;
  password: string;
  displayName?: string;
  username?: string;
  preferredGenres: string[];
  releaseYearMin?: number | null;
  releaseYearMax?: number | null;
}

export interface RefreshPayload {
  refreshToken: string;
}

export interface AuthSessionDto {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  expiresAt: number | null;
  tokenType: string;
}

export interface AuthUserDto {
  id: string;
  email: string | null;
}

export interface AuthResponseDto {
  user: AuthUserDto;
  profile: ProfileDto;
  session: AuthSessionDto;
}

export const invalidCredentialsMessage =
  'Mot de passe ou adresse mail incorrect';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toAuthenticatedUser(user: User): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email ?? null,
  };
}

function mapSession(session: Session): AuthSessionDto {
  if (!session.access_token || !session.refresh_token) {
    throw unauthorized('Unable to create an authenticated session');
  }

  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in,
    expiresAt: session.expires_at ?? null,
    tokenType: session.token_type,
  };
}

function mapAuthError(error: { message: string; status?: number }): never {
  const message = error.message.toLowerCase();

  if (
    error.status === 422 ||
    message.includes('already') ||
    message.includes('registered') ||
    message.includes('exists')
  ) {
    throw conflict('An account already exists for this email address');
  }

  if (
    error.status === 400 ||
    message.includes('password') ||
    message.includes('email')
  ) {
    throw badRequest(error.message);
  }

  throw unauthorized(error.message);
}

async function upsertProfileFromAuth(
  supabase: SupabaseClient<Database>,
  user: AuthenticatedUser,
  input: Pick<
    AuthPayload,
    | 'displayName'
    | 'username'
    | 'preferredGenres'
    | 'releaseYearMin'
    | 'releaseYearMax'
  >,
): Promise<ProfileDto> {
  const preferences = await normalizePreferencesInput(supabase, input, {
    enforceMinimumGenres: true,
  });
  const fallbackName = user.email?.split('@')[0] ?? 'Compte local';
  const profileInput: Database['public']['Tables']['profiles']['Insert'] = {
    id: user.id,
    display_name: input.displayName?.trim() || fallbackName,
    preferred_genres: preferences.preferredGenres,
    release_year_min: preferences.releaseYearMin,
    release_year_max: preferences.releaseYearMax,
    updated_at: new Date().toISOString(),
  };

  if (input.username?.trim()) {
    profileInput.username = input.username.trim();
  }

  const { data, error } = await supabase
    .from('profiles')
    .upsert(profileInput, { onConflict: 'id' })
    .select('*')
    .single();

  if (error) {
    throwDatabaseError(error, 'Unable to create user profile');
  }

  return mapProfile(data);
}

async function buildAuthResponse(
  supabase: SupabaseClient<Database>,
  session: Session,
  profileOverride?: ProfileDto,
): Promise<AuthResponseDto> {
  const user = toAuthenticatedUser(session.user);
  const profile = profileOverride ?? (await ensureProfile(supabase, user));

  return {
    user: {
      id: user.id,
      email: user.email,
    },
    profile,
    session: mapSession(session),
  };
}

export async function signUpWithPassword(
  supabase: SupabaseClient<Database>,
  supabaseAuth: SupabaseClient<Database>,
  input: AuthPayload,
): Promise<AuthResponseDto> {
  const email = normalizeEmail(input.email);
  await normalizePreferencesInput(supabase, input, {
    enforceMinimumGenres: true,
  });

  const { data: created, error: createError } =
    await supabase.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
      user_metadata: {
        display_name: input.displayName?.trim() || undefined,
        username: input.username?.trim() || undefined,
      },
    });

  if (createError) {
    mapAuthError(createError);
  }

  if (!created.user) {
    throw badRequest('Unable to create account');
  }

  const profile = await upsertProfileFromAuth(
    supabase,
    {
      id: created.user.id,
      email: created.user.email ?? email,
    },
    input,
  );

  const { data, error } = await supabaseAuth.auth.signInWithPassword({
    email,
    password: input.password,
  });

  if (error) {
    mapAuthError(error);
  }

  if (!data.session) {
    throw unauthorized('Unable to create a session for this account');
  }

  return buildAuthResponse(supabase, data.session, profile);
}

export async function signInWithPassword(
  supabase: SupabaseClient<Database>,
  supabaseAuth: SupabaseClient<Database>,
  input: Pick<AuthPayload, 'email' | 'password'>,
): Promise<AuthResponseDto> {
  if (!input.email.trim() || !input.password) {
    throw unauthorized(invalidCredentialsMessage);
  }

  const { data, error } = await supabaseAuth.auth.signInWithPassword({
    email: normalizeEmail(input.email),
    password: input.password,
  });

  if (error) {
    throw unauthorized(invalidCredentialsMessage);
  }

  if (!data.session) {
    throw unauthorized(invalidCredentialsMessage);
  }

  return buildAuthResponse(supabase, data.session);
}

export async function refreshAuthSession(
  supabase: SupabaseClient<Database>,
  supabaseAuth: SupabaseClient<Database>,
  input: RefreshPayload,
): Promise<AuthResponseDto> {
  const { data, error } = await supabaseAuth.auth.refreshSession({
    refresh_token: input.refreshToken,
  });

  if (error || !data.session) {
    throw unauthorized('Invalid or expired refresh token');
  }

  return buildAuthResponse(supabase, data.session);
}

export async function revokeAuthSession(
  supabase: SupabaseClient<Database>,
  accessToken: string,
): Promise<void> {
  const { error } = await supabase.auth.admin.signOut(accessToken);

  if (error) {
    throw unauthorized('Invalid or expired authentication token');
  }
}

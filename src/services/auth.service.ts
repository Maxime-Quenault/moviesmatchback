import type { Session, SupabaseClient, User } from '@supabase/supabase-js';

import { ApiError, badRequest, conflict, unauthorized, upstreamError } from '../lib/api-error.js';
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
    message.includes('already') ||
    message.includes('registered') ||
    message.includes('exists')
  ) {
    throw conflict('An account already exists for this email address');
  }

  if (
    error.status === 400 || error.status === 422 ||
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
  const fallbackName = user.email?.split('@')[0] ?? 'Utilisateur';
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
  if (session.user.is_anonymous || !session.user.email_confirmed_at) {
    throw new ApiError(403, 'EMAIL_NOT_VERIFIED', 'Verifie ton adresse email pour te connecter.');
  }
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
): Promise<{ email: string; confirmationRequired: true }> {
  const email = normalizeEmail(input.email);
  await normalizePreferencesInput(supabase, input, {
    enforceMinimumGenres: true,
  });

  const { data: created, error: createError } =
    await supabase.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: false,
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

  try {
    await upsertProfileFromAuth(supabase, {
      id: created.user.id, email: created.user.email ?? email,
    }, input);
    // Existing users only: OTP must never create a profile-free account.
    const { error } = await supabaseAuth.auth.signInWithOtp({
      email, options: { shouldCreateUser: false },
    });
    if (error) throw upstreamError('Impossible d envoyer le code de verification');
  } catch (error) {
    const { error: rollbackError } = await supabase.auth.admin.deleteUser(created.user.id);
    if (rollbackError) {
      throw upstreamError('Inscription interrompue; nettoyage du compte impossible', rollbackError);
    }
    throw error;
  }
  return { email, confirmationRequired: true };
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
    if (error.code === 'email_not_confirmed') {
      throw new ApiError(403, 'EMAIL_NOT_VERIFIED', 'Verifie ton adresse email pour te connecter.');
    }
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
  const { error } = await supabase.auth.admin.signOut(accessToken, 'local');

  if (error) {
    throw unauthorized('Invalid or expired authentication token');
  }
}

export async function sendVerificationCode(supabaseAuth: SupabaseClient<Database>, email: string): Promise<void> {
  const { error } = await supabaseAuth.auth.signInWithOtp({
    email: normalizeEmail(email), options: { shouldCreateUser: false },
  });
  // Do not disclose whether this address has an account.
  if (error && error.status !== 400 && error.status !== 422) {
    throw upstreamError('Impossible d envoyer le code de verification');
  }
}

export async function verifyEmailCode(
  supabase: SupabaseClient<Database>, supabaseAuth: SupabaseClient<Database>,
  email: string, token: string,
): Promise<AuthResponseDto> {
  const { data, error } = await supabaseAuth.auth.verifyOtp({
    email: normalizeEmail(email), token, type: 'email',
  });
  if (error || !data.session) throw unauthorized('Code invalide ou expire');
  return buildAuthResponse(supabase, data.session);
}

export async function requestPasswordReset(supabaseAuth: SupabaseClient<Database>, email: string): Promise<void> {
  const { error } = await supabaseAuth.auth.resetPasswordForEmail(normalizeEmail(email));
  if (error && error.status !== 400 && error.status !== 422) {
    throw upstreamError('Impossible d envoyer le code de recuperation');
  }
}

export async function resetPasswordWithCode(
  supabase: SupabaseClient<Database>, supabaseAuth: SupabaseClient<Database>,
  input: { email: string; token: string; password: string },
): Promise<void> {
  const { data, error } = await supabaseAuth.auth.verifyOtp({
    email: normalizeEmail(input.email), token: input.token, type: 'recovery',
  });
  if (error || !data.user || !data.session) throw unauthorized('Code invalide ou expire');
  const { error: updateError } = await supabase.auth.admin.updateUserById(data.user.id, { password: input.password });
  if (updateError) throw upstreamError('Impossible de modifier le mot de passe');
  const { error: revokeError } = await supabase.auth.admin.signOut(data.session.access_token, 'global');
  if (revokeError) throw upstreamError('Mot de passe modifie; fermeture des sessions impossible');
}

export async function deleteAccount(
  supabase: SupabaseClient<Database>, supabaseAuth: SupabaseClient<Database>,
  user: AuthenticatedUser, password: string, avatarBucket: string,
): Promise<void> {
  if (!user.email) throw unauthorized();
  const { data, error } = await supabaseAuth.auth.signInWithPassword({ email: user.email, password });
  if (error || data.user?.id !== user.id) throw unauthorized(invalidCredentialsMessage);
  // Supabase will refuse deleting a user who still owns storage objects.
  for (;;) {
    const { data: files, error: listError } = await supabase.storage.from(avatarBucket).list(user.id, { limit: 100 });
    if (listError) {
      // No bucket yet is normal for users who never uploaded an avatar.
      if (String(listError.message).toLowerCase().includes('not found')) break;
      throw upstreamError('Impossible de supprimer les photos du compte');
    }
    if (!files?.length) break;
    const { error: removeError } = await supabase.storage.from(avatarBucket).remove(files.map((file) => `${user.id}/${file.name}`));
    if (removeError) throw upstreamError('Impossible de supprimer les photos du compte');
  }
  const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
  if (deleteError) throw upstreamError('Impossible de supprimer le compte');
}

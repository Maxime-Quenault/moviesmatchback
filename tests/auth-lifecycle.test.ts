import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/types/database.js';
import { signUpWithPassword, resetPasswordWithCode, deleteAccount } from '../src/services/auth.service.js';

vi.mock('../src/services/preference.service.js', () => ({
  normalizePreferencesInput: vi.fn().mockResolvedValue({ preferredGenres: ['Action', 'Drame', 'Thriller'], releaseYearMin: null, releaseYearMax: null }),
}));

describe('Account lifecycle', () => {
  const input = { email: 'alice@example.com', password: 'Password123', preferredGenres: ['Action', 'Drame', 'Thriller'] };
  let createUser: ReturnType<typeof vi.fn>;
  let deleteUser: ReturnType<typeof vi.fn>;
  let otp: ReturnType<typeof vi.fn>;
  let profile: ReturnType<typeof vi.fn>;
  let admin: SupabaseClient<Database>;
  let auth: SupabaseClient<Database>;
  beforeEach(() => {
    createUser = vi.fn().mockResolvedValue({ data: { user: { id: 'alice', email: input.email } }, error: null });
    deleteUser = vi.fn().mockResolvedValue({ error: null });
    otp = vi.fn().mockResolvedValue({ error: null });
    profile = vi.fn().mockResolvedValue({ data: { id: 'alice' }, error: null });
    const query = { upsert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), single: profile };
    admin = { auth: { admin: { createUser, deleteUser } }, from: () => query } as unknown as SupabaseClient<Database>;
    auth = { auth: { signInWithOtp: otp } } as unknown as SupabaseClient<Database>;
  });
  it('creates an unconfirmed account and sends a code without issuing tokens', async () => {
    expect(await signUpWithPassword(admin, auth, input)).toEqual({ email: input.email, confirmationRequired: true });
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ email_confirm: false }));
    expect(otp).toHaveBeenCalledWith({ email: input.email, options: { shouldCreateUser: false } });
    expect(deleteUser).not.toHaveBeenCalled();
  });
  it('rolls back the newly created account when profile creation fails', async () => {
    profile.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate username' } });
    await expect(signUpWithPassword(admin, auth, input)).rejects.toThrow();
    expect(deleteUser).toHaveBeenCalledWith('alice');
    expect(otp).not.toHaveBeenCalled();
  });
  it('rolls back when email delivery fails, allowing a clean retry', async () => {
    otp.mockResolvedValue({ error: { message: 'SMTP unavailable', status: 500 } });
    await expect(signUpWithPassword(admin, auth, input)).rejects.toThrow();
    expect(deleteUser).toHaveBeenCalledWith('alice');
  });
  it('never deletes an existing account after a duplicate signup', async () => {
    createUser.mockResolvedValue({ data: { user: null }, error: { message: 'already registered', status: 422 } });
    await expect(signUpWithPassword(admin, auth, input)).rejects.toThrow();
    expect(deleteUser).not.toHaveBeenCalled();
  });
  it('rejects an invalid recovery code before changing the password', async () => {
    const updateUserById = vi.fn();
    (admin.auth.admin as unknown as Record<string, unknown>).updateUserById = updateUserById;
    (auth.auth as unknown as Record<string, unknown>).verifyOtp = vi.fn().mockResolvedValue({ data: {}, error: { message: 'Expired' } });
    await expect(resetPasswordWithCode(admin, auth, { ...input, token: '123456' })).rejects.toThrow('Code invalide');
    expect(updateUserById).not.toHaveBeenCalled();
  });
  it('requires reauthentication before account deletion', async () => {
    (auth.auth as unknown as Record<string, unknown>).signInWithPassword = vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'Wrong password' } });
    await expect(deleteAccount(admin, auth, { id: 'alice', email: input.email }, 'wrong', 'avatars')).rejects.toThrow();
    expect(deleteUser).not.toHaveBeenCalled();
  });
});

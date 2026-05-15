import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import {
  invalidCredentialsMessage,
  signInWithPassword,
} from '../src/services/auth.service.js';
import type { Database } from '../src/types/database.js';

function supabaseWithAdminCreateUser(createUser = vi.fn()) {
  return {
    auth: {
      admin: {
        createUser,
      },
    },
  } as unknown as SupabaseClient<Database>;
}

function supabaseAuthWithPasswordResult(
  result: Awaited<
    ReturnType<SupabaseClient<Database>['auth']['signInWithPassword']>
  >,
) {
  return {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue(result),
    },
  } as unknown as SupabaseClient<Database>;
}

describe('signInWithPassword', () => {
  it('rejects an unknown account without creating a user', async () => {
    const createUser = vi.fn();
    const supabase = supabaseWithAdminCreateUser(createUser);
    const supabaseAuth = supabaseAuthWithPasswordResult({
      data: { user: null, session: null },
      error: {
        name: 'AuthApiError',
        message: 'Invalid login credentials',
        status: 400,
      },
    });

    await expect(
      signInWithPassword(supabase, supabaseAuth, {
        email: 'missing@example.com',
        password: 'WrongPassword1',
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: invalidCredentialsMessage,
    });

    expect(createUser).not.toHaveBeenCalled();
    expect(supabaseAuth.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'missing@example.com',
      password: 'WrongPassword1',
    });
  });

  it('uses the same message when the password is wrong', async () => {
    const supabase = supabaseWithAdminCreateUser();
    const supabaseAuth = supabaseAuthWithPasswordResult({
      data: { user: null, session: null },
      error: {
        name: 'AuthApiError',
        message: 'Invalid login credentials',
        status: 400,
      },
    });

    await expect(
      signInWithPassword(supabase, supabaseAuth, {
        email: 'known@example.com',
        password: 'WrongPassword1',
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: invalidCredentialsMessage,
    });
  });

  it('rejects empty signin credentials before any auth call', async () => {
    const supabase = supabaseWithAdminCreateUser();
    const supabaseAuth = supabaseAuthWithPasswordResult({
      data: { user: null, session: null },
      error: null,
    });

    await expect(
      signInWithPassword(supabase, supabaseAuth, {
        email: ' ',
        password: '',
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: invalidCredentialsMessage,
    });

    expect(supabaseAuth.auth.signInWithPassword).not.toHaveBeenCalled();
  });
});

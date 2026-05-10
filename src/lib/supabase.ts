import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { FastifyInstance } from 'fastify';

import {
  hasSupabaseAuthConfig,
  hasSupabaseConfig,
  type AppEnv,
} from '../config/env.js';
import type { Database } from '../types/database.js';
import { serviceUnavailable } from './api-error.js';

export function createSupabaseClient(env: AppEnv): SupabaseClient<Database> | null {
  if (!hasSupabaseConfig(env)) {
    return null;
  }

  return createClient<Database>(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function createSupabaseAuthClient(
  env: AppEnv,
): SupabaseClient<Database> | null {
  if (!hasSupabaseAuthConfig(env)) {
    return null;
  }

  return createClient<Database>(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function requireSupabase(app: FastifyInstance): SupabaseClient<Database> {
  if (!app.supabase) {
    throw serviceUnavailable(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    );
  }

  return app.supabase;
}

export function requireSupabaseAuth(
  app: FastifyInstance,
): SupabaseClient<Database> {
  if (!app.supabaseAuth) {
    throw serviceUnavailable(
      'Supabase Auth is not configured. Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.',
    );
  }

  return app.supabaseAuth;
}

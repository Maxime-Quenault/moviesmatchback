import 'dotenv/config';

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  APP_HOST: z.string().default('0.0.0.0'),
  APP_PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGIN: z.string().default('*'),
  SUPABASE_URL: z.string().min(1).optional(),
  SUPABASE_API_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  TMDB_ACCESS_TOKEN: z.string().min(1).optional(),
  TMDB_API_KEY: z.string().min(1).optional(),
  TMDB_BASE_URL: z.string().url().default('https://api.themoviedb.org/3'),
  TMDB_IMAGE_BASE_URL: z.string().url().default('https://image.tmdb.org/t/p/w500'),
  TMDB_LANGUAGE: z.string().min(2).default('fr-FR'),
  JIKAN_BASE_URL: z.string().url().default('https://api.jikan.moe/v4'),
  CATALOG_SYNC_TOKEN: z.string().min(1).optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(): AppEnv {
  return envSchema.parse(process.env);
}

export function hasSupabaseConfig(env: AppEnv): boolean {
  return Boolean(resolveSupabaseApiUrl(env) && env.SUPABASE_SERVICE_ROLE_KEY);
}

export function hasSupabaseAuthConfig(env: AppEnv): boolean {
  return Boolean(
    resolveSupabaseApiUrl(env) &&
      env.SUPABASE_ANON_KEY &&
      env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function hasTmdbConfig(env: AppEnv): boolean {
  return Boolean(env.TMDB_ACCESS_TOKEN || env.TMDB_API_KEY);
}

export function resolveSupabaseApiUrl(env: AppEnv): string | undefined {
  if (env.SUPABASE_API_URL) {
    return env.SUPABASE_API_URL;
  }

  if (!env.SUPABASE_URL) {
    return undefined;
  }

  if (env.SUPABASE_URL.startsWith('http://') || env.SUPABASE_URL.startsWith('https://')) {
    return env.SUPABASE_URL;
  }

  const projectRef = env.SUPABASE_URL.match(
    /^postgres(?:ql)?:\/\/[^:/.]+\.([a-z0-9]+):/i,
  )?.[1];

  return projectRef ? `https://${projectRef}.supabase.co` : undefined;
}

export function parseCorsOrigin(value: string): true | string[] {
  if (value.trim() === '*') {
    return true;
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

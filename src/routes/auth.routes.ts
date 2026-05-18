import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { unauthorized } from '../lib/api-error.js';
import { requireSupabase, requireSupabaseAuth } from '../lib/supabase.js';
import {
  refreshAuthSession,
  revokeAuthSession,
  signInWithPassword,
  signUpWithPassword,
} from '../services/auth.service.js';
import { getProfileWithStats } from '../services/user.service.js';
import type { AuthenticatedUser } from '../types/database.js';

const passwordSchema = z
  .string()
  .min(8, 'Password must contain at least 8 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number');

const credentialsSchema = z.object({
  email: z.string().trim().email(),
  password: passwordSchema,
});

const signInSchema = z.object({
  email: z.string().trim(),
  password: z.string(),
});

const signUpSchema = credentialsSchema
  .extend({
    displayName: z.string().trim().min(1).max(80).optional(),
    username: z
      .string()
      .trim()
      .min(3)
      .max(32)
      .regex(/^[a-zA-Z0-9_]+$/)
      .optional(),
    preferredGenres: z.array(z.string().trim().min(1)).min(3),
    releaseYearMin: z.coerce.number().int().nullable().optional(),
    releaseYearMax: z.coerce.number().int().nullable().optional(),
  })
  .superRefine((value, context) => {
    if (
      value.releaseYearMin !== undefined &&
      value.releaseYearMin !== null &&
      value.releaseYearMax !== undefined &&
      value.releaseYearMax !== null &&
      value.releaseYearMin > value.releaseYearMax
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'releaseYearMin cannot be greater than releaseYearMax',
        path: ['releaseYearMin'],
      });
    }
  });

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

function currentUser(request: FastifyRequest): AuthenticatedUser {
  if (!request.user) {
    throw unauthorized();
  }

  return request.user;
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/signup', async (request, reply) => {
    const body = signUpSchema.parse(request.body);
    const supabase = requireSupabase(app);
    const supabaseAuth = requireSupabaseAuth(app);
    const response = await signUpWithPassword(supabase, supabaseAuth, body);

    return reply.status(201).send(response);
  });

  app.post('/signin', async (request) => {
    const body = signInSchema.parse(request.body);
    const supabase = requireSupabase(app);
    const supabaseAuth = requireSupabaseAuth(app);

    return signInWithPassword(supabase, supabaseAuth, body);
  });

  app.post('/refresh', async (request) => {
    const body = refreshSchema.parse(request.body);
    const supabase = requireSupabase(app);
    const supabaseAuth = requireSupabaseAuth(app);

    return refreshAuthSession(supabase, supabaseAuth, body);
  });

  app.post('/logout', { preHandler: app.requireAuth }, async (request) => {
    const authorization = request.headers.authorization ?? '';
    const token = authorization.replace(/^Bearer\s+/i, '');
    const supabase = requireSupabase(app);

    await revokeAuthSession(supabase, token);
    return { ok: true };
  });

  app.get('/me', { preHandler: app.requireAuth }, async (request) => {
    const supabase = requireSupabase(app);

    return getProfileWithStats(supabase, currentUser(request));
  });
};

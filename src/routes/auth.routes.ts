import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { unauthorized } from '../lib/api-error.js';
import { requireSupabase, requireSupabaseAuth } from '../lib/supabase.js';
import {
  refreshAuthSession,
  revokeAuthSession,
  signInWithPassword,
  signUpWithPassword,
  sendVerificationCode,
  verifyEmailCode,
  requestPasswordReset,
  resetPasswordWithCode,
  deleteAccount,
} from '../services/auth.service.js';
import { getProfileWithStats } from '../services/user.service.js';
import type { AuthenticatedUser } from '../types/database.js';

const passwordSchema = z
  .string()
  .min(8, 'Password must contain at least 8 characters')
  .max(128, 'Password must contain at most 128 characters')
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
  const emailSchema = z.object({ email: z.string().trim().email().max(254) });
  const codeSchema = emailSchema.extend({ token: z.string().regex(/^\d{6,10}$/) });
  const mailLimit = { rateLimit: { max: 5, timeWindow: '15 minutes' } };

  app.post('/verify-email', { config: mailLimit }, async (request) => {
    const body = codeSchema.parse(request.body);
    return verifyEmailCode(requireSupabase(app), requireSupabaseAuth(app), body.email, body.token);
  });
  app.post('/resend-email', { config: mailLimit }, async (request) => {
    const body = emailSchema.parse(request.body);
    await sendVerificationCode(requireSupabaseAuth(app), body.email);
    return { ok: true };
  });
  app.post('/forgot-password', { config: mailLimit }, async (request) => {
    const body = emailSchema.parse(request.body);
    await requestPasswordReset(requireSupabaseAuth(app), body.email);
    return { ok: true };
  });
  app.post('/reset-password', { config: mailLimit }, async (request) => {
    const body = codeSchema.extend({ password: passwordSchema.max(128) }).parse(request.body);
    await resetPasswordWithCode(requireSupabase(app), requireSupabaseAuth(app), body);
    return { ok: true };
  });
  app.post('/delete-account', { preHandler: app.requireAuth, config: mailLimit }, async (request) => {
    const body = z.object({ password: z.string().min(1).max(128) }).parse(request.body);
    await deleteAccount(requireSupabase(app), requireSupabaseAuth(app), currentUser(request), body.password, app.config.SUPABASE_AVATAR_BUCKET);
    return { ok: true };
  });
  app.post('/signup', { config: mailLimit }, async (request, reply) => {
    const body = signUpSchema.parse(request.body);
    const supabase = requireSupabase(app);
    const supabaseAuth = requireSupabaseAuth(app);
    const response = await signUpWithPassword(supabase, supabaseAuth, body);

    return reply.status(201).send(response);
  });

  app.post('/signin', { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } }, async (request) => {
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

    return getProfileWithStats(supabase, app.config, currentUser(request));
  });
};

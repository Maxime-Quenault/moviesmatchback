import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { badRequest, unauthorized } from '../lib/api-error.js';
import { requireSupabase } from '../lib/supabase.js';
import {
  actionSchema,
  listIdParamSchema,
  listItemParamSchema,
  paginationSchema,
  profileIdParamSchema,
  titleIdParamSchema,
  titleTypeSchema,
  visibilitySchema,
} from '../schemas/common.js';
import {
  addListItem,
  createList,
  deleteList,
  followProfileByEmail,
  followProfile,
  listFollowing,
  listOwnLists,
  removeListItem,
  unfollowProfile,
  updateList,
} from '../services/list.service.js';
import {
  getUserPreferences,
  updateUserPreferences,
} from '../services/preference.service.js';
import {
  clearMediaActions,
  clearTitleActions,
  deleteMediaAction,
  deleteTitleAction,
  getDiscoverTitles,
  getProfileWithStats,
  profileAvatarMaxBytes,
  getSelections,
  getUserRecommendations,
  listMediaActions,
  setMediaAction,
  setTitleAction,
  syncMediaActions,
  updateProfile,
  uploadProfileAvatar,
} from '../services/user.service.js';
import type { AuthenticatedUser } from '../types/database.js';

function currentUser(request: FastifyRequest): AuthenticatedUser {
  if (!request.user) {
    throw unauthorized();
  }

  return request.user;
}

const discoverQuerySchema = paginationSchema.extend({
  type: titleTypeSchema.optional(),
});

const recommendationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(5),
  type: titleTypeSchema.optional(),
});

const actionBodySchema = z.object({
  action: actionSchema,
});

const mediaActionBodySchema = z.object({
  mediaKey: z.string().trim().min(1).max(160),
  action: actionSchema,
});

const mediaActionParamsSchema = z.object({
  mediaKey: z.string().trim().min(1).max(160),
});

const syncMediaActionsBodySchema = z.object({
  items: z
    .array(
      z.object({
        mediaKey: z.string().trim().min(1).max(160),
        action: actionSchema,
        updatedAt: z.string().trim().min(1).optional(),
      }),
    )
    .max(500)
    .default([]),
});

const updateProfileBodySchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/)
    .nullable()
    .optional(),
  displayName: z.string().trim().min(1).max(80).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  bio: z.string().trim().max(280).nullable().optional(),
  isPublic: z.boolean().optional(),
});

const updatePreferencesBodySchema = z
  .object({
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

const createListBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(280).nullable().optional(),
  visibility: visibilitySchema.default('private'),
});

const updateListBodySchema = createListBodySchema.partial();

const addListItemBodySchema = z.object({
  titleId: z.string().min(1),
  position: z.number().int().min(0).optional(),
});

const followByEmailBodySchema = z.object({
  email: z.string().trim().email(),
});

export const meRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get('/profile', async (request) => {
    const user = currentUser(request);
    const supabase = requireSupabase(app);

    return getProfileWithStats(supabase, user);
  });

  app.put('/profile', async (request) => {
    const user = currentUser(request);
    const body = updateProfileBodySchema.parse(request.body);
    const supabase = requireSupabase(app);

    return updateProfile(supabase, user, body);
  });

  app.post('/profile/avatar', async (request) => {
    const user = currentUser(request);
    const supabase = requireSupabase(app);
    const file = await request.file({
      limits: {
        files: 1,
        fileSize: profileAvatarMaxBytes,
      },
    });

    if (!file) {
      throw badRequest('Aucune image selectionnee');
    }

    const buffer = await file.toBuffer();
    return uploadProfileAvatar(supabase, app.config, user, {
      buffer,
      mimeType: file.mimetype,
    });
  });

  app.get('/preferences', async (request) => {
    const user = currentUser(request);
    const supabase = requireSupabase(app);

    return getUserPreferences(supabase, user);
  });

  app.put('/preferences', async (request) => {
    const user = currentUser(request);
    const body = updatePreferencesBodySchema.parse(request.body);
    const supabase = requireSupabase(app);

    return updateUserPreferences(supabase, user, body);
  });

  app.get('/selections', async (request) => {
    const user = currentUser(request);
    const supabase = requireSupabase(app);

    return getSelections(supabase, user.id);
  });

  app.delete('/selections', async (request) => {
    const user = currentUser(request);
    const supabase = requireSupabase(app);

    await clearTitleActions(supabase, user.id);
    return { ok: true };
  });

  app.get('/media-actions', async (request) => {
    const user = currentUser(request);
    const supabase = requireSupabase(app);

    return { items: await listMediaActions(supabase, user.id) };
  });

  app.post('/media-actions/sync', async (request) => {
    const user = currentUser(request);
    const body = syncMediaActionsBodySchema.parse(request.body);
    const supabase = requireSupabase(app);

    return syncMediaActions(supabase, app.config, user.id, body.items);
  });

  app.put('/media-actions', async (request) => {
    const user = currentUser(request);
    const body = mediaActionBodySchema.parse(request.body);
    const supabase = requireSupabase(app);

    return setMediaAction(supabase, user.id, body);
  });

  app.delete('/media-actions', async (request) => {
    const user = currentUser(request);
    const supabase = requireSupabase(app);

    await clearMediaActions(supabase, user.id);
    return { ok: true };
  });

  app.delete('/media-actions/:mediaKey', async (request) => {
    const user = currentUser(request);
    const { mediaKey } = mediaActionParamsSchema.parse(request.params);
    const supabase = requireSupabase(app);

    await deleteMediaAction(supabase, user.id, mediaKey);
    return { ok: true };
  });

  app.get('/discover', async (request) => {
    const user = currentUser(request);
    const query = discoverQuerySchema.parse(request.query);
    const supabase = requireSupabase(app);

    return getDiscoverTitles(supabase, user.id, query);
  });

  app.get('/recommendations', async (request) => {
    const user = currentUser(request);
    const query = recommendationsQuerySchema.parse(request.query);
    const supabase = requireSupabase(app);

    return getUserRecommendations(supabase, user.id, query);
  });

  app.put('/titles/:titleId/action', async (request) => {
    const user = currentUser(request);
    const { titleId } = titleIdParamSchema.parse(request.params);
    const body = actionBodySchema.parse(request.body);
    const supabase = requireSupabase(app);

    return setTitleAction(supabase, user.id, titleId, body.action);
  });

  app.delete('/titles/:titleId/action', async (request) => {
    const user = currentUser(request);
    const { titleId } = titleIdParamSchema.parse(request.params);
    const supabase = requireSupabase(app);

    await deleteTitleAction(supabase, user.id, titleId);
    return { ok: true };
  });

  app.get('/lists', async (request) => {
    const user = currentUser(request);
    const supabase = requireSupabase(app);

    return { items: await listOwnLists(supabase, user.id) };
  });

  app.post('/lists', async (request, reply) => {
    const user = currentUser(request);
    const body = createListBodySchema.parse(request.body);
    const supabase = requireSupabase(app);
    const list = await createList(supabase, user.id, body);

    return reply.status(201).send(list);
  });

  app.patch('/lists/:listId', async (request) => {
    const user = currentUser(request);
    const { listId } = listIdParamSchema.parse(request.params);
    const body = updateListBodySchema.parse(request.body);
    const supabase = requireSupabase(app);

    return updateList(supabase, user.id, listId, body);
  });

  app.delete('/lists/:listId', async (request) => {
    const user = currentUser(request);
    const { listId } = listIdParamSchema.parse(request.params);
    const supabase = requireSupabase(app);

    await deleteList(supabase, user.id, listId);
    return { ok: true };
  });

  app.post('/lists/:listId/items', async (request) => {
    const user = currentUser(request);
    const { listId } = listIdParamSchema.parse(request.params);
    const body = addListItemBodySchema.parse(request.body);
    const supabase = requireSupabase(app);

    return addListItem(supabase, user.id, listId, body.titleId, body.position);
  });

  app.delete('/lists/:listId/items/:titleId', async (request) => {
    const user = currentUser(request);
    const { listId, titleId } = listItemParamSchema.parse(request.params);
    const supabase = requireSupabase(app);

    return removeListItem(supabase, user.id, listId, titleId);
  });

  app.get('/follows', async (request) => {
    const user = currentUser(request);
    const supabase = requireSupabase(app);

    return { items: await listFollowing(supabase, user.id) };
  });

  app.post('/follows/by-email', async (request) => {
    const user = currentUser(request);
    const body = followByEmailBodySchema.parse(request.body);
    const supabase = requireSupabase(app);

    await followProfileByEmail(supabase, user.id, body.email);
    return { ok: true };
  });

  app.post('/follows/:profileId', async (request) => {
    const user = currentUser(request);
    const { profileId } = profileIdParamSchema.parse(request.params);
    const supabase = requireSupabase(app);

    await followProfile(supabase, user.id, profileId);
    return { ok: true };
  });

  app.delete('/follows/:profileId', async (request) => {
    const user = currentUser(request);
    const { profileId } = profileIdParamSchema.parse(request.params);
    const supabase = requireSupabase(app);

    await unfollowProfile(supabase, user.id, profileId);
    return { ok: true };
  });
};

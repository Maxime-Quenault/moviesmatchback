import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { unauthorized } from '../lib/api-error.js';
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
  followProfile,
  listFollowing,
  listOwnLists,
  removeListItem,
  unfollowProfile,
  updateList,
} from '../services/list.service.js';
import {
  clearTitleActions,
  deleteTitleAction,
  getDiscoverTitles,
  getProfileWithStats,
  getSelections,
  getUserRecommendations,
  setTitleAction,
  updateProfile,
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

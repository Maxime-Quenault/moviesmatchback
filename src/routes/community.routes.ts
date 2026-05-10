import type { FastifyPluginAsync } from 'fastify';

import { requireSupabase } from '../lib/supabase.js';
import {
  listIdParamSchema,
  paginationSchema,
  profileIdParamSchema,
} from '../schemas/common.js';
import { getVisibleList, listPublicLists } from '../services/list.service.js';
import { getVisibleProfile } from '../services/user.service.js';

export const communityRoutes: FastifyPluginAsync = async (app) => {
  app.get('/lists', async (request) => {
    const query = paginationSchema.parse(request.query);
    const supabase = requireSupabase(app);

    return listPublicLists(supabase, query);
  });

  app.get('/lists/:listId', { preHandler: app.authenticateOptional }, async (request) => {
    const { listId } = listIdParamSchema.parse(request.params);
    const supabase = requireSupabase(app);

    return getVisibleList(supabase, listId, request.user?.id);
  });

  app.get('/profiles/:profileId', { preHandler: app.authenticateOptional }, async (request) => {
    const { profileId } = profileIdParamSchema.parse(request.params);
    const supabase = requireSupabase(app);

    return getVisibleProfile(supabase, profileId, request.user?.id);
  });
};

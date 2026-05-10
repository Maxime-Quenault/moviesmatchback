import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { requireSupabase } from '../lib/supabase.js';
import { paginationSchema, titleTypeSchema } from '../schemas/common.js';
import { getTitleById, listTitles } from '../services/title.service.js';

const listTitlesQuerySchema = paginationSchema.extend({
  type: titleTypeSchema.optional(),
  q: z.string().trim().min(1).optional(),
});

const titleParamsSchema = z.object({
  id: z.string().min(1),
});

export const titleRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (request) => {
    const query = listTitlesQuerySchema.parse(request.query);
    const supabase = requireSupabase(app);

    return listTitles(supabase, query);
  });

  app.get('/:id', async (request) => {
    const { id } = titleParamsSchema.parse(request.params);
    const supabase = requireSupabase(app);

    return getTitleById(supabase, id);
  });
};

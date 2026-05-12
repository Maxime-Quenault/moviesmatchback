import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { configurationError, unauthorized } from '../lib/api-error.js';
import { requireSupabase } from '../lib/supabase.js';
import { paginationSchema, titleTypeSchema } from '../schemas/common.js';
import {
  listExternalGenres,
  syncExternalCatalog,
} from '../services/catalog-sync.service.js';
import { getTitleById, listTitles } from '../services/title.service.js';

const listTitlesQuerySchema = paginationSchema.extend({
  type: titleTypeSchema.optional(),
  genre: z.string().trim().min(1).optional(),
  q: z.string().trim().min(1).optional(),
});

const externalGenresQuerySchema = z.object({
  type: titleTypeSchema,
  language: z.string().trim().min(2).optional(),
});

const genreIdsByTypeSchema = z.object({
  movie: z.array(z.coerce.number().int().positive()).optional(),
  series: z.array(z.coerce.number().int().positive()).optional(),
  anime: z.array(z.coerce.number().int().positive()).optional(),
});

const genreNamesByTypeSchema = z.object({
  movie: z.array(z.string().trim().min(1)).optional(),
  series: z.array(z.string().trim().min(1)).optional(),
  anime: z.array(z.string().trim().min(1)).optional(),
});

const syncCatalogBodySchema = z
  .object({
    type: titleTypeSchema.optional(),
    types: z.array(titleTypeSchema).min(1).optional(),
    genreId: z.coerce.number().int().positive().optional(),
    genreName: z.string().trim().min(1).optional(),
    genreIds: genreIdsByTypeSchema.optional(),
    genreNames: genreNamesByTypeSchema.optional(),
    allGenres: z.boolean().default(false),
    pages: z.coerce.number().int().min(1).max(5).default(1),
    limit: z.coerce.number().int().min(1).max(25).default(20),
    language: z.string().trim().min(2).optional(),
  })
  .superRefine((value, context) => {
    if ((value.genreId || value.genreName) && !value.type) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'type is required when using genreId or genreName',
        path: ['type'],
      });
    }
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

  app.get('/external-genres', async (request) => {
    const query = externalGenresQuerySchema.parse(request.query);

    return {
      items: await listExternalGenres(app.config, query.type, query.language),
    };
  });

  app.post('/sync', { preHandler: assertCatalogSyncAllowed(app) }, async (request) => {
    const body = syncCatalogBodySchema.parse(request.body);
    const supabase = requireSupabase(app);

    return syncExternalCatalog(supabase, app.config, {
      ...body,
      types: resolveRequestedTypes(body),
      genreIds: mergeSingleGenreId(body),
      genreNames: mergeSingleGenreName(body),
    });
  });

  app.get('/:id', async (request) => {
    const { id } = titleParamsSchema.parse(request.params);
    const supabase = requireSupabase(app);

    return getTitleById(supabase, id);
  });
};

function assertCatalogSyncAllowed(app: FastifyInstance) {
  return async (request: FastifyRequest) => {
    const expectedToken = app.config.CATALOG_SYNC_TOKEN;

    if (!expectedToken && app.config.NODE_ENV === 'production') {
      throw configurationError(
        'Catalog sync is not configured. Set CATALOG_SYNC_TOKEN in production.',
      );
    }

    if (!expectedToken) {
      return;
    }

    const receivedToken = request.headers['x-catalog-sync-token'];
    const token = Array.isArray(receivedToken) ? receivedToken[0] : receivedToken;

    if (token !== expectedToken) {
      throw unauthorized('Invalid catalog sync token');
    }
  };
}

function resolveRequestedTypes(body: z.infer<typeof syncCatalogBodySchema>) {
  if (body.type) {
    return [body.type];
  }

  return body.types;
}

function mergeSingleGenreId(body: z.infer<typeof syncCatalogBodySchema>) {
  const genreIds = { ...body.genreIds };

  if (body.type && body.genreId) {
    genreIds[body.type] = [...(genreIds[body.type] ?? []), body.genreId];
  }

  return genreIds;
}

function mergeSingleGenreName(body: z.infer<typeof syncCatalogBodySchema>) {
  const genreNames = { ...body.genreNames };

  if (body.type && body.genreName) {
    genreNames[body.type] = [...(genreNames[body.type] ?? []), body.genreName];
  }

  return genreNames;
}

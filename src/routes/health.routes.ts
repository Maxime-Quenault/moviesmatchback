import type { FastifyPluginAsync } from 'fastify';

import { hasSupabaseAuthConfig, hasSupabaseConfig } from '../config/env.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async () => {
    return {
      status: 'ok',
      service: 'moviesmatchback',
      timestamp: new Date().toISOString(),
      supabase: hasSupabaseConfig(app.config) ? 'configured' : 'missing',
      auth: hasSupabaseAuthConfig(app.config) ? 'configured' : 'missing',
    };
  });
};

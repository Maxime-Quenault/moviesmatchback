import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { loadEnv, parseCorsOrigin } from './config/env.js';
import { authPlugin } from './plugins/auth.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { supabasePlugin } from './plugins/supabase.js';
import { authRoutes } from './routes/auth.routes.js';
import { communityRoutes } from './routes/community.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { meRoutes } from './routes/me.routes.js';
import { titleRoutes } from './routes/title.routes.js';

export async function buildApp() {
  const config = loadEnv();
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
  });

  app.decorate('config', config);
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_request, body, done) => {
      const rawBody = typeof body === 'string' ? body : body.toString('utf8');

      if (rawBody.trim().length === 0) {
        done(null, undefined);
        return;
      }

      try {
        done(null, JSON.parse(rawBody));
      } catch (error) {
        const parseError =
          error instanceof Error ? error : new Error('Invalid JSON body');
        (parseError as Error & { statusCode?: number }).statusCode = 400;
        done(parseError, undefined);
      }
    },
  );

  await app.register(helmet);
  await app.register(cors, {
    origin: parseCorsOrigin(config.CORS_ORIGIN),
  });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
  });
  await app.register(errorHandlerPlugin);
  await app.register(supabasePlugin);
  await app.register(authPlugin);

  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(authRoutes, { prefix: '/v1/auth' });
  await app.register(titleRoutes, { prefix: '/v1/titles' });
  await app.register(meRoutes, { prefix: '/v1/me' });
  await app.register(communityRoutes, { prefix: '/v1/community' });

  return app;
}

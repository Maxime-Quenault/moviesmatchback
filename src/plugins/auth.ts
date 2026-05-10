import fp from 'fastify-plugin';

import { unauthorized } from '../lib/api-error.js';
import { requireSupabase } from '../lib/supabase.js';

function extractBearerToken(authorization?: string): string | null {
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token;
}

export const authPlugin = fp(async (app) => {
  app.decorateRequest('user', null);

  app.decorate('requireAuth', async (request) => {
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw unauthorized();
    }

    const supabase = requireSupabase(app);
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      throw unauthorized('Invalid or expired authentication token');
    }

    request.user = {
      id: data.user.id,
      email: data.user.email ?? null,
    };
  });

  app.decorate('authenticateOptional', async (request) => {
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      request.user = null;
      return;
    }

    const supabase = requireSupabase(app);
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      throw unauthorized('Invalid or expired authentication token');
    }

    request.user = {
      id: data.user.id,
      email: data.user.email ?? null,
    };
  });
});

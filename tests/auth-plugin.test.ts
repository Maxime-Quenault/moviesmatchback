import Fastify from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { authPlugin } from '../src/plugins/auth.js';
import { errorHandlerPlugin } from '../src/plugins/error-handler.js';
import type { Database } from '../src/types/database.js';

describe('Account authentication', () => {
  it.each([false, true])('rejects anonymous tokens (optional=%s)', async (optional) => {
    const app = Fastify();
    app.decorate('supabase', {
      auth: { getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'anonymous', is_anonymous: true } }, error: null,
      }) },
    } as unknown as SupabaseClient<Database>);
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin);
    app.get('/protected', {
      preHandler: optional ? app.authenticateOptional : app.requireAuth,
    }, async () => ({ ok: true }));
    try {
      const response = await app.inject({
        url: '/protected', headers: { authorization: 'Bearer anonymous-token' },
      });
      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});

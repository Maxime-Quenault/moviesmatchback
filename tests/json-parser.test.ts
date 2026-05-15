import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';

describe('JSON body parser', () => {
  it('allows empty JSON bodies on media action DELETE requests', async () => {
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/v1/me/media-actions/tmdb%3Atv%3A82817',
        headers: {
          'content-type': 'application/json',
        },
        payload: '',
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        error: {
          code: 'UNAUTHORIZED',
        },
      });
    } finally {
      await app.close();
    }
  });
});

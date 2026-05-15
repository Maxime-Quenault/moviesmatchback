import fp from 'fastify-plugin';
import { ZodError } from 'zod';

import { ApiError } from '../lib/api-error.js';

export const errorHandlerPlugin = fp(async (app) => {
  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
      },
    });
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request payload',
          details: error.flatten(),
        },
      });
    }

    const httpError = error as Error & {
      code?: unknown;
      statusCode?: unknown;
    };
    if (
      typeof httpError.statusCode === 'number' &&
      httpError.statusCode >= 400 &&
      httpError.statusCode < 500
    ) {
      return reply.status(httpError.statusCode).send({
        error: {
          code:
            typeof httpError.code === 'string' ? httpError.code : 'BAD_REQUEST',
          message: httpError.message,
        },
      });
    }

    app.log.error(error);
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Unexpected server error',
      },
    });
  });
});
